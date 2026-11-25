/**
 * Seed validator (runs in CI as `npm run validate:seed` via scripts/validate-seed.ts). Pure: takes parsed JSON and
 * `now`, returns issues + a coverage summary. Never imported by the app.
 *
 * ERRORS (exit 1):
 *  - JSON Schema violations (data/schemas/*.schema.json)
 *  - a value whose computed confidence is Verified without source_url AND evidence_snippet (defence in depth)
 *  - a hand-written "confidence": "Verified" without source_url AND evidence_snippet
 *  - evidence_snippet without source_url
 *  - source_url / official_url / website that is not a valid https URL
 *  - fetched_at / last_checked that is not a valid date, or is in the future
 *  - evidence_snippet shorter than 12 or longer than 600 characters
 *  - HTML tags in any string; admission-probability / "chance" wording in any key or string
 *  - duplicate ids; program.institution_id that does not exist; duplicate (country, key); unknown country fact keys
 *  - a GpaRule.alternatives minimum that is not written in the same source's evidence_snippet
 * WARNINGS (printed, never fail the build):
 *  - "Unverified value present": a value with no evidence behind it (verbatim/default basis without a snippet,
 *    or a summary/inferred value without a source_url)
 *  - other hand-written confidence keys (ignored: confidence is computed in code)
 *  - evidence without a value, source hosts missing from data/ingest.allowlist.json, past deadlines
 *  - a conflicting value without a source_url (ignored by the confidence code: it never makes a Conflict)
 *  - a conditional_admission minimum that is not written in its evidence_snippet
 */
import { computeConfidence, sourceConfidence } from '../confidence';
import type { Confidence, Fact, SourcedValue } from '../types';
import { isAllowedHost, INGEST_ALLOWLIST } from '../net/hosts';
import {
  COUNTRY_FACT_KEYS,
  INSTITUTION_FACT_FIELDS,
  PROGRAM_CORE_FIELDS,
  PROGRAM_FACT_FIELDS,
  type ValueKind,
} from './fields';
import { validateSeedFileSchema, type SeedFileName } from './schemas';
import {
  hasForbiddenText,
  hasHtmlTag,
  httpsUrlProblem,
  mentionsNumber,
  parseIsoDate,
  snippetLengthProblem,
  walkJson,
} from './text-rules';

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  file: SeedFileName;
  /** JSON pointer into the file, e.g. "/programs/3/deadline". */
  path: string;
  message: string;
}

/** The four parsed seed files (as read from disk; not yet trusted). */
export interface SeedFiles {
  programs: unknown;
  countryFacts: unknown;
  conversionRules: unknown;
  fxRates: unknown;
}

export type ConfidenceCounts = Record<Confidence, number>;

export interface Coverage {
  programs: { total: number; active: number; ruledOut: number; fullyVerified: number; coreFields: readonly string[] };
  programFacts: ConfidenceCounts;
  institutionFacts: ConfidenceCounts;
  countryFacts: ConfidenceCounts;
  fxRates: ConfidenceCounts;
  conversionRules: { total: number; withSource: number };
}

export interface ValidationReport {
  issues: Issue[];
  errors: number;
  warnings: number;
  coverage: Coverage;
}

/** Allowed future skew for dates (time zones up to UTC+14 write "today" before UTC reaches it). */
export const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

const CONFIDENCE_KEY = 'confidence';

/* ---------------- small JSON guards ---------------- */

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function arrayAt(root: unknown, key: string): unknown[] {
  if (!isObj(root)) return [];
  const v = root[key];
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function emptyCounts(): ConfidenceCounts {
  return { Verified: 0, Likely: 0, Unverified: 0, Conflict: 0 };
}

/* ---------------- collector ---------------- */

class Collector {
  readonly issues: Issue[] = [];
  error(file: SeedFileName, path: string, message: string) {
    this.issues.push({ severity: 'error', file, path, message });
  }
  warn(file: SeedFileName, path: string, message: string) {
    this.issues.push({ severity: 'warning', file, path, message });
  }
}

/* ---------------- shared checks ---------------- */

function checkHttpsUrl(c: Collector, file: SeedFileName, path: string, value: unknown, label: string) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string') return; // the schema reports the type
  const problem = httpsUrlProblem(value);
  if (problem) c.error(file, path, `${label}: ${problem}`);
}

