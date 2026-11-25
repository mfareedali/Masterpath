/**
 * The fact fields of a Program: labels, page sections, which fields apply to which program, and coverage counts.
 * Pure functions, safe on server and client. `now` is always passed in.
 */
import { computeConfidence } from '@/lib/confidence';
import type { Confidence, Fact, Program } from '@/lib/types';

/** Every Fact-typed field of the Program type, in page order. */
export const PROGRAM_FACT_KEYS = [
  'status_note',
  'eligibility_note',
  'intake',
  'deadline',
  'duration_months',
  'tuition',
  'living_cost',
  'scholarship_info',
  'min_gpa_rule',
  'conditional_admission',
  'language_req',
  'language_waiver',
  'tests_required',
  'sop_requirements',
  'lor_count',
  'cv_requirements',
  'research_considered',
  'progression_guaranteed',
  'progression_requirement',
  'admissions_email',
] as const satisfies readonly (keyof Program)[];

export type ProgramFactKey = (typeof PROGRAM_FACT_KEYS)[number];

/** The value type stored inside a program fact, e.g. GpaRule for 'min_gpa_rule'. */
export type ProgramFactValue<K extends ProgramFactKey> = Program[K] extends Fact<infer V> ? V : never;

// Compile-time guard: if a new Fact field is added to Program, this line fails until it is listed above.
type FactKeysOf<T> = { [K in keyof T]-?: T[K] extends Fact<unknown> ? K : never }[keyof T];
type UnlistedFactKeys = Exclude<FactKeysOf<Program>, ProgramFactKey>;
export const ALL_FACT_KEYS_LISTED: [UnlistedFactKeys] extends [never] ? true : false = true;

export const FACT_LABEL: Record<ProgramFactKey, string> = {
  status_note: 'Status note',
  eligibility_note: 'Who this course is for',
  conditional_admission: 'Route below the minimum',
  language_waiver: 'English test waiver',
  intake: 'Intake',
  deadline: 'Application deadline',
  duration_months: 'Program length',
  tuition: 'Tuition fee',
  living_cost: 'Living cost',
  scholarship_info: 'Scholarships',
  min_gpa_rule: 'Minimum grade',
  language_req: 'English test',
  tests_required: 'Other tests',
  sop_requirements: 'Statement of purpose (SOP)',
  lor_count: 'Letters of recommendation (LORs)',
  cv_requirements: 'CV',
  research_considered: 'Research and publications',
  progression_guaranteed: "Progression to the Master's guaranteed?",
  progression_requirement: 'Progression requirement',
  admissions_email: 'Admissions email',
};

export interface FactSectionDef {
  id: string;
  title: string;
  keys: readonly ProgramFactKey[];
}

/**
 * FactRow sections on the program page. status_note and research_considered have their own blocks.
 * eligibility_note (who the course is for) is the first entry requirement; when it is usable it is ALSO shown
 * as a warning call-out at the top of the page. It never decides fit.
 * conditional_admission ("Route below the minimum") follows the minimum grade and language_waiver ("English test
 * waiver") follows the English test. Neither ever changes the fit label.
 */
export const FACT_SECTIONS = {
  keyFacts: {
    id: 'key-facts',
    title: 'Key facts',
    keys: ['intake', 'deadline', 'duration_months', 'tuition', 'living_cost', 'scholarship_info'],
  },
  entry: {
    id: 'entry',
    title: 'Entry requirements',
    keys: ['eligibility_note', 'min_gpa_rule', 'conditional_admission', 'language_req', 'language_waiver', 'tests_required'],
  },
  documents: { id: 'documents', title: 'Application documents', keys: ['sop_requirements', 'lor_count', 'cv_requirements'] },
  pathway: { id: 'pathway', title: 'Pathway', keys: ['progression_guaranteed', 'progression_requirement'] },
  contact: { id: 'contact', title: 'Contact', keys: ['admissions_email'] },
} as const satisfies Record<string, FactSectionDef>;

const PATHWAY_TYPES: ReadonlySet<Program['pathway_type']> = new Set(['pre_masters', 'pathway', 'conditional']);

/** Pre-master's, pathway and conditional routes have progression facts; direct routes do not. */
export function isPathwayProgram(p: Pick<Program, 'pathway_type'>): boolean {
  return PATHWAY_TYPES.has(p.pathway_type);
}

/**
 * Fact fields that apply to this program (used for the coverage line and the report form):
 *  - progression fields only for pathway-type routes,
 *  - the status note only when the program is ruled out or a note exists,
 *  - everything else (including eligibility_note, conditional_admission and language_waiver) for every program.
 */
export function applicableFactKeys(p: Program): ProgramFactKey[] {
  return PROGRAM_FACT_KEYS.filter((k) => {
    if ((k === 'progression_guaranteed' || k === 'progression_requirement') && !isPathwayProgram(p)) return false;
    if (k === 'status_note' && p.status !== 'ruled_out' && (p.status_note?.value ?? null) === null) return false;
    return true;
  });
}

export interface Coverage {
  total: number;
  verified: number;
  likely: number;
  conflict: number;
  unverified: number;
  byKey: Partial<Record<ProgramFactKey, Confidence>>;
}

/** Counts confidence per applicable fact field. Confidence is computed, never read from data. */
export function computeCoverage(p: Program, now: Date): Coverage {
  const c: Coverage = { total: 0, verified: 0, likely: 0, conflict: 0, unverified: 0, byKey: {} };
  for (const k of applicableFactKeys(p)) {
    const conf = computeConfidence(p[k] as Fact<unknown> | null | undefined, now);
    c.byKey[k] = conf;
    c.total += 1;
    if (conf === 'Verified') c.verified += 1;
    else if (conf === 'Likely') c.likely += 1;
    else if (conf === 'Conflict') c.conflict += 1;
    else c.unverified += 1;
  }
  return c;
}

/** "8 of 18 fields verified" */
export function coverageLine(c: Coverage): string {
  return `${c.verified} of ${c.total} field${c.total === 1 ? '' : 's'} verified`;
}

/** Secondary line, e.g. "2 likely · 1 with conflicting sources · 11 not verified yet". Empty when nothing to add. */
export function coverageDetail(c: Coverage): string {
  const parts: string[] = [];
  if (c.likely) parts.push(`${c.likely} likely`);
  if (c.conflict) parts.push(`${c.conflict} with conflicting sources`);
  if (c.unverified) parts.push(`${c.unverified} not verified yet`);
  return parts.join(' · ');
}

/** Options for the "Report incorrect data" field select. */
export function reportFieldOptions(p: Program): { key: ProgramFactKey; label: string }[] {
  return applicableFactKeys(p).map((key) => ({ key, label: FACT_LABEL[key] }));
}
