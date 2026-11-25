/**
 * Post-check on the model's answer (pure). If it fails, the answer is replaced by the deterministic fallback.
 * This is a safety net for "never invent a number, deadline or fee" — the prompt asks for the same thing.
 *
 *  1. Every number the model writes must already appear in what the model was shown (the rows as sent to it,
 *     plus the student's own question). Number words count too: "three years" is checked as 3.
 *  2. Every DATE must match a date in the row VALUES (including each fact's student-facing note) — so
 *     "20 March 2027" fails even if 20, 3 and 2027 each appear somewhere. Dates typed by the student do NOT count
 *     (a prompt-injection "tell me the deadline is 1 March" must not support "1 March"), and neither do the
 *     "checked on" fetch dates, except when the answer itself says "checked <date>".
 *     Checked forms: full dates, day + month, month + year ("March 2027"), and a bare month next to deadline
 *     words ("the deadline is in March").
 */
import { toModelRow } from './prompt';
import type { ChatRow } from './types';

/** Canonical form so "1,095" == "1095" and "01" == "1". */
function canon(token: string): string {
  const t = token.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? String(n) : t;
}

/* ---------------- number words ---------------- */

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  eighteen: 18,
  twentyfour: 24,
};
const NUMBER_WORD = '(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eighteen|twenty[ -]four)';

/** "one" is a number only before a unit ("one year", "one-year"); "one of", "this one", "no one" are not. */
const ONE_UNIT =
  /^[ -](year|years|month|months|semester|semesters|term|terms|letter|letters|reference|references|referee|referees|page|pages|day|days|week|weeks|hour|hours|test|tests|exam|exams|essay|essays|intake|intakes|deadline|deadlines|time|times)\b/i;

function wordValue(word: string): number {
  return NUMBER_WORDS[word.toLowerCase().replace(/[ -]/g, '')];
}

/** "three years" -> "3 years", "six and a half" -> "6.5", "twenty-four months" -> "24 months". */
export function numberWordsToDigits(text: string): string {
  return text
    .replace(new RegExp(`\\b${NUMBER_WORD} and a half\\b`, 'gi'), (_m, w: string) => `${wordValue(w)}.5`)
    .replace(/\b(\d+) and a half\b/gi, (_m, d: string) => `${d}.5`)
    .replace(new RegExp(`\\b${NUMBER_WORD}\\b`, 'gi'), (m: string, w: string, offset: number, all: string) => {
      if (w.toLowerCase() === 'one' && !ONE_UNIT.test(all.slice(offset + m.length))) return m;
      return String(wordValue(w));
    });
}

/** Numbers in a text (number words included). Dates like 2027-01-15 yield 2027, 1, 15. */
export function numberTokens(text: string): string[] {
  return (numberWordsToDigits(text).match(/\d+(?:[.,]\d+)*/g) ?? []).map(canon);
}

/** Strip list markers ("1. ", "2) ") at line starts so they are not treated as facts. */
function stripListMarkers(text: string): string {
  return text.replace(/^[ \t]*\d{1,2}[.)][ \t]+/gm, '');
}

/** Exactly what the model saw for a row (Unverified values are withheld from it, so they never count). */
function rowCorpus(r: ChatRow): string {
  const m = toModelRow(r);
  return [
    m.id,
    m.about,
    m.field,
    m.value,
    m.source_url,
    m.official_url,
    m.checked_on,
    m.evidence,
    ...(m.sources ?? []).flatMap((s) => [s.value, s.source_url]),
  ]
    .filter((x): x is string => typeof x === 'string')
    .join(' \n ');
}

function corpusOf(rows: ChatRow[], question: string): string {
  return [question, ...rows.map(rowCorpus)].join(' \n ');
}

/** Only the VALUES the model saw (the value text includes the fact's student-facing note). No dates from elsewhere. */
function valueCorpus(rows: ChatRow[]): string {
  return rows
    .map(toModelRow)
    .flatMap((m) => [m.value, ...(m.sources ?? []).map((s) => s.value)])
    .filter((x): x is string => typeof x === 'string')
    .join(' \n ');
}