function checkDate(c: Collector, file: SeedFileName, path: string, value: unknown, label: string, now: Date) {
  if (value === null || value === undefined) return;
  if (typeof value !== 'string') return;
  const t = parseIsoDate(value);
  if (t === null) {
    c.error(file, path, `${label} "${value}" is not a valid date (use YYYY-MM-DD)`);
    return;
  }
  if (t > now.getTime() + FUTURE_TOLERANCE_MS) c.error(file, path, `${label} "${value}" is in the future`);
}

function checkSnippet(c: Collector, file: SeedFileName, path: string, snippet: unknown) {
  if (typeof snippet !== 'string') return;
  const problem = snippetLengthProblem(snippet);
  if (problem) c.error(file, `${path}/evidence_snippet`, problem);
}

/**
 * Checks one source of a fact (the primary source or one entry of `conflicts`).
 * Returns nothing; issues go to the collector.
 */
function checkSource(
  c: Collector,
  file: SeedFileName,
  path: string,
  source: Obj,
  now: Date,
  opts: { allowlist: readonly string[] },
) {
  const value = source.value;
  const hasValue = value !== null && value !== undefined;
  const url = source.source_url;
  const snippet = source.evidence_snippet;
  const basis = source.basis;
  const hasUrl = !isBlank(url);
  const hasSnippet = !isBlank(snippet);

  checkHttpsUrl(c, file, `${path}/source_url`, url, 'source_url');
  checkDate(c, file, `${path}/fetched_at`, source.fetched_at, 'fetched_at', now);
  checkSnippet(c, file, path, snippet);

  if (hasSnippet && !hasUrl) {
    c.error(file, path, 'evidence_snippet has no source_url: add the official page the snippet was copied from');
  }

  // Hand-written confidence is never trusted. A claimed "Verified" without evidence is an error.
  if (Object.prototype.hasOwnProperty.call(source, CONFIDENCE_KEY)) {
    const claimed = source[CONFIDENCE_KEY];
    if (claimed === 'Verified' && (!hasUrl || !hasSnippet)) {
      c.error(
        file,
        `${path}/${CONFIDENCE_KEY}`,
        '"confidence": "Verified" needs both source_url and evidence_snippet (and confidence is computed in code: remove this key)',
      );
    } else {
      c.warn(file, `${path}/${CONFIDENCE_KEY}`, 'confidence is computed in code; this key is ignored. Remove it.');
    }
  }

  // Defence in depth: whatever the confidence code decides, a Verified value must carry its evidence.
  if (hasValue) {
    const conf = sourceConfidence(source as unknown as SourcedValue<unknown>, now);
    if (conf === 'Verified' && (!hasUrl || !hasSnippet)) {
      c.error(file, path, 'value is computed as Verified but has no source_url or evidence_snippet');
    }
    const declared = basis === 'summary' || basis === 'inferred';
    if (!declared && !hasSnippet) {
      c.warn(file, path, 'Unverified value present: no evidence_snippet. Add a verbatim snippet and source_url, or set the value to null');
    } else if (declared && !hasUrl) {
      c.warn(file, path, `Unverified value present: basis "${String(basis)}" without a source_url`);
    }
  } else if (hasSnippet) {
    c.warn(file, path, 'evidence_snippet without a value: add the value or remove the snippet');
  }

  if (hasUrl && typeof url === 'string' && httpsUrlProblem(url) === null) {
    const host = new URL(url).hostname;
    if (!isAllowedHost(host, opts.allowlist)) {
      c.warn(
        file,
        `${path}/source_url`,
        `${host} is not on data/ingest.allowlist.json, so the link checker cannot verify it. Prefer an official domain`,
      );
    }
  }
}

