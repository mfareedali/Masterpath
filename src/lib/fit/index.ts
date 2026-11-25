/**
 * Fit engine — pure TypeScript, no AI, no I/O.
 *
 * Input: the student's CGPA + scale (+ optional transcript minimum pass grade), a program, and conversion rules.
 * Output: exactly one of three labels — "Meets minimum", "Below minimum", "Competitive range unknown" —
 * plus a machine-readable reason, the converted RANGE, and the rule's source.
 *
 * Never outputs an admission probability. Strengths (publications etc.) never change the label.
 */
import { computeConfidence, isUsable } from '../confidence';
import type {
  ConversionRule,
  ConvertedRange,
  FitLabel,
  FitReasonCode,
  FitResult,
  GpaRule,
  GradeScale,
  Profile,
  Program,
  StudentScale,
} from '../types';

const EPS = 1e-9;

export const SCALE_MAX: Record<StudentScale, number> = { cgpa_4: 4, cgpa_5: 5, percent: 100 };

export const SCALE_LABEL: Record<GradeScale, string> = {
  cgpa_4: 'CGPA (out of 4.0)',
  cgpa_5: 'CGPA (out of 5.0)',
  percent: 'Percentage',
  german: 'German grade (1.0 best – 4.0 pass)',
};

/** On the German scale lower is better; everywhere else higher is better. */
export function betterDirection(scale: GradeScale): 'higher' | 'lower' {
  return scale === 'german' ? 'lower' : 'higher';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function asRange(v: number | [number, number] | undefined): [number, number] | null {
  if (v === undefined) return null;
  if (Array.isArray(v)) {
    const [a, b] = v;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [Math.min(a, b), Math.max(a, b)];
  }
  return Number.isFinite(v) ? [v, v] : null;
}

export function isValidGrade(cgpa: number, scale: StudentScale): boolean {
  return Number.isFinite(cgpa) && cgpa >= 0 && cgpa <= SCALE_MAX[scale];
}

/** Modified Bavarian formula: German grade = 1 + 3 * (Nmax - Nd) / (Nmax - Nmin). */
export function modifiedBavarian(nd: number, nmax: number, nmin: number): number {
  if (nmax - nmin <= 0) return NaN;
  return 1 + (3 * (nmax - nd)) / (nmax - nmin);
}

/**
 * Pick the conversion rule for a student scale -> target scale, for a destination country.
 * Prefers a country-specific scope ("PK->DE") over a wildcard ("PK->*").
 */
export function findRule(
  rules: ConversionRule[],
  from: GradeScale,
  to: GradeScale,
  country: string,
): ConversionRule | null {
  const candidates = rules.filter((r) => r.from_scale === from && r.to_scale === to);
  return (
    candidates.find((r) => r.scope === `PK->${country}`) ??
    candidates.find((r) => r.scope === 'PK->*') ??
    candidates.find((r) => r.scope === '*') ??
    null
  );
}

export type ConvertResult =
  | { ok: true; range: ConvertedRange }
  | { ok: false; code: Extract<FitReasonCode, 'NO_CONVERSION_RULE' | 'INVALID_INPUT'>; message: string };

/**
 * Convert a student grade to the target scale as a RANGE.
 * Identity conversions need no rule. Otherwise the matching rule is applied; a range in the rule's params
 * (e.g. an unknown transcript minimum pass grade) produces a range in the output.
 */
export function convertGrade(
  input: { cgpa: number; scale: StudentScale; min_pass?: number | null },
  to: GradeScale,
  country: string,
  rules: ConversionRule[],
): ConvertResult {
  const { cgpa, scale } = input;
  if (!isValidGrade(cgpa, scale)) {
    return { ok: false, code: 'INVALID_INPUT', message: `Enter a grade between 0 and ${SCALE_MAX[scale]}.` };
  }
  const better = betterDirection(to);

  if (scale === to) {
    return {
      ok: true,
      range: { scale: to, low: cgpa, high: cgpa, better, rule_id: null, rule_source_url: null, rule_formula: 'identity' },
    };
  }

  const rule = findRule(rules, scale, to, country);
  if (!rule) {
    return {
      ok: false,
      code: 'NO_CONVERSION_RULE',
      message: `No sourced rule converts ${SCALE_LABEL[scale]} to ${SCALE_LABEL[to]} yet.`,
    };
  }

  const base = { scale: to, better, rule_id: rule.id, rule_source_url: rule.source_url, rule_formula: rule.formula };

  if (rule.formula === 'identity') {
    return { ok: true, range: { ...base, low: cgpa, high: cgpa } };
  }

  if (rule.formula === 'modified_bavarian') {
    const nmaxR = asRange(rule.params?.nmax) ?? [SCALE_MAX[scale], SCALE_MAX[scale]];
    // A minimum pass grade supplied by the student narrows the range to a single value.
    const studentMin =
      input.min_pass != null && Number.isFinite(input.min_pass) && input.min_pass < nmaxR[0] ? input.min_pass : null;
    const nminR: [number, number] | null = studentMin != null ? [studentMin, studentMin] : asRange(rule.params?.nmin);
    if (!nminR) {
      return { ok: false, code: 'NO_CONVERSION_RULE', message: 'The conversion rule is missing its minimum pass grade.' };
    }
    // If cgpa is below the pass mark the formula yields a failing German grade (> 4.0); that is kept as-is.
    const values: number[] = [];
    for (const nmax of nmaxR) for (const nmin of nminR) values.push(modifiedBavarian(cgpa, nmax, nmin));
    if (values.some((v) => !Number.isFinite(v))) {
      return { ok: false, code: 'NO_CONVERSION_RULE', message: 'The conversion rule parameters are invalid.' };
    }
    // German grades cannot be better than 1.0.
    const clamped = values.map((v) => Math.max(1, v));
    return { ok: true, range: { ...base, low: round2(Math.min(...clamped)), high: round2(Math.max(...clamped)) } };
  }

  if (rule.formula === 'linear') {
    const aR = asRange(rule.params?.a);
    const bR = asRange(rule.params?.b) ?? [0, 0];
    if (!aR) return { ok: false, code: 'NO_CONVERSION_RULE', message: 'The conversion rule is missing parameter a.' };
    const values: number[] = [];
    for (const a of aR) for (const b of bR) values.push(a * cgpa + b);
    return { ok: true, range: { ...base, low: round2(Math.min(...values)), high: round2(Math.max(...values)) } };
  }

  return { ok: false, code: 'NO_CONVERSION_RULE', message: 'Unknown conversion formula.' };
}

const LABEL_FOR: Record<FitReasonCode, FitLabel> = {
  MEETS_MIN: 'Meets minimum',
  BELOW_MIN: 'Below minimum',
  STRADDLES_MIN: 'Competitive range unknown',
  MIN_NOT_VERIFIED: 'Competitive range unknown',
  MIN_CONFLICT: 'Competitive range unknown',
  NO_CONVERSION_RULE: 'Competitive range unknown',
  CONVERSION_RULE_UNSOURCED: 'Competitive range unknown',
  NOT_ACCEPTING: 'Competitive range unknown',
  INVALID_INPUT: 'Competitive range unknown',
};

function result(
  code: FitReasonCode,
  message: string,
  converted: ConvertedRange | null = null,
  required: FitResult['required'] = null,
): FitResult {
  return { label: LABEL_FOR[code], reason: { code, message }, converted, required };
}

function fmt(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/** Minimums read naturally: CGPA 3 -> "3.0", German 2.5 -> "2.5", percent 60 -> "60". */
function fmtMin(n: number, scale: GradeScale): string {
  if (scale === 'percent') return fmt(n);
  return Number.isInteger(n) ? n.toFixed(1) : fmt(n);
}

export function formatRange(r: ConvertedRange): string {
  return r.low === r.high ? fmt(r.low) : `${fmt(r.low)}–${fmt(r.high)}`;
}

export interface ChosenMinimum {
  scale: GradeScale;
  min: number;
  /** True when the minimum came from GpaRule.alternatives (another minimum printed in the same snippet). */
  alternative: boolean;
}

/**
 * The minimum to decide on for a student scale. If the rule's own scale is the student's scale, that minimum; else an
 * alternative printed in the SAME evidence snippet on the student's scale (e.g. Brookes "60% or GPA 2.7" for a
 * percentage student), used directly with no conversion; else the rule's own minimum (which then needs a conversion).
 */
export function minimumForScale(rule: GpaRule, scale: GradeScale): ChosenMinimum {
  if (rule.scale === scale) return { scale: rule.scale, min: rule.min, alternative: false };
  const alt = rule.alternatives?.find((a) => a.scale === scale && Number.isFinite(a.min));
  if (alt) return { scale: alt.scale, min: alt.min, alternative: true };
  return { scale: rule.scale, min: rule.min, alternative: false };
}

/** "2.5 on the CGPA (out of 4.0)"; percentages read "62 out of 100" (never a "%" sign next to a fit result). */
function shownGrade(range: ConvertedRange, scale: GradeScale): string {
  if (scale === 'percent') return `${formatRange(range)} out of 100`;
  return `${formatRange(range)} on the ${SCALE_LABEL[scale]}`;
}

/**
 * Compute the fit label for one program.
 * `now` is passed in (not read from the clock) so results are deterministic and testable.
 */
export function computeFit(
  profile: Pick<Profile, 'cgpa' | 'scale' | 'min_pass'>,
  program: Program,
  rules: ConversionRule[],
  now: Date,
): FitResult {
  if (program.status === 'ruled_out') {
    return result('NOT_ACCEPTING', 'This program is marked as ruled out. See the note and official page.');
  }
  if (!isValidGrade(profile.cgpa, profile.scale)) {
    return result('INVALID_INPUT', `Enter a grade between 0 and ${SCALE_MAX[profile.scale]}.`);
  }

  const minFact = program.min_gpa_rule;
  const minConf = computeConfidence(minFact, now);
  if (minConf === 'Conflict') {
    return result('MIN_CONFLICT', 'Official sources disagree on the minimum grade. Ask the university in writing.');
  }
  if (!isUsable(minConf) || !minFact.value) {
    return result('MIN_NOT_VERIFIED', 'The minimum grade for this program is not verified yet.');
  }

  // Decide on the minimum printed for the student's own scale when the page gives one (identity, no conversion rule).
  const rule = minimumForScale(minFact.value, profile.scale);
  const required = { scale: rule.scale, min: rule.min, confidence: minConf, source_url: minFact.source_url };
  const fromPage = rule.alternative ? ' The official page states this minimum on your grade scale, so no conversion was needed.' : '';

  const conv = convertGrade(profile, rule.scale, program.country, rules);
  if (!conv.ok) return result(conv.code, conv.message, null, required);
  const range = conv.range;

  if (range.rule_id !== null && !range.rule_source_url) {
    return result(
      'CONVERSION_RULE_UNSOURCED',
      'Your grade was converted with a rule that has no official source yet, so we will not decide fit.',
      range,
      required,
    );
  }

  const shown = shownGrade(range, rule.scale);
  if (range.better === 'higher') {
    if (range.low >= rule.min - EPS) return result('MEETS_MIN', `Your grade, ${shown}, meets the minimum of ${fmtMin(rule.min, rule.scale)}.${fromPage}`, range, required);
    if (range.high < rule.min - EPS) return result('BELOW_MIN', `Your grade, ${shown}, is below the minimum of ${fmtMin(rule.min, rule.scale)}.${fromPage}`, range, required);
  } else {
    // Lower is better (German scale): "min" is the worst acceptable grade.
    if (range.high <= rule.min + EPS) return result('MEETS_MIN', `Your converted grade, ${shown}, meets the required ${fmtMin(rule.min, rule.scale)} or better.`, range, required);
    if (range.low > rule.min + EPS) return result('BELOW_MIN', `Your converted grade, ${shown}, is below the required ${fmtMin(rule.min, rule.scale)} or better.`, range, required);
  }
  return result(
    'STRADDLES_MIN',
    `Your converted grade range, ${shown}, crosses the minimum of ${fmtMin(rule.min, rule.scale)}. Your exact transcript rules decide it.`,
    range,
    required,
  );
}

/** Ordering for "Rank by: Fit". Null = not rankable (goes to "Not ranked: data missing"). */
export function fitSortValue(f: FitResult): number | null {
  switch (f.reason.code) {
    case 'MEETS_MIN':
      return 0;
    case 'STRADDLES_MIN':
      return 1;
    case 'BELOW_MIN':
      return 2;
    default:
      return null;
  }
}