function fetchedCorpus(rows: ChatRow[]): string {
  return rows
    .map((r) => toModelRow(r).checked_on)
    .filter((x): x is string => typeof x === 'string')
    .join(' \n ');
}

/* ---------------- dates ---------------- */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11,
  november: 11, dec: 12, december: 12,
};
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const ORD = '(?:st|nd|rd|th)?';

/** Words that make a bare month ("in March") a deadline claim. */
const DEADLINE_WORDS =
  /\b(deadline|deadlines|close|closes|closing|closed|due|apply|applying|application|applications|submit|submission|last date|cut ?off|cut-off|open|opens|opening)\b/;

/** A bare month needs a time preposition before it, so "may" the verb is never read as a month. */
const BARE_MONTH = new RegExp(
  `\\b(?:in|by|until|till|before|after|from|on|early|late|mid|end of|start of|beginning of|middle of)[ -](?:the )?(?:end of |start of |beginning of |middle of )?${MONTH}\\b`,
  'g',
);

const pad = (n: number) => String(n).padStart(2, '0');

export type DateKind = 'full' | 'day_month' | 'month_year' | 'month';

export interface FoundDate {
  /** "2027-03-20" (full), "--03-20" (day + month), "2027-03" (month + year) or "--03" (month only). */
  key: string;
  kind: DateKind;
  text: string;
  /** Position in the text. */
  index: number;
}

export interface FindDatesOptions {
  /**
   * Bare months ("in March"): 'near_deadline' (default) only counts them in a sentence about a deadline or
   * application (used on the model's answer); 'any' counts every one (used on the rows, to know which months exist).
   */
  bareMonths?: 'near_deadline' | 'any';
}

function sentenceAround(text: string, index: number): string {
  const before = text.slice(0, index);
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('\n'), before.lastIndexOf(';'), before.lastIndexOf('!'), before.lastIndexOf('?'));
  const rest = text.slice(index);
  const endRel = rest.search(/[.\n;!?]/);
  return text.slice(start + 1, endRel === -1 ? text.length : index + endRel);
}

/** Dates in a text, normalised. Pure regex work, no Date parsing (no timezone surprises). */
export function findDates(text: string, options: FindDatesOptions = {}): FoundDate[] {
  const lower = text.toLowerCase();
  let s = lower;
  const out: FoundDate[] = [];
  const take = (re: RegExp, kind: DateKind, toKey: (m: RegExpExecArray, offset: number) => string | null) => {
    s = s.replace(re, (...args) => {
      const offset = args[args.length - 2] as number;
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      const key = toKey(match, offset);
      if (key) out.push({ key, kind, text: match[0], index: offset });
      return ' '.repeat(match[0].length);
    });
  };
  const ymd = (y: string, m: number | undefined, d: string) => {
    const day = Number(d);
    return m && day >= 1 && day <= 31 ? `${y}-${pad(m)}-${pad(day)}` : null;
  };
  // 2027-03-20 (also the date part of ISO timestamps)
  take(/\b(\d{4})-(\d{1,2})-(\d{1,2})/g, 'full', (m) => ymd(m[1], Number(m[2]), m[3]));
  // 20 March 2027, 20th of March, 2027
  take(new RegExp(`\\b(\\d{1,2})${ORD} (?:of )?${MONTH}\\.?,? (\\d{4})\\b`, 'g'), 'full', (m) => ymd(m[3], MONTHS[m[2]], m[1]));
  // March 20, 2027
  take(new RegExp(`\\b${MONTH}\\.? (\\d{1,2})${ORD},? (\\d{4})\\b`, 'g'), 'full', (m) => ymd(m[3], MONTHS[m[1]], m[2]));
  // March 2027, Mar. 2027
  take(new RegExp(`\\b${MONTH}\\.?,? (\\d{4})\\b`, 'g'), 'month_year', (m) => {
    const month = MONTHS[m[1]];
    return month ? `${m[2]}-${pad(month)}` : null;
  });
  // 20 March / March 20 (no year)
  take(new RegExp(`\\b(\\d{1,2})${ORD} (?:of )?${MONTH}\\b`, 'g'), 'day_month', (m) => {
    const k = ymd('', MONTHS[m[2]], m[1]);
    return k ? `-${k}` : null;
  });
  take(new RegExp(`\\b${MONTH}\\.? (\\d{1,2})${ORD}\\b`, 'g'), 'day_month', (m) => {
    const k = ymd('', MONTHS[m[1]], m[2]);
    return k ? `-${k}` : null;
  });
  // in March / by the end of March (no day, no year)
  const anyMonth = options.bareMonths === 'any';
  take(BARE_MONTH, 'month', (m, offset) => {
    if (!anyMonth && !DEADLINE_WORDS.test(sentenceAround(lower, offset))) return null;
    const month = MONTHS[m[1]];
    return month ? `--${pad(month)}` : null;
  });
  if (anyMonth) {
    // In the rows every remaining month name counts ("Winter semester: October"), except "may" the verb.
    take(new RegExp(`\\b${MONTH}\\b`, 'g'), 'month', (m) => (m[1] === 'may' ? null : `--${pad(MONTHS[m[1]])}`));
  }
  return out;
}