/**
 * Numbers inside structured values must be traceable to the SAME source's snippet:
 *  - GpaRule.alternatives: every minimum must be written in the snippet (ERROR: the fit engine decides on it directly);
 *  - conditional_admission.min: should be written in the snippet (warning, for a human to check).
 */
function checkValueNumbers(c: Collector, file: SeedFileName, path: string, source: Obj, kind: ValueKind | undefined) {
  const value = source.value;
  if (!isObj(value)) return;
  const snippet = typeof source.evidence_snippet === 'string' ? source.evidence_snippet : '';
  if (kind === 'gpa_rule' && Array.isArray(value.alternatives)) {
    value.alternatives.forEach((alt, i) => {
      if (!isObj(alt) || typeof alt.min !== 'number') return; // the schema reports the shape
      if (!mentionsNumber(snippet, alt.min)) {
        c.error(
          file,
          `${path}/value/alternatives/${i}/min`,
          `alternative minimum ${alt.min} (${String(alt.scale)}) is not written in the evidence_snippet: an alternative must be printed in the same snippet as the minimum`,
        );
      }
    });
  }
  if (kind === 'conditional_admission' && typeof value.min === 'number' && !mentionsNumber(snippet, value.min)) {
    c.warn(file, `${path}/value/min`, `conditional admission minimum ${value.min} is not written in the evidence_snippet: check it by hand`);
  }
}

/** Checks a fact (primary + conflicts) and returns its computed confidence, or null if it is not a fact object. */
function checkFact(
  c: Collector,
  file: SeedFileName,
  path: string,
  fact: unknown,
  now: Date,
  opts: { allowlist: readonly string[]; kind?: ValueKind },
): Confidence | null {
  if (!isObj(fact)) return null;
  checkSource(c, file, path, fact, now, opts);
  checkValueNumbers(c, file, path, fact, opts.kind);
  const conflicts = fact.conflicts;
  if (Array.isArray(conflicts)) {
    conflicts.forEach((s, i) => {
      if (!isObj(s)) return;
      const at = `${path}/conflicts/${i}`;
      checkSource(c, file, at, s, now, opts);
      checkValueNumbers(c, file, at, s, opts.kind);
      if (s.value !== null && s.value !== undefined && isBlank(s.source_url)) {
        c.warn(file, at, 'conflict without a source_url is ignored (an unsourced claim never makes a Conflict): add its official page or remove it');
      }
    });
  }
  const conf = computeConfidence(fact as unknown as Fact<unknown>, now);

  if (opts.kind === 'deadline' && (conf === 'Verified' || conf === 'Likely') && typeof fact.value === 'string') {
    const t = parseIsoDate(fact.value);
    if (t !== null && t < now.getTime() - FUTURE_TOLERANCE_MS) {
      c.warn(file, path, `deadline ${fact.value} has passed: check the official page for the next intake`);
    }
  }
  return conf;
}

function checkUniqueIds(c: Collector, file: SeedFileName, collection: string, rows: unknown[]): Set<string> {
  const seen = new Map<string, number>();
  rows.forEach((row, i) => {
    const id = isObj(row) ? str(row.id) : null;
    if (id === null) return; // the schema reports a missing id
    const first = seen.get(id);
    if (first !== undefined) c.error(file, `/${collection}/${i}/id`, `duplicate id "${id}" (first used at /${collection}/${first})`);
    else seen.set(id, i);
  });
  return new Set(seen.keys());
}

