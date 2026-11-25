/**
 * View model for the FitPanel client island. Pure: the panel passes in the saved profile, the program,
 * the conversion rules and `now`. The fit label itself always comes from computeFit (never decided here),
 * and strengths are not an input, so they can never change it. The next steps added here (Plan B link, the
 * program's own route below its minimum, the "enter another scale" hint) are shown NEXT TO the label and never
 * change it.
 */
import { computeConfidence, isUsable } from '@/lib/confidence';
import { computeFit, formatRange, SCALE_LABEL } from '@/lib/fit';
import type {
  Confidence,
  ConditionalAdmission,
  ConversionRule,
  Fact,
  FitReasonCode,
  FitResult,
  GpaRule,
  Profile,
  Program,
  SourcedValue,
} from '@/lib/types';
import { conditionalAdmissionLines, formatGrade, minimumText, SHORT_SCALE, unwrapQuotes } from './render';

export type MinimumView =
  | {
      kind: 'value';
      text: string;
      confidence: Confidence;
      sourceUrl: string | null;
      /** The fact's student-facing note (e.g. "the page does not name the scale"), never the internal review_note. */
      note: string | null;
    }
  | { kind: 'conflict'; confidence: 'Conflict' }
  | { kind: 'missing'; confidence: Confidence };

export type ConversionView =
  | { kind: 'same_scale' }
  | { kind: 'sourced'; url: string }
  | { kind: 'unsourced' }
  | null;

export interface FitView {
  fit: FitResult;
  /** "2.5 (CGPA out of 4.0)" */
  grade: string;
  /** The converted RANGE with its scale label; null when no conversion was applied. */
  converted: { scaleLabel: string; value: string; isRange: boolean } | null;
  minimum: MinimumView;
  conversion: ConversionView;
  /** The German range could be narrowed if the student adds the transcript's lowest passing grade. */
  showNarrowHint: boolean;
  /** Plain-text notes of the conversion rule that was used, if any. */
  ruleNotes: string | null;
  /** Below the minimum: link to Plan B for this program. */
  showPlanB: boolean;
  /**
   * The program's own published route below its minimum (usable conditional_admission only), shown when the fit is
   * not "Meets minimum". Display only: the fit label above it is unchanged.
   */
  conditional: ConditionalRouteView | null;
  /**
   * No sourced rule converts the student's scale: the next step plus the official minimum, so the student can read
   * it themselves. Null for every other reason.
   */
  noConversion: NoConversionView | null;
}

export interface ConditionalRouteView {
  lines: string[];
  confidence: Confidence;
  sourceUrl: string | null;
  note: string | null;
}

export interface NoConversionView {
  /** The minimum's short summary (GpaRule.text), shown as "In short:"; null when the row has none. */
  summary: string | null;
  /** The verbatim evidence for the minimum, when there is one. */
  evidence: string | null;
}

/** Fit reasons where the program's own route below its minimum is worth showing (not met, not ruled out). */
const CONDITIONAL_REASONS: ReadonlySet<FitReasonCode> = new Set([
  'BELOW_MIN',
  'STRADDLES_MIN',
  'MIN_NOT_VERIFIED',
  'MIN_CONFLICT',
  'NO_CONVERSION_RULE',
  'CONVERSION_RULE_UNSOURCED',
]);

function trimmed(s: string | null | undefined): string | null {
  return s?.trim() ? s.trim() : null;
}

function conditionalRoute(program: Program, fit: FitResult, now: Date): ConditionalRouteView | null {
  if (program.status !== 'active' || !CONDITIONAL_REASONS.has(fit.reason.code)) return null;
  const fact = program.conditional_admission;
  const confidence = computeConfidence(fact, now);
  if (!fact || !isUsable(confidence) || !fact.value) return null;
  const lines = conditionalAdmissionLines(fact.value);
  return { lines, confidence, sourceUrl: fact.source_url, note: trimmed(fact.note) };
}

type FitProfile = Pick<Profile, 'cgpa' | 'scale' | 'min_pass'>;

