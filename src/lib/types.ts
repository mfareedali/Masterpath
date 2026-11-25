/**
 * MastersPath domain types — the shared contract for every module.
 *
 * CORE RULE: every program or country fact is stored as
 *   { value, source_url, evidence_snippet, fetched_at } (+ optional basis / conflicts)
 * and its confidence is COMPUTED IN CODE (see src/lib/confidence.ts), never stored as truth.
 * A null value means "Not verified yet". Never invent a number, deadline, fee or requirement.
 */

/** ISO date "YYYY-MM-DD" or a full ISO timestamp. */
export type ISODate = string;

/**
 * How a value relates to its source:
 *  - 'verbatim': evidence_snippet was copied exactly from the official page (the default when a snippet exists)
 *  - 'summary':  a human summary of the official page, not yet backed by a verbatim snippet (max confidence: Likely)
 *  - 'inferred': derived from other facts or a secondary/news source (max confidence: Likely)
 */
export type Basis = 'verbatim' | 'summary' | 'inferred';

export interface SourcedValue<T> {
  value: T | null;
  source_url: string | null;
  evidence_snippet: string | null;
  fetched_at: ISODate | null;
  basis?: Basis;
  /** Optional student-facing note (shown as "Note: …"). Plain text only. */
  note?: string | null;
  /** Internal reviewer note (provenance, caveats for maintainers). NEVER rendered to students. */
  review_note?: string | null;
}

export interface Fact<T> extends SourcedValue<T> {
  /**
   * Other sources for the same fact. If any has a non-null value that differs from `value`,
   * confidence is 'Conflict' and the UI must show BOTH values with BOTH links.
   */
  conflicts?: SourcedValue<T>[];
}

export type Confidence = 'Verified' | 'Likely' | 'Unverified' | 'Conflict';

/** Countries we support. Extend freely (ISO-3166 alpha-2, except UK which is used instead of GB). */
export type CountryCode = 'DE' | 'CH' | 'UK' | 'CA' | 'US' | 'PK' | (string & {});

export const COUNTRY_NAMES: Record<string, string> = {
  DE: 'Germany',
  CH: 'Switzerland',
  UK: 'United Kingdom',
  CA: 'Canada',
  US: 'United States',
  PK: 'Pakistan',
};

/** Grade scales. 'german' is the German 1.0 (best) – 4.0 (pass) scale where LOWER IS BETTER. */
export type GradeScale = 'cgpa_4' | 'cgpa_5' | 'percent' | 'german';

export interface Money {
  amount: number;
  /** ISO-4217 code, e.g. "EUR", "GBP", "USD", "CAD", "CHF", "PKR". */
  currency: string;
  period: 'year' | 'semester' | 'month' | 'total';
}

export interface GpaRule {
  /** Scale the minimum is expressed in. */
  scale: GradeScale;
  /** Minimum required (for 'german': the WORST acceptable grade, e.g. 2.5 means "2.5 or better"). */
  min: number;
  /** Exact wording, e.g. "CGPA 3.0/4.0 for Pakistani 4-year bachelor's". Plain text. */
  text?: string | null;
  /**
   * Other minimums printed in the SAME evidence snippet on another scale (e.g. Brookes: "60% or GPA 2.7").
   * The fit engine uses the one on the student's own scale directly, with no conversion.
   */
  alternatives?: { scale: GradeScale; min: number }[] | null;
}

/**
 * An official route below the regular minimum (provisional / conditional admission), as the page states it.
 * `min` is the lowest grade the route names on `scale` (null when the page names no floor). It never changes the
 * fit label; Plan B shows it as a conditional route.
 */
export interface ConditionalAdmission {
  scale: GradeScale;
  min: number | null;
  text: string;
}

export interface LanguageReq {
  ielts_overall?: number | null;
  toefl_ibt?: number | null;
  /** e.g. "Medium of instruction letter accepted" — only if the official page says so. */
  waiver?: string | null;
  text?: string | null;
}

export type PathwayType =
  | 'direct'
  | 'conditional'
  | 'pre_masters'
  | 'pathway'
  | 'score_based'
  | 'research_led';

export type RecognitionStatus = 'listed' | 'not_listed';

