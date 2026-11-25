/**
 * Conditional routes from data — pure, no I/O, no clock (pass `now` in).
 *
 * A program's `conditional_admission` is an official route below the regular minimum, as the page states it.
 * We only use it when it is usable (Verified/Likely). The student's grade is compared with the route's OWN
 * lower limit, on the route's scale: directly when the scales match, or through a conversion rule that has an
 * official source. An unsourced rule (today: CGPA -> German) never decides; the route is "not decided yet".
 *
 * A conditional route NEVER changes the fit label (that is always computed from the regular minimum).
 */
import { computeConfidence, isUsable } from '../confidence';
import { SCALE_LABEL, convertGrade, formatRange } from '../fit';
import type { Confidence, ConversionRule, GradeScale, Profile, Program, StudentScale } from '../types';

/**
 *  - meets_floor: the student's grade is at or above the lower limit the route names
 *  - no_floor:    the page names no lower limit (still a route, with a warning)
 *  - below_floor: the student's grade is below the route's own lower limit ("Not for your grade")
 *  - undecided:   we cannot compare (no sourced conversion, or a converted range that crosses the limit)
 */
export type ConditionalStatus = 'meets_floor' | 'no_floor' | 'below_floor' | 'undecided';

export interface ConditionalCheck {
  status: ConditionalStatus;
  /** The route in short, as our data row words it (plain text; may be a summary, so shown as "In short:"). */
  text: string;
  /** The verbatim words from the official page (evidence_snippet), when we hold them. Shown in preference to `text`. */
  quote: string | null;
  scale: GradeScale;
  /** Lowest grade the route names on `scale`; null when the page names none. */
  min: number | null;
  /** Computed confidence of the conditional_admission fact (always Verified or Likely here). */
  confidence: Confidence;
  sourceUrl: string | null;
  /** When the source was checked (fetched_at), for "Checked <date>". */
  checkedAt: string | null;
  /** Student-facing note on the fact (never the internal review_note). */
  note: string | null;
  /** Plain words: how the student's grade compares with the route's own lower limit, or why we cannot tell. */
  reason: string;
}

/** The student's scale in running text ("your percentage"). */
export const STUDENT_SCALE_TEXT: Record<StudentScale, string> = {
  cgpa_4: 'CGPA (out of 4.0)',
  cgpa_5: 'CGPA (out of 5.0)',
  percent: 'percentage',
};

export const NO_FLOOR_TEXT = 'The page names no lower limit; admission is not assured';

const EPS = 1e-9;

function fmt(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, '');
}

/** A lower limit as people write it: CGPA 2.5 -> "2.5", 3 -> "3.0", 60% -> "60", German 4 -> "4.0 or better". */
export function formatLimit(min: number, scale: GradeScale): string {
  const n = scale === 'percent' ? fmt(min) : Number.isInteger(min) ? min.toFixed(1) : fmt(min);
  return scale === 'german' ? `${n} or better` : n;
}

/** True when the route can be shown as a route (the student is not below its own lower limit and we could check). */
export function isConditionalRoute(c: ConditionalCheck | null | undefined): boolean {
  return c != null && (c.status === 'meets_floor' || c.status === 'no_floor');
}

/**
 * Compare the student's grade with a program's conditional route. Null when the program has no usable
 * (Verified/Likely) conditional_admission with official text.
 */
export function checkConditional(
  profile: Pick<Profile, 'cgpa' | 'scale' | 'min_pass'>,
  program: Program,
  rules: ConversionRule[],
  now: Date,
): ConditionalCheck | null {
  const fact = program.conditional_admission;
  const confidence = computeConfidence(fact, now);
  if (!isUsable(confidence)) return null;
  const v = fact?.value;
  if (!v || typeof v.text !== 'string' || v.text.trim() === '') return null;

  const base = {
    text: v.text.trim(),
    quote: fact.evidence_snippet?.trim() ? fact.evidence_snippet.trim() : null,
    scale: v.scale,
    confidence,
    sourceUrl: fact.source_url ?? program.official_url ?? null,
    checkedAt: fact.fetched_at ?? null,
    note: fact.note?.trim() ? fact.note.trim() : null,
  };

  if (v.min == null) return { ...base, min: null, status: 'no_floor', reason: `${NO_FLOOR_TEXT}.` };
  if (!Number.isFinite(v.min)) {
    return { ...base, min: null, status: 'undecided', reason: 'We could not read the lower limit this route names.' };
  }
  const min = v.min;
  const scaleText = SCALE_LABEL[v.scale];

  const conv = convertGrade(profile, v.scale, program.country, rules);
  if (!conv.ok) {
    return {
      ...base,
      min,
      status: 'undecided',
      reason:
        conv.code === 'INVALID_INPUT'
          ? 'We could not read your grade, so we cannot check it against this route.'
          : `This route uses the ${scaleText} scale, and no sourced rule converts your ${STUDENT_SCALE_TEXT[profile.scale]} to it yet, so we cannot check your grade against it.`,
    };
  }
  const range = conv.range;
  if (range.rule_id !== null && !range.rule_source_url) {
    return {
      ...base,
      min,
      status: 'undecided',
      reason: `This route uses the ${scaleText} scale. The rule that converts your ${STUDENT_SCALE_TEXT[profile.scale]} to it has no official source yet, so we cannot check your grade against it.`,
    };
  }

  const yours = range.rule_id !== null ? 'Your converted grade' : 'Your grade';
  const shown = `${formatRange(range)} on the ${scaleText}`;
  const limit = formatLimit(min, v.scale);
  const higher = range.better === 'higher';
  const meets = higher ? range.low >= min - EPS : range.high <= min + EPS;
  const below = higher ? range.high < min - EPS : range.low > min + EPS;

  if (meets) {
    return { ...base, min, status: 'meets_floor', reason: `${yours}, ${shown}, meets the lower limit this route names (${limit}).` };
  }
  if (below) {
    return { ...base, min, status: 'below_floor', reason: `${yours}, ${shown}, is below the lower limit this route names (${limit}).` };
  }
  return {
    ...base,
    min,
    status: 'undecided',
    reason: `${yours} range, ${shown}, crosses the lower limit this route names (${limit}). Your exact transcript rules decide it.`,
  };
}