export function buildFitView(profile: FitProfile, program: Program, rules: ConversionRule[], now: Date): FitView {
  const fit = computeFit(profile, program, rules, now);
  const conv = fit.converted;
  const rule = conv?.rule_id ? (rules.find((r) => r.id === conv.rule_id) ?? null) : null;

  const minConfidence = computeConfidence(program.min_gpa_rule, now);
  let minimum: MinimumView;
  if (fit.required) {
    minimum = {
      kind: 'value',
      text: minimumText(fit.required.min, fit.required.scale),
      confidence: fit.required.confidence,
      sourceUrl: fit.required.source_url,
      note: program.min_gpa_rule?.note?.trim() ? program.min_gpa_rule.note.trim() : null,
    };
  } else if (minConfidence === 'Conflict') {
    minimum = { kind: 'conflict', confidence: 'Conflict' };
  } else {
    minimum = { kind: 'missing', confidence: minConfidence };
  }

  let conversion: ConversionView = null;
  if (conv) {
    if (conv.rule_id === null) conversion = { kind: 'same_scale' };
    else if (conv.rule_source_url) conversion = { kind: 'sourced', url: conv.rule_source_url };
    else conversion = { kind: 'unsourced' };
  } else if (fit.reason.code === 'NO_CONVERSION_RULE') {
    conversion = { kind: 'unsourced' };
  }

  const isRange = conv ? conv.low !== conv.high : false;

  const noConversion: NoConversionView | null =
    fit.reason.code === 'NO_CONVERSION_RULE'
      ? {
          summary: trimmed(unwrapQuotes(program.min_gpa_rule?.value?.text ?? '')),
          evidence: trimmed(program.min_gpa_rule?.evidence_snippet),
        }
      : null;

  return {
    fit,
    grade: `${formatGrade(profile.cgpa, profile.scale)} (${SHORT_SCALE[profile.scale]})`,
    converted:
      conv && conv.rule_id !== null ? { scaleLabel: SCALE_LABEL[conv.scale], value: formatRange(conv), isRange } : null,
    minimum,
    conversion,
    showNarrowHint: Boolean(conv && conv.rule_formula === 'modified_bavarian' && isRange && profile.min_pass == null),
    ruleNotes: rule?.notes?.trim() ? rule.notes.trim() : null,
    showPlanB: fit.reason.code === 'BELOW_MIN',
    conditional: conditionalRoute(program, fit, now),
    noConversion,
  };
}

function withoutReviewNote<T>(s: SourcedValue<T>): SourcedValue<T> {
  const { review_note: _internal, ...rest } = s;
  void _internal;
  return rest;
}

function slimFact<T>(f: Fact<T>): Fact<T> {
  const out: Fact<T> = withoutReviewNote(f);
  if (f.conflicts) out.conflicts = f.conflicts.map(withoutReviewNote);
  return out;
}

/** Facts the FitPanel reads: the minimum (computeFit) and the program's own route below it (display only). */
const FIT_PANEL_FACTS = new Set<string>(['min_gpa_rule', 'conditional_admission']);

/**
 * The only parts of a Program the FitPanel island needs (computeFit reads status, country and min_gpa_rule; the
 * panel also shows conditional_admission). Passing the whole program to a client component would serialise every
 * fact and snippet into the page a second time, which slows hydration on mid-range phones. Other facts become
 * empty (they are not used). The internal review_note is dropped from the kept facts too, so it never reaches
 * the browser.
 */
export function programForFitPanel(p: Program): Program {
  const empty = { value: null, source_url: null, evidence_snippet: null, fetched_at: null };
  const slim = { ...p } as Record<string, unknown>;
  for (const [k, v] of Object.entries(p)) {
    if (!(v && typeof v === 'object' && 'value' in (v as object))) continue;
    slim[k] = FIT_PANEL_FACTS.has(k) ? slimFact(v as Fact<unknown>) : empty;
  }
  if (p.min_gpa_rule) slim.min_gpa_rule = slimFact<GpaRule>(p.min_gpa_rule);
  if (p.conditional_admission) slim.conditional_admission = slimFact<ConditionalAdmission>(p.conditional_admission);
  return slim as unknown as Program;
}
