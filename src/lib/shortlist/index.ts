/**
 * Shortlist engine — plain code over rows, no AI, no I/O, no clock (pass `now`).
 *
 * Pipeline:
 *  1. Field scope: only programs whose field equals profile.field.
 *  2. Ruled-out programs (status 'ruled_out') are split off and never ranked.
 *  3. Country filter (a plain property, always known): pass or hidden.
 *  4. Data-dependent filters (fit, intake, budget): pass, fail (hidden, counted) or UNKNOWN.
 *     Unknown = the value is missing/unusable -> the program goes to a visible "Can't check: data missing" group.
 *     It is never silently dropped and never silently kept.
 *  5. The rest is ranked with rankItems. Only Verified/Likely values are ranked; everything else goes to
 *     "Not ranked: data missing" with a reason. A missing value is never treated as zero or infinity.
 */
import { computeConfidence, isUsable } from '../confidence';
import { pkrRate, pkrRateStatus, programTotalCost, programTuitionTotal, programTuitionTotalProblem, toPkr, type CostResult } from '../cost';
import { computeFit, fitSortValue } from '../fit';
import { countryName, formatDate, formatMonths, formatPkr } from '../format';
import { shortlistHref as profileShortlistHref } from '../onboarding/profile-form';
import { FIELDS, SUPPORTED_COUNTRIES } from '../profile';
import { rankItems, weakestConfidence, type RankKey } from '../rank';
import type {
  Confidence,
  ConditionalAdmission,
  ConversionRule,
  CountryFact,
  CountryFactValue,
  Fact,
  FitLabel,
  FitReasonCode,
  FitResult,
  FxRate,
  Institution,
  Profile,
  Program,
} from '../types';
import {
  compareIntakeTerms,
  intakeTermLabel,
  intakeTermsOf,
  isIntakeTermId,
  matchIntake,
  parseIntake,
  type IntakeTermId,
} from './intake';
import {
  DEFAULT_QUERY,
  RANK_LABEL,
  activeFilterCount,
  type FitFilter,
  type ShortlistQuery,
  type ShortlistRankKey,
} from './query';

export * from './intake';
export * from './query';
export * from './presentation';

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ types */

export interface ProgramView {
  program: Program;
  institution: Institution | null;
  institutionName: string;
  fit: FitResult;
  /** Tuition + living for the whole programme (PKR only through a usable exchange rate). */
  totalCost: CostResult;
  /** The program country's `citizenship_rule` fact, if a row exists. */
  citizenship: CountryFact | null;
  /** true/false only when the profile has a budget AND a usable PKR total exists; otherwise null. */
  withinBudget: boolean | null;
  /** True only when a usable (Verified/Likely) deadline is before `now`. */
  deadlinePassed: boolean;
  /**
   * Whole days from today (UTC) to a usable (Verified/Likely) deadline: 0 = closes today, negative = passed.
   * Null when the deadline is missing, Unverified, in conflict or unreadable.
   */
  deadlineDaysLeft: number | null;
}

export interface RankedRow extends ProgramView {
  rank: number;
  key: RankKey;
}

export interface NotRankedRow extends ProgramView {
  key: RankKey;
  reason: string;
}

export interface CantCheckRow extends ProgramView {
  /** One plain-language reason per filter that could not be checked, e.g. "Intake: not verified yet". */
  reasons: string[];
}

export interface FieldCoverage {
  field: string;
  label: string;
  verified: number;
  total: number;
}

export interface Coverage {
  /** Verified programs in the profile's field (active programs only). */
  verified: number;
  total: number;
  /** Same count for every field in the dataset. */
  byField: FieldCoverage[];
  /** Individual facts across those programs (every fact field), by computed confidence. */
  facts: { verified: number; likely: number; total: number };
}

export interface EffectiveFilters {
  /** Countries shown; null = all countries. */
  countries: string[] | null;
  countrySource: 'profile' | 'query' | 'all';
  fit: FitFilter[];
  /** Selected intake terms that exist in the data (others are ignored). */
  intake: IntakeTermId[];
  /** "Within my budget" is applied. */
  budget: boolean;
  /** "Within my budget" was asked for, but the profile has no budget, so it is not applied. */
  budgetUnavailable: boolean;
}

