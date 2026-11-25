/**
 * Pure mappers between Postgres rows (supabase/migrations/*_init.sql) and the domain types in ../types.
 *
 * - `rowToX` turns a row read from Supabase back into the EXACT type the app uses. Bad shapes never crash the
 *   app: a fact whose value has the wrong shape becomes "Not verified yet" (value null) and an issue is reported;
 *   a row that is structurally broken (no id, unknown status...) throws, and the loader skips it.
 * - `xToRow` builds the row the seed script upserts.
 * - `factIsWellFormed` mirrors the SQL CHECK function `public.fact_is_well_formed(jsonb)`.
 *
 * No Node, DOM or Next APIs here: safe in scripts, tests, server and client. Relative imports on purpose
 * (scripts run through tsx).
 */
import { z } from '@/lib/zod';
import { computeConfidence, emptyFact } from '../confidence';
import type {
  Basis,
  Confidence,
  ConversionRule,
  CountryFact,
  ConditionalAdmission,
  CountryFactKey,
  CountryFactValue,
  Fact,
  FxRate,
  GpaRule,
  Institution,
  LanguageReq,
  Money,
  Program,
  RecognitionStatus,
  SourcedValue,
} from '../types';

/* ------------------------------------------------------------------ */
/* Row shapes (match the migration)                                    */
/* ------------------------------------------------------------------ */

/** A jsonb fact column, as stored. */
export type FactJson = Record<string, unknown>;

/** Every Program key whose type is a Fact. The compile-time check below keeps this list exhaustive. */
export const PROGRAM_FACT_FIELDS = [
  'status_note',
  'intake',
  'deadline',
  'min_gpa_rule',
  'language_req',
  'tuition',
  'living_cost',
  'duration_months',
  'scholarship_info',
  'sop_requirements',
  'lor_count',
  'cv_requirements',
  'tests_required',
  'research_considered',
  'progression_guaranteed',
  'progression_requirement',
  'eligibility_note',
  'conditional_admission',
  'language_waiver',
  'admissions_email',
] as const;

export type ProgramFactField = (typeof PROGRAM_FACT_FIELDS)[number];

export const INSTITUTION_FACT_FIELDS = ['hec_status', 'pqr_status', 'anabin_status', 'recognition_list_status'] as const;
export type InstitutionFactField = (typeof INSTITUTION_FACT_FIELDS)[number];

/* Compile-time exhaustiveness: adding a Fact field to Program/Institution without listing it here fails tsc. */
type FactKeysOf<T> = { [K in keyof T]-?: NonNullable<T[K]> extends Fact<unknown> ? K : never }[keyof T];
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _programFactsExhaustive: Exact<FactKeysOf<Program>, ProgramFactField> = true;
const _institutionFactsExhaustive: Exact<FactKeysOf<Institution>, InstitutionFactField> = true;
void _programFactsExhaustive;
void _institutionFactsExhaustive;

export type InstitutionRow = {
  id: string;
  name: string;
  country: string;
  kind: string;
  website: string | null;
  notes: string | null;
  updated_at?: string;
} & Record<InstitutionFactField, FactJson | null>;

export type ProgramRow = {
  id: string;
  institution_id: string;
  name: string;
  country: string;
  degree: string;
  field: string;
  official_url: string | null;
  status: string;
  pathway_type: string;
  last_checked: string | null;
  updated_at?: string;
} & Record<ProgramFactField, FactJson | null>;

export interface CountryFactRow {
  id: string;
  country: string;
  key: string;
  value: unknown;
  source_url: string | null;
  evidence_snippet: string | null;
  fetched_at: string | null;
  basis: string | null;
  note: string | null;
  /** Internal reviewer note; never shown to students. */
  review_note?: string | null;
  conflicts: unknown;
  /** Cache only. Never read back by the app. */
  confidence?: Confidence | null;
  updated_at?: string;
}

export interface ConversionRuleRow {
  id: string;
  scope: string;
  from_scale: string;
  to_scale: string;
  formula: string;
  params: unknown;
  source_url: string | null;
  evidence_snippet: string | null;
  fetched_at: string | null;
  notes: string | null;
  updated_at?: string;
}

