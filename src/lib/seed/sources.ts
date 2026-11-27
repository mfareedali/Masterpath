/**
 * Source registry (data/sources.json): which official page each target is read from and which fields the page is
 * expected to state. Pure functions (no I/O, no clock): scripts pass the data and `now`.
 *
 * A registry entry is only a place to LOOK. A value still becomes a fact only through the proposal rules in ./ingest.ts
 * (verbatim snippet on the fetched official page + schema-valid value).
 */
import { createHash } from 'node:crypto';
import sourcesSchema from '@data/schemas/sources.schema.json';
import { isAllowedHost } from '../net/hosts';
import { COUNTRY_FACT_KEYS, INSTITUTION_FACT_KEYS, PROGRAM_FACT_KEYS } from './fields';
import { validateAgainst, type SchemaIssue } from './schemas';

export type SourceTarget =
  | { type: 'program'; id: string }
  | { type: 'institution'; id: string }
  | { type: 'conversion_rule'; id: string }
  | { type: 'country'; country: string }
  | { type: 'fx'; currency: string };

export interface SourcePage {
  id: string;
  url: string;
  target: SourceTarget;
  fields: string[];
  role?: 'primary' | 'secondary';
  notes?: string;
}

export interface SourcesFile {
  version: number;
  pages: SourcePage[];
}

/**
 * Country keys that are NOT in the database yet (visa fee, processing time, work rights). Pages may be registered for
 * them so the data gets collected, but they only ever become proposals in data/proposals/new-fields/.
 */
export const PROPOSED_COUNTRY_KEYS = ['visa_fee', 'visa_processing_time', 'student_work_rights'] as const;

export const FX_FIELD = 'pkr_per_unit';
export const CONVERSION_FIELD = 'rule';

/** What the seed files contain (ids only): enough to check that registry targets exist. */
export interface SeedIds {
  programs: ReadonlyMap<string, { country: string; institution_id: string }>;
  institutions: ReadonlyMap<string, { country: string }>;
  conversionRules: ReadonlySet<string>;
  fxCurrencies: ReadonlySet<string>;
  countries: ReadonlySet<string>;
}

export interface SourceIssue {
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

export function targetKey(t: SourceTarget): string {
  switch (t.type) {
    case 'country':
      return `country:${t.country}`;
    case 'fx':
      return `fx:${t.currency}`;
    default:
      return `${t.type}:${t.id}`;
  }
}

/** Lower-case host without "www.", no fragment, no tracking parameters, sorted query, no trailing slash. */
export function canonicalUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw.trim().toLowerCase();
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !/^(utm_|fbclid$|gclid$|mc_)/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
  const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : '';
  return `${u.protocol}//${host}${path}${query}`;
}

function allowedFields(t: SourceTarget): readonly string[] {
  switch (t.type) {
    case 'program':
      return PROGRAM_FACT_KEYS;
    case 'institution':
      return INSTITUTION_FACT_KEYS;
    case 'country':
      return [...COUNTRY_FACT_KEYS, ...PROPOSED_COUNTRY_KEYS];
    case 'fx':
      return [FX_FIELD];
    case 'conversion_rule':
      return [CONVERSION_FIELD];
  }
}

