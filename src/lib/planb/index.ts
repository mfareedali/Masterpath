/**
 * Plan B engine — pure TypeScript, no AI, no I/O, no clock (pass `now` in).
 *
 * When a student is "Below minimum" for a target, Plan B lists honest alternative routes with total time and
 * cost versus going direct, behind an INTEGRITY GATE that blocks or warns instead of pushing the easiest option.
 *
 * Rules this module follows:
 *  - Only Verified/Likely values are used (computeConfidence / usableValue). Missing data is never zero or infinity.
 *  - No numbers, durations, costs or requirements are invented. "Improve and reapply" is generic advice only.
 *  - Fit comes from computeFit. Labels only — never a probability or percentage.
 *  - Strengths never change a fit label or the order of routes; they only add a note on research-led routes.
 *  - Routes are ordered by a transparent score (feasibility + quality + cost), never by ease alone.
 *  - A usable eligibility_note (who the course is for) on a route's program or the Masters it leads to is a soft
 *    ELIGIBILITY warning, listed first. It never blocks (we do not know the student's degree subject for sure)
 *    and never changes fit; like every soft warning it lowers the quality score by one step.
 *  - A usable conditional_admission (an official route below the regular minimum) makes a 'conditional' route
 *    when the student's grade is at or above the route's OWN lower limit (or the page names none). It is
 *    compared on the route's scale, directly or through a SOURCED conversion rule only. It never changes the
 *    fit label, always carries the CONDITIONAL warning, and its feasibility is scored against its own lower
 *    limit with the middle value (never the best). Below that limit it is listed as "Not for your grade";
 *    when we cannot compare, as "Not decided yet".
 *  - A usable deadline (or the follow-on Masters' deadline) that is before today is a soft DEADLINE_PASSED
 *    warning. Unverified deadlines never warn.
 */
import { computeConfidence, isUsable, usableValue } from '../confidence';
import { programTotalCost, type CostResult } from '../cost';
import { SCALE_LABEL, computeFit, fitSortValue } from '../fit';
import { countryName, formatDate, formatMonths, formatPkr } from '../format';
import { PERSONA_B_STRENGTHS } from '../profile';
import { rankItems, weakestConfidence } from '../rank';
import type {
  Confidence,
  ConversionRule,
  Fact,
  FitResult,
  FxRate,
  Institution,
  Profile,
  Program,
  StudentScale,
  Strengths,
} from '../types';
import {
  STUDENT_SCALE_TEXT,
  NO_FLOOR_TEXT,
  checkConditional,
  formatLimit,
  isConditionalRoute,
  type ConditionalCheck,
} from './conditional';
import { deadlineOf, hasPassed, type RouteDeadline } from './deadline';
import { hasResearchStrengths } from './strengths';

export { hasResearchStrengths } from './strengths';
export {
  NO_FLOOR_TEXT,
  STUDENT_SCALE_TEXT,
  checkConditional,
  formatLimit,
  isConditionalRoute,
  type ConditionalCheck,
  type ConditionalStatus,
} from './conditional';
export { daysLeftText, daysUntil, deadlineOf, deadlineText, hasPassed, type RouteDeadline } from './deadline';

/* ------------------------------------------------------------------ */
/* Route types                                                         */
/* ------------------------------------------------------------------ */

export type RouteType =
  | 'lower_floor_direct'
  | 'conditional'
  | 'pre_masters'
  | 'pathway'
  | 'score_based'
  | 'research_led'
  | 'improve_reapply';

export type ProgramRouteType = Exclude<RouteType, 'improve_reapply'>;

/** Display order of route types. */
export const PROGRAM_ROUTE_TYPES: readonly ProgramRouteType[] = [
  'lower_floor_direct',
  'conditional',
  'pre_masters',
  'pathway',
  'score_based',
  'research_led',
];

export const ROUTE_LABEL: Record<RouteType, string> = {
  lower_floor_direct: 'Direct entry, lower minimum',
  conditional: 'Conditional offer',
  pre_masters: "Pre-master's, then Masters",
  pathway: 'Pathway programme',
  score_based: 'Test-score route',
  research_led: 'Research-led route',
  improve_reapply: 'Improve and reapply',
};

/** One plain sentence per route type. Generic on purpose: facts about a program come only from its data row. */
export const ROUTE_HELP: Record<RouteType, string> = {
  lower_floor_direct: 'A Masters in your field whose verified minimum grade you meet.',
  conditional: 'An offer with conditions you must meet first. The official page says what they are.',
  pre_masters: "A preparation course before the Masters. Moving on to the Masters can depend on your results.",
  pathway: 'A preparation route, often run with a partner college, that can lead to the Masters.',
  score_based: 'A program where the official page says a test score is considered as well as your grades.',
  research_led: 'A program where the official page says research experience or publications are considered.',
  improve_reapply: 'Make your application stronger, then apply again in a later cycle.',
};

/** Why a route type has no routes for this student (shown so every route type is explained). */
export const ROUTE_EMPTY: Record<ProgramRouteType, string> = {
  lower_floor_direct:
    'None yet. No program in your field and countries has a verified minimum that you meet. As minimums are verified, they will appear here.',
  conditional: 'None in your field and countries in our data yet.',
  pre_masters: "None in your field and countries in our data yet.",
  pathway: 'None in your field and countries in our data yet.',
  score_based: 'None in your field and countries in our data yet.',
  research_led:
    'None yet. No program in your field and countries has a verified statement that research is considered.',
};

/** Shown on the page as the integrity promise. */
export const INTEGRITY_NOTE =
  'We never rank by ease alone. Routes that look easy or cheap but carry risk are warned or blocked.';

export const ORDER_NOTE =
  'Order = feasibility (do you meet the minimum?) + quality (recognition and warnings) + cost (your budget). Unknown facts never score as the best. Ties are ordered by name.';

/** Pre-master's and pathway routes have a first stage before the Masters. */
const STAGED: readonly ProgramRouteType[] = ['pre_masters', 'pathway'];
const STAGE_LABEL: Partial<Record<ProgramRouteType, string>> = { pre_masters: "Pre-master's", pathway: 'Pathway' };
/** Route types where progression to the Masters must be guaranteed by the official page, or we warn. */
const NEEDS_PROGRESSION_GUARANTEE: readonly ProgramRouteType[] = ['pre_masters', 'pathway', 'conditional'];

/* ------------------------------------------------------------------ */
/* Output types                                                        */
/* ------------------------------------------------------------------ */

export interface TimePart {
  label: string;
  programId: string;
  months: number | null;
  confidence: Confidence;
}

export interface RouteTime {
  /** Total months, only when every part is known (Verified/Likely). */
  months: number | null;
  confidence: Confidence;
  parts: TimePart[];
  /** Plain reasons why the total is unknown. Empty when `months` is known. */
  missing: string[];
}

export interface CostPart {
  label: string;
  programId: string;
  result: CostResult;
}