export interface Institution {
  id: string;
  name: string;
  country: CountryCode;
  /** 'destination' = university abroad; 'home' = Pakistani university (for the context card). */
  kind: 'destination' | 'home';
  /** Official homepage (domain checked by the link checker). */
  website: string | null;
  /** HEC (Pakistan) recognition status of this institution. Plain-text status as printed on the official list. */
  hec_status: Fact<string>;
  /** PQR status as recorded on the official list. Plain-text status. */
  pqr_status: Fact<string>;
  /** anabin (Germany) institution status, e.g. "H+" — only as printed on anabin. */
  anabin_status: Fact<string>;
  /** Whether the destination's official recognition list includes this institution (integrity gate). */
  recognition_list_status: Fact<RecognitionStatus>;
  notes?: string | null;
}

export interface Program {
  id: string;
  institution_id: string;
  name: string;
  country: CountryCode;
  degree: string;
  /** Field slug, e.g. "cs". */
  field: string;
  /** Official program page. Used for "Not verified yet — check the official page". */
  official_url: string | null;
  /** 'ruled_out' = shown as a ruled-out card with `status_note` (e.g. not accepting Pakistan applicants). */
  status: 'active' | 'ruled_out';
  status_note: Fact<string>;
  pathway_type: PathwayType;
  intake: Fact<string>;
  /** Application deadline as ISO date (YYYY-MM-DD). */
  deadline: Fact<ISODate>;
  min_gpa_rule: Fact<GpaRule>;
  language_req: Fact<LanguageReq>;
  tuition: Fact<Money>;
  living_cost: Fact<Money>;
  /** Programme length in months (for "Study time" ranking and total cost). */
  duration_months: Fact<number>;
  scholarship_info: Fact<string>;
  sop_requirements: Fact<string>;
  lor_count: Fact<number>;
  cv_requirements: Fact<string>;
  /** GRE/GMAT/other tests, as stated. */
  tests_required: Fact<string>;
  /** Evidence that research/publications are considered in admission (P1 "Where your research may matter"). */
  research_considered: Fact<string>;
  /** For pre-master's / pathway routes: is progression to the Masters guaranteed per the official page? */
  progression_guaranteed: Fact<boolean>;
  progression_requirement: Fact<string>;
  /**
   * Who the programme is for, as the official page states it (e.g. "for graduates of subjects other than computing").
   * Shown prominently and used as a Plan B / shortlist warning. Never used to decide fit.
   */
  eligibility_note: Fact<string>;
  /** Official conditional / provisional route below the regular minimum. */
  conditional_admission: Fact<ConditionalAdmission>;
  /** Whether (and how) the English test can be waived for a Pakistani degree, as the official page states it. */
  language_waiver: Fact<string>;
  /** Admissions email for "Copy email to admissions" (only from an official page). */
  admissions_email: Fact<string>;
  last_checked: ISODate | null;
}

export type CountryFactKey =
  | 'citizenship_rule'
  /** Recent changes to the citizenship route (e.g. a fast track ending). */
  | 'citizenship_update'
  /** Money the student must show for the student visa (proof of funds / blocked account). */
  | 'proof_of_funds'
  | 'dual_nationality_destination'
  | 'post_study_work'
  | 'pr_route'
  | 'pakistan_dual_nationality'
  | 'tuition_typical'
  | 'living_cost_typical';

export interface CountryFactValue {
  /** The exact rule in plain words. */
  text: string;
  /**
   * The number of months this rule is RANKED by, taken from the rule. It is a sort key, not a legal minimum or
   * maximum (e.g. the UK Graduate visa row uses 18 although 2 years applies until 31 Dec 2026; see DECISIONS.md).
   * Never compare a claim with it as if it were the law: read the rule text. Null when no single number fits.
   */
  sort_months?: number | null;
  /** For cost keys: typical yearly amount. */
  money?: Money | null;
  /** How/when the clock starts, as stated by the source. */
  clock_note?: string | null;
}

export interface CountryFact extends Fact<CountryFactValue> {
  id: string;
  country: CountryCode;
  key: CountryFactKey;
}