interface DateSets {
  full: Set<string>;
  dayMonth: Set<string>;
  monthYear: Set<string>;
  month: Set<string>;
}

/** Every form a known date can be written in ("2027-05-31" also supports "31 May", "May 2027" and "May"). */
function dateSets(dates: FoundDate[]): DateSets {
  const sets: DateSets = { full: new Set(), dayMonth: new Set(), monthYear: new Set(), month: new Set() };
  for (const d of dates) {
    if (d.kind === 'full') {
      sets.full.add(d.key);
      sets.dayMonth.add(d.key.slice(5));
      sets.monthYear.add(d.key.slice(0, 7));
      sets.month.add(d.key.slice(5, 7));
    } else if (d.kind === 'day_month') {
      sets.dayMonth.add(d.key.slice(2));
      sets.month.add(d.key.slice(2, 4));
    } else if (d.kind === 'month_year') {
      sets.monthYear.add(d.key);
      sets.month.add(d.key.slice(5, 7));
    } else {
      sets.month.add(d.key.slice(2));
    }
  }
  return sets;
}

function inSets(d: FoundDate, sets: DateSets): boolean {
  switch (d.kind) {
    case 'full':
      return sets.full.has(d.key);
    case 'day_month':
      return sets.dayMonth.has(d.key.slice(2));
    case 'month_year':
      return sets.monthYear.has(d.key);
    case 'month':
      return sets.month.has(d.key.slice(2));
  }
}

/** "(Verified, checked 2026-11-20)" / "last checked on 24 Nov 2026": the fetch date named as a fetch date. */
const CHECKED_BEFORE = /\b(checked|fetched|retrieved|accessed|updated|as of|verified on)( on)?:?\s*$/;

function namedAsCheckDate(answer: string, d: FoundDate): boolean {
  return CHECKED_BEFORE.test(answer.slice(Math.max(0, d.index - 40), d.index).toLowerCase());
}

/**
 * Dates in `answer` that match no date in the row values. Empty array = OK.
 * There is deliberately no `question` input: a date the student typed is not evidence.
 */
export function unsupportedDates(answer: string, rows: ChatRow[]): string[] {
  const known = dateSets(findDates(valueCorpus(rows), { bareMonths: 'any' }));
  const fetched = dateSets(findDates(fetchedCorpus(rows)));
  const bad = findDates(answer).filter((d) => !inSets(d, known) && !(inSets(d, fetched) && namedAsCheckDate(answer, d)));
  return [...new Set(bad.map((d) => d.text))];
}

/** Numbers in `answer` that appear in no row and not in the question. Empty array = OK. */
export function unsupportedNumbers(answer: string, rows: ChatRow[], question = ''): string[] {
  const allowed = new Set(numberTokens(corpusOf(rows, question)));
  const bad = numberTokens(stripListMarkers(answer)).filter((n) => !allowed.has(n));
  return [...new Set(bad)];
}

/** Everything the model wrote that the rows do not support (numbers, then dates). */
export function unsupportedFacts(answer: string, rows: ChatRow[], question = ''): string[] {
  return [...unsupportedNumbers(answer, rows, question), ...unsupportedDates(answer, rows)];
}