export interface FxRateRow {
  id: string;
  currency: string;
  pkr_per_unit: FactJson | null;
  updated_at?: string;
}

/** Columns the app reads (no updated_at / cache columns, smaller payload). */
export const INSTITUTION_COLUMNS = ['id', 'name', 'country', 'kind', 'website', ...INSTITUTION_FACT_FIELDS, 'notes'] as const;
export const PROGRAM_COLUMNS = [
  'id',
  'institution_id',
  'name',
  'country',
  'degree',
  'field',
  'official_url',
  'status',
  'pathway_type',
  ...PROGRAM_FACT_FIELDS,
  'last_checked',
] as const;
export const COUNTRY_FACT_COLUMNS = [
  'id',
  'country',
  'key',
  'value',
  'source_url',
  'evidence_snippet',
  'fetched_at',
  'basis',
  'note',
  'review_note',
  'conflicts',
] as const;
export const CONVERSION_RULE_COLUMNS = [
  'id',
  'scope',
  'from_scale',
  'to_scale',
  'formula',
  'params',
  'source_url',
  'evidence_snippet',
  'fetched_at',
  'notes',
] as const;
export const FX_RATE_COLUMNS = ['id', 'currency', 'pkr_per_unit'] as const;

/* ------------------------------------------------------------------ */
/* Issues                                                               */
/* ------------------------------------------------------------------ */

export interface MapIssue {
  table: string;
  id: string;
  field: string;
  problem: string;
}

type Report = (field: string, problem: string) => void;

function reporter(issues: MapIssue[] | undefined, table: string, id: string): Report {
  return (field, problem) => {
    issues?.push({ table, id, field, problem });
  };
}

/** Thrown for rows that cannot be used at all. The loader logs and skips them. */
export class RowShapeError extends Error {
  constructor(
    public readonly table: string,
    public readonly id: string,
    message: string,
  ) {
    super(`${table}/${id}: ${message}`);
    this.name = 'RowShapeError';
  }
}

/* ------------------------------------------------------------------ */
/* Value schemas (shape checks only — never invent or default a value) */
/* ------------------------------------------------------------------ */

const gradeScale = z.enum(['cgpa_4', 'cgpa_5', 'percent', 'german']);
const optText = z.string().nullish();
const optNumber = z.number().nullish();

export const moneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  period: z.enum(['year', 'semester', 'month', 'total']),
});

const gpaRuleSchema = z.object({
  scale: gradeScale,
  min: z.number(),
  text: optText,
  alternatives: z.array(z.object({ scale: gradeScale, min: z.number() })).nullish(),
});
const conditionalAdmissionSchema = z.object({ scale: gradeScale, min: z.number().nullable(), text: z.string() });

const languageReqSchema = z.object({
  ielts_overall: optNumber,
  toefl_ibt: optNumber,
  waiver: optText,
  text: optText,
});

const countryFactValueSchema = z.object({
  text: z.string(),
  sort_months: optNumber,
  money: moneySchema.nullish(),
  clock_note: optText,
});

/**
 * A deadline is a calendar date written YYYY-MM-DD that exists (round-trip check, so 2027-02-30 fails). Anything else
 * ("15 January", "January 2027", a timestamp) would make the app invent a day or a year, so it is Not verified yet.
 * Mirrors the seed schema (format: date).
 */
export function isIsoCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(v);
}

/** Programme length in whole months, 1 to 72 (mirrors the seed schema). 0 would make a free degree. */
export const DURATION_MONTHS_MIN = 1;
export const DURATION_MONTHS_MAX = 72;
const isDurationMonths = (v: unknown): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= DURATION_MONTHS_MIN && v <= DURATION_MONTHS_MAX;

type Guard = (v: unknown) => boolean;
const guardOf =
  (schema: z.ZodType): Guard =>
  (v) =>
    schema.safeParse(v).success;

const isString: Guard = (v) => typeof v === 'string';
const isNonNegativeNumber: Guard = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isBoolean: Guard = (v) => typeof v === 'boolean';

