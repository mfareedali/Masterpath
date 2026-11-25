/**
 * Plain-text renderers for program facts. Every function returns strings (or arrays of lines), never HTML.
 * React escapes the strings when they are rendered. Values come only from data rows; nothing is invented here.
 */
import { formatDate, formatMoney, formatMonths } from '@/lib/format';
import type {
  ConditionalAdmission,
  CountryFactValue,
  GpaRule,
  GradeScale,
  LanguageReq,
  PathwayType,
  RecognitionStatus,
} from '@/lib/types';
import type { ProgramFactKey, ProgramFactValue } from './fields';

export const PATHWAY_LABEL: Record<PathwayType, string> = {
  direct: 'Direct entry',
  conditional: 'Conditional offer route',
  pre_masters: "Pre-master's route",
  pathway: 'Pathway program',
  score_based: 'Score-based entry',
  research_led: 'Research-led route',
};

/** Short scale names for inline text (the fit engine's SCALE_LABEL is used for headings). */
export const SHORT_SCALE: Record<GradeScale, string> = {
  cgpa_4: 'CGPA out of 4.0',
  cgpa_5: 'CGPA out of 5.0',
  percent: 'percentage',
  german: 'German grade, 1.0 is best',
};

function isBlank(s: string | null | undefined): s is null | undefined | '' {
  return s == null || s.trim() === '';
}

function trimNumber(n: number, maxDecimals = 2): string {
  return n.toFixed(maxDecimals).replace(/\.?0+$/, '');
}

/** "3.0", "2.75", "60%". */
export function formatGrade(n: number, scale: GradeScale): string {
  if (!Number.isFinite(n)) return String(n);
  if (scale === 'percent') return `${trimNumber(n)}%`;
  const hundredths = Math.round(n * 100);
  return hundredths % 10 === 0 ? n.toFixed(1) : n.toFixed(2);
}

/** "3.0 or higher (CGPA out of 4.0)" / "2.5 or better (German grade, 1.0 is best)". */
export function minimumText(min: number, scale: GradeScale): string {
  if (!Number.isFinite(min)) return 'Minimum not given';
  if (scale === 'german') return `${formatGrade(min, scale)} or better (${SHORT_SCALE.german})`;
  if (scale === 'percent') return `${formatGrade(min, scale)} or higher`;
  return `${formatGrade(min, scale)} or higher (${SHORT_SCALE[scale]})`;
}

/** Removes one pair of quotation marks wrapping the WHOLE text, so stored text never looks like a quote. */
export function unwrapQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && /^["“]/.test(t) && /["”]$/.test(t)) return t.slice(1, -1).trim();
  return t;
}

/**
 * GpaRule.text is the team's short summary of the rule, NOT a verbatim quote, so it is labelled "In short:" and
 * never wrapped in quotation marks. Quotation marks are reserved for evidence_snippet (FactRow's evidence block).
 */
export function gpaRuleLines(rule: GpaRule): string[] {
  const lines = [minimumText(rule.min, rule.scale)];
  // Other minimums printed in the same evidence (e.g. "60% or GPA 2.7"): shown as written, never converted.
  for (const alt of rule.alternatives ?? []) {
    if (alt && Number.isFinite(alt.min) && alt.scale !== rule.scale) lines.push(`Or: ${minimumText(alt.min, alt.scale)}`);
  }
  const summary = isBlank(rule.text) ? '' : unwrapQuotes(rule.text);
  if (summary) lines.push(`In short: ${summary}`);
  return lines;
}

/**
 * An official route below the regular minimum. `text` is the team's short summary of the page (labelled
 * "In short:", never quoted); the floor line appears only when the page names one. It never changes the fit label.
 */
export function conditionalAdmissionLines(v: ConditionalAdmission): string[] {
  const lines: string[] = [];
  if (v.min != null && Number.isFinite(v.min)) lines.push(`This route's minimum: ${minimumText(v.min, v.scale)}`);
  const summary = isBlank(v.text) ? '' : unwrapQuotes(v.text);
  if (summary) lines.push(`In short: ${summary}`);
  return lines.length ? lines : ['The official page describes a route below the minimum'];
}

