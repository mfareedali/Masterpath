/**
 * Deterministic parser for Coventry University postgraduate course pages
 * (https://www.coventry.ac.uk/course-structure/pg/<school>/<course>/). The pages share one layout, so every value is
 * read with a fixed pattern and carries the exact page text it came from. Nothing is guessed: a missing block gives
 * null for that fact.
 */

export interface ParsedFact<T> {
  value: T;
  /** Text copied from the page (lines joined by one space). Must appear verbatim in the page text. */
  evidence_snippet: string;
}

export interface CoventryCourse {
  title: string | null;
  intake: ParsedFact<string> | null;
  duration_months: ParsedFact<number> | null;
  entry_requirement: ParsedFact<string> | null;
  language_req: ParsedFact<{ ielts_overall: number; text: string }> | null;
  tuition_international: ParsedFact<{ amount: number; currency: 'GBP'; period: 'year' }> | null;
}

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';

function lines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** The lines after `label` while they look like "<Month> <year>". */
function startDates(ls: string[]): string[] {
  const i = ls.findIndex((l) => l === 'Start date');
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of ls.slice(i + 1)) {
    if (new RegExp(`^(${MONTHS}) 20\\d\\d$`).test(l)) out.push(l);
    else break;
  }
  return out;
}

export function parseCoventryCourse(text: string): CoventryCourse {
  const ls = lines(text);
  const joined = ls.join(' ');

  const dates = startDates(ls);
  const intake = dates.length ? { value: dates.join(', '), evidence_snippet: `Start date ${dates.join(' ')}` } : null;

  const dur = /\bDuration (1 year full-time)\b/.exec(joined);
  const duration_months = dur ? { value: 12, evidence_snippet: `Duration ${dur[1]}` } : null;

  const entryLine = ls.find((l) => /^An honours degree 2:[12] or above/.test(l) || /^An honours degree .* or above/.test(l));
  const entry_requirement = entryLine ? { value: entryLine, evidence_snippet: entryLine } : null;

  const ie = /IELTS: (\d(?:\.5)?) overall, with no component lower than (\d(?:\.5)?)/.exec(joined);
  const language_req = ie
    ? { value: { ielts_overall: Number(ie[1]), text: ie[0] }, evidence_snippet: ie[0] }
    : null;

  const fee = /International (£([\d,]+) per year)/.exec(joined);
  const tuition_international = fee
    ? { value: { amount: Number(fee[2].replace(/,/g, '')), currency: 'GBP' as const, period: 'year' as const }, evidence_snippet: `International ${fee[1]}` }
    : null;

  const title = ls.find((l) => /\bMSc$/.test(l)) ?? null;
  return { title, intake, duration_months, entry_requirement, language_req, tuition_international };
}