/** Value shape per Program fact field. */
export const PROGRAM_FACT_GUARDS: Record<ProgramFactField, Guard> = {
  status_note: isString,
  intake: isString,
  deadline: isIsoCalendarDate,
  min_gpa_rule: guardOf(gpaRuleSchema),
  language_req: guardOf(languageReqSchema),
  tuition: guardOf(moneySchema),
  living_cost: guardOf(moneySchema),
  duration_months: isDurationMonths,
  scholarship_info: isString,
  sop_requirements: isString,
  lor_count: (v) => isNonNegativeNumber(v) && Number.isInteger(v),
  cv_requirements: isString,
  tests_required: isString,
  research_considered: isString,
  progression_guaranteed: isBoolean,
  progression_requirement: isString,
  eligibility_note: isString,
  conditional_admission: guardOf(conditionalAdmissionSchema),
  language_waiver: isString,
  admissions_email: (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
};

export const INSTITUTION_FACT_GUARDS: Record<InstitutionFactField, Guard> = {
  hec_status: isString,
  pqr_status: isString,
  anabin_status: isString,
  recognition_list_status: (v) => v === 'listed' || v === 'not_listed',
};

const COUNTRY_FACT_KEYS: readonly CountryFactKey[] = [
  'citizenship_rule',
  'citizenship_update',
  'dual_nationality_destination',
  'post_study_work',
  'pr_route',
  'pakistan_dual_nationality',
  'proof_of_funds',
  'tuition_typical',
  'living_cost_typical',
];

const PATHWAY_TYPES: readonly Program['pathway_type'][] = [
  'direct',
  'conditional',
  'pre_masters',
  'pathway',
  'score_based',
  'research_led',
];

const BASES: readonly Basis[] = ['verbatim', 'summary', 'inferred'];

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/** Only http(s) links survive; anything else becomes null (and is reported). */
function urlOrNull(v: unknown, field: string, report: Report): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' && isHttpUrl(v)) return v;
  report(field, 'link is not an http(s) URL and was removed');
  return null;
}

/**
 * Postgres `timestamptz` comes back as e.g. "2026-11-23T00:00:00+00:00". When it is exactly midnight UTC we return
 * the plain date ("2026-11-23"), which is the same instant (Date.parse treats a date-only string as UTC).
 */
export function normalizeTimestamp(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ]00:00:00(?:\.0+)?(?:Z|[+-]00(?::?00)?)$/.exec(v);
  return m ? m[1] : v;
}

/* ------------------------------------------------------------------ */
/* Facts                                                                */
/* ------------------------------------------------------------------ */

function toSourced<T>(raw: Record<string, unknown>, guard: Guard, field: string, report: Report): SourcedValue<T> {
  let value: unknown = raw.value ?? null;
  if (value !== null && !guard(value)) {
    report(field, 'value has the wrong shape; shown as Not verified yet');
    value = null;
  }
  const out: SourcedValue<T> = {
    value: value as T | null,
    source_url: urlOrNull(raw.source_url, field, report),
    evidence_snippet: strOrNull(raw.evidence_snippet),
    fetched_at: strOrNull(raw.fetched_at),
  };
  if (raw.basis !== undefined && raw.basis !== null) {
    if (BASES.includes(raw.basis as Basis)) out.basis = raw.basis as Basis;
    else report(field, 'unknown basis ignored');
  }
  if (raw.note !== undefined) out.note = strOrNull(raw.note);
  if (raw.review_note !== undefined) out.review_note = strOrNull(raw.review_note);
  return out;
}

function toConflicts<T>(raw: unknown, guard: Guard, field: string, report: Report): SourcedValue<T>[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) {
    report(field, 'conflicts is not a list and was ignored');
    return undefined;
  }
  const out: SourcedValue<T>[] = [];
  raw.forEach((c, i) => {
    if (isRecord(c)) out.push(toSourced<T>(c, guard, `${field}.conflicts[${i}]`, report));
    else report(field, `conflicts[${i}] is not an object and was ignored`);
  });
  return out;
}

/**
 * jsonb fact column -> Fact<T>. Missing or broken columns become an empty (Unverified) fact.
 * Keys are preserved exactly (optional keys stay absent), so seed -> row -> type round-trips deep-equal.
 */