function score(n: number): string {
  return trimNumber(n, 1);
}

export function languageReqLines(req: LanguageReq): string[] {
  const lines: string[] = [];
  if (req.ielts_overall != null && Number.isFinite(req.ielts_overall)) lines.push(`IELTS overall: ${score(req.ielts_overall)}`);
  if (req.toefl_ibt != null && Number.isFinite(req.toefl_ibt)) lines.push(`TOEFL iBT: ${score(req.toefl_ibt)}`);
  if (!isBlank(req.waiver)) lines.push(`Waiver: ${req.waiver.trim()}`);
  if (!isBlank(req.text)) lines.push(req.text.trim());
  return lines.length ? lines : ['No test scores listed in this record'];
}

/** "1 letter" / "2 letters". */
export function lorCountText(n: number): string {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return String(n);
  return `${n} letter${n === 1 ? '' : 's'}`;
}

export function yesNoText(v: boolean): string {
  return v ? 'Yes, as stated on the source' : 'No, as stated on the source';
}

export function progressionText(v: boolean): string {
  return v ? 'Guaranteed, as stated on the source' : 'Not guaranteed, as stated on the source';
}

const DAY_MS = 86_400_000;

/** Whole days from `now` to an ISO date (UTC calendar days). Null when the date is invalid. */
export function daysUntil(iso: string, now: Date): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / DAY_MS);
}

/**
 * "52 days left", "Today", "This date has passed". Null when the date is invalid.
 * The program page is static, so the page shows this text only from the client leaf DaysLeft
 * (src/components/ui/days-left.tsx), never baked into the HTML.
 */
export function daysLeftText(iso: string, now: Date): string | null {
  const days = daysUntil(iso, now);
  if (days === null) return null;
  if (days < 0) return 'This date has passed';
  if (days === 0) return 'Today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

/** True when the date (UTC calendar day) is before today. Invalid dates count as passed (never offered). */
export function isDatePassed(iso: string, now: Date): boolean {
  const days = daysUntil(iso, now);
  return days === null || days < 0;
}

export function deadlineLines(iso: string, now?: Date): string[] {
  const lines = [formatDate(iso)];
  if (now) {
    const left = daysLeftText(iso, now);
    if (left) lines.push(left);
  }
  return lines;
}

export function countryFactLines(v: CountryFactValue): string[] {
  const lines = [v.text];
  if (!isBlank(v.clock_note)) lines.push(`How time is counted: ${v.clock_note.trim()}`);
  return lines;
}

export function recognitionText(s: RecognitionStatus): string {
  return s === 'listed' ? 'Listed on the official recognition list' : 'Not found on the official recognition list';
}

type LineFns = { [K in ProgramFactKey]: (value: ProgramFactValue<K>, now?: Date) => string[] };

const text = (v: string) => [v];

const FACT_LINES: LineFns = {
  status_note: text,
  eligibility_note: text,
  conditional_admission: conditionalAdmissionLines,
  language_waiver: text,
  intake: text,
  deadline: (v, now) => deadlineLines(v, now),
  duration_months: (v) => [formatMonths(v)],
  tuition: (v) => [formatMoney(v)],
  living_cost: (v) => [formatMoney(v)],
  scholarship_info: text,
  min_gpa_rule: gpaRuleLines,
  language_req: languageReqLines,
  tests_required: text,
  sop_requirements: text,
  lor_count: (v) => [lorCountText(v)],
  cv_requirements: text,
  research_considered: text,
  progression_guaranteed: (v) => [progressionText(v)],
  progression_requirement: text,
  admissions_email: text,
};

/** Display lines for one program fact value. Pass `now` to add relative text (e.g. "52 days left"). */
export function factLines<K extends ProgramFactKey>(key: K, value: ProgramFactValue<K>, now?: Date): string[] {
  const fn = FACT_LINES[key] as (value: ProgramFactValue<K>, now?: Date) => string[];
  return fn(value, now).filter((l) => !isBlank(l));
}

/** One-line plain text for a fact value (used in the "Copy email to admissions" text). */
export function factText<K extends ProgramFactKey>(key: K, value: ProgramFactValue<K>): string {
  return factLines(key, value).join('; ');
}