/** HTML tags and admission-probability wording, in every key and string of a file. */
function checkText(c: Collector, file: SeedFileName, data: unknown) {
  walkJson(data, (kind, text, pointer) => {
    if (kind === 'key' && text === '$schema') return;
    if (hasForbiddenText(text)) {
      c.error(
        file,
        pointer,
        `${kind === 'key' ? 'key' : 'text'} mentions admission probability or "chances" ("${truncate(text)}"). MastersPath never estimates chances`,
      );
    }
    if (kind === 'string' && hasHtmlTag(text)) {
      c.error(file, pointer, `contains an HTML tag ("${truncate(text)}"). Use plain text only`);
    }
  });
}

function truncate(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/* ---------------- per-file rules ---------------- */

function checkPrograms(c: Collector, data: unknown, now: Date, allowlist: readonly string[], cov: Coverage) {
  const file: SeedFileName = 'programs.seed.json';
  const institutions = arrayAt(data, 'institutions');
  const programs = arrayAt(data, 'programs');
  const institutionIds = checkUniqueIds(c, file, 'institutions', institutions);
  checkUniqueIds(c, file, 'programs', programs);

  const institutionCountry = new Map<string, string>();
  institutions.forEach((inst, i) => {
    if (!isObj(inst)) return;
    const base = `/institutions/${i}`;
    if (typeof inst.id === 'string' && typeof inst.country === 'string') institutionCountry.set(inst.id, inst.country);
    checkHttpsUrl(c, file, `${base}/website`, inst.website, 'website');
    for (const [key, kind] of Object.entries(INSTITUTION_FACT_FIELDS)) {
      const conf = checkFact(c, file, `${base}/${key}`, inst[key], now, { allowlist, kind });
      if (conf) cov.institutionFacts[conf]++;
    }
  });

  programs.forEach((p, i) => {
    if (!isObj(p)) return;
    const base = `/programs/${i}`;
    cov.programs.total++;
    if (p.status === 'ruled_out') cov.programs.ruledOut++;
    else cov.programs.active++;

    const instId = str(p.institution_id);
    if (instId !== null && !institutionIds.has(instId)) {
      c.error(file, `${base}/institution_id`, `institution_id "${instId}" does not match any institution id`);
    } else if (instId !== null && typeof p.country === 'string' && institutionCountry.get(instId) !== p.country) {
      c.warn(file, `${base}/country`, `country "${p.country}" differs from its institution's country "${institutionCountry.get(instId)}"`);
    }
    checkHttpsUrl(c, file, `${base}/official_url`, p.official_url, 'official_url');
    checkDate(c, file, `${base}/last_checked`, p.last_checked, 'last_checked', now);

    const confByField = new Map<string, Confidence>();
    for (const [key, kind] of Object.entries(PROGRAM_FACT_FIELDS)) {
      const conf = checkFact(c, file, `${base}/${key}`, p[key], now, { allowlist, kind });
      if (conf) {
        cov.programFacts[conf]++;
        confByField.set(key, conf);
      }
    }
    if (p.status !== 'ruled_out' && PROGRAM_CORE_FIELDS.every((f) => confByField.get(f) === 'Verified')) {
      cov.programs.fullyVerified++;
    }
  });
}

function checkCountryFacts(c: Collector, data: unknown, now: Date, allowlist: readonly string[], cov: Coverage) {
  const file: SeedFileName = 'country_facts.seed.json';
  const rows = arrayAt(data, 'country_facts');
  checkUniqueIds(c, file, 'country_facts', rows);
  const allowedKeys = new Set<string>(COUNTRY_FACT_KEYS);
  const pairs = new Map<string, number>();
  rows.forEach((row, i) => {
    if (!isObj(row)) return;
    const base = `/country_facts/${i}`;
    const country = str(row.country);
    const key = str(row.key);
    if (key !== null && !allowedKeys.has(key)) {
      c.error(file, `${base}/key`, `unknown country fact key "${key}" (allowed: ${COUNTRY_FACT_KEYS.join(', ')})`);
    }
    if (country !== null && key !== null) {
      const pair = `${country}/${key}`;
      const first = pairs.get(pair);
      if (first !== undefined) {
        c.error(file, base, `duplicate country fact ${country} "${key}" (first at /country_facts/${first}). Use "conflicts" for a second source`);
      } else pairs.set(pair, i);
    }
    const conf = checkFact(c, file, base, row, now, { allowlist });
    if (conf) cov.countryFacts[conf]++;
  });
}

function checkConversionRules(c: Collector, data: unknown, now: Date, cov: Coverage) {
  const file: SeedFileName = 'conversion_rules.seed.json';
  const rows = arrayAt(data, 'conversion_rules');
  checkUniqueIds(c, file, 'conversion_rules', rows);
  rows.forEach((row, i) => {
    if (!isObj(row)) return;
    const base = `/conversion_rules/${i}`;
    cov.conversionRules.total++;
    const hasUrl = !isBlank(row.source_url);
    if (hasUrl) cov.conversionRules.withSource++;
    checkHttpsUrl(c, file, `${base}/source_url`, row.source_url, 'source_url');
    checkDate(c, file, `${base}/fetched_at`, row.fetched_at, 'fetched_at', now);
    checkSnippet(c, file, base, row.evidence_snippet);
    if (!isBlank(row.evidence_snippet) && !hasUrl) {
      c.error(file, base, 'evidence_snippet has no source_url: add the official page the snippet was copied from');
    }
    if (isObj(row.params)) {
      for (const [name, v] of Object.entries(row.params)) {
        if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && v[0] > v[1]) {
          c.error(file, `${base}/params/${name}`, `range [${v[0]}, ${v[1]}] must be [low, high]`);
        }
      }
    }
  });
}