export function toFact<T>(raw: unknown, guard: Guard, field = 'fact', report: Report = () => {}): Fact<T> {
  if (raw === null || raw === undefined) return emptyFact<T>();
  if (!isRecord(raw)) {
    report(field, 'fact is not an object; shown as Not verified yet');
    return emptyFact<T>();
  }
  const fact: Fact<T> = toSourced<T>(raw, guard, field, report);
  const conflicts = toConflicts<T>(raw.conflicts, guard, field, report);
  if (conflicts) fact.conflicts = conflicts;
  return fact;
}

/** JS mirror of the SQL CHECK `public.source_is_well_formed(jsonb)`. */
export function sourceIsWellFormed(s: unknown): boolean {
  if (!isRecord(s) || !('value' in s)) return false;
  const strOrNullField = (k: string) => s[k] === undefined || s[k] === null || typeof s[k] === 'string';
  if (!['source_url', 'evidence_snippet', 'fetched_at', 'note', 'basis'].every(strOrNullField)) return false;
  const url = typeof s.source_url === 'string' ? s.source_url : null;
  const snippet = typeof s.evidence_snippet === 'string' ? s.evidence_snippet : null;
  if (snippet && snippet.trim() !== '' && !(url && url.trim() !== '')) return false;
  if (url !== null && !isHttpUrl(url)) return false;
  if (typeof s.fetched_at === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(s.fetched_at)) return false;
  if (typeof s.basis === 'string' && !BASES.includes(s.basis as Basis)) return false;
  return true;
}

/** JS mirror of the SQL CHECK `public.fact_is_well_formed(jsonb)`: a snippet always needs a source URL. */
export function factIsWellFormed(f: unknown): boolean {
  if (!sourceIsWellFormed(f)) return false;
  const conflicts = (f as Record<string, unknown>).conflicts;
  if (conflicts === undefined || conflicts === null) return true;
  return Array.isArray(conflicts) && conflicts.every(sourceIsWellFormed);
}

/* ------------------------------------------------------------------ */
/* Row -> type                                                          */
/* ------------------------------------------------------------------ */

function requireString(row: Record<string, unknown>, key: string, table: string, id: string): string {
  const v = row[key];
  if (typeof v !== 'string' || v.trim() === '') throw new RowShapeError(table, id, `missing ${key}`);
  return v;
}

function rowId(row: unknown, table: string): string {
  if (!isRecord(row) || typeof row.id !== 'string' || row.id === '') throw new RowShapeError(table, '?', 'missing id');
  return row.id;
}

export function rowToInstitution(row: InstitutionRow, issues?: MapIssue[]): Institution {
  const table = 'institutions';
  const id = rowId(row, table);
  const r = row as unknown as Record<string, unknown>;
  const report = reporter(issues, table, id);
  const kind = r.kind;
  if (kind !== 'destination' && kind !== 'home') throw new RowShapeError(table, id, 'unknown kind');
  return {
    id,
    name: requireString(r, 'name', table, id),
    country: requireString(r, 'country', table, id),
    kind,
    website: urlOrNull(r.website, 'website', report),
    hec_status: toFact<string>(r.hec_status, INSTITUTION_FACT_GUARDS.hec_status, 'hec_status', report),
    pqr_status: toFact<string>(r.pqr_status, INSTITUTION_FACT_GUARDS.pqr_status, 'pqr_status', report),
    anabin_status: toFact<string>(r.anabin_status, INSTITUTION_FACT_GUARDS.anabin_status, 'anabin_status', report),
    recognition_list_status: toFact<RecognitionStatus>(
      r.recognition_list_status,
      INSTITUTION_FACT_GUARDS.recognition_list_status,
      'recognition_list_status',
      report,
    ),
    notes: strOrNull(r.notes),
  };
}