export interface HiddenCounts {
  /** Programs hidden because a filter definitively excluded them (unique count). */
  total: number;
  country: number;
  fit: number;
  intake: number;
  budget: number;
}

export interface Shortlist {
  query: ShortlistQuery;
  field: { slug: string; label: string };
  /** No programs (active or ruled out) are seeded for the profile's field. */
  noProgramsForField: boolean;
  ranked: RankedRow[];
  notRanked: NotRankedRow[];
  cantCheck: CantCheckRow[];
  ruledOut: ProgramView[];
  hidden: HiddenCounts;
  /**
   * When no programs exist for the profile's field: the field we do have programs for, offered as a one-click
   * alternative ("the closest field we have"). Null otherwise. Navigation only: nothing is relabelled.
   */
  fallbackField: { slug: string; label: string } | null;
  options: {
    /** Countries that have programs in this field. */
    countries: string[];
    /** Distinct start terms read from usable (Verified/Likely) intake values in this field, in chip order. */
    intakes: IntakeTermId[];
    /**
     * At least one exchange-rate row is usable for PKR totals (pkrRate in src/lib/cost.ts). When false,
     * "Within my budget" can check nothing and says why.
     */
    pkrRateAvailable: boolean;
  };
  filters: EffectiveFilters;
  activeFilterCount: number;
  coverage: Coverage;
}

export interface ShortlistInput {
  programs: readonly Program[];
  institutions: readonly Institution[] | ReadonlyMap<string, Institution>;
  countryFacts: readonly CountryFact[];
  conversionRules: ConversionRule[];
  fxRates: FxRate[];
  profile: Profile;
  now: Date;
  query?: Partial<ShortlistQuery>;
}

/* ------------------------------------------------------------- rank keys */

const FIT_MISSING_REASON: Partial<Record<FitReasonCode, string>> = {
  MIN_NOT_VERIFIED: 'Minimum grade not verified yet',
  MIN_CONFLICT: 'Sources disagree on the minimum grade',
  NO_CONVERSION_RULE: 'No sourced rule converts your grade to this scale yet',
  CONVERSION_RULE_UNSOURCED: 'The grade conversion rule has no official source yet',
  INVALID_INPUT: 'Check the grade in your profile',
  NOT_ACCEPTING: 'Program is ruled out',
};

/** Short reason when fit cannot be decided (for "Not ranked" / "Can't check"). */
export function fitMissingReason(fit: FitResult): string {
  return FIT_MISSING_REASON[fit.reason.code] ?? 'Fit could not be decided';
}

/** 'fit': Meets minimum (0) → range crosses minimum (1) → Below minimum (2). */
export function fitRankKey(fit: FitResult): RankKey {
  const v = fitSortValue(fit);
  if (v !== null && fit.required) return { value: v, confidence: fit.required.confidence };
  return {
    value: null,
    confidence: fit.reason.code === 'MIN_CONFLICT' ? 'Conflict' : 'Unverified',
    missingReason: fitMissingReason(fit),
  };
}

/** 'tuition': tuition for the whole programme, converted to PKR through a usable exchange rate. */
export function tuitionRankKey(p: Program, fx: FxRate[], now: Date): RankKey {
  const tc = computeConfidence(p.tuition, now);
  if (tc === 'Conflict') return { value: null, confidence: 'Conflict', missingReason: 'Tuition sources conflict' };
  if (!isUsable(tc) || !p.tuition.value) return { value: null, confidence: tc, missingReason: 'Tuition not verified yet' };
  const total = programTuitionTotal(p, now);
  if (!total) {
    return {
      value: null,
      confidence: 'Unverified',
      // e.g. no usable length, or a length that is not a whole number of the fee's period (src/lib/cost.ts).
      missingReason: programTuitionTotalProblem(p, now) ?? 'Programme length not verified yet (needed to total tuition)',
    };
  }
  const conv = toPkr(total.amount, total.currency, fx, now);
  if (!conv) {
    // Say exactly why (no rate, a rate older than 45 days, an undated rate, or conflicting sources).
    const status = pkrRateStatus(total.currency, fx, now);
    const reason = status.ok ? `No verified ${total.currency} to PKR rate yet` : status.reason;
    return { value: null, confidence: total.confidence, missingReason: reason };
  }
  return { value: conv.pkr, confidence: weakestConfidence(total.confidence, conv.confidence) };
}