export interface RouteCost {
  /** Whole-route total in PKR (needs verified exchange rates). */
  pkr: number | null;
  /** Whole-route total in the programs' own currency, when every part uses the same currency. */
  native: { amount: number; currency: string } | null;
  confidence: Confidence;
  parts: CostPart[];
  /** Plain reasons for anything missing (also present when only the PKR figure is missing). */
  missing: string[];
}

/**
 *  - within: known PKR total at or under the student's budget
 *  - over: known PKR total above the budget
 *  - no_budget: cost known, the student has not set a budget
 *  - not_comparable: cost known in another currency, but no verified exchange rate to compare with the budget
 *  - unknown: cost not verified yet
 */
export type BudgetStatus = 'within' | 'over' | 'no_budget' | 'not_comparable' | 'unknown';

/** Plain words for each budget status (null = nothing extra to say). */
export const BUDGET_TEXT: Record<BudgetStatus, string | null> = {
  within: 'Within your budget',
  over: 'Over your budget',
  no_budget: 'You have not set a budget',
  not_comparable: 'Cannot check against your budget yet: no verified exchange rate',
  unknown: null,
};

export interface Comparison {
  /** Route months minus direct months, when both are known. */
  timeDiffMonths: number | null;
  timeText: string;
  /** Route cost minus direct cost, when both are known in the same currency (PKR preferred). */
  costDiff: { amount: number; currency: string } | null;
  costText: string;
}

export type WarningCode =
  | 'ELIGIBILITY'
  | 'DEADLINE_PASSED'
  | 'CONDITIONAL'
  | 'CONDITIONAL_NO_FLOOR'
  | 'PROGRESSION_NOT_GUARANTEED'
  | 'OVER_BUDGET'
  | 'COSTS_MORE_THAN_DIRECT'
  | 'COST_NOT_VERIFIED'
  | 'RECOGNITION_NOT_VERIFIED';

export interface RouteWarning {
  code: WarningCode;
  message: string;
  detail: string | null;
  sourceUrl: string | null;
  /** Computed confidence of the fact the warning quotes (set when the message shows a data value). */
  confidence?: Confidence;
}

export interface GateBlock {
  reason: string;
  sourceUrl: string | null;
  confidence: Confidence;
  checkedAt: string | null;
}

export interface Gate {
  status: 'ok' | 'warn' | 'blocked';
  block: GateBlock | null;
  warnings: RouteWarning[];
}

export interface ScorePart {
  points: number;
  max: number;
  summary: string;
  /** True when this part rests on Verified/Likely data. */
  known: boolean;
  /** Plain reason this part is not known (used in "Not ranked yet: …"). Null when known. */
  missing: string | null;
}

export interface RouteScore {
  total: number;
  max: number;
  feasibility: ScorePart;
  quality: ScorePart;
  cost: ScorePart;
  /** At least one part is known. Routes with nothing known go to "Not ranked: data missing". */
  rankable: boolean;
  /** Confidence handed to rankItems: the strongest known part, or Unverified when nothing is known. */
  keyConfidence: Confidence;
}

export interface PlanRoute {
  id: string;
  type: ProgramRouteType;
  program: Program;
  institution: Institution | null;
  /** For pre-master's / pathway: the Masters at the same institution it leads to, when it is in our data. */
  followOn: Program | null;
  fit: FitResult;
  time: RouteTime;
  cost: RouteCost;
  budget: BudgetStatus;
  vsDirect: Comparison;
  gate: Gate;
  /** Null for blocked routes (they are never ranked). */
  score: RouteScore | null;
  /** 1-based rank, or null when not ranked or blocked. */
  rank: number | null;
  notRankedReason: string | null;
  /** The official page says research is considered (or the route is research-led by type). */
  researchConsidered: boolean;
  /** Server-side: the student has research strengths and this route considers research. Never changes fit or order. */
  researchMayMatter: boolean;
  /**
   * The program's official conditional route, as checked against the student's grade. Set on 'conditional'
   * routes that have usable conditional_admission data; null otherwise. Never changes `fit`.
   */
  conditional: ConditionalCheck | null;
  /** The same program is the "going direct" target (e.g. its conditional or research-led route). */
  isTarget: boolean;
  /** Deadlines to show on the card: the program's, then the follow-on Masters' for staged routes. */
  deadlines: RouteDeadline[];
}

export interface TargetRow {
  program: Program;
  institution: Institution | null;
  fit: FitResult;
  chipLabel: string;
}

export interface DirectRoute {
  program: Program;
  institution: Institution | null;
  fit: FitResult;
  time: RouteTime;
  cost: RouteCost;
  budget: BudgetStatus;
  deadline: RouteDeadline;
  /** Its official conditional route, if it has usable data (shown as a separate route card when it applies). */
  conditional: ConditionalCheck | null;
}

export interface ExcludedProgram {
  program: Program;
  institution: Institution | null;
  reason: string;
}

/** A direct Masters in the student's field and countries whose fit (or conditional route) we cannot decide yet. */
export interface UndecidedProgram {
  program: Program;
  institution: Institution | null;
  /** Why the regular minimum cannot decide fit, in plain words. Null when the regular fit is decided. */
  minimumReason: string | null;
  /** Its conditional route, when we cannot check the student's grade against it. */
  conditional: ConditionalCheck | null;
  /** It is the "going direct" target. */
  isTarget: boolean;
  /** It is also shown above as a route (e.g. a conditional route). */
  routeAbove: boolean;
}

/** An official conditional route whose own lower limit the student's grade is below. */
export interface NotForYourGrade {
  program: Program;
  institution: Institution | null;
  check: ConditionalCheck;
}

export interface ImproveRoute {
  type: 'improve_reapply';
  label: string;
  help: string;
  steps: readonly string[];
  timeText: string;
  costText: string;
}

export interface TypeCoverage {
  type: ProgramRouteType;
  shown: number;
  blocked: number;
  /** Conditional routes we cannot check against the student's grade yet (0 for other types). */
  notDecided: number;
  /** Conditional routes whose own lower limit the student is below (0 for other types). */
  notForYourGrade: number;
}

export interface PlanB {
  mode: 'target' | 'all';
  direct: DirectRoute | null;
  /** Active direct programs in the student's field and countries. */
  targets: TargetRow[];
  /** Targets that are "Below minimum" (the target selector chips). */
  belowMinimum: TargetRow[];
  ranked: PlanRoute[];
  notRanked: PlanRoute[];
  blocked: PlanRoute[];
  excluded: ExcludedProgram[];
  /** Direct Masters whose fit (or conditional route) we cannot decide yet. Listed, never ranked or scored. */
  undecided: UndecidedProgram[];
  /** Conditional routes below their own lower limit for this student. */
  notForYourGrade: NotForYourGrade[];
  improve: ImproveRoute;
  coverage: TypeCoverage[];
  /** Shown when the requested ?target= could not be used. */
  notice: string | null;
  /** Shown when there is no single target to compare with (e.g. nothing is Below minimum on verified data). */
  explanation: string | null;
}

