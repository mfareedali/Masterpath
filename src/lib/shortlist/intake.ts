/**
 * Intake filter terms. Plain code, no AI, no clock.
 *
 * Intake values are free text copied from official pages ("January 2027, September 2027",
 * "Summer or Winter semester"). The filter must not compare those strings exactly, so the text is read
 * into a small set of start TERMS:
 *   - months:    January ... December (years are read but not kept: chips say "September", not "September 2027")
 *   - semesters: "Winter semester", "Summer semester" (the German/Swiss wording, kept as its own kind)
 *   - seasons:   "Autumn / Fall", "Spring", "Summer", "Winter" (a bare season word, e.g. a US "Fall 2027")
 *
 * Code never converts between kinds: "Winter semester" is NOT read as October and "Fall" is NOT read as
 * September. When a program's terms are of another kind than the chip, or its text cannot be read in full,
 * the answer is "unknown" (the program goes to "Can't check"), never "fail".
 */

export type IntakeKind = 'month' | 'season' | 'semester';

export const INTAKE_TERM_IDS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'spring',
  'summer',
  'autumn',
  'winter',
  'summer-semester',
  'winter-semester',
] as const;

export type IntakeTermId = (typeof INTAKE_TERM_IDS)[number];

const MONTH_IDS: readonly IntakeTermId[] = INTAKE_TERM_IDS.slice(0, 12);

const LABEL: Record<IntakeTermId, string> = {
  january: 'January',
  february: 'February',
  march: 'March',
  april: 'April',
  may: 'May',
  june: 'June',
  july: 'July',
  august: 'August',
  september: 'September',
  october: 'October',
  november: 'November',
  december: 'December',
  spring: 'Spring',
  summer: 'Summer',
  autumn: 'Autumn / Fall',
  winter: 'Winter',
  'summer-semester': 'Summer semester',
  'winter-semester': 'Winter semester',
};

export function isIntakeTermId(v: unknown): v is IntakeTermId {
  return typeof v === 'string' && (INTAKE_TERM_IDS as readonly string[]).includes(v);
}

export function intakeTermLabel(id: IntakeTermId): string {
  return LABEL[id];
}

export function intakeTermKind(id: IntakeTermId): IntakeKind {
  if (MONTH_IDS.includes(id)) return 'month';
  return id.endsWith('-semester') ? 'semester' : 'season';
}

/** Calendar order for months, then seasons, then semesters (the chip order). */
export function compareIntakeTerms(a: IntakeTermId, b: IntakeTermId): number {
  return INTAKE_TERM_IDS.indexOf(a) - INTAKE_TERM_IDS.indexOf(b);
}

/* ---------------------------------------------------------------- parse */

const MONTH_WORDS: Record<string, IntakeTermId> = {
  january: 'january',
  jan: 'january',
  february: 'february',
  feb: 'february',
  march: 'march',
  mar: 'march',
  april: 'april',
  apr: 'april',
  june: 'june',
  jun: 'june',
  july: 'july',
  jul: 'july',
  august: 'august',
  aug: 'august',
  september: 'september',
  sept: 'september',
  sep: 'september',
  october: 'october',
  oct: 'october',
  november: 'november',
  nov: 'november',
  december: 'december',
  dec: 'december',
};

const SEASON_WORDS: Record<string, IntakeTermId> = {
  autumn: 'autumn',
  fall: 'autumn',
  spring: 'spring',
  summer: 'summer',
  winter: 'winter',
};

const ONE_WORD_SEMESTERS: Record<string, IntakeTermId> = {
  wintersemester: 'winter-semester',
  summersemester: 'summer-semester',
  sommersemester: 'summer-semester',
};

/** Words that carry no start term but are fine in an intake sentence ("Starts January and September"). */
const FILLER = new Set([
  'a',
  'and',
  'both',
  'date',
  'dates',
  'each',
  'either',
  'entries',
  'entry',
  'every',
  'from',
  'in',
  'intake',
  'intakes',
  'of',
  'only',
  'or',
  'semester',
  'semesters',
  'start',
  'starting',
  'starts',
  'term',
  'terms',
  'the',
  'year',
]);

/** "2027", "2027/28", "2027/2028". */
const YEAR = /^(?:19|20)\d{2}(?:\/(?:\d{2}|\d{4}))?$/;

export interface ParsedIntake {
  /** Distinct start terms found in the text, in chip order. */
  terms: IntakeTermId[];
  /** True when every word was understood (terms, years or filler) and at least one term was found. */
  complete: boolean;
}

/**
 * Reads an intake text into start terms. Conservative: any word it does not know makes the parse
 * incomplete, so a non-match can only become "unknown", never "fail".
 */
export function parseIntake(text: string | null | undefined): ParsedIntake {
  if (text == null) return { terms: [], complete: false };
  // "Summer or Winter semester" -> "summer semester winter semester" (the word "semester" applies to both).
  const s = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(
      /\b(summer|winter)\s*(?:,|\/|&|\bor\b|\band\b)\s*(summer|winter)\s+semesters?\b/g,
      '$1 semester $2 semester',
    );
  const words = s.match(/[a-z]+|\d+(?:\/\d+)*/g) ?? [];
  const found = new Set<IntakeTermId>();
  let unknownWord = false;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    if ((w === 'summer' || w === 'winter') && (next === 'semester' || next === 'semesters')) {
      found.add(w === 'summer' ? 'summer-semester' : 'winter-semester');
      i++;
    } else if (w in ONE_WORD_SEMESTERS) {
      found.add(ONE_WORD_SEMESTERS[w]);
    } else if (w in MONTH_WORDS) {
      found.add(MONTH_WORDS[w]);
    } else if (w === 'may' && next !== undefined && YEAR.test(next)) {
      // "may" is a month only next to a year ("May 2027"); otherwise it may be the verb.
      found.add('may');
    } else if (w in SEASON_WORDS) {
      found.add(SEASON_WORDS[w]);
    } else if (YEAR.test(w) || FILLER.has(w)) {
      // understood, carries no term
    } else {
      unknownWord = true;
    }
  }

  const terms = [...found].sort(compareIntakeTerms);
  return { terms, complete: !unknownWord && terms.length > 0 };
}

/** Distinct terms of a text, for chips and for old shared links that carried the raw intake text. */
export function intakeTermsOf(text: string | null | undefined): IntakeTermId[] {
  return parseIntake(text).terms;
}

/* ---------------------------------------------------------------- match */

export type IntakeMatch = 'pass' | 'fail' | 'unknown';

/**
 * Three-valued match of a parsed intake against the selected terms (OR across the selection):
 *  - pass:    the text names at least one selected term;
 *  - fail:    the text was read in full and, for EVERY selected term, names other terms of the same kind
 *             (e.g. "January, September" vs "October");
 *  - unknown: anything else (text not read in full, or a selected term of another kind, e.g. "Winter semester"
 *             vs "October"). Unknown is never treated as a match or as a miss.
 */
export function matchIntake(parsed: ParsedIntake, selected: readonly IntakeTermId[]): IntakeMatch {
  if (selected.length === 0) return 'pass';
  if (selected.some((t) => parsed.terms.includes(t))) return 'pass';
  if (!parsed.complete) return 'unknown';
  const kinds = new Set(parsed.terms.map(intakeTermKind));
  return selected.every((t) => kinds.has(intakeTermKind(t))) ? 'fail' : 'unknown';
}
