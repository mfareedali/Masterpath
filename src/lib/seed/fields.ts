/**
 * Which keys of each seed row are facts, and which JSON Schema value definition each fact uses
 * (data/schemas/*.schema.json → `$defs/value_<kind>`). Shared by the seed validator and the ingestion script.
 * The Record types make this list exhaustive at compile time: adding a fact to src/lib/types.ts without listing it here
 * is a type error.
 */
import type { CountryFactKey, Fact, Institution, Program } from '../types';

export type ValueKind =
  | 'text'
  | 'deadline'
  | 'email'
  | 'boolean'
  | 'lor_count'
  | 'duration_months'
  | 'recognition_status'
  | 'money'
  | 'gpa_rule'
  | 'language_req'
  | 'conditional_admission';

type FactKeys<T> = { [K in keyof T]-?: T[K] extends Fact<unknown> ? K : never }[keyof T];

export type ProgramFactField = FactKeys<Program>;
export type InstitutionFactField = FactKeys<Institution>;

export const PROGRAM_FACT_FIELDS: Record<ProgramFactField, ValueKind> = {
  status_note: 'text',
  intake: 'text',
  deadline: 'deadline',
  min_gpa_rule: 'gpa_rule',
  language_req: 'language_req',
  tuition: 'money',
  living_cost: 'money',
  duration_months: 'duration_months',
  scholarship_info: 'text',
  sop_requirements: 'text',
  lor_count: 'lor_count',
  cv_requirements: 'text',
  tests_required: 'text',
  research_considered: 'text',
  progression_guaranteed: 'boolean',
  progression_requirement: 'text',
  eligibility_note: 'text',
  conditional_admission: 'conditional_admission',
  language_waiver: 'text',
  admissions_email: 'email',
};

export const INSTITUTION_FACT_FIELDS: Record<InstitutionFactField, ValueKind> = {
  hec_status: 'text',
  pqr_status: 'text',
  anabin_status: 'text',
  recognition_list_status: 'recognition_status',
};

export const PROGRAM_FACT_KEYS = Object.keys(PROGRAM_FACT_FIELDS) as ProgramFactField[];
export const INSTITUTION_FACT_KEYS = Object.keys(INSTITUTION_FACT_FIELDS) as InstitutionFactField[];

/**
 * Fields used for the "fully verified" coverage figure. Not every fact applies to every program
 * (status_note only for ruled-out programs, progression_* only for pathways), so coverage uses this core set.
 */
export const PROGRAM_CORE_FIELDS: readonly ProgramFactField[] = [
  'intake',
  'deadline',
  'min_gpa_rule',
  'language_req',
  'tuition',
  'duration_months',
];

const COUNTRY_KEYS: Record<CountryFactKey, true> = {
  citizenship_rule: true,
  citizenship_update: true,
  dual_nationality_destination: true,
  post_study_work: true,
  pr_route: true,
  pakistan_dual_nationality: true,
  proof_of_funds: true,
  tuition_typical: true,
  living_cost_typical: true,
};

export const COUNTRY_FACT_KEYS = Object.keys(COUNTRY_KEYS) as CountryFactKey[];

export function isProgramFactField(s: string): s is ProgramFactField {
  return Object.prototype.hasOwnProperty.call(PROGRAM_FACT_FIELDS, s);
}

/** Fields the ingestion script extracts by default (status_note is left to a human: it can rule a program out). */
export const DEFAULT_INGEST_FIELDS: readonly ProgramFactField[] = PROGRAM_FACT_KEYS.filter((f) => f !== 'status_note');