export interface PlanBInput {
  profile: Profile;
  programs: Program[];
  institutions: Map<string, Institution> | Institution[];
  rules: ConversionRule[];
  fx: FxRate[];
  now: Date;
  /** The ?target= value: a program id, 'all', or empty for the default. */
  target?: string | null;
  /** Strengths known to the caller. Only adds "Your research may matter here"; never changes fit or order. */
  strengths?: Strengths | null;
}

/* ------------------------------------------------------------------ */
/* Improve and reapply (always included, generic, no invented numbers) */
/* ------------------------------------------------------------------ */

export const IMPROVE_REAPPLY: ImproveRoute = {
  type: 'improve_reapply',
  label: ROUTE_LABEL.improve_reapply,
  help: ROUTE_HELP.improve_reapply,
  steps: [
    'Improve where you can: retake or repeat courses if your university allows it, then get an updated transcript.',
    'Get relevant work experience in your field.',
    'Do research or build projects you can show, such as code, a report, or a supervisor who knows your work.',
    'Take a language test and aim for a strong score.',
    'Reapply in the next application cycle with your new evidence. Check each official page for what it looks at.',
  ],
  timeText: 'At least one application cycle',
  costText: 'Depends on what you choose. We do not guess a number.',
};

/* ------------------------------------------------------------------ */
/* Scoring constants (shown to the student in "Why this order")        */
/* ------------------------------------------------------------------ */

export const SCORE_POINTS = {
  /**
   * `conditional`: a conditional route scored against its OWN lower limit (met, or none named). It is the middle
   * value on purpose: conditions still apply, so it never scores as the best.
   */
  feasibility: { meets: 6, unknown: 3, conditional: 3, below: 0, max: 6 },
  quality: { listed: 2, notVerified: 1, perWarning: -1, max: 2 },
  cost: { good: 2, unknown: 1, over: 0, max: 2 },
} as const;

export const MAX_SCORE = SCORE_POINTS.feasibility.max + SCORE_POINTS.quality.max + SCORE_POINTS.cost.max;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const CONF_STRENGTH: Record<Confidence, number> = { Conflict: 0, Unverified: 1, Likely: 2, Verified: 3 };

/** Strongest confidence of a list (opposite of weakestConfidence). */
export function strongestConfidence(...cs: Confidence[]): Confidence {
  let best: Confidence = 'Unverified';
  for (const c of cs) if (CONF_STRENGTH[c] > CONF_STRENGTH[best]) best = c;
  return best;
}

function toMap(insts: Map<string, Institution> | Institution[]): Map<string, Institution> {
  return insts instanceof Map ? insts : new Map(insts.map((i) => [i.id, i]));
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "MSc Computer Science at Liverpool John Moores University" (many programs share a name). */
export function programLabel(p: Program, institution: Institution | null): string {
  return institution ? `${p.name} at ${institution.name}` : p.name;
}

/** Signed points with a real minus sign, e.g. "+2", "−1", "0". */
export function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return '0';
}