/** Schema + cross checks: ids and URLs unique, hosts on the allowlist, targets and fields exist. */
export function validateSources(data: unknown, seed: SeedIds, allowlist: readonly string[]): SourceIssue[] {
  const issues: SourceIssue[] = [];
  const schemaIssues: SchemaIssue[] = validateAgainst(sourcesSchema, data);
  for (const s of schemaIssues) issues.push({ severity: 'error', path: s.path, message: `schema: ${s.message}` });
  if (schemaIssues.length > 0) return issues;

  const file = data as SourcesFile;
  const ids = new Map<string, number>();
  const urlTargets = new Map<string, number>();
  file.pages.forEach((p, i) => {
    const base = `/pages/${i}`;
    if (ids.has(p.id)) issues.push({ severity: 'error', path: `${base}/id`, message: `duplicate page id "${p.id}" (first at /pages/${ids.get(p.id)})` });
    else ids.set(p.id, i);

    const pairKey = `${canonicalUrl(p.url)}|${targetKey(p.target)}`;
    if (urlTargets.has(pairKey)) {
      issues.push({ severity: 'error', path: `${base}/url`, message: `the same page is registered twice for ${targetKey(p.target)} (first at /pages/${urlTargets.get(pairKey)})` });
    } else urlTargets.set(pairKey, i);

    let host = '';
    try {
      host = new URL(p.url).hostname;
    } catch {
      /* the schema already rejected it */
    }
    if (!isAllowedHost(host, allowlist)) {
      issues.push({ severity: 'error', path: `${base}/url`, message: `${host} is not on data/ingest.allowlist.json: add the official domain first` });
    }

    const t = p.target;
    if (t.type === 'program' && !seed.programs.has(t.id)) issues.push({ severity: 'error', path: `${base}/target`, message: `unknown program "${t.id}"` });
    if (t.type === 'institution' && !seed.institutions.has(t.id)) issues.push({ severity: 'error', path: `${base}/target`, message: `unknown institution "${t.id}"` });
    if (t.type === 'conversion_rule' && !seed.conversionRules.has(t.id)) issues.push({ severity: 'error', path: `${base}/target`, message: `unknown conversion rule "${t.id}"` });
    if (t.type === 'fx' && !seed.fxCurrencies.has(t.currency)) issues.push({ severity: 'error', path: `${base}/target`, message: `no fx_rates row for ${t.currency}` });
    if (t.type === 'country' && !seed.countries.has(t.country)) issues.push({ severity: 'warning', path: `${base}/target`, message: `no country facts for ${t.country} yet` });

    const allowed = allowedFields(t);
    for (const f of p.fields) {
      if (!allowed.includes(f)) issues.push({ severity: 'error', path: `${base}/fields`, message: `"${f}" is not a field of a ${t.type} (allowed: ${allowed.join(', ')})` });
    }
  });
  return issues;
}

/* ---------------- page state (content hashes) ---------------- */

export interface PageState {
  hash: string;
  etag: string | null;
  last_modified: string | null;
  /** ISO timestamp of the last successful fetch. */
  checked_at: string;
  final_url: string;
  chars: number;
  /** Whether an extraction ran on exactly this content (a hash recorded by a fetch-only run does not count). */
  extracted: boolean;
}

export interface StateFile {
  version: 1;
  pages: Record<string, PageState>;
}

export function emptyState(): StateFile {
  return { version: 1, pages: {} };
}

export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/* ---------------- selecting pages for a run ---------------- */

export interface SelectOptions {
  /** Only pages whose target is in this country (ISO-2, UK for the United Kingdom). */
  country?: string;
  /** Only pages not checked in the last N days (never-checked pages always qualify). */
  staleDays?: number;
  /** Only these page ids. */
  only?: readonly string[];
  /** Only these target types. */
  types?: readonly SourceTarget['type'][];
  now: Date;
}

const DAY_MS = 86_400_000;

/** The country a target belongs to, or null (fx and conversion rules have none). */
export function countryOfTarget(t: SourceTarget, seed: SeedIds): string | null {
  switch (t.type) {
    case 'country':
      return t.country;
    case 'program':
      return seed.programs.get(t.id)?.country ?? null;
    case 'institution':
      return seed.institutions.get(t.id)?.country ?? null;
    default:
      return null;
  }
}

export function selectPages(file: SourcesFile, state: StateFile, seed: SeedIds, o: SelectOptions): SourcePage[] {
  return file.pages.filter((p) => {
    if (o.only && !o.only.includes(p.id)) return false;
    if (o.types && !o.types.includes(p.target.type)) return false;
    if (o.country && countryOfTarget(p.target, seed) !== o.country) return false;
    if (o.staleDays !== undefined) {
      const st = state.pages[p.url];
      if (st) {
        const age = (o.now.getTime() - Date.parse(st.checked_at)) / DAY_MS;
        if (Number.isFinite(age) && age < o.staleDays) return false;
      }
    }
    return true;
  });
}

/** Pages grouped by target, in registry order: one proposals file is written per target. */
export function groupByTarget(pages: readonly SourcePage[]): Map<string, SourcePage[]> {
  const out = new Map<string, SourcePage[]>();
  for (const p of pages) out.set(targetKey(p.target), [...(out.get(targetKey(p.target)) ?? []), p]);
  return out;
}