export function rowToProgram(row: ProgramRow, issues?: MapIssue[]): Program {
  const table = 'programs';
  const id = rowId(row, table);
  const r = row as unknown as Record<string, unknown>;
  const report = reporter(issues, table, id);
  const status = r.status;
  if (status !== 'active' && status !== 'ruled_out') throw new RowShapeError(table, id, 'unknown status');
  const pathway = r.pathway_type as Program['pathway_type'];
  if (!PATHWAY_TYPES.includes(pathway)) throw new RowShapeError(table, id, 'unknown pathway_type');

  const f = <T>(field: ProgramFactField) => toFact<T>(r[field], PROGRAM_FACT_GUARDS[field], field, report);

  return {
    id,
    institution_id: requireString(r, 'institution_id', table, id),
    name: requireString(r, 'name', table, id),
    country: requireString(r, 'country', table, id),
    degree: requireString(r, 'degree', table, id),
    field: requireString(r, 'field', table, id),
    official_url: urlOrNull(r.official_url, 'official_url', report),
    status,
    status_note: f<string>('status_note'),
    pathway_type: pathway,
    intake: f<string>('intake'),
    deadline: f<string>('deadline'),
    min_gpa_rule: f<GpaRule>('min_gpa_rule'),
    language_req: f<LanguageReq>('language_req'),
    tuition: f<Money>('tuition'),
    living_cost: f<Money>('living_cost'),
    duration_months: f<number>('duration_months'),
    scholarship_info: f<string>('scholarship_info'),
    sop_requirements: f<string>('sop_requirements'),
    lor_count: f<number>('lor_count'),
    cv_requirements: f<string>('cv_requirements'),
    tests_required: f<string>('tests_required'),
    research_considered: f<string>('research_considered'),
    progression_guaranteed: f<boolean>('progression_guaranteed'),
    progression_requirement: f<string>('progression_requirement'),
    eligibility_note: f<string>('eligibility_note'),
    conditional_admission: f<ConditionalAdmission>('conditional_admission'),
    language_waiver: f<string>('language_waiver'),
    admissions_email: f<string>('admissions_email'),
    last_checked: strOrNull(r.last_checked),
  };
}

export function rowToCountryFact(row: CountryFactRow, issues?: MapIssue[]): CountryFact {
  const table = 'country_facts';
  const id = rowId(row, table);
  const r = row as unknown as Record<string, unknown>;
  const report = reporter(issues, table, id);
  const key = r.key as CountryFactKey;
  if (!COUNTRY_FACT_KEYS.includes(key)) throw new RowShapeError(table, id, 'unknown key');

  // The flat columns are read through the same fact logic as the jsonb facts.
  const fact = toFact<CountryFactValue>(
    {
      value: r.value,
      source_url: r.source_url,
      evidence_snippet: r.evidence_snippet,
      fetched_at: normalizeTimestamp(r.fetched_at),
      ...(r.basis != null ? { basis: r.basis } : {}),
      ...(r.note != null ? { note: r.note } : {}),
      ...(r.review_note != null ? { review_note: r.review_note } : {}),
      ...(r.conflicts != null ? { conflicts: r.conflicts } : {}),
    },
    guardOf(countryFactValueSchema),
    'value',
    report,
  );
  return { id, country: requireString(r, 'country', table, id), key, ...fact };
}

const paramValueSchema = z.union([z.number(), z.tuple([z.number(), z.number()])]);
const paramsSchema = z.record(z.string(), paramValueSchema);

export function rowToConversionRule(row: ConversionRuleRow, issues?: MapIssue[]): ConversionRule {
  const table = 'conversion_rules';
  const id = rowId(row, table);
  const r = row as unknown as Record<string, unknown>;
  const report = reporter(issues, table, id);
  const from = gradeScale.safeParse(r.from_scale);
  const to = gradeScale.safeParse(r.to_scale);
  if (!from.success || !to.success) throw new RowShapeError(table, id, 'unknown scale');
  const formula = r.formula;
  if (formula !== 'identity' && formula !== 'modified_bavarian' && formula !== 'linear') {
    throw new RowShapeError(table, id, 'unknown formula');
  }
  // A broken rule must not produce a fit decision: drop it rather than guess its parameters.
  let params: ConversionRule['params'] | undefined;
  if (r.params !== null && r.params !== undefined) {
    const p = paramsSchema.safeParse(r.params);
    if (!p.success) throw new RowShapeError(table, id, 'params have the wrong shape');
    params = r.params as ConversionRule['params'];
  }
  return {
    id,
    scope: requireString(r, 'scope', table, id),
    from_scale: from.data,
    to_scale: to.data,
    formula,
    ...(params ? { params } : {}),
    source_url: urlOrNull(r.source_url, 'source_url', report),
    evidence_snippet: strOrNull(r.evidence_snippet),
    fetched_at: normalizeTimestamp(r.fetched_at),
    notes: strOrNull(r.notes),
  };
}