/** Amount in a currency without a period suffix. PKR uses lakh/crore wording. */
export function formatAmount(amount: number, currency: string): string {
  if (currency === 'PKR') return formatPkr(amount);
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString('en-GB')}`;
  }
}

/** "Institution Program" — used for the name tiebreak. */
export function routeName(r: { program: Program; institution: Institution | null }): string {
  return `${r.institution?.name ?? ''} ${r.program.name}`.trim();
}

function byName(a: { program: Program; institution: Institution | null }, b: { program: Program; institution: Institution | null }) {
  return routeName(a).localeCompare(routeName(b), 'en');
}

/** The student's own field and target countries (no target countries = every country). */
export function inStudentScope(p: Program, profile: Pick<Profile, 'field' | 'target_countries'>): boolean {
  if (p.field !== profile.field) return false;
  const countries = profile.target_countries ?? [];
  return countries.length === 0 || countries.includes(p.country);
}

/** The server cannot read localStorage: demo persona B is treated as having its demo strengths. */
export function strengthsForProfile(profile: Pick<Profile, 'persona'>): Strengths | null {
  return profile.persona === 'B' ? PERSONA_B_STRENGTHS : null;
}

/** True when the program's official page (Verified/Likely) says research is considered. */
export function researchIsConsidered(p: Program, now: Date): boolean {
  const v = usableValue(p.research_considered, now);
  return typeof v === 'string' ? v.trim() !== '' : v != null;
}

/* ------------------------------------------------------------------ */
/* Time and cost                                                       */
/* ------------------------------------------------------------------ */

function durationPart(label: string, p: Program, now: Date): TimePart {
  const confidence = computeConfidence(p.duration_months, now);
  const v = p.duration_months?.value;
  const months = isUsable(confidence) && typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  return { label, programId: p.id, months, confidence };
}

function combineTime(parts: TimePart[], extraMissing: string[]): RouteTime {
  const missing = [...extraMissing];
  for (const part of parts) {
    if (part.months == null) {
      missing.push(
        part.confidence === 'Conflict'
          ? `${part.label}: sources disagree on the length`
          : `${part.label}: length not verified yet`,
      );
    }
  }
  if (missing.length > 0 || parts.length === 0) {
    return { months: null, confidence: 'Unverified', parts, missing };
  }
  return {
    months: parts.reduce((s, p) => s + (p.months as number), 0),
    confidence: weakestConfidence(...parts.map((p) => p.confidence)),
    parts,
    missing,
  };
}

function costKnown(r: { native: unknown; pkr: number | null }): boolean {
  return r.native != null || r.pkr != null;
}

function combineCost(parts: CostPart[], extraMissing: string[]): RouteCost {
  const prefix = parts.length > 1;
  const missing = [
    ...extraMissing,
    ...parts.flatMap((p) => p.result.missing.map((m) => (prefix ? `${p.label}: ${m}` : m))),
  ];
  const complete = extraMissing.length === 0 && parts.length > 0 && parts.every((p) => costKnown(p.result));
  if (!complete) return { pkr: null, native: null, confidence: 'Unverified', parts, missing };

  const pkr = parts.every((p) => p.result.pkr != null)
    ? parts.reduce((s, p) => s + (p.result.pkr as number), 0)
    : null;
  const natives = parts.map((p) => p.result.native);
  const native =
    natives.every((n) => n != null) && natives.every((n) => n!.currency === natives[0]!.currency)
      ? { amount: natives.reduce((s, n) => s + n!.amount, 0), currency: natives[0]!.currency }
      : null;
  if (pkr == null && native == null) {
    return { pkr: null, native: null, confidence: 'Unverified', parts, missing: missing.length ? missing : ['Costs use different currencies and there is no verified exchange rate yet'] };
  }
  return { pkr, native, confidence: weakestConfidence(...parts.map((p) => p.result.confidence)), parts, missing };
}

export function isCostKnown(c: RouteCost): boolean {
  return costKnown(c);
}

export function budgetStatus(cost: RouteCost, budgetPkr: number | null | undefined): BudgetStatus {
  if (!isCostKnown(cost)) return 'unknown';
  if (budgetPkr == null || !Number.isFinite(budgetPkr) || budgetPkr <= 0) return 'no_budget';
  if (cost.pkr == null) return 'not_comparable';
  return cost.pkr <= budgetPkr ? 'within' : 'over';
}

/* ------------------------------------------------------------------ */
/* Comparison versus going direct                                      */
/* ------------------------------------------------------------------ */

export function compareWithDirect(
  route: { time: RouteTime; cost: RouteCost },
  direct: { time: RouteTime; cost: RouteCost } | null,
): Comparison {
  if (!direct) {
    const text = 'Pick one target above to compare with going direct.';
    return { timeDiffMonths: null, timeText: text, costDiff: null, costText: text };
  }

  let timeDiffMonths: number | null = null;
  let timeText: string;
  if (route.time.months == null) timeText = "Cannot compare yet: this route's time is not verified.";
  else if (direct.time.months == null) timeText = "Cannot compare yet: the direct route's time is not verified.";
  else {
    timeDiffMonths = route.time.months - direct.time.months;
    timeText =
      timeDiffMonths > 0
        ? `${formatMonths(timeDiffMonths)} longer than going direct`
        : timeDiffMonths < 0
          ? `${formatMonths(-timeDiffMonths)} shorter than going direct`
          : 'Same time as going direct';
  }

  const { costDiff, costText } = compareCost(route.cost, direct.cost);
  return { timeDiffMonths, timeText, costDiff, costText };
}

function compareCost(route: RouteCost, direct: RouteCost): Pick<Comparison, 'costDiff' | 'costText'> {
  if (!isCostKnown(route)) return { costDiff: null, costText: "Cannot compare yet: this route's cost is not verified." };
  if (!isCostKnown(direct)) return { costDiff: null, costText: "Cannot compare yet: the direct route's cost is not verified." };

  let costDiff: Comparison['costDiff'] = null;
  if (route.pkr != null && direct.pkr != null) {
    costDiff = { amount: route.pkr - direct.pkr, currency: 'PKR' };
  } else if (route.native && direct.native && route.native.currency === direct.native.currency) {
    costDiff = { amount: route.native.amount - direct.native.amount, currency: route.native.currency };
  }
  if (!costDiff) {
    return {
      costDiff: null,
      costText: 'Cannot compare yet: the costs use different currencies and there is no verified exchange rate.',
    };
  }
  const costText =
    costDiff.amount > 0
      ? `${formatAmount(costDiff.amount, costDiff.currency)} more than going direct`
      : costDiff.amount < 0
        ? `${formatAmount(-costDiff.amount, costDiff.currency)} less than going direct`
        : 'Same cost as going direct';
  return { costDiff, costText };
}

/* ------------------------------------------------------------------ */
/* Integrity gate                                                      */
/* ------------------------------------------------------------------ */

function factSource<T>(f: Fact<T> | null | undefined): string | null {
  return f?.source_url ?? null;
}

/** Shown under every eligibility warning: why we warn instead of blocking. */
export const ELIGIBILITY_DETAIL =
  'This is who the course is for, as its official page states it. We cannot check your degree subject against it, so we do not hide this route. Read the official page before you apply or pay anything.';

/**
 * Soft ELIGIBILITY warnings: one per usable (Verified/Likely) eligibility_note on the route's program and on the
 * Masters it leads to (same text shown once). They never block a route and never change fit.
 */
export function eligibilityWarnings(program: Program, followOn: Program | null, now: Date): RouteWarning[] {
  const sources = followOn && followOn.id !== program.id ? [program, followOn] : [program];
  const seen = new Set<string>();
  const out: RouteWarning[] = [];
  for (const p of sources) {
    const fact = p.eligibility_note;
    const value = usableValue(fact, now);
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text === '' || seen.has(text)) continue;
    seen.add(text);
    const from = p === program ? '' : `From the official page for ${p.name}. `;
    const note = fact?.note?.trim() ? ` Note: ${fact.note.trim()}` : '';
    out.push({
      code: 'ELIGIBILITY',
      message: `Check you are eligible: ${text}`,
      detail: `${from}${ELIGIBILITY_DETAIL}${note}`,
      sourceUrl: factSource(fact) ?? p.official_url,
      confidence: computeConfidence(fact, now),
    });
  }
  return out;
}

/** Every conditional route carries this warning; a verified progression guarantee does not remove it. */
export const CONDITIONAL_MESSAGE = 'Conditional: you must meet the stated conditions to continue';
export const CONDITIONAL_DETAIL =
  'The official text on this card says what the conditions are. Ask the university in writing what happens if you do not meet them, before you pay anything.';
export const NO_FLOOR_DETAIL =
  'A route with no stated lower limit is not a promise of a place. The university decides each application.';
export const DEADLINE_PASSED_DETAIL =
  'The next deadline is not verified yet. Check the official page before you pay anything.';

/** Deadlines shown on a route card: the program's own, then (staged routes) the follow-on Masters'. */
export function routeDeadlines(type: ProgramRouteType, program: Program, followOn: Program | null, now: Date): RouteDeadline[] {
  if (STAGED.includes(type)) {
    const stage = STAGE_LABEL[type] ?? 'First stage';
    return [
      deadlineOf(program, `${stage} deadline`, now),
      ...(followOn && followOn.id !== program.id ? [deadlineOf(followOn, 'Masters deadline', now)] : []),
    ];
  }
  return [deadlineOf(program, 'Application deadline', now)];
}

/** Soft DEADLINE_PASSED warnings: one per usable deadline that is before today. */
export function deadlineWarnings(deadlines: RouteDeadline[], program: Program): RouteWarning[] {
  return deadlines.filter(hasPassed).map((d) => ({
    code: 'DEADLINE_PASSED' as const,
    message:
      d.programId === program.id
        ? `The deadline we hold (${formatDate(d.date)}) has passed`
        : `The deadline we hold for ${d.programName} (${formatDate(d.date)}) has passed`,
    detail: DEADLINE_PASSED_DETAIL,
    sourceUrl: d.fact.source_url ?? null,
    confidence: d.confidence,
  }));
}

/** CONDITIONAL (always) and CONDITIONAL_NO_FLOOR (no lower limit named) for a route built from conditional data. */
export function conditionalWarnings(check: ConditionalCheck): RouteWarning[] {
  const out: RouteWarning[] = [
    {
      code: 'CONDITIONAL',
      message: CONDITIONAL_MESSAGE,
      detail: CONDITIONAL_DETAIL,
      sourceUrl: check.sourceUrl,
      confidence: check.confidence,
    },
  ];
  if (check.status === 'no_floor') {
    out.push({
      code: 'CONDITIONAL_NO_FLOOR',
      message: NO_FLOOR_TEXT,
      detail: NO_FLOOR_DETAIL,
      sourceUrl: check.sourceUrl,
      confidence: check.confidence,
    });
  }
  return out;
}

export function integrityGate(args: {
  program: Program;
  institution: Institution | null;
  type: ProgramRouteType;
  /** For pre-master's / pathway routes: the Masters it leads to (its eligibility note is checked too). */
  followOn?: Program | null;
  /** For conditional routes built from conditional_admission data: the check of the student's grade. */
  conditional?: ConditionalCheck | null;
  cost: RouteCost;
  budget: BudgetStatus;
  budgetPkr: number | null | undefined;
  vsDirect: Comparison;
  now: Date;
}): Gate {
  const { program, institution, type, cost, budget, vsDirect, now } = args;
  const followOn = args.followOn ?? null;
  const conditional = type === 'conditional' ? (args.conditional ?? null) : null;

  // HARD BLOCK: a usable (Verified/Likely) value says the institution is not on the official recognition list.
  const recFact = institution?.recognition_list_status;
  const recConf = computeConfidence(recFact, now);
  const recValue = usableValue(recFact, now);
  if (institution && recValue === 'not_listed') {
    return {
      status: 'blocked',
      block: {
        reason: `${institution.name} is not on the destination's official recognition list, according to the source below. We do not show it as an option.`,
        sourceUrl: factSource(recFact),
        confidence: recConf,
        checkedAt: recFact?.fetched_at ?? null,
      },
      warnings: [],
    };
  }

  // Eligibility comes FIRST: who the course is for, as the official page states it. Soft warning only.
  const warnings: RouteWarning[] = eligibilityWarnings(program, followOn, now);

  // A usable deadline that has passed (the program's, or the follow-on Masters' on a staged route).
  warnings.push(...deadlineWarnings(routeDeadlines(type, program, followOn, now), program));

  if (conditional) {
    // Data-backed conditional route: its own warning replaces the generic progression warning and is never removed.
    warnings.push(...conditionalWarnings(conditional));
  } else if (NEEDS_PROGRESSION_GUARANTEE.includes(type) && usableValue(program.progression_guaranteed, now) !== true) {
    const stated = usableValue(program.progression_guaranteed, now) === false;
    const requirement = usableValue(program.progression_requirement, now);
    const detail = stated
      ? `Moving on to the Masters depends on conditions.${requirement ? ` Condition stated: ${requirement}` : ''}`
      : 'We have no verified guarantee. Ask the university in writing before you pay anything.';
    warnings.push({
      code: 'PROGRESSION_NOT_GUARANTEED',
      message: 'The official page does not guarantee progression to the Masters',
      detail,
      sourceUrl: factSource(program.progression_guaranteed) ?? program.official_url,
    });
  }

  if (budget === 'over' && cost.pkr != null && args.budgetPkr != null) {
    warnings.push({
      code: 'OVER_BUDGET',
      message: 'Costs more than your budget',
      detail: `The known total (${formatPkr(cost.pkr)}) is above your budget (${formatPkr(args.budgetPkr)}).`,
      sourceUrl: null,
    });
  }

  if (vsDirect.costDiff && vsDirect.costDiff.amount > 0) {
    warnings.push({
      code: 'COSTS_MORE_THAN_DIRECT',
      message: 'Costs more than going direct',
      detail: `${vsDirect.costText}.`,
      sourceUrl: null,
    });
  }

  if (!isCostKnown(cost)) {
    warnings.push({
      code: 'COST_NOT_VERIFIED',
      message: 'Cost not verified yet',
      detail: 'Check the full cost on the official page, or ask the university in writing, before you pay anything.',
      sourceUrl: program.official_url,
    });
  }

  if (recValue == null) {
    warnings.push({
      code: 'RECOGNITION_NOT_VERIFIED',
      message: 'Check the institution is on the official recognition list before you pay anything',
      detail: recConf === 'Conflict' ? 'Sources disagree about the recognition list.' : 'We have not verified this yet.',
      sourceUrl: factSource(recFact),
    });
  }

  return { status: warnings.length > 0 ? 'warn' : 'ok', block: null, warnings };
}