/** 'total': programTotalCost(...).pkr; reason = what is missing. */
export function totalCostRankKey(cost: CostResult): RankKey {
  if (cost.pkr != null && isUsable(cost.confidence)) return { value: cost.pkr, confidence: cost.confidence };
  return {
    value: null,
    confidence: cost.confidence,
    missingReason: cost.missing.length > 0 ? cost.missing.join('; ') : 'Cost data incomplete',
  };
}

/** 'citizenship': the country's citizenship_rule sort_months, with that fact's confidence. */
export function citizenshipRankKey(fact: CountryFact | null | undefined, now: Date): RankKey {
  if (!fact) return { value: null, confidence: 'Unverified', missingReason: 'Citizenship rule not verified yet' };
  const conf = computeConfidence(fact, now);
  if (conf === 'Conflict') return { value: null, confidence: conf, missingReason: 'Citizenship rule sources conflict' };
  if (!isUsable(conf) || !fact.value) {
    return { value: null, confidence: conf, missingReason: 'Citizenship rule not verified yet' };
  }
  const m = fact.value.sort_months;
  if (m == null || !Number.isFinite(m)) {
    return { value: null, confidence: conf, missingReason: 'Citizenship rule has no comparable number of months yet' };
  }
  return { value: m, confidence: conf };
}

/** 'study': programme length in months. */
export function studyRankKey(p: Program, now: Date): RankKey {
  const conf = computeConfidence(p.duration_months, now);
  if (conf === 'Conflict') return { value: null, confidence: conf, missingReason: 'Programme length sources conflict' };
  const v = p.duration_months.value;
  if (!isUsable(conf) || v == null || !Number.isFinite(v)) {
    return { value: null, confidence: conf, missingReason: 'Programme length not verified yet' };
  }
  return { value: v, confidence: conf };
}

/** Whole days since 1970-01-01 (UTC) for an ISO date, or null when unreadable. */
export function isoToDays(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / DAY_MS);
}

/** Today as whole days since 1970-01-01 (UTC), the same day count isoToDays uses. */
export function todayInDays(now: Date): number {
  return Math.floor(now.getTime() / DAY_MS);
}

/** "Not ranked" reason for a usable deadline that is already behind us. Never guesses the next cycle's date. */
export function deadlinePassedReason(iso: string): string {
  return `Deadline has passed (${formatDate(iso)}). The next deadline is not verified yet.`;
}

/**
 * 'deadline': the deadline ISO date as a number of days. A usable date that has already passed is NOT ranked
 * (an "earliest first" list must never put closed applications on top); it goes to "Not ranked" with
 * deadlinePassedReason, and the card still shows the date and "Date has passed".
 */
export function deadlineRankKey(p: Program, now: Date): RankKey {
  const conf = computeConfidence(p.deadline, now);
  if (conf === 'Conflict') return { value: null, confidence: conf, missingReason: 'Deadline sources conflict' };
  if (!isUsable(conf) || !p.deadline.value) return { value: null, confidence: conf, missingReason: 'Deadline not verified yet' };
  const days = isoToDays(p.deadline.value);
  if (days === null) return { value: null, confidence: conf, missingReason: 'Deadline date is not in a readable format' };
  if (days < todayInDays(now)) return { value: null, confidence: conf, missingReason: deadlinePassedReason(p.deadline.value) };
  return { value: days, confidence: conf };
}

/**
 * Whole days from today (UTC) to the program's deadline, only for a usable (Verified/Likely), readable date.
 * 0 = closes today; negative = passed. Null otherwise (never computed from an Unverified or conflicting date).
 */
export function deadlineDaysLeft(p: Program, now: Date): number | null {
  const conf = computeConfidence(p.deadline, now);
  if (!isUsable(conf) || !p.deadline.value) return null;
  const days = isoToDays(p.deadline.value);
  return days === null ? null : days - todayInDays(now);
}