export function rowToFxRate(row: FxRateRow, issues?: MapIssue[]): FxRate {
  const table = 'fx_rates';
  const id = rowId(row, table);
  const r = row as unknown as Record<string, unknown>;
  const report = reporter(issues, table, id);
  const currency = requireString(r, 'currency', table, id);
  if (!/^[A-Z]{3}$/.test(currency)) throw new RowShapeError(table, id, 'currency is not an ISO-4217 code');
  return {
    id,
    currency,
    pkr_per_unit: toFact<number>(r.pkr_per_unit, (v) => typeof v === 'number' && Number.isFinite(v) && v > 0, 'pkr_per_unit', report),
  };
}

/* ------------------------------------------------------------------ */
/* Type -> row (seed script)                                            */
/* ------------------------------------------------------------------ */

/** JSON-safe copy (drops undefined keys exactly like Postgres jsonb would). */
function asJson<T>(v: T): FactJson {
  return JSON.parse(JSON.stringify(v)) as FactJson;
}

export function institutionToRow(i: Institution): InstitutionRow {
  return {
    id: i.id,
    name: i.name,
    country: i.country,
    kind: i.kind,
    website: i.website,
    hec_status: asJson(i.hec_status),
    pqr_status: asJson(i.pqr_status),
    anabin_status: asJson(i.anabin_status),
    recognition_list_status: asJson(i.recognition_list_status),
    notes: i.notes ?? null,
  };
}

export function programToRow(p: Program): ProgramRow {
  const facts = Object.fromEntries(PROGRAM_FACT_FIELDS.map((k) => [k, asJson(p[k])])) as Record<ProgramFactField, FactJson>;
  return {
    id: p.id,
    institution_id: p.institution_id,
    name: p.name,
    country: p.country,
    degree: p.degree,
    field: p.field,
    official_url: p.official_url,
    status: p.status,
    pathway_type: p.pathway_type,
    ...facts,
    last_checked: p.last_checked,
  };
}

/** `now` fills the confidence CACHE column only (for SQL dashboards). The app never reads it. */
export function countryFactToRow(f: CountryFact, now?: Date): CountryFactRow {
  return {
    id: f.id,
    country: f.country,
    key: f.key,
    value: f.value === undefined ? null : asJsonValue(f.value),
    source_url: f.source_url,
    evidence_snippet: f.evidence_snippet,
    fetched_at: f.fetched_at,
    basis: f.basis ?? null,
    note: f.note ?? null,
    review_note: f.review_note ?? null,
    conflicts: f.conflicts ? asJsonValue(f.conflicts) : null,
    ...(now ? { confidence: computeConfidence(f, now) } : {}),
  };
}

function asJsonValue(v: unknown): unknown {
  return v === null ? null : JSON.parse(JSON.stringify(v));
}

export function conversionRuleToRow(r: ConversionRule): ConversionRuleRow {
  return {
    id: r.id,
    scope: r.scope,
    from_scale: r.from_scale,
    to_scale: r.to_scale,
    formula: r.formula,
    params: r.params ? asJsonValue(r.params) : null,
    source_url: r.source_url,
    evidence_snippet: r.evidence_snippet ?? null,
    fetched_at: r.fetched_at ?? null,
    notes: r.notes ?? null,
  };
}

export function fxRateToRow(r: FxRate): FxRateRow {
  return { id: r.id, currency: r.currency, pkr_per_unit: asJson(r.pkr_per_unit) };
}

/* ------------------------------------------------------------------ */
/* Whole dataset                                                        */
/* ------------------------------------------------------------------ */