/* ------------------------------------------------------------------ */
/* Score                                                               */
/* ------------------------------------------------------------------ */

export function scoreRoute(args: {
  fit: FitResult;
  institution: Institution | null;
  budget: BudgetStatus;
  costConfidence: Confidence;
  warnings: RouteWarning[];
  now: Date;
  /** A conditional route's check: feasibility is scored against the route's own lower limit (middle value). */
  conditional?: ConditionalCheck | null;
}): RouteScore {
  const { fit, institution, budget, warnings, now } = args;
  const P = SCORE_POINTS;
  const cond = args.conditional && isConditionalRoute(args.conditional) ? args.conditional : null;

  // Feasibility: meets verified minimum > competitive range unknown > below.
  const fitKnown = fitSortValue(fit) !== null;
  const feasibility: ScorePart = cond
    ? {
        points: P.feasibility.conditional,
        max: P.feasibility.max,
        summary:
          cond.status === 'meets_floor' && cond.min != null
            ? `You meet the lower limit this conditional route names (${formatLimit(cond.min, cond.scale)}); its conditions still apply`
            : 'This conditional route names no lower limit, so admission is not assured',
        known: true,
        missing: null,
      }
    : fit.label === 'Meets minimum'
      ? { points: P.feasibility.meets, max: P.feasibility.max, summary: 'You meet the verified minimum', known: true, missing: null }
      : fit.label === 'Below minimum'
        ? {
            points: P.feasibility.below,
            max: P.feasibility.max,
            summary: 'Your grade is below the verified minimum',
            known: true,
            missing: null,
          }
        : {
            points: P.feasibility.unknown,
            max: P.feasibility.max,
            summary: fitKnown ? 'Your grade range crosses the minimum' : 'Minimum grade not verified yet',
            known: fitKnown,
            missing: fitKnown ? null : feasibilityMissing(fit),
          };

  // Quality: recognition verified 'listed' > not verified; minus one step per soft warning.
  const recConf = computeConfidence(institution?.recognition_list_status, now);
  const listed = usableValue(institution?.recognition_list_status, now) === 'listed';
  const base = listed ? P.quality.listed : P.quality.notVerified;
  const n = warnings.length;
  const qualityKnown = isUsable(recConf);
  const quality: ScorePart = {
    points: base + n * P.quality.perWarning,
    max: P.quality.max,
    summary: `${listed ? 'On the official recognition list' : 'Recognition not verified yet'} (${signed(base)}), ${
      n === 0 ? 'no warnings' : `${plural(n, 'warning')} (${signed(n * P.quality.perWarning)})`
    }`,
    known: qualityKnown,
    missing: qualityKnown
      ? null
      : recConf === 'Conflict'
        ? 'official sources disagree on recognition'
        : 'recognition not verified yet',
  };

  // Cost: known and within budget > unknown > over budget.
  const COST_PART: Record<BudgetStatus, Omit<ScorePart, 'max'>> = {
    within: { points: P.cost.good, summary: 'Within your budget', known: true, missing: null },
    no_budget: { points: P.cost.good, summary: 'Cost known (you have not set a budget)', known: true, missing: null },
    not_comparable: {
      points: P.cost.unknown,
      summary: 'Cost known, but no verified exchange rate to compare with your budget',
      known: true,
      missing: null,
    },
    unknown: { points: P.cost.unknown, summary: 'Cost not verified yet', known: false, missing: 'total cost not verified yet' },
    over: { points: P.cost.over, summary: 'Over your budget', known: true, missing: null },
  };
  const cost: ScorePart = { ...COST_PART[budget], max: P.cost.max };

  const knownConfs: Confidence[] = [];
  if (feasibility.known) knownConfs.push(cond ? cond.confidence : (fit.required?.confidence ?? 'Unverified'));
  if (quality.known) knownConfs.push(recConf);
  if (cost.known) knownConfs.push(args.costConfidence);
  const rankable = feasibility.known || quality.known || cost.known;

  return {
    total: feasibility.points + quality.points + cost.points,
    max: MAX_SCORE,
    feasibility,
    quality,
    cost,
    rankable,
    keyConfidence: rankable ? strongestConfidence(...knownConfs) : 'Unverified',
  };
}

