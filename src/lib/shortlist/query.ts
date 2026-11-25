/**
 * Shortlist URL state: zod parsing of the query string and an href builder for chips.
 * Pure, safe on server and client. All state lives in the URL so chips are plain links (no client JS).
 *
 * Param names:
 *   rank=fit|tuition|total|citizenship|study|deadline   (default fit, omitted from URLs)
 *   dir=asc|desc                                         (default asc, omitted)
 *   country=DE,UK  |  country=all                        (absent = the profile's target countries, else all)
 *   fit=meets,unknown,below
 *   intake=september&intake=winter-semester               (repeated; start-term ids from ./intake.ts. Old links that
 *                                                          carry the raw intake text are read into terms)
 *   inbudget=1                                            ("Within my budget". NOT `budget`: shareable profile
 *                                                          links already use `budget` for the PKR amount)
 *   panel=filters                                         (keeps the mobile filter sheet open after a tap)
 */
import { z } from '@/lib/zod';
import type { SortDir } from '../rank';

export const RANK_KEYS = ['fit', 'tuition', 'total', 'citizenship', 'study', 'deadline'] as const;
export type ShortlistRankKey = (typeof RANK_KEYS)[number];

export const FIT_FILTERS = ['meets', 'unknown', 'below'] as const;
export type FitFilter = (typeof FIT_FILTERS)[number];

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const RANK_LABEL: Record<ShortlistRankKey, string> = {
  fit: 'Fit',
  tuition: 'Tuition',
  total: 'Total cost',
  citizenship: 'Citizenship rule',
  study: 'Study time',
  deadline: 'Deadline',
};

/** Plain-words order labels, per key ("Cheapest first" reads better than "ascending"). */
export const DIR_LABEL: Record<ShortlistRankKey, Record<SortDir, string>> = {
  fit: { asc: 'Meets minimum first', desc: 'Below minimum first' },
  tuition: { asc: 'Cheapest first', desc: 'Most expensive first' },
  total: { asc: 'Cheapest first', desc: 'Most expensive first' },
  citizenship: { asc: 'Shortest wait first', desc: 'Longest wait first' },
  study: { asc: 'Shortest first', desc: 'Longest first' },
  deadline: { asc: 'Earliest first', desc: 'Latest first' },
};

export const FIT_FILTER_LABEL: Record<FitFilter, string> = {
  meets: 'Meets minimum',
  unknown: 'Competitive range unknown',
  below: 'Below minimum',
};

export const PARAM = {
  rank: 'rank',
  dir: 'dir',
  country: 'country',
  fit: 'fit',
  intake: 'intake',
  budget: 'inbudget',
  panel: 'panel',
} as const;

/** Profile params used by shareable links (see profileFromSearchParams in src/lib/profile.ts). */
export const PROFILE_PARAM_KEYS = ['cgpa', 'scale', 'min_pass', 'field', 'budget', 'countries'] as const;

export interface ShortlistQuery {
  rank: ShortlistRankKey;
  dir: SortDir;
  /** null = default (profile target countries, else all); 'all' = every country; else explicit codes. */
  country: string[] | 'all' | null;
  fit: FitFilter[];
  intake: string[];
  /** "Within my budget" filter (URL param `inbudget`). */
  budget: boolean;
  /** Keep the mobile filter sheet open (URL param `panel=filters`). */
  panel: boolean;
}

export const DEFAULT_QUERY: ShortlistQuery = {
  rank: 'fit',
  dir: 'asc',
  country: null,
  fit: [],
  intake: [],
  budget: false,
  panel: false,
};

const rankSchema = z.enum(RANK_KEYS).catch('fit');
const dirSchema = z.enum(['asc', 'desc']).catch('asc');
const countryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2,3}$/);
const fitSchema = z.enum(FIT_FILTERS);
const intakeSchema = z.string().trim().min(1).max(80);
const onSchema = z.enum(['1', 'true', 'on', 'yes']);

const MAX_LIST = 20;