export interface DatasetLike {
  programs: Program[];
  institutions: Institution[];
  countryFacts: CountryFact[];
  conversionRules: ConversionRule[];
  fxRates: FxRate[];
}

export interface SeedRows {
  institutions: InstitutionRow[];
  programs: ProgramRow[];
  country_facts: CountryFactRow[];
  conversion_rules: ConversionRuleRow[];
  fx_rates: FxRateRow[];
}

export function buildSeedRows(d: DatasetLike, now?: Date): SeedRows {
  return {
    institutions: d.institutions.map(institutionToRow),
    programs: d.programs.map(programToRow),
    country_facts: d.countryFacts.map((f) => countryFactToRow(f, now)),
    conversion_rules: d.conversionRules.map(conversionRuleToRow),
    fx_rates: d.fxRates.map(fxRateToRow),
  };
}

/**
 * Checks rows against the same rules as the SQL CHECK constraints, so the seed script fails fast with a clear
 * message instead of a Postgres error. Returns human-readable problems (empty = OK).
 */
export function validateSeedRows(rows: SeedRows): string[] {
  const problems: string[] = [];
  const ids = (list: { id: string }[], table: string) => {
    const seen = new Set<string>();
    for (const r of list) {
      if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(r.id)) problems.push(`${table}/${r.id}: id must be lowercase letters, digits and dashes`);
      if (seen.has(r.id)) problems.push(`${table}/${r.id}: duplicate id`);
      seen.add(r.id);
    }
  };
  ids(rows.institutions, 'institutions');
  ids(rows.programs, 'programs');
  ids(rows.country_facts, 'country_facts');
  ids(rows.conversion_rules, 'conversion_rules');
  ids(rows.fx_rates, 'fx_rates');

  for (const i of rows.institutions) {
    for (const k of INSTITUTION_FACT_FIELDS) {
      if (!factIsWellFormed(i[k])) problems.push(`institutions/${i.id}.${k}: snippet without source URL, or bad shape`);
    }
  }
  const institutionIds = new Set(rows.institutions.map((i) => i.id));
  for (const p of rows.programs) {
    if (!institutionIds.has(p.institution_id)) problems.push(`programs/${p.id}: unknown institution ${p.institution_id}`);
    for (const k of PROGRAM_FACT_FIELDS) {
      if (!factIsWellFormed(p[k])) problems.push(`programs/${p.id}.${k}: snippet without source URL, or bad shape`);
      // Same value contract as rowToProgram: a value it would drop (e.g. a deadline that is not YYYY-MM-DD, a 0-month
      // programme) must not be written in the first place.
      const fact = p[k];
      const sources = fact ? [fact, ...(Array.isArray(fact.conflicts) ? (fact.conflicts as unknown[]) : [])] : [];
      sources.forEach((s, i) => {
        const v = isRecord(s) ? s.value : null;
        if (v !== null && v !== undefined && !PROGRAM_FACT_GUARDS[k](v)) {
          problems.push(`programs/${p.id}.${k}${i === 0 ? '' : `.conflicts[${i - 1}]`}: value has the wrong shape (it would be shown as Not verified yet)`);
        }
      });
    }
  }
  const pairs = new Set<string>();
  for (const f of rows.country_facts) {
    const flat = { value: f.value, source_url: f.source_url, evidence_snippet: f.evidence_snippet, fetched_at: f.fetched_at, basis: f.basis, note: f.note, conflicts: f.conflicts };
    if (!factIsWellFormed(flat)) problems.push(`country_facts/${f.id}: snippet without source URL, or bad shape`);
    const pair = `${f.country}:${f.key}`;
    if (pairs.has(pair)) problems.push(`country_facts/${f.id}: duplicate (country, key) ${pair}`);
    pairs.add(pair);
  }
  for (const r of rows.conversion_rules) {
    if (r.evidence_snippet && r.evidence_snippet.trim() !== '' && !r.source_url) {
      problems.push(`conversion_rules/${r.id}: snippet without source URL`);
    }
  }
  for (const r of rows.fx_rates) {
    if (!factIsWellFormed(r.pkr_per_unit)) problems.push(`fx_rates/${r.id}: snippet without source URL, or bad shape`);
  }
  return problems;
}