/** Why the feasibility part is unknown, in plain words, from the fit reason code. */
function feasibilityMissing(fit: FitResult): string {
  switch (fit.reason.code) {
    case 'MIN_CONFLICT':
      return 'official sources disagree on the minimum grade';
    case 'NO_CONVERSION_RULE':
    case 'CONVERSION_RULE_UNSOURCED':
      return 'no verified way to convert your grade to its scale yet';
    case 'INVALID_INPUT':
      return 'your grade could not be read';
    default:
      return 'minimum grade not verified yet';
  }
}

/** "a", "a and b", "a, b and c". */
function joinPlain(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Plain reason a route cannot be put in order, from its unknown score parts. */
export function notRankedText(score: RouteScore): string {
  const reasons = [score.feasibility, score.quality, score.cost]
    .map((p) => p.missing)
    .filter((m): m is string => m != null && m !== '');
  return `Not ranked yet: ${reasons.length > 0 ? joinPlain(reasons) : 'the facts we rank by are not verified yet'}`;
}

/** Shown after "Not ranked yet: …" on a route card. */
export const NOT_RANKED_HELP = 'We only put a route in order when at least one of these is verified. We do not guess.';

/** Under every conditional route: it decides nothing about fit and promises nothing. */
export const CONDITIONAL_FIT_NOTE =
  'A conditional route does not change your fit label, and it is not a promise of a place.';

/** On a route card whose program is also the "going direct" target, so the two cards are not confused. */
export function targetRouteNote(type: ProgramRouteType): string {
  return type === 'conditional'
    ? 'Same program as your target above. The target card is regular entry; this card is its conditional route.'
    : `Same program as your target above, shown here as a route: ${ROUTE_LABEL[type]}.`;
}

/** On the target card: what its own conditional route means for this student (null when there is none to mention). */
export function directConditionalText(direct: Pick<DirectRoute, 'fit' | 'conditional'>): string | null {
  const c = direct.conditional;
  if (!c || direct.fit.label === 'Meets minimum') return null;
  if (isConditionalRoute(c)) {
    return 'This program also has an official conditional route below its regular minimum. It is shown further down this page as a separate route, with its conditions and warnings.';
  }
  if (c.status === 'below_floor') return `Its official conditional route is not for your grade. ${c.reason}`;
  return `Its official conditional route is not decided yet. ${c.reason}`;
}

/** Lead sentence of the "Not decided yet" list. */
export function undecidedSummary(n: number): string {
  return `For ${plural(n, 'program')} in your field and countries we cannot tell yet whether your grade meets the minimum. Each one says why.`;
}

/** Row label for a program's status note: names Pakistan only when the official note itself is about Pakistan. */
export function statusNoteLabel(text: string): string {
  return /\bPakistan/i.test(text) ? 'Note for Pakistan applicants' : 'Note from the official page';
}

/** Human-readable "Why this order" breakdown. */
export function whyThisOrder(score: RouteScore): string[] {
  const pts = (n: number) => `${signed(n)} ${Math.abs(n) === 1 ? 'point' : 'points'}`;
  return [
    `Feasibility: ${score.feasibility.summary}. ${pts(score.feasibility.points)} (best is ${score.feasibility.max}).`,
    `Quality: ${score.quality.summary}. ${pts(score.quality.points)} (best is ${score.quality.max}).`,
    `Cost: ${score.cost.summary}. ${pts(score.cost.points)} (best is ${score.cost.max}).`,
    `Total: ${score.total} out of ${score.max}. Higher totals come first. Ties are ordered by name.`,
  ];
}

/* ------------------------------------------------------------------ */
/* Route classification                                                */
/* ------------------------------------------------------------------ */

/** Which Plan B route a program offers this student, or null when it is not a Plan B route. */
export function classifyRoute(p: Program, fit: FitResult, now: Date): ProgramRouteType | null {
  if (p.status !== 'active') return null;
  if (p.pathway_type !== 'direct') return p.pathway_type;
  if (fit.label === 'Meets minimum') return 'lower_floor_direct';
  if (researchIsConsidered(p, now)) return 'research_led';
  return null;
}

/** The Masters a pre-master's/pathway leads to: an active direct program at the same institution in the same field. */
export function findFollowOn(stage: Program, programs: Program[], preferred: Program | null): Program | null {
  const ok = (m: Program) =>
    m.id !== stage.id &&
    m.status === 'active' &&
    m.pathway_type === 'direct' &&
    m.institution_id === stage.institution_id &&
    m.field === stage.field;
  if (preferred && ok(preferred)) return preferred;
  return programs.find(ok) ?? null;
}

function routeTimeAndCost(
  type: ProgramRouteType,
  p: Program,
  followOn: Program | null,
  fx: FxRate[],
  now: Date,
): { time: RouteTime; cost: RouteCost } {
  if (STAGED.includes(type)) {
    const stageLabel = STAGE_LABEL[type] ?? 'First stage';
    const extra = followOn ? [] : ['The Masters this route leads to is not in our data yet'];
    const timeParts = [durationPart(stageLabel, p, now), ...(followOn ? [durationPart('Masters', followOn, now)] : [])];
    const costParts: CostPart[] = [
      { label: stageLabel, programId: p.id, result: programTotalCost(p, fx, now) },
      ...(followOn ? [{ label: 'Masters', programId: followOn.id, result: programTotalCost(followOn, fx, now) }] : []),
    ];
    return { time: combineTime(timeParts, extra), cost: combineCost(costParts, extra) };
  }
  return {
    time: combineTime([durationPart('Masters', p, now)], []),
    cost: combineCost([{ label: 'Masters', programId: p.id, result: programTotalCost(p, fx, now) }], []),
  };
}

/* ------------------------------------------------------------------ */
/* Target selection                                                    */
/* ------------------------------------------------------------------ */

/** Short chip text: the institution name, plus the program name when one institution has several targets. */
function chipLabels(rows: Omit<TargetRow, 'chipLabel'>[]): TargetRow[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.program.institution_id, (counts.get(r.program.institution_id) ?? 0) + 1);
  return rows.map((r) => {
    if (!r.institution) return { ...r, chipLabel: r.program.name };
    const shared = (counts.get(r.program.institution_id) ?? 0) > 1;
    return { ...r, chipLabel: shared ? `${r.institution.name}: ${r.program.name}` : r.institution.name };
  });
}