function checkFxRates(c: Collector, data: unknown, now: Date, allowlist: readonly string[], cov: Coverage) {
  const file: SeedFileName = 'fx_rates.seed.json';
  const rows = arrayAt(data, 'fx_rates');
  checkUniqueIds(c, file, 'fx_rates', rows);
  const currencies = new Map<string, number>();
  rows.forEach((row, i) => {
    if (!isObj(row)) return;
    const base = `/fx_rates/${i}`;
    const cur = str(row.currency);
    if (cur !== null) {
      const first = currencies.get(cur);
      if (first !== undefined) c.error(file, `${base}/currency`, `duplicate currency "${cur}" (first at /fx_rates/${first})`);
      else currencies.set(cur, i);
    }
    const conf = checkFact(c, file, `${base}/pkr_per_unit`, row.pkr_per_unit, now, { allowlist });
    if (conf) cov.fxRates[conf]++;
  });
}

/* ---------------- entry point ---------------- */

const FILE_KEYS: Record<keyof SeedFiles, SeedFileName> = {
  programs: 'programs.seed.json',
  countryFacts: 'country_facts.seed.json',
  conversionRules: 'conversion_rules.seed.json',
  fxRates: 'fx_rates.seed.json',
};

/**
 * Drops schema errors that a friendlier custom rule already reported at the same place
 * (e.g. "must match pattern ^https://" next to "source_url must use https://").
 */
function dedupe(schemaIssues: Issue[], ruleIssues: Issue[]): Issue[] {
  const covered = new Set(ruleIssues.filter((i) => i.severity === 'error').map((i) => `${i.file}|${i.path}`));
  return schemaIssues.filter((i) => !covered.has(`${i.file}|${i.path}`));
}

export interface ValidateOptions {
  /** Hosts considered official (default: data/ingest.allowlist.json). */
  allowlist?: readonly string[];
}