function firstOf(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function listOf(v: string | string[] | undefined, splitCommas: boolean): string[] {
  const arr = v == null ? [] : Array.isArray(v) ? v : [v];
  return arr
    .flatMap((x) => (splitCommas ? x.split(',') : [x]))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Keeps only the values the schema accepts (invalid chips are ignored, not fatal), de-duplicated. */
function keepValid<T>(schema: z.ZodType<T>, values: string[]): T[] {
  const out: T[] = [];
  for (const v of values) {
    const r = schema.safeParse(v);
    if (r.success && !out.includes(r.data)) out.push(r.data);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}

export function parseShortlistQuery(sp: RawSearchParams): ShortlistQuery {
  const countryRaw = listOf(sp[PARAM.country], true);
  let country: ShortlistQuery['country'] = null;
  if (countryRaw.some((c) => c.toLowerCase() === 'all')) country = 'all';
  else {
    const codes = keepValid(countryCodeSchema, countryRaw);
    country = codes.length > 0 ? codes : null;
  }
  return {
    rank: rankSchema.parse(firstOf(sp[PARAM.rank])),
    dir: dirSchema.parse(firstOf(sp[PARAM.dir])),
    country,
    fit: keepValid(fitSchema, listOf(sp[PARAM.fit], true)),
    intake: keepValid(intakeSchema, listOf(sp[PARAM.intake], false)),
    budget: onSchema.safeParse(firstOf(sp[PARAM.budget])?.toLowerCase()).success,
    panel: firstOf(sp[PARAM.panel]) === 'filters',
  };
}

/** `undefined` = keep the current value; `null` = remove (back to default). */
export interface ShortlistQueryChanges {
  rank?: ShortlistRankKey | null;
  dir?: SortDir | null;
  country?: string[] | 'all' | null;
  fit?: FitFilter[] | null;
  intake?: string[] | null;
  budget?: boolean | null;
  panel?: boolean | null;
}

/**
 * Builds a shortlist URL from the current params plus changes. Every other param (profile params of a
 * shareable link, unknown params) is kept. Defaults are omitted so URLs stay short.
 */
export function shortlistHref(current: RawSearchParams, changes: ShortlistQueryChanges, pathname = '/shortlist'): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) params.append(k, one);
  }
  const set = (name: string, values: string[]) => {
    params.delete(name);
    for (const v of values) params.append(name, v);
  };
  if (changes.rank !== undefined) set(PARAM.rank, changes.rank && changes.rank !== 'fit' ? [changes.rank] : []);
  if (changes.dir !== undefined) set(PARAM.dir, changes.dir === 'desc' ? ['desc'] : []);
  if (changes.country !== undefined) {
    const c = changes.country;
    set(PARAM.country, c === 'all' ? ['all'] : c && c.length > 0 ? [c.join(',')] : []);
  }
  if (changes.fit !== undefined) set(PARAM.fit, changes.fit && changes.fit.length > 0 ? [changes.fit.join(',')] : []);
  if (changes.intake !== undefined) set(PARAM.intake, changes.intake ?? []);
  if (changes.budget !== undefined) set(PARAM.budget, changes.budget ? ['1'] : []);
  if (changes.panel !== undefined) set(PARAM.panel, changes.panel ? ['filters'] : []);
  // Commas are legal in a query string; keep "country=DE,UK" readable.
  const qs = params.toString().replace(/%2C/gi, ',');
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Changes that reset every filter (rank and order are kept). */
export const CLEAR_FILTERS: ShortlistQueryChanges = { country: null, fit: null, intake: null, budget: null };

/** Number of filters the user set explicitly in the URL (the default country set does not count). */
export function activeFilterCount(q: ShortlistQuery): number {
  return (q.country !== null ? 1 : 0) + (q.fit.length > 0 ? 1 : 0) + (q.intake.length > 0 ? 1 : 0) + (q.budget ? 1 : 0);
}

/** Adds the value if absent, removes it if present (order of first appearance kept). */
export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * "?cgpa=…&scale=…" with only the profile params of a shareable link, so links to other pages
 * (e.g. /program/[id]) keep the same profile. Empty string when there are none.
 */
export function profileQueryString(sp: RawSearchParams): string {
  const params = new URLSearchParams();
  for (const k of PROFILE_PARAM_KEYS) {
    const v = firstOf(sp[k]);
    if (v != null && v !== '') params.set(k, v);
  }
  if (!params.has('cgpa') || !params.has('scale')) return '';
  const qs = params.toString().replace(/%2C/gi, ',');
  return `?${qs}`;
}