/**
 * Why there is no single target to compare with. Each reason a target's fit is not decided is worded and
 * counted separately: minimum not verified, cannot convert the student's grade scale, sources disagree.
 */
export function explainNoTarget(targets: TargetRow[], belowCount: number, scale: StudentScale): string | null {
  if (targets.length === 0) {
    return 'We have no programs in your field and target countries yet, so there is no direct route to compare with. Every route type is explained below.';
  }
  // The student chose "All my targets" while some targets are Below minimum: nothing to explain.
  if (belowCount > 0) return null;
  const count = (...codes: FitResult['reason']['code'][]) => targets.filter((t) => codes.includes(t.fit.reason.code)).length;
  const forN = (n: number) => `For ${plural(n, 'target')}`;
  const notVerified = count('MIN_NOT_VERIFIED');
  const noConversion = count('NO_CONVERSION_RULE', 'CONVERSION_RULE_UNSOURCED');
  const conflict = count('MIN_CONFLICT');
  const crosses = count('STRADDLES_MIN');
  const invalid = count('INVALID_INPUT');
  return [
    'None of your targets is "Below minimum" on verified data.',
    notVerified > 0 ? `${forN(notVerified)} the minimum grade is not verified yet, so we cannot tell.` : '',
    noConversion > 0
      ? `${forN(noConversion)} we cannot convert your ${STUDENT_SCALE_TEXT[scale]} to the scale the minimum uses yet, because no sourced conversion rule exists.`
      : '',
    conflict > 0 ? `${forN(conflict)} official sources disagree on the minimum grade.` : '',
    crosses > 0 ? `${forN(crosses)} your converted grade range crosses the minimum, so your exact transcript rules decide it.` : '',
    invalid > 0 ? 'We could not read your grade.' : '',
    'Every route type is shown below so you can plan ahead.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Plain reason the regular minimum cannot decide fit (null when fit is decided). */
export function undecidedMinimumReason(fit: FitResult, scale: StudentScale): string | null {
  if (fitSortValue(fit) !== null) return null;
  const target = fit.required ? `the ${SCALE_LABEL[fit.required.scale]} scale its minimum uses` : 'the scale its minimum uses';
  switch (fit.reason.code) {
    case 'MIN_CONFLICT':
      return 'Official sources disagree on the minimum grade.';
    case 'NO_CONVERSION_RULE':
      return `We cannot convert your ${STUDENT_SCALE_TEXT[scale]} to ${target} yet: no sourced conversion rule.`;
    case 'CONVERSION_RULE_UNSOURCED':
      return `We cannot convert your ${STUDENT_SCALE_TEXT[scale]} to ${target} yet: the rule has no official source.`;
    case 'INVALID_INPUT':
      return 'We could not read your grade.';
    case 'NOT_ACCEPTING':
      return 'Marked as ruled out in our data.';
    default:
      return 'Minimum grade not verified yet.';
  }
}

/* ------------------------------------------------------------------ */
/* Build the plan                                                      */
/* ------------------------------------------------------------------ */

export function buildPlanB(input: PlanBInput): PlanB {
  const { profile, programs, rules, fx, now } = input;
  const insts = toMap(input.institutions);
  const instOf = (p: Program) => insts.get(p.institution_id) ?? null;
  const fitCache = new Map<string, FitResult>();
  const fitOf = (p: Program) => {
    let f = fitCache.get(p.id);
    if (!f) {
      f = computeFit(profile, p, rules, now);
      fitCache.set(p.id, f);
    }
    return f;
  };

  const scoped = programs.filter((p) => inStudentScope(p, profile));
  const active = scoped.filter((p) => p.status === 'active');

  // The student's direct targets and the Below-minimum ones (target selector chips).
  const targets = chipLabels(
    active.filter((p) => p.pathway_type === 'direct').map((p) => ({ program: p, institution: instOf(p), fit: fitOf(p) })),
  );
  const belowMinimum = targets.filter((t) => t.fit.label === 'Below minimum');

  // Choose the direct target. Only an active, direct Masters in the student's field and countries can be the
  // "going direct" baseline; anything else falls back with a notice.
  const requested = (input.target ?? '').trim();
  let notice: string | null = null;
  let directProgram: Program | null = null;
  let mode: PlanB['mode'] = 'all';
  if (requested && requested !== 'all') {
    const found = programs.find((p) => p.id === requested) ?? null;
    const name = found ? programLabel(found, instOf(found)) : '';
    const fallback = belowMinimum.length
      ? 'compare with your first target that is below the minimum.'
      : 'show routes for all your targets.';
    if (!found) {
      notice = `We could not find that program, so we ${fallback}`;
    } else if (found.status !== 'active') {
      notice = `${name} is marked as ruled out in our data, so we cannot compare other routes with it. We ${fallback}`;
    } else if (!inStudentScope(found, profile)) {
      notice = `${name} is outside your field or your target countries, so we cannot compare other routes with it. We ${fallback}`;
    } else if (found.pathway_type !== 'direct') {
      // A pre-master's, pathway or other route is not "going direct": never use it as the baseline.
      notice = `${name} is not a direct Masters, so we cannot compare other routes with it. We ${fallback}`;
    } else {
      directProgram = found;
    }
  }
  if (!directProgram && requested !== 'all' && belowMinimum.length > 0) directProgram = belowMinimum[0].program;
  if (directProgram) mode = 'target';

  const conditionalCache = new Map<string, ConditionalCheck | null>();
  const conditionalOf = (p: Program) => {
    if (!conditionalCache.has(p.id)) conditionalCache.set(p.id, checkConditional(profile, p, rules, now));
    return conditionalCache.get(p.id) ?? null;
  };

  const buildDirect = (p: Program): DirectRoute => {
    const tc = routeTimeAndCost('lower_floor_direct', p, null, fx, now);
    return {
      program: p,
      institution: instOf(p),
      fit: fitOf(p),
      time: tc.time,
      cost: tc.cost,
      budget: budgetStatus(tc.cost, profile.budget_pkr),
      deadline: deadlineOf(p, 'Application deadline', now),
      conditional: conditionalOf(p),
    };
  };
  const direct = directProgram ? buildDirect(directProgram) : null;
  const explanation = direct ? null : explainNoTarget(targets, belowMinimum.length, profile.scale);

  const researchStrengths = hasResearchStrengths(input.strengths);

  const routes: PlanRoute[] = [];
  const addRoute = (p: Program, type: ProgramRouteType, fit: FitResult, conditional: ConditionalCheck | null) => {
    const institution = instOf(p);
    const followOn = STAGED.includes(type) ? findFollowOn(p, active, directProgram) : null;
    const { time, cost } = routeTimeAndCost(type, p, followOn, fx, now);
    const budget = budgetStatus(cost, profile.budget_pkr);
    const vsDirect = compareWithDirect({ time, cost }, direct);
    const gate = integrityGate({
      program: p,
      institution,
      type,
      followOn,
      conditional,
      cost,
      budget,
      budgetPkr: profile.budget_pkr,
      vsDirect,
      now,
    });
    const score =
      gate.status === 'blocked'
        ? null
        : scoreRoute({
            fit,
            institution,
            budget,
            costConfidence: cost.confidence,
            warnings: gate.warnings,
            now,
            conditional,
          });
    const researchConsidered = type === 'research_led' || researchIsConsidered(p, now);

    routes.push({
      id: `${type}:${p.id}`,
      type,
      program: p,
      institution,
      followOn,
      fit,
      time,
      cost,
      budget,
      vsDirect,
      gate,
      score,
      rank: null,
      notRankedReason: null,
      researchConsidered,
      researchMayMatter: researchStrengths && researchConsidered,
      conditional,
      isTarget: directProgram != null && p.id === directProgram.id,
      deadlines: routeDeadlines(type, p, followOn, now),
    });
  };

  // Build every route.
  const notForYourGrade: NotForYourGrade[] = [];
  /** Direct programs whose conditional route cannot be checked against the student's grade yet. */
  const conditionalUndecided = new Map<string, ConditionalCheck>();
  for (const p of active) {
    const fit = fitOf(p);
    const type = classifyRoute(p, fit, now);
    const cond = conditionalOf(p);

    if (type === 'conditional') {
      // A conditional programme whose own lower limit the student's grade is below is not a route for them.
      if (cond?.status === 'below_floor') notForYourGrade.push({ program: p, institution: instOf(p), check: cond });
      else addRoute(p, type, fit, cond);
      continue;
    }

    // The direct target is the comparison, not a route — except its research-led case.
    if (type && !(directProgram && p.id === directProgram.id && type !== 'research_led')) addRoute(p, type, fit, null);

    // A direct Masters with an official conditional route below its regular minimum. It is a separate route
    // (even for the target itself) and never changes the fit label. Not needed when the student meets the minimum.
    if (p.pathway_type === 'direct' && cond && fit.label !== 'Meets minimum') {
      if (isConditionalRoute(cond)) addRoute(p, 'conditional', fit, cond);
      else if (cond.status === 'below_floor') notForYourGrade.push({ program: p, institution: instOf(p), check: cond });
      else conditionalUndecided.set(p.id, cond);
    }
  }

  // Blocked routes: never ranked, shown last.
  const blocked = routes.filter((r) => r.gate.status === 'blocked').sort(byName);
  const open = routes.filter((r) => r.gate.status !== 'blocked');

  const result = rankItems(
    open,
    (r) => ({
      value: r.score!.rankable ? r.score!.total : null,
      confidence: r.score!.keyConfidence,
      missingReason: notRankedText(r.score!),
    }),
    'desc',
    byName,
  );
  const ranked = result.ranked.map((x) => ({ ...x.item, rank: x.rank }));
  const notRanked = result.notRanked
    .map((x) => ({ ...x.item, notRankedReason: x.reason }))
    .sort(byName);

  // Ruled-out programs are excluded with a reason.
  const excluded: ExcludedProgram[] = scoped
    .filter((p) => p.status === 'ruled_out')
    .map((p) => ({
      program: p,
      institution: instOf(p),
      reason: 'Marked as ruled out in our data, so it is not shown as a route. See the note and the official page.',
    }));

  const shown = [...ranked, ...notRanked];
  const coverage: TypeCoverage[] = PROGRAM_ROUTE_TYPES.map((type) => ({
    type,
    shown: shown.filter((r) => r.type === type).length,
    blocked: blocked.filter((r) => r.type === type).length,
    notDecided: type === 'conditional' ? conditionalUndecided.size : 0,
    notForYourGrade: type === 'conditional' ? notForYourGrade.length : 0,
  }));

  // "Not decided yet": direct Masters whose regular minimum cannot decide fit, or whose conditional route we
  // cannot check. Listed with plain reasons; never ranked, scored or filtered.
  const shownIds = new Set(shown.map((r) => r.program.id));
  const undecided: UndecidedProgram[] = targets
    .filter((t) => fitSortValue(t.fit) === null || conditionalUndecided.has(t.program.id))
    .map((t) => ({
      program: t.program,
      institution: t.institution,
      minimumReason: undecidedMinimumReason(t.fit, profile.scale),
      conditional: conditionalUndecided.get(t.program.id) ?? null,
      isTarget: directProgram != null && t.program.id === directProgram.id,
      routeAbove: shownIds.has(t.program.id),
    }))
    .sort(byName);

  return {
    mode,
    direct,
    targets,
    belowMinimum,
    ranked,
    notRanked,
    blocked,
    excluded,
    undecided,
    notForYourGrade: notForYourGrade.sort(byName),
    improve: IMPROVE_REAPPLY,
    coverage,
    notice,
    explanation,
  };
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

/** Profile query params that make a page shareable (see profileFromSearchParams). */
const PROFILE_PARAMS = ['cgpa', 'scale', 'min_pass', 'field', 'budget', 'countries'] as const;

/** Keep only the profile params from the current URL (so shared links keep working). */
export function profileQuery(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const q = new URLSearchParams();
  for (const k of PROFILE_PARAMS) {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (s != null && s !== '') q.set(k, s);
  }
  return q;
}

/** Link to /plan-b for a target (a program id or 'all'), keeping the profile params. */
export function planBHref(sp: Record<string, string | string[] | undefined>, target: string | null): string {
  const q = profileQuery(sp);
  if (target) q.set('target', target);
  const s = q.toString();
  return s ? `/plan-b?${s}` : '/plan-b';
}

/** Link to the shortlist filtered to "Competitive range unknown", keeping the profile params. */
export function shortlistUnknownHref(sp: Record<string, string | string[] | undefined>): string {
  const q = profileQuery(sp);
  q.set('fit', 'unknown');
  return `/shortlist?${q.toString()}`;
}

/** Link to a program page, keeping the profile params. */
export function programHref(sp: Record<string, string | string[] | undefined>, programId: string): string {
  const s = profileQuery(sp).toString();
  return `/program/${encodeURIComponent(programId)}${s ? `?${s}` : ''}`;
}

/** Plain-words name of the destination country for a route. */
export function routeCountry(p: Program): string {
  return countryName(p.country);
}