/** Validates all four seed files. `now` is the clock used for confidence and future-date checks. */
export function validateSeed(files: SeedFiles, now: Date, options: ValidateOptions = {}): ValidationReport {
  const allowlist = options.allowlist ?? INGEST_ALLOWLIST;
  const coverage: Coverage = {
    programs: { total: 0, active: 0, ruledOut: 0, fullyVerified: 0, coreFields: PROGRAM_CORE_FIELDS },
    programFacts: emptyCounts(),
    institutionFacts: emptyCounts(),
    countryFacts: emptyCounts(),
    fxRates: emptyCounts(),
    conversionRules: { total: 0, withSource: 0 },
  };

  const schemaIssues: Issue[] = [];
  for (const [key, file] of Object.entries(FILE_KEYS) as [keyof SeedFiles, SeedFileName][]) {
    for (const s of validateSeedFileSchema(file, files[key])) {
      schemaIssues.push({ severity: 'error', file, path: s.path, message: `schema: ${s.message}` });
    }
  }

  const c = new Collector();
  checkPrograms(c, files.programs, now, allowlist, coverage);
  checkCountryFacts(c, files.countryFacts, now, allowlist, coverage);
  checkConversionRules(c, files.conversionRules, now, coverage);
  checkFxRates(c, files.fxRates, now, allowlist, coverage);
  for (const [key, file] of Object.entries(FILE_KEYS) as [keyof SeedFiles, SeedFileName][]) checkText(c, file, files[key]);

  const issues = [...dedupe(schemaIssues, c.issues), ...c.issues];
  return {
    issues,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    coverage,
  };
}

/* ---------------- report formatting ---------------- */

function countsLine(counts: ConfidenceCounts): string {
  const total = counts.Verified + counts.Likely + counts.Unverified + counts.Conflict;
  return `${total} total · Verified ${counts.Verified} · Likely ${counts.Likely} · Conflict ${counts.Conflict} · Unverified ${counts.Unverified}`;
}

export function formatCoverage(cov: Coverage): string {
  const p = cov.programs;
  return [
    'Coverage',
    `  Programs:          ${p.total} (${p.active} active, ${p.ruledOut} ruled out). Fully verified: ${p.fullyVerified}/${p.active}` +
      ` (all of ${p.coreFields.join(', ')} Verified)`,
    `  Program facts:     ${countsLine(cov.programFacts)}`,
    `  Institution facts: ${countsLine(cov.institutionFacts)}`,
    `  Country facts:     ${countsLine(cov.countryFacts)}`,
    `  Exchange rates:    ${countsLine(cov.fxRates)}`,
    `  Conversion rules:  ${cov.conversionRules.total} (${cov.conversionRules.withSource} with an official source)`,
  ].join('\n');
}

/** Human-readable report. Warnings are grouped by message so 200 empty facts do not flood the CI log. */
export function formatReport(report: ValidationReport, opts: { maxWarningExamples?: number } = {}): string {
  const lines: string[] = [];
  const errors = report.issues.filter((i) => i.severity === 'error');
  const warnings = report.issues.filter((i) => i.severity === 'warning');
  if (errors.length) {
    lines.push(`ERRORS (${errors.length})`);
    for (const e of errors) lines.push(`  ✗ ${e.file} ${e.path}: ${e.message}`);
    lines.push('');
  }
  if (warnings.length) {
    lines.push(`WARNINGS (${warnings.length})`);
    const max = opts.maxWarningExamples ?? 5;
    const groups = new Map<string, Issue[]>();
    for (const w of warnings) {
      const g = groups.get(w.message) ?? [];
      g.push(w);
      groups.set(w.message, g);
    }
    for (const [message, items] of groups) {
      lines.push(`  ! ${message} (${items.length})`);
      for (const it of items.slice(0, max)) lines.push(`      ${it.file} ${it.path}`);
      if (items.length > max) lines.push(`      … and ${items.length - max} more`);
    }
    lines.push('');
  }
  lines.push(formatCoverage(report.coverage));
  lines.push('');
  lines.push(
    report.errors
      ? `Seed validation FAILED: ${report.errors} error(s), ${report.warnings} warning(s).`
      : `Seed validation passed with ${report.warnings} warning(s).`,
  );
  return lines.join('\n');
}