export interface ConversionRule {
  id: string;
  /** e.g. "PK->DE", "PK->*" */
  scope: string;
  from_scale: GradeScale;
  to_scale: GradeScale;
  /**
   * 'identity': same scale.
   * 'modified_bavarian': German grade = 1 + 3 * (Nmax - Nd) / (Nmax - Nmin). Requires params.nmax and params.nmin
   *   (nmin may be a [low, high] range when the transcript's minimum pass grade is unknown -> converted RANGE).
   * 'linear': to = a * from + b, params.a / params.b (each may be a [low, high] range).
   */
  formula: 'identity' | 'modified_bavarian' | 'linear';
  params?: Record<string, number | [number, number]>;
  source_url: string | null;
  evidence_snippet?: string | null;
  fetched_at?: ISODate | null;
  notes?: string | null;
}

export interface FxRate {
  id: string;
  /** Currency converted FROM, e.g. "EUR". */
  currency: string;
  /** PKR per 1 unit of `currency`. */
  pkr_per_unit: Fact<number>;
}

/* ---------------- Fit engine ---------------- */

export type FitLabel = 'Meets minimum' | 'Below minimum' | 'Competitive range unknown';

export type FitReasonCode =
  | 'MEETS_MIN' // converted range is entirely at/above the minimum
  | 'BELOW_MIN' // converted range is entirely below the minimum
  | 'STRADDLES_MIN' // the converted range crosses the minimum
  | 'MIN_NOT_VERIFIED' // program minimum missing or Unverified
  | 'MIN_CONFLICT' // sources disagree on the minimum
  | 'NO_CONVERSION_RULE' // no rule converts the student's scale to the program's scale
  | 'CONVERSION_RULE_UNSOURCED' // a rule exists but has no official source yet
  | 'NOT_ACCEPTING' // program is ruled out (e.g. not accepting Pakistan applicants)
  | 'INVALID_INPUT';

export interface ConvertedRange {
  scale: GradeScale;
  low: number;
  high: number;
  /** For display: which direction is better on this scale. */
  better: 'higher' | 'lower';
  rule_id: string | null;
  rule_source_url: string | null;
  rule_formula: ConversionRule['formula'];
}

export interface FitResult {
  label: FitLabel;
  reason: { code: FitReasonCode; message: string };
  converted: ConvertedRange | null;
  required: { scale: GradeScale; min: number; confidence: Confidence; source_url: string | null } | null;
}

/* ---------------- Student profile ---------------- */

export type StudentScale = 'cgpa_4' | 'cgpa_5' | 'percent';

/**
 * The student's profile. No passport or ID numbers — ever.
 * Stored in a first-party cookie + localStorage (anonymous), and in Supabase `profiles` when signed in.
 */
export interface Profile {
  cgpa: number;
  scale: StudentScale;
  /** Lowest passing grade on the transcript, if the student knows it (narrows the German conversion range). */
  min_pass?: number | null;
  university_name?: string | null;
  university_id?: string | null;
  degree?: string | null;
  field: string;
  /** Total budget for the whole degree (tuition + living), in PKR. */
  budget_pkr?: number | null;
  target_countries: CountryCode[];
  /** Demo persona marker ('A' | 'B'), if loaded from the demo button. */
  persona?: 'A' | 'B' | null;
}

/* ---------------- Strengths (P1) ---------------- */

export interface Publication {
  title: string;
  venue?: string | null;
  year?: number | null;
  status: 'published' | 'accepted' | 'preprint' | 'under_review';
  author_position?: 'first' | 'co-first' | 'middle' | 'last' | null;
  link?: string | null;
}

export interface ResearchExperience {
  lab?: string | null;
  supervisor?: string | null;
  institution?: string | null;
  link?: string | null;
  role?: string | null;
  dates?: string | null;
  note?: string | null;
}

export interface Strengths {
  publications: Publication[];
  research: ResearchExperience[];
  collaborators?: string[];
  code_data_links?: string[];
  other?: string[];
  free_text?: string | null;
}

/* ---------------- Reports (P1) ---------------- */

export interface DataReport {
  id?: string;
  program_id: string;
  field: string;
  message: string;
  status?: 'open' | 'triaged' | 'fixed' | 'rejected';
}