/** "12 days left" / "1 day left" / "Closes today" / "Date has passed". */
export function daysLeftLabel(days: number): string {
  if (days < 0) return 'Date has passed';
  if (days === 0) return 'Closes today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

/** The "Deadlines in the next N days" window. A UI constant, not a fact. */
export const CLOSING_SOON_DAYS = 30;

export interface ClosingSoonRow {
  program: Program;
  institutionName: string;
  /** The deadline as stored (usable value). */
  iso: string;
  /** 0..windowDays. */
  days: number;
  confidence: Extract<Confidence, 'Verified' | 'Likely'>;
  /** The deadline's student-facing note, verbatim (never review_note). */
  note: string | null;
}

/**
 * Deadlines closing within `windowDays` (0 = today, inclusive) among the programs already listed (ranked, not
 * ranked, can't check), so country, fit, intake and budget filters apply. Only usable (Verified/Likely) dates;
 * passed, Unverified and conflicting dates are left out. Sorted by date, then program name. It re-shows rows
 * already listed: it never filters, ranks or changes fit.
 */
export function closingSoon(
  s: Pick<Shortlist, 'ranked' | 'notRanked' | 'cantCheck'>,
  now: Date,
  windowDays: number = CLOSING_SOON_DAYS,
): ClosingSoonRow[] {
  const out: ClosingSoonRow[] = [];
  for (const v of [...s.ranked, ...s.notRanked, ...s.cantCheck] as ProgramView[]) {
    const conf = computeConfidence(v.program.deadline, now);
    const iso = v.program.deadline.value;
    if (!isUsable(conf) || !iso) continue;
    const days = deadlineDaysLeft(v.program, now);
    if (days === null || days < 0 || days > windowDays) continue;
    const note = v.program.deadline.note?.trim() || null;
    out.push({ program: v.program, institutionName: v.institutionName, iso, days, confidence: conf, note });
  }
  return out.sort((a, b) => a.days - b.days || a.program.name.localeCompare(b.program.name));
}

export function rankKeyFor(rank: ShortlistRankKey, view: ProgramView, fx: FxRate[], now: Date): RankKey {
  switch (rank) {
    case 'fit':
      return fitRankKey(view.fit);
    case 'tuition':
      return tuitionRankKey(view.program, fx, now);
    case 'total':
      return totalCostRankKey(view.totalCost);
    case 'citizenship':
      return citizenshipRankKey(view.citizenship, now);
    case 'study':
      return studyRankKey(view.program, now);
    case 'deadline':
      return deadlineRankKey(view.program, now);
  }
}

/* --------------------------------------------------------------- filters */

type Check = { result: 'pass' } | { result: 'fail' } | { result: 'unknown'; reason: string };
const PASS: Check = { result: 'pass' };
const FAIL: Check = { result: 'fail' };

const FIT_FILTER_OF: Record<FitLabel, FitFilter> = {
  'Meets minimum': 'meets',
  'Competitive range unknown': 'unknown',
  'Below minimum': 'below',
};

/**
 * Fit filter. Pass when the label is selected. Fail only when the label is DECIDED by verified data
 * (Meets / Below minimum). Otherwise (minimum not verified, range crosses the minimum, ...) we cannot
 * check it -> unknown.
 */
export function checkFitFilter(fit: FitResult, selected: readonly FitFilter[]): Check {
  if (selected.length === 0 || selected.includes(FIT_FILTER_OF[fit.label])) return PASS;
  if (fit.reason.code === 'MEETS_MIN' || fit.reason.code === 'BELOW_MIN') return FAIL;
  const why = fit.reason.code === 'STRADDLES_MIN' ? 'your grade range crosses the minimum' : fitMissingReason(fit).toLowerCase();
  return { result: 'unknown', reason: `Fit: ${why}` };
}

/**
 * Intake filter over start TERMS read from the intake text (see ./intake.ts), never an exact string compare.
 * Pass when the text names a selected term. Fail only when the text was read in full and names other terms
 * of the same kind. Anything else (text we cannot read, or a term of another kind such as "Winter semester"
 * against "October") is unknown -> "Can't check".
 */
export function checkIntakeFilter(p: Program, selected: readonly IntakeTermId[], now: Date): Check {
  if (selected.length === 0) return PASS;
  const conf = computeConfidence(p.intake, now);
  if (conf === 'Conflict') return { result: 'unknown', reason: 'Intake: sources disagree' };
  if (!isUsable(conf) || p.intake.value == null) return { result: 'unknown', reason: 'Intake: not verified yet' };
  const result = matchIntake(parseIntake(p.intake.value), selected);
  if (result === 'pass') return PASS;
  if (result === 'fail') return FAIL;
  const wanted = selected.map(intakeTermLabel).join(' or ');
  return { result: 'unknown', reason: `Intake: "${p.intake.value.trim()}" can't be compared with ${wanted}` };
}

/**
 * Selected intake terms from the URL. A value is a term id ("september"), or, for links shared before
 * intake terms existed, the old raw intake text ("January 2027, September 2027"), read into its terms.
 * Only terms offered by the data are kept.
 */
export function selectedIntakeTerms(values: readonly string[], options: readonly IntakeTermId[]): IntakeTermId[] {
  const out = new Set<IntakeTermId>();
  for (const v of values) {
    for (const t of isIntakeTermId(v) ? [v] : intakeTermsOf(v)) if (options.includes(t)) out.add(t);
  }
  return [...out].sort(compareIntakeTerms);
}

export function checkBudgetFilter(cost: CostResult, budgetPkr: number): Check {
  if (cost.pkr == null || !isUsable(cost.confidence)) {
    const why = cost.missing.length > 0 ? cost.missing.join('; ') : 'cost data incomplete';
    return { result: 'unknown', reason: `Budget: ${why}` };
  }
  return cost.pkr <= budgetPkr ? PASS : FAIL;
}

/* -------------------------------------------------------------- coverage */

/** A program is "verified" when its minimum grade, deadline, tuition and English requirement are all Verified. */
export function isProgramVerified(p: Program, now: Date): boolean {
  const facts: Fact<unknown>[] = [p.min_gpa_rule, p.deadline, p.tuition, p.language_req];
  return facts.every((f) => computeConfidence(f, now) === 'Verified');
}

export function fieldLabel(slug: string): string {
  return FIELDS.find((f) => f.slug === slug)?.label ?? slug;
}

export function computeCoverage(programs: readonly Program[], field: string, now: Date): Coverage {
  const active = programs.filter((p) => p.status === 'active');
  const order = FIELDS.map((f) => f.slug as string);
  const fields = [...new Set(active.map((p) => p.field))].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  const count = (slug: string) => {
    const inField = active.filter((p) => p.field === slug);
    return { verified: inField.filter((p) => isProgramVerified(p, now)).length, total: inField.length };
  };
  const facts = { verified: 0, likely: 0, total: 0 };
  for (const p of active.filter((x) => x.field === field)) {
    for (const v of Object.values(p)) {
      if (!v || typeof v !== 'object' || !('value' in v)) continue;
      facts.total++;
      const c = computeConfidence(v as Fact<unknown>, now);
      if (c === 'Verified') facts.verified++;
      else if (c === 'Likely') facts.likely++;
    }
  }
  return {
    ...count(field),
    byField: fields.map((slug) => ({ field: slug, label: fieldLabel(slug), ...count(slug) })),
    facts,
  };
}

/* ----------------------------------------------------------------- notes */

export interface ProgramNotes {
  /** status_note of an ACTIVE program (e.g. extra measures for Pakistan applicants). Shown as "Note". */
  status: Fact<string> | null;
  /** Who the course is for, as the official page states it. Shown as a "Who it's for" warning. */
  eligibility: Fact<string> | null;
}

/**
 * Notes a shortlist card shows beside the numbers: only Verified or Likely values, or a Conflict (then both
 * sources are shown). Unverified notes are left to the program page. Notes are for reading only: they never
 * change fit, filters or ranking.
 */
export function programNotes(p: Program, now: Date): ProgramNotes {
  const shown = (f: Fact<string> | null | undefined): Fact<string> | null => {
    if (!f) return null;
    const c = computeConfidence(f, now);
    if (c === 'Conflict') return f;
    return isUsable(c) && typeof f.value === 'string' && f.value.trim() !== '' ? f : null;
  };
  return {
    status: p.status === 'active' ? shown(p.status_note) : null,
    eligibility: shown(p.eligibility_note),
  };
}

/**
 * The official route below the regular minimum (conditional / provisional admission), as the page states it,
 * for the card row "Official route below the minimum". Only a usable (Verified/Likely) value with text, on an
 * active program, and not when the student already meets the regular minimum (the route does not apply then).
 * Read-only: it NEVER changes the fit label, filters or ranking, and code does not compare the grade with it.
 */
export function conditionalRoute(p: Program, fit: FitResult, now: Date): Fact<ConditionalAdmission> | null {
  if (p.status !== 'active' || fit.reason.code === 'MEETS_MIN') return null;
  const f = p.conditional_admission;
  if (!f || !isUsable(computeConfidence(f, now))) return null;
  const text = f.value?.text;
  return typeof text === 'string' && text.trim() !== '' ? f : null;
}

/**
 * Show "See other routes (Plan B)" on a direct-entry program whose fit is Below minimum, or whose converted
 * grade range crosses the minimum. Navigation only.
 */
export function planBSuggested(v: Pick<ProgramView, 'program' | 'fit'>): boolean {
  return v.program.pathway_type === 'direct' && (v.fit.reason.code === 'BELOW_MIN' || v.fit.reason.code === 'STRADDLES_MIN');
}

/**
 * /plan-b with the same profile query (from profileQueryString: '' or '?cgpa=…') and target=<program id>.
 * Without a profile query, Plan B reads the profile cookie, as the shortlist does.
 */
export function planBTargetHref(profileQuery: string, programId: string): string {
  const target = `target=${encodeURIComponent(programId)}`;
  return profileQuery ? `/plan-b${profileQuery}&${target}` : `/plan-b?${target}`;
}

/**
 * Plain-text caveats shown under a total cost (CostResult.caveats from src/lib/cost.ts: the usable tuition and
 * living-cost notes, because a total can leave out what a note describes). Only when a total is shown (PKR or
 * native); without a total the notes already sit under Tuition. Read defensively: non-empty strings only.
 */
export function totalCostCaveats(cost: CostResult): string[] {
  if (cost.pkr == null && !cost.native) return [];
  const raw: unknown = cost.caveats ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map((c) => c.trim());
}

/** True when at least one exchange-rate row gives a usable PKR rate (same rule as every PKR total). */
export function hasUsablePkrRate(fx: readonly FxRate[], now: Date): boolean {
  return fx.some((r) => r.currency !== 'PKR' && pkrRate(r.currency, fx as FxRate[], now) !== null);
}

/**
 * A /shortlist link that carries the profile itself (cgpa, scale, field, min_pass, budget, countries: the
 * shareable-link format of src/lib/onboarding/profile-form.ts). It never contains the name, university or
 * degree. `field` overrides the profile's field; a non-default rank/order is kept so the reader sees the same order.
 */
export function profileShortlistPath(
  profile: Profile,
  over: { field?: string; rank?: ShortlistRankKey; dir?: ShortlistQuery['dir'] } = {},
): string {
  const path = profileShortlistHref({
    cgpa: profile.cgpa,
    scale: profile.scale,
    field: over.field ?? profile.field,
    min_pass: profile.min_pass ?? null,
    budget_pkr: profile.budget_pkr ?? null,
    target_countries: profile.target_countries,
  });
  const extra = new URLSearchParams();
  if (over.rank && over.rank !== DEFAULT_QUERY.rank) extra.set('rank', over.rank);
  if (over.dir && over.dir !== DEFAULT_QUERY.dir) extra.set('dir', over.dir);
  const qs = extra.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

/** The field offered when the profile's field has no programs: Computer Science, the only seeded field today. */
export const FALLBACK_FIELD = 'cs';

/* ---------------------------------------------------------- display text */

/**
 * Card text for a citizenship_rule value: the row's own exact wording, unchanged.
 * Code never paraphrases a rule (e.g. "1,095 days of physical presence in 5 years" is NOT "3 years of residence").
 */
export function citizenshipShortText(v: CountryFactValue): string {
  return v.text.trim();
}

/** ISO "YYYY-MM-DD" for a whole-days value from isoToDays. */
export function daysToIso(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The value a ranked row was ordered by, in plain words (shown as "Ranked on: …" next to its confidence badge).
 * Pure formatting of the RankKey value that code computed from rows; null for 'fit' (the fit badge says it)
 * or when there is no value.
 */
export function rankValueText(rank: ShortlistRankKey, value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  switch (rank) {
    case 'fit':
      return null;
    case 'tuition':
      return `${formatPkr(value)} tuition for the whole programme`;
    case 'total':
      return `${formatPkr(value)} for the whole degree`;
    case 'citizenship':
      return `${value} months (the number this rule is compared by)`;
    case 'study':
      return formatMonths(value);
    case 'deadline':
      return formatDate(daysToIso(value));
  }
}


export function gradeText(p: Pick<Profile, 'cgpa' | 'scale'>): string {
  if (p.scale === 'percent') return `${p.cgpa}%`;
  return `CGPA ${p.cgpa} / ${p.scale === 'cgpa_4' ? '4.0' : '5.0'}`;
}

/** One-line profile summary parts: grade, field, countries, budget. */
export function profileSummaryParts(p: Profile): string[] {
  return [
    gradeText(p),
    fieldLabel(p.field),
    p.target_countries.length > 0 ? p.target_countries.map(countryName).join(', ') : 'All countries',
    p.budget_pkr != null ? `Budget ${formatPkr(p.budget_pkr)}` : 'No budget set',
  ];
}

/** Programs listed on the page outside "Ruled out" (ranked + not ranked + can't check). */
export function listedCount(s: Pick<Shortlist, 'ranked' | 'notRanked' | 'cantCheck'>): number {
  return s.ranked.length + s.notRanked.length + s.cantCheck.length;
}

/** "2 programs are hidden by your filters: country (1), budget (1)." or null when nothing is hidden. */
export function hiddenSummary(s: Pick<Shortlist, 'hidden'>): string | null {
  const n = s.hidden.total;
  if (n === 0) return null;
  const parts = (['country', 'fit', 'intake', 'budget'] as const)
    .filter((k) => s.hidden[k] > 0)
    .map((k) => `${k} (${s.hidden[k]})`);
  return `${n} program${n === 1 ? ' is' : 's are'} hidden by your filters: ${parts.join(', ')}.`;
}

/** Text for the ranked section when nothing could be ranked. */
export function emptyRankedMessage(
  s: Pick<Shortlist, 'ranked' | 'notRanked' | 'cantCheck' | 'hidden' | 'query'>,
): string {
  const label = RANK_LABEL[s.query.rank].toLowerCase();
  if (listedCount(s) === 0) {
    return s.hidden.total > 0 ? 'No programs match your filters.' : 'No open programs for these countries yet.';
  }
  return `Open a program to check its ${label} on the official page. Every program is listed below.`;
}

/* ------------------------------------------------------------- the build */

function sortCountries(codes: Iterable<string>): string[] {
  const order: readonly string[] = SUPPORTED_COUNTRIES;
  return [...new Set(codes)].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}

function byName(a: ProgramView, b: ProgramView): number {
  return a.program.name.localeCompare(b.program.name) || a.institutionName.localeCompare(b.institutionName);
}

export function buildShortlist(input: ShortlistInput): Shortlist {
  const { profile, now, fxRates, conversionRules, countryFacts } = input;
  const query = mergeQuery(input.query);
  const institutions =
    input.institutions instanceof Map
      ? (input.institutions as ReadonlyMap<string, Institution>)
      : new Map((input.institutions as readonly Institution[]).map((i) => [i.id, i]));

  const view = (program: Program): ProgramView => {
    const institution = institutions.get(program.institution_id) ?? null;
    const totalCost = programTotalCost(program, fxRates, now);
    const daysLeft = deadlineDaysLeft(program, now);
    return {
      program,
      institution,
      institutionName: institution?.name ?? program.institution_id,
      fit: computeFit(profile, program, conversionRules, now),
      totalCost,
      citizenship: countryFacts.find((f) => f.country === program.country && f.key === 'citizenship_rule') ?? null,
      withinBudget:
        profile.budget_pkr != null && totalCost.pkr != null && isUsable(totalCost.confidence)
          ? totalCost.pkr <= profile.budget_pkr
          : null,
      deadlinePassed: daysLeft !== null && daysLeft < 0,
      deadlineDaysLeft: daysLeft,
    };
  };

  const inField = input.programs.filter((p) => p.field === profile.field);
  const active = inField.filter((p) => p.status !== 'ruled_out').map(view).sort(byName);
  const ruledOutAll = inField.filter((p) => p.status === 'ruled_out').map(view).sort(byName);

  // Options come from the data in this field only.
  const countryOptions = sortCountries(inField.map((p) => p.country));
  const intakeOptions = [
    ...new Set(
      active.flatMap((v) => {
        const conf = computeConfidence(v.program.intake, now);
        return isUsable(conf) && v.program.intake.value ? intakeTermsOf(v.program.intake.value) : [];
      }),
    ),
  ].sort(compareIntakeTerms);

  // Effective filters.
  let countries: string[] | null;
  let countrySource: EffectiveFilters['countrySource'];
  if (query.country === 'all') {
    countries = null;
    countrySource = 'all';
  } else if (query.country && query.country.length > 0) {
    countries = query.country;
    countrySource = 'query';
  } else if (profile.target_countries.length > 0) {
    countries = profile.target_countries;
    countrySource = 'profile';
  } else {
    countries = null;
    countrySource = 'all';
  }
  const intake = selectedIntakeTerms(query.intake, intakeOptions);
  const budgetUnavailable = query.budget && profile.budget_pkr == null;
  const budget = query.budget && profile.budget_pkr != null;
  const filters: EffectiveFilters = { countries, countrySource, fit: query.fit, intake, budget, budgetUnavailable };

  const countryOk = (v: ProgramView) => countries === null || countries.includes(v.program.country);

  const hidden: HiddenCounts = { total: 0, country: 0, fit: 0, intake: 0, budget: 0 };
  const candidates: ProgramView[] = [];
  const cantCheck: CantCheckRow[] = [];

  for (const v of active) {
    if (!countryOk(v)) {
      hidden.country++;
      hidden.total++;
      continue;
    }
    const checks: [keyof Omit<HiddenCounts, 'total' | 'country'>, Check][] = [
      ['fit', checkFitFilter(v.fit, filters.fit)],
      ['intake', checkIntakeFilter(v.program, filters.intake, now)],
      ['budget', filters.budget ? checkBudgetFilter(v.totalCost, profile.budget_pkr as number) : PASS],
    ];
    const failed = checks.filter(([, c]) => c.result === 'fail');
    if (failed.length > 0) {
      for (const [name] of failed) hidden[name]++;
      hidden.total++;
      continue;
    }
    const reasons = checks.flatMap(([, c]) => (c.result === 'unknown' ? [c.reason] : []));
    if (reasons.length > 0) cantCheck.push({ ...v, reasons });
    else candidates.push(v);
  }

  const { ranked, notRanked } = rankItems(
    candidates,
    (v) => rankKeyFor(query.rank, v, fxRates, now),
    query.dir,
    (a, b) => a.program.name.localeCompare(b.program.name),
  );

  return {
    query,
    field: { slug: profile.field, label: fieldLabel(profile.field) },
    noProgramsForField: inField.length === 0,
    fallbackField:
      inField.length === 0 &&
      profile.field !== FALLBACK_FIELD &&
      input.programs.some((p) => p.field === FALLBACK_FIELD && p.status === 'active')
        ? { slug: FALLBACK_FIELD, label: fieldLabel(FALLBACK_FIELD) }
        : null,
    ranked: ranked.map((r) => ({ ...r.item, rank: r.rank, key: r.key })),
    notRanked: notRanked.map((r) => ({ ...r.item, key: r.key, reason: r.reason })),
    cantCheck,
    ruledOut: ruledOutAll.filter(countryOk),
    hidden,
    options: { countries: countryOptions, intakes: intakeOptions, pkrRateAvailable: hasUsablePkrRate(fxRates, now) },
    filters,
    activeFilterCount: activeFilterCount(query),
    coverage: computeCoverage(input.programs, profile.field, now),
  };
}

/** Fills missing (or undefined) query fields with defaults. */
export function mergeQuery(q: Partial<ShortlistQuery> | undefined): ShortlistQuery {
  const out: ShortlistQuery = { ...DEFAULT_QUERY };
  if (!q) return out;
  for (const k of Object.keys(DEFAULT_QUERY) as (keyof ShortlistQuery)[]) {
    if (q[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = q[k];
  }
  return out;
}

/**
 * Country chip toggle. `current` = the countries shown now (null = all).
 * From "all", a tap selects just that country. An empty selection means all.
 * A selection equal to the profile's target countries returns null (= default, no URL param).
 */
export function toggleCountry(
  current: readonly string[] | null,
  code: string,
  profileDefault: readonly string[] = [],
): string[] | 'all' | null {
  const base = current ?? [];
  const next = base.includes(code) ? base.filter((c) => c !== code) : [...base, code];
  if (next.length === 0) return profileDefault.length > 0 ? 'all' : null;
  const sameAsDefault =
    profileDefault.length === next.length && profileDefault.every((c) => next.includes(c));
  return sameAsDefault ? null : next;
}
