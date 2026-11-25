/**
 * Consultant Check — claim extraction. Pure TypeScript, regex + keywords, NO AI, no I/O.
 *
 * Splits what an agent/consultant told the student into short claims, classifies each one, pulls out the
 * numbers it states (money, durations, dates, CGPA) and attaches the institution / programme / country it
 * refers to (same clause, else same sentence, else the whole text).
 *
 * Extraction only READS the student's text. It never adds a real-world fact.
 */
import type { CountryCode, Institution, Money, Program, StudentScale } from '../types';
import { buildAliasPatterns, findCountries, findInstitutions, normalizeText, stripMarks, type AliasPattern } from './aliases';

export const MAX_INPUT_CHARS = 2000;
export const MAX_CLAIMS = 20;

export type ClaimType =
  | 'guaranteed_admission'
  | 'no_language_test'
  | 'language_score'
  | 'tests'
  | 'gpa_requirement'
  | 'total_cost'
  | 'tuition'
  | 'deadline'
  | 'scholarship_guaranteed'
  | 'visa_guaranteed'
  | 'visa_money'
  | 'pr_or_citizenship_time'
  | 'work_rights'
  | 'recognition'
  | 'institution_mention'
  | 'other';

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  guaranteed_admission: 'Admission promise',
  no_language_test: 'English test',
  language_score: 'English test score',
  tests: 'GRE / GMAT',
  visa_money: 'Visa money',
  gpa_requirement: 'CGPA',
  total_cost: 'Total cost',
  tuition: 'Tuition fee',
  deadline: 'Deadline',
  scholarship_guaranteed: 'Scholarship promise',
  visa_guaranteed: 'Visa promise',
  pr_or_citizenship_time: 'PR / citizenship',
  work_rights: 'Work rights',
  recognition: 'Recognition',
  institution_mention: 'University named',
  other: 'Other claim',
};

export interface ClaimedMoney {
  amount: number;
  /** ISO-4217 code, or null when the claim gives no currency (e.g. "tuition is free"). */
  currency: string | null;
  period: Money['period'] | null;
  raw: string;
}

export interface ClaimedDate {
  year: number | null;
  month: number | null;
  day: number | null;
  raw: string;
}

export interface Claim {
  id: string;
  /** The clause as the student wrote it (personal numbers removed). */
  text: string;
  /** The full sentence the clause came from. */
  sentence: string;
  type: ClaimType;
  institutionIds: string[];
  programIds: string[];
  countries: CountryCode[];
  /** Where the institution context came from. */
  contextFrom: 'clause' | 'sentence' | 'text' | 'none';
  money?: ClaimedMoney;
  /** Duration stated for PR / citizenship / post-study work, in months. */
  months?: number | null;
  subject?: 'pr' | 'citizenship';
  workKind?: 'post_study' | 'during_study';
  gpa?: { value: number; scale: StudentScale } | null;
  gpaMode?: 'accepts' | 'minimum';
  lowGpa?: boolean;
  date?: ClaimedDate | null;
  dateRole?: 'deadline' | 'intake' | 'urgency';
  /** "IELTS" / "TOEFL" / "Duolingo" / "an English test" for English claims; "GRE" / "GMAT" for 'tests' claims. */
  test?: string;
  /** The overall English test score a 'language_score' claim states (IELTS band, or TOEFL iBT score). */
  score?: number | null;
  /** 'minimum': "requires IELTS 6.5"; 'accepts': "IELTS 5.5 is enough". */
  scoreMode?: 'accepts' | 'minimum';
  /** Visa money claims: 'none' = "no bank statement needed"; 'amount' = "show only 10 lakh". */
  fundsKind?: 'none' | 'amount';
  /** What the visa money claim is about: a German-style blocked account, or proof of money in general. */
  fundsItem?: 'blocked_account' | 'general';
  recognitionKind?: 'hec' | 'anabin' | 'listed' | 'ranked';
  anabinMarker?: string | null;
}

export interface ExtractData {
  institutions: readonly Institution[];
  programs: readonly Program[];
}

/* ------------------------------------------------------------------ */
/* Personal data                                                       */
/* ------------------------------------------------------------------ */

/**
 * Removes things that look like ID numbers, passport numbers, phone numbers and emails.
 * MastersPath never needs them. Idempotent (placeholders contain no digits).
 */
export function redactPersonalNumbers(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email removed]')
    .replace(/\b\d{5}-?\d{7}-?\d\b/g, '[ID number removed]')
    .replace(/\b[A-Z]{1,2}\d{6,8}\b/g, '[ID number removed]')
    .replace(/(\+|00)?\b92[-\s]?3\d{2}[-\s]?\d{7}\b/g, '[phone number removed]')
    .replace(/\b03\d{2}[-\s]?\d{7}\b/g, '[phone number removed]')
    .replace(/\b\d{10,}\b/g, '[number removed]');
}

/** Trim, remove personal numbers and cap the length. Use on every raw input before extraction. */
export function cleanInput(raw: string | null | undefined): string {
  if (!raw) return '';
  return redactPersonalNumbers(raw.replace(/\r\n?/g, '\n'))
    .slice(0, MAX_INPUT_CHARS)
    .trim();
}

/* ------------------------------------------------------------------ */
/* Splitting                                                           */
/* ------------------------------------------------------------------ */

const DOT = '․'; // placeholder for dots inside abbreviations ("Rs.", "U.K.")
const ABBREV = /\b(rs|dr|mr|mrs|ms|prof|approx|no|vs|etc|st|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|u\.k|u\.s|u\.s\.a|e\.g|i\.e)\./gi;

/** Sentences: split on line breaks, bullets and sentence punctuation (never on decimal points like "1.2 crore"). */
export function splitSentences(text: string): string[] {
  const protectedText = text.replace(ABBREV, (m) => m.replace(/\./g, DOT));
  const out: string[] = [];
  for (const line of protectedText.split(/\n+|[•●▪◦]+/)) {
    const stripped = line.replace(/^\s*(?:[-*–]|\d{1,2}[.)])\s+/, '');
    for (const s of stripped.split(/(?<=[.!?])\s+|[!?]+/)) {
      const t = s.replace(/[.\s]+$/, '').replace(new RegExp(DOT, 'g'), '.').trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/** Clauses: split on ";" and on commas that are not inside a number ("25,00,000" stays whole). */
export function splitClauses(sentence: string): string[] {
  return sentence
    .split(/\s*;\s*|(?<!\d),\s*|,(?!\d)\s*/)
    .map((c) => c.trim())
    .filter(Boolean);
}

const CONJUNCTION = /\s+(?:and|&|plus|also|but|aur|then)\s+/i;

/** Split a clause on "and"/"plus"... only when every part carries its own claim. */
function refineClause(clause: string): string[] {
  const parts = clause.split(CONJUNCTION).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return [clause];
  // "1 crore aur 20 lakh" is one amount, not two claims.
  const money = parseMoney(clause);
  if (money && CONJUNCTION.test(` ${money.raw} `)) return [clause];
  const typed = parts.map((p) => detectTypes(p).length > 0);
  return typed.every(Boolean) ? parts : [clause];
}

/* ------------------------------------------------------------------ */
/* Number parsing                                                      */
/* ------------------------------------------------------------------ */

const WORD_NUM: Record<string, number> = {
  half: 0.5,
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
  twenty: 20,
  'twenty-four': 24,
};

/** First duration in the text, in months ("2 years" -> 24, "18 months" -> 18, "two saal" -> 24). */
export function parseDurationMonths(text: string): number | null {
  const n = normalizeText(text);
  const re = new RegExp(
    String.raw`(?<![a-z0-9.])(\d+(?:\.\d+)?|${Object.keys(WORD_NUM).join('|')})(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?\s*(?:\+\s*)?(years?|yrs?|saal|sal|months?|mahine|mahiney|maheene)(?![a-z])`,
  );
  const m = n.match(re);
  if (!m) return null;
  const num = WORD_NUM[m[1]] ?? Number.parseFloat(m[1]);
  if (!Number.isFinite(num) || num <= 0) return null;
  const unit = m[2];
  const months = /^(month|mahine|mahiney|maheene)/.test(unit) ? num : num * 12;
  return Math.round(months * 10) / 10;
}

const NUM = String.raw`(\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const MULT = String.raw`(k|thousand|m|million|mn|lakh|lakhs|lac|lacs|lacks|crore|crores|cr|hazaar|hazar)?`;

const CURRENCY_WORDS: { re: RegExp; code: string }[] = [
  { re: /^(€|eur|euro|euros)$/, code: 'EUR' },
  { re: /^(£|gbp|pound|pounds)$/, code: 'GBP' },
  { re: /^(cad|c\$|ca\$|canadian dollars?)$/, code: 'CAD' },
  { re: /^(usd|us\$|us dollars?)$/, code: 'USD' },
  { re: /^(\$|dollar|dollars)$/, code: '$' },
  { re: /^(chf|sfr|swiss francs?|francs?)$/, code: 'CHF' },
  { re: /^(rs|rs\.|pkr|rupee|rupees)$/, code: 'PKR' },
];
const CUR = String.raw`(€|£|\$|eur|euros?|gbp|pounds?|cad|c\$|ca\$|canadian dollars?|usd|us\$|us dollars?|dollars?|chf|sfr|swiss francs?|francs?|rs\.?|pkr|rupees?)`;

function currencyCode(word: string): string | null {
  const w = word.trim();
  for (const c of CURRENCY_WORDS) if (c.re.test(w)) return c.code;
  return null;
}

function parseNumber(raw: string, currency: string | null): number {
  // "12.000 €" (European thousands separator)
  if (/^\d{1,3}(\.\d{3})+$/.test(raw) && (currency === 'EUR' || currency === 'CHF')) {
    return Number.parseFloat(raw.replace(/\./g, ''));
  }
  return Number.parseFloat(raw.replace(/,/g, ''));
}

function multiplier(word: string | undefined): { factor: number; pkr: boolean } {
  switch (word) {
    case 'k':
    case 'thousand':
      return { factor: 1e3, pkr: false };
    case 'm':
    case 'mn':
    case 'million':
      return { factor: 1e6, pkr: false };
    case 'lakh':
    case 'lakhs':
    case 'lac':
    case 'lacs':
    case 'lacks':
      return { factor: 1e5, pkr: true };
    case 'crore':
    case 'crores':
    case 'cr':
      return { factor: 1e7, pkr: true };
    case 'hazar':
    case 'hazaar':
      return { factor: 1e3, pkr: true };
    default:
      return { factor: 1, pkr: false };
  }
}

export function parsePeriod(text: string): Money['period'] | null {
  const n = normalizeText(text);
  if (/per (year|annum)|a year|each year|every year|\/\s?(year|yr|annum|a)\b|yearly|annual(ly)?|per saal|saalana|salana|p\.a\./.test(n)) return 'year';
  if (/per semester|a semester|each semester|\/\s?semester|semester fee/.test(n)) return 'semester';
  if (/per month|a month|each month|monthly|\/\s?(month|mo)\b|mahana/.test(n)) return 'month';
  if (/total|overall|whole|complete|entire|all[- ]?in(clusive)?|in all|everything|full (degree|program|programme|course)|including|with living|sab kuch|sab mila (ke|kar)/.test(n)) return 'total';
  return null;
}

/** A smaller Pakistani unit right after an amount: "1 crore [aur] 20 lakh", "2 lakh 50 hazar". */
const PKR_CONTINUATION = new RegExp(
  String.raw`^\s*(?:,|\+|&|and|aur)?\s*${NUM}\s*(lakh|lakhs|lac|lacs|lacks|hazaar|hazar|thousand)(?![a-z])`,
);

/**
 * Adds the smaller units that follow a crore / lakh amount ("1 crore 20 lakh" = 12,000,000). Each next unit must be
 * smaller than the one before, so "20 lakh 30 lakh" is never added up. Returns the extra amount and the new end.
 */
function pkrContinuation(n: string, end: number, factor: number): { extra: number; end: number } {
  let extra = 0;
  let pos = end;
  let last = factor;
  for (;;) {
    const m = n.slice(pos).match(PKR_CONTINUATION);
    if (!m) break;
    const f = multiplier(m[2]).factor;
    if (f >= last) break;
    extra += Number.parseFloat(m[1].replace(/,/g, '')) * f;
    pos += m[0].length;
    last = f;
  }
  return { extra, end: pos };
}

/**
 * First money amount in the text. "25 lakh" -> PKR 2,500,000; "1.2 crore" -> PKR 12,000,000;
 * "1 crore 20 lakh" -> PKR 12,000,000; "2 lakh 50 hazar" -> PKR 250,000; "50 hazar" -> PKR 50,000;
 * "£15,000" -> GBP 15,000; "€12k" -> EUR 12,000. A bare "$" is CAD when the claim is about Canada, else USD.
 */
export function parseMoney(text: string, countries: readonly CountryCode[] = []): ClaimedMoney | null {
  const n = normalizeText(text);
  const dollar = countries.length === 1 && countries[0] === 'CA' ? 'CAD' : 'USD';
  const candidates: { at: number; end: number; amount: number; currency: string; raw: string; factor: number; pkrUnit: boolean }[] = [];

  const prefix = new RegExp(String.raw`(?<![a-z])${CUR}\s?${NUM}\s*${MULT}(?![a-z])`, 'g');
  for (const m of n.matchAll(prefix)) {
    const cur = currencyCode(m[1]);
    if (!cur) continue;
    const mult = multiplier(m[3]);
    const code = mult.pkr ? 'PKR' : cur;
    const at = m.index ?? 0;
    candidates.push({
      at,
      end: at + m[0].length,
      amount: parseNumber(m[2], code) * mult.factor,
      currency: code,
      raw: m[0],
      factor: mult.factor,
      pkrUnit: mult.pkr,
    });
  }
  const suffix = new RegExp(String.raw`(?<![\d.,])${NUM}\s*${MULT}\s*${CUR}?(?![a-z])`, 'g');
  for (const m of n.matchAll(suffix)) {
    const mult = multiplier(m[2]);
    const cur = m[3] ? currencyCode(m[3]) : null;
    if (!mult.pkr && !cur) continue; // a bare number is not money
    const code = mult.pkr ? 'PKR' : (cur as string);
    const at = m.index ?? 0;
    candidates.push({
      at,
      end: at + m[0].length,
      amount: parseNumber(m[1], code) * mult.factor,
      currency: code,
      raw: m[0].trim(),
      factor: mult.factor,
      pkrUnit: mult.pkr,
    });
  }
  if (candidates.length === 0) return null;
  // Earliest match; for the same start prefer the longer (more specific) one.
  candidates.sort((a, b) => a.at - b.at || b.raw.length - a.raw.length);
  const best = { ...candidates[0] };
  if (best.currency === 'PKR' && best.pkrUnit && best.factor > 1e3) {
    const more = pkrContinuation(n, best.end, best.factor);
    if (more.extra > 0) {
      best.amount += more.extra;
      best.raw = n.slice(best.at, more.end).trim();
    }
  }
  if (!Number.isFinite(best.amount) || best.amount < 0) return null;
  return {
    amount: Math.round(best.amount * 100) / 100,
    currency: best.currency === '$' ? dollar : best.currency,
    period: parsePeriod(text),
    raw: best.raw,
  };
}

const MONTHS: [RegExp, number][] = [
  [/^jan(uary)?$/, 1],
  [/^feb(ruary)?$/, 2],
  [/^mar(ch)?$/, 3],
  [/^apr(il)?$/, 4],
  [/^may$/, 5],
  [/^june?$/, 6],
  [/^july?$/, 7],
  [/^aug(ust)?$/, 8],
  [/^sep(t(ember)?)?$/, 9],
  [/^oct(ober)?$/, 10],
  [/^nov(ember)?$/, 11],
  [/^dec(ember)?$/, 12],
];
const MONTH_RE = String.raw`(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)`;

function monthNumber(word: string): number | null {
  for (const [re, n] of MONTHS) if (re.test(word)) return n;
  return null;
}

function validDay(d: number | null, m: number | null): boolean {
  return d == null || (d >= 1 && d <= 31 && m != null);
}

/** First date in the text: "15 March 2027", "March 15", "2027-03-15", "15/03/2027" (day first), "March 2027". */
export function parseDate(text: string): ClaimedDate | null {
  const n = normalizeText(text);
  const mk = (y: number | null, m: number | null, d: number | null, raw: string): ClaimedDate | null =>
    m != null && m >= 1 && m <= 12 && validDay(d, m) ? { year: y, month: m, day: d, raw } : null;

  let m = n.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return mk(+m[1], +m[2], +m[3], m[0]);

  m = n.match(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:of\s+)?${MONTH_RE}\.?,?\s*(20\d{2})?\b`));
  if (m) return mk(m[3] ? +m[3] : null, monthNumber(m[2]), +m[1], m[0].trim());

  m = n.match(new RegExp(String.raw`\b${MONTH_RE}\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(20\d{2}))?`));
  if (m) return mk(m[3] ? +m[3] : null, monthNumber(m[1]), +m[2], m[0].trim());

  m = n.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return mk(y, +m[2], +m[1], m[0]);
  }

  m = n.match(new RegExp(String.raw`\b${MONTH_RE}\.?,?\s+(20\d{2})\b`));
  if (m) return mk(+m[2], monthNumber(m[1]), null, m[0]);

  m = n.match(new RegExp(String.raw`\b(?:in|by|before|until|till|end of|from)\s+${MONTH_RE}\b`));
  if (m) return mk(null, monthNumber(m[1]), null, m[0]);

  return null;
}

/** CGPA stated in the text ("2.5 CGPA", "CGPA of 2.8/4", "60% marks"). */
export function parseGpa(text: string): { value: number; scale: StudentScale } | null {
  const n = normalizeText(text);
  let m = n.match(/(?<![\d.])(\d(?:\.\d{1,2})?)\s*(?:\/\s*([45])(?:\.0+)?|out of\s*([45])(?:\.0+)?)?\s*(?:c\.?gpa|gpa)\b/);
  // "CGPA of 2.8", "CGPA required is 2.8/4": a few words may sit between the word and the number.
  if (!m) m = n.match(/\b(?:c\.?gpa|gpa)\b[^\d.%]{0,30}?(\d(?:\.\d{1,2})?)(?!\d)(?:\s*(?:\/|out of)\s*([45])(?:\.0+)?)?/);
  if (m) {
    const value = Number.parseFloat(m[1]);
    const max = m[2] ?? m[3];
    const scale: StudentScale = max === '5' || (!max && value > 4) ? 'cgpa_5' : 'cgpa_4';
    if (Number.isFinite(value) && value >= 0 && value <= (scale === 'cgpa_5' ? 5 : 4)) return { value, scale };
    return null;
  }
  // "60% marks", "percentage of 60%", "percentage required is 60%".
  m = n.match(/(?<![\d.])(\d{2}(?:\.\d+)?)\s*(?:%|percent)\s*(?:marks|percentage|aggregate|grade)|(?:marks|percentage|aggregate)[^\d%.]{0,25}?(?<![\d.])(\d{2}(?:\.\d+)?)\s*(?:%|percent)/);
  if (m) {
    const value = Number.parseFloat(m[1] ?? m[2]);
    if (Number.isFinite(value) && value <= 100) return { value, scale: 'percent' };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

type Detected = Omit<Claim, 'id' | 'text' | 'sentence' | 'institutionIds' | 'programIds' | 'countries' | 'contextFrom'>;

const GUARANTEE =
  /guarantee\w*|100\s?%|hundred percent|(?<!make )\bsure\b|\bconfirm(ed)?\b|pakk[ai]|definitely|certain(ly)?|assured|no (refusal|rejection)|never (refused|rejected)|will (surely |definitely )?get|will give (you )?(an? )?(admission|offer|seat)|milega|milegi|mil jaye(ga|gi)|success (rate|ratio)/;
const ADMISSION = /admission|admit(ted)?|offer( letter)?|\bseats?\b|acceptance|\baccepted\b|\bplace\b|get in\b|enrol(l)?ment|unconditional/;
const SCHOLARSHIP = /scholarship|fee waiver|tuition waiver|funding|fully funded|bursary|stipend|financial aid/;
const SCHOLARSHIP_PROMISE = /guarantee\w*|100\s?%|(?<!make )\bsure\b|\bconfirm(ed)?\b|pakk[ai]|definitely|fully funded|full scholarship|will (surely |definitely )?get|milegi|mil jaye(gi|ga)|automatic(ally)?|assured/;
const LANG_TEST =
  /(ielts|toefl|pte|duolingo|english (language )?(test|proficiency|requirement|certificate)|language (test|requirement|proficiency))/;
const NO_LANG = [
  new RegExp(String.raw`\b(no|without|skip|zero|bina)\s+(any\s+|an?\s+|the\s+)?(need (of|for)\s+)?${LANG_TEST.source}`),
  new RegExp(String.raw`\bno need (of|for|to (give|take|do))\s+(an?\s+|the\s+)?${LANG_TEST.source}`),
  new RegExp(String.raw`${LANG_TEST.source}\s+(is\s+|are\s+)?(not|nahi|nahin|nai)\s+(required|needed|necessary|mandatory|compulsory|zaroori|zaruri)`),
  new RegExp(String.raw`${LANG_TEST.source}\s+(is\s+)?(waiv(ed|er)|exempt(ed|ion)?|optional|free|not required|not needed)`),
  new RegExp(String.raw`(waiv(e|ed|er)|exempt(ion|ed)?)\s+(of|from|for|on)?\s*(the\s+)?${LANG_TEST.source}`),
  new RegExp(String.raw`(do ?n[o']?t|dont|won'?t|will not|never) (need|require|have to (give|take|do|pass))\s+(an?\s+|the\s+|any\s+)?${LANG_TEST.source}`),
  new RegExp(String.raw`${LANG_TEST.source}.{0,20}(zaroorat|zarurat|zarorat|zaroori|zaruri)\s*(nahi|nahin|nai)`),
  /\b(moi|medium of instruction)( letter| certificate)?\b.{0,30}(instead|accepted|enough|works|valid)/,
];

const PR_SUBJECT = /permanent residen(ce|cy|t)|\bsettlement\b|settled status|indefinite leave|\bilr\b|green ?card|niederlassungserlaubnis|\bp\.r\.?(?![a-z])/;
const CITIZEN_SUBJECT = /citizenship|\bcitizen\b|nationality|naturali[sz]ation|passport/;

const POST_STUDY =
  /post[- ]?study|\bpsw\b|stay[- ]?back|graduate (route|visa)|stem opt|\bpgwp\b|post[- ]?graduat(e|ion) work|work permit after|job seeker|after (graduation|graduating|your studies|study|studies|degree|the degree).{0,30}(work|job|stay)|(work|job|stay).{0,25}after (graduation|graduating|your studies|study|studies|your degree|the degree)/;
const DURING_STUDY =
  /unlimited (work(ing)? )?hours|work (full[- ]?time|unlimited)|full[- ]?time (work|job)s?|\d+\s*hours?\s*(a|per|\/|every)?\s*week|work while (you )?(study|studying)|part[- ]?time (job|work)s? (easily|guaranteed|available|easy)|no limit on work/;

const COST_EXCLUDE = /bank statement|statement|\bfunds?\b|show money|deposit|maintenance|proof|blocked account|sperrkonto|agent fee|service fee|processing fee|consultancy fee|consultant fee|our fee|registration fee|application fee|salary|\bearn(ing|s)?\b|income|\bjob\b|stipend|pays? you/;

function detectLanguage(n: string): Detected | null {
  if (!NO_LANG.some((re) => re.test(n))) return null;
  const t = n.match(/ielts|toefl|pte|duolingo/);
  const test = t ? (t[0] === 'duolingo' ? 'Duolingo' : t[0].toUpperCase()) : 'an English test';
  return { type: 'no_language_test', test };
}

/** A number that is a CGPA, a percentage or an amount, not a test score ("IELTS waiver with 2.5 CGPA"). */
const NOT_A_SCORE = String.raw`(?!\s*(?:\/\s*[45]|out of|c\.?gpa|gpa|%|percent|lakh|lac|crore|years?|months?))`;
const IELTS_SCORE = [
  new RegExp(String.raw`\bielts\b[^\d\n]{0,25}?(?<![\d.])(\d(?:\.\d)?)(?![\d.])${NOT_A_SCORE}`),
  new RegExp(String.raw`(?<![\d.])(\d(?:\.\d)?)\s*(?:bands?\s*)?(?:overall\s*)?(?:in\s+|on\s+)?ielts\b`),
];
const TOEFL_SCORE = [
  new RegExp(String.raw`\btoefl\b[^\d\n]{0,25}?(?<![\d.])(\d{1,3}(?:\.\d)?)(?![\d.])${NOT_A_SCORE}`),
  new RegExp(String.raw`(?<![\d.])(\d{2,3})\s*(?:in\s+|on\s+)?toefl\b`),
];
const SCORE_ACCEPTS = /enough|\bok\b|okay|\bfine\b|accept\w*|chal(ega|e ga| jayega| jaye ga)|kaafi|\bkafi\b|sufficient|\bonly\b|\bjust\b|\bsirf\b|\bbas\b|\bwith\b|\bworks?\b|eligible/;
const SCORE_MINIMUM = /minimum|\bmin\.?\b|required|requirement|requires?\b|at least|\bneed(ed|s)?\b|\bmust\b/;

function firstScore(n: string, res: RegExp[]): number | null {
  for (const re of res) {
    const m = n.match(re);
    if (m) return Number.parseFloat(m[1]);
  }
  return null;
}

/**
 * "IELTS 5.5 is enough", "Brookes requires IELTS 5.5 only", "TOEFL 70 chalega": a claimed overall score.
 * Only bands 1–9 in steps of 0.5 count for IELTS; TOEFL iBT 1–120 (old scale) or 1–6 (new scale).
 */
function detectLanguageScore(n: string): Detected | null {
  const accepts = SCORE_ACCEPTS.test(n);
  if (!accepts && !SCORE_MINIMUM.test(n)) return null;
  const ielts = firstScore(n, IELTS_SCORE);
  if (ielts != null && ielts >= 1 && ielts <= 9 && Number.isInteger(ielts * 2)) {
    return { type: 'language_score', test: 'IELTS', score: ielts, scoreMode: accepts ? 'accepts' : 'minimum' };
  }
  const toefl = firstScore(n, TOEFL_SCORE);
  if (toefl != null && toefl >= 1 && ((toefl <= 6 && Number.isInteger(toefl * 2)) || (toefl <= 120 && Number.isInteger(toefl)))) {
    return { type: 'language_score', test: 'TOEFL', score: toefl, scoreMode: accepts ? 'accepts' : 'minimum' };
  }
  return null;
}

const ADMISSION_TEST = String.raw`(gre|gmat)`;
const NO_ADMISSION_TEST = [
  new RegExp(String.raw`\b(no|without|skip|zero|bina)\s+(any\s+|an?\s+|the\s+)?(need (of|for)\s+)?${ADMISSION_TEST}\b`),
  new RegExp(String.raw`\bno need (of|for|to (give|take|do|submit))\s+(an?\s+|the\s+)?${ADMISSION_TEST}\b`),
  new RegExp(
    String.raw`\b${ADMISSION_TEST}\b(\s+\(?general\)?)?(\s+(test|tests|exam|score|scores))?\s+(is\s+|are\s+)?(not|nahi|nahin|nai)\s+(required|needed|necessary|mandatory|compulsory|zaroori|zaruri|chahiye)`,
  ),
  new RegExp(String.raw`\b${ADMISSION_TEST}\b.{0,20}\b(waiv(ed|er)|exempt(ed|ion)?|optional|not required|not needed|not necessary)`),
  new RegExp(String.raw`\b(waiv(e|ed|er)|exempt(ion|ed)?)\s+(of|from|for|on)?\s*(the\s+)?${ADMISSION_TEST}\b`),
  new RegExp(String.raw`\b(do(es)? ?n[o']?t|dont|doesnt|won'?t|will not|never) (need|require|ask for|have to (give|take|do|submit))\s+(an?\s+|the\s+|any\s+)?${ADMISSION_TEST}\b`),
  new RegExp(String.raw`\b${ADMISSION_TEST}\b.{0,20}(zaroorat|zarurat|zarorat|zaroori|zaruri)\s*(nahi|nahin|nai)`),
  new RegExp(String.raw`\b${ADMISSION_TEST}\b.{0,20}\b(nahi|nahin|nai) chahiye`),
];

/** "No GRE needed", "GRE is waived", "does not require GRE": a claim that an admission test is not needed. */
function detectAdmissionTest(n: string): Detected | null {
  if (!NO_ADMISSION_TEST.some((re) => re.test(n))) return null;
  const t = n.match(/\b(gre|gmat)\b/);
  return { type: 'tests', test: t?.[1] === 'gmat' ? 'GMAT' : 'GRE' };
}

const FUNDS =
  /bank statements?|bank balance|blocked account|sperrkonto|proof of (funds|money)|funds? proof|financial (proof|evidence|documents?)|maintenance (funds|money)|show(ing)? (money|funds|balance)|\bfunds\b/;
/** The same words without a bare "funds" (which, next to "scholarship", is about the scholarship, not the visa). */
const FUNDS_SPECIFIC = new RegExp(FUNDS.source.replace(/\|\\bfunds\\b$/, ''));
/** "show 10 lakh", "10 lakh dikhana hai"; not "we will show you". */
const SHOW_MONEY = /\bshow\b(?!\s+(you|me|him|her|them|us)\b)|\bdikha(na|ni|o|ne|en|yen)?\b/;
const FUNDS_SRC = FUNDS.source;
const NO_FUNDS = [
  new RegExp(String.raw`\b(no|without|bina|skip)\s+(any\s+|a\s+|the\s+)?(need (of|for)\s+)?(${FUNDS_SRC})`),
  /\bno need (of|for|to (show|open|give|submit|provide))\b/,
  new RegExp(String.raw`(${FUNDS_SRC}).{0,25}\b(not (needed|required|necessary|mandatory|compulsory)|nahi|nahin|nai)\b`),
  new RegExp(String.raw`\b(do(es)? ?n[o']?t|dont|doesnt|won'?t|will not|never) (need|require|ask for|have to (show|open|give|submit|provide))\b.{0,20}(${FUNDS_SRC})`),
];

/**
 * Money the student must show for the student visa: "no bank statement needed", "show only 10 lakh",
 * "no blocked account for Germany". Not a programme cost.
 */
function detectVisaMoney(n: string, raw: string): Detected | null {
  const funds = SCHOLARSHIP.test(n) ? FUNDS_SPECIFIC.test(n) : FUNDS.test(n);
  const money = parseMoney(raw);
  if (!funds && !(SHOW_MONEY.test(n) && money)) return null;
  const fundsItem = /blocked account|sperrkonto/.test(n) ? 'blocked_account' : 'general';
  if (funds && NO_FUNDS.some((re) => re.test(n))) return { type: 'visa_money', fundsKind: 'none', fundsItem };
  if (money) return { type: 'visa_money', fundsKind: 'amount', fundsItem, money };
  return null;
}

function detectMoney(n: string, raw: string): Detected | null {
  const free =
    /(tuition|fees?)\s+(is\s+|are\s+)?(totally\s+|completely\s+)?(free|zero|nil|waived|nothing)|free (tuition|education|study|studies)|no tuition( fees?)?|tuition[- ]free|zero (tuition|fees?)/.test(n);
  if (free && !SCHOLARSHIP.test(n.replace(/fee waiver|tuition waiver/, ''))) {
    return { type: 'tuition', money: { amount: 0, currency: null, period: null, raw: 'free' } };
  }
  if (SCHOLARSHIP.test(n) || COST_EXCLUDE.test(n)) return null;
  const money = parseMoney(raw);
  if (!money) return null;
  const tuitionOnly = /tuition/.test(n) || (/\bfees?\b/.test(n) && !/living|everything|all[- ]?in|including|expenses?|total cost|overall|cost of living/.test(n));
  return { type: tuitionOnly ? 'tuition' : 'total_cost', money };
}

function detectDeadline(n: string, raw: string): Detected | null {
  const urgency =
    /today only|only today|\bpay\b.{0,20}\btoday\b|only \d+ seats?|seats? (are |is )?(limited|filling|almost (full|gone)|left)|limited seats|last chance|\bhurry\b|before (it'?s|it is) too late|within \d+ (hours?|days?)|(deadline|last date) (is )?(tomorrow|today|this week|next week)/.test(n);
  const deadlineWords =
    /deadline|last date|closing date|\bapply (by|before|until|till)\b|applications? (close|closes|closing|due|end|ends)|\bsubmit (by|before)\b|due date|\bcloses?\b|\buntil\b|\btill\b/.test(n);
  const intakeWords = /intake|\bstarts?\b|starting|\bbegins?\b|beginning|commence|classes|session|semester (starts|begins)/.test(n);
  const date = parseDate(raw);
  if (date && (deadlineWords || (!intakeWords && /\b(by|before)\b/.test(n)))) return { type: 'deadline', date, dateRole: 'deadline' };
  if (date && intakeWords) return { type: 'deadline', date, dateRole: 'intake' };
  if (urgency) return { type: 'deadline', date: date ?? null, dateRole: 'urgency' };
  if (deadlineWords && /deadline|last date|closing date/.test(n)) return { type: 'deadline', date: null, dateRole: 'deadline' };
  return null;
}

function detectPr(n: string, raw: string): Detected | null {
  const cased = stripMarks(raw);
  const prCased = /(?<![A-Za-z])PR(?![A-Za-z])/.test(cased);
  // Lower-case "pr" is Roman Urdu for "on" ("par"), so it only counts right before a time phrase.
  const prLower = /\bpr\s+(in|after|within|mil|ka|milegi|milay|after\s+just)\b/.test(n);
  const isCitizen = CITIZEN_SUBJECT.test(n);
  const isPr = prCased || prLower || PR_SUBJECT.test(n);
  if (!isCitizen && !isPr) return null;
  return { type: 'pr_or_citizenship_time', subject: isCitizen ? 'citizenship' : 'pr', months: parseDurationMonths(raw) };
}

function detectWork(n: string, raw: string): Detected | null {
  const cased = stripMarks(raw);
  if (POST_STUDY.test(n) || /(?<![A-Za-z])OPT(?![A-Za-z])/.test(cased)) {
    return { type: 'work_rights', workKind: 'post_study', months: parseDurationMonths(raw) };
  }
  if (DURING_STUDY.test(n)) return { type: 'work_rights', workKind: 'during_study', months: null };
  return null;
}

function detectRecognition(n: string): Detected | null {
  if (/\bhec\b.{0,30}(recogni[sz]ed|recogni[sz]es|approved|attested|verified|accepted|listed|valid)|(recogni[sz]ed|approved|attested|accepted|listed|valid).{0,30}\bhec\b/.test(n)) {
    return { type: 'recognition', recognitionKind: 'hec' };
  }
  if (/\banabin\b|\bh\+/.test(n)) {
    const marker = n.match(/\bh\s?(\+\/-|\+-|\+|-)(?![a-z])/);
    return { type: 'recognition', recognitionKind: 'anabin', anabinMarker: marker ? `H${marker[1]}` : null };
  }
  if (/\b(ranked|ranking|rankings|top \d+|#\s?\d+|number one|no\.? ?1\b|world'?s best|qs (world )?rank\w*|times higher)/.test(n)) {
    return { type: 'recognition', recognitionKind: 'ranked' };
  }
  if (/accredit\w*|recogni[sz]ed|government[- ]approved|officially approved/.test(n)) {
    return { type: 'recognition', recognitionKind: 'listed' };
  }
  return null;
}

function detectGpa(n: string, raw: string): Detected | null {
  const hasGpaWord = /c\.?gpa|\bgpa\b|\bgrades?\b|marks|percentage|aggregate/.test(n);
  if (!hasGpaWord) return null;
  const lowGpa =
    /low (c\.?gpa|gpa|grades?|marks)|any (c\.?gpa|gpa|grades?)|(c\.?gpa|gpa|grades?) (does ?n[o']?t|doesnt|do ?n[o']?t) matter|no (c\.?gpa|gpa) (requirement|limit|issue|problem)|(c\.?gpa|gpa) (is )?not (important|required|an issue)|regardless of (c\.?gpa|gpa)|third division|(c\.?gpa|gpa) (koi )?masla nahi/.test(n);
  const gpa = parseGpa(raw);
  const accepts =
    /accept\w*|\bok\b|okay|fine|enough|eligible|allowed|no problem|chal(ega|e ga| jayega| jaye ga)|\bworks?\b|consider\w*|apply with|even with|with (only|just)|\bpass\b|\bcan apply\b|apply (to|at|for)\b.{0,40}\bwith\b|\bwith (a )?\d(\.\d{1,2})? ?(c\.?gpa|gpa)\b/.test(n);
  const minimum = /minimum|\bmin\.?\b|required|requirement|at least|\bneed(ed|s)?\b/.test(n);
  if (!gpa && !lowGpa) return null;
  if (gpa && !accepts && !minimum && !lowGpa) return null;
  return { type: 'gpa_requirement', gpa, lowGpa, gpaMode: minimum && !accepts ? 'minimum' : 'accepts' };
}

/** All claim types found in one clause, in a stable order. Exported for tests. */
export function detectTypes(clause: string): Detected[] {
  const n = normalizeText(clause);
  const out: Detected[] = [];

  const work = detectWork(n, clause);
  const strongPromise = /100\s?%|guarantee|\bsure\b|pakk[ai]/.test(n);
  // "Graduate visa 2 years" is a work-rights claim, not a visa promise.
  const visa = /\bvisa\b/.test(n) && GUARANTEE.test(n) && (work?.workKind !== 'post_study' || strongPromise);
  if (ADMISSION.test(n) && GUARANTEE.test(n)) out.push({ type: 'guaranteed_admission' });
  const lang = detectLanguage(n);
  if (lang) out.push(lang);
  const score = lang ? null : detectLanguageScore(n);
  if (score) out.push(score);
  const admissionTest = detectAdmissionTest(n);
  if (admissionTest) out.push(admissionTest);
  const gpa = detectGpa(n, clause);
  if (gpa) out.push(gpa);
  // Money to show for the visa is not a programme cost.
  const visaMoney = detectVisaMoney(n, clause);
  if (visaMoney) out.push(visaMoney);
  const money = visaMoney ? null : detectMoney(n, clause);
  if (money) out.push(money);
  const deadline = detectDeadline(n, clause);
  if (deadline) out.push(deadline);
  if (SCHOLARSHIP.test(n) && SCHOLARSHIP_PROMISE.test(n)) out.push({ type: 'scholarship_guaranteed' });
  if (visa) out.push({ type: 'visa_guaranteed' });
  const pr = detectPr(n, clause);
  if (pr) out.push(pr);
  if (work) out.push(work);
  const rec = detectRecognition(n);
  if (rec) out.push(rec);
  return out;
}

/* ------------------------------------------------------------------ */
/* Context: institution / programme / country                          */
/* ------------------------------------------------------------------ */

function programsFor(institutionIds: string[], programs: readonly Program[], scopeText: string): string[] {
  const n = normalizeText(scopeText);
  const ids: string[] = [];
  for (const instId of institutionIds) {
    const own = programs.filter((p) => p.institution_id === instId);
    // Narrow by programme name when the text names one ("MSc Informatics"), else keep all of the institution's programmes.
    const named = own.filter((p) => {
      const core = normalizeText(p.name).replace(/^(msc|ms|ma|meng|mphil|master of science|master of|masters?)( in)?\s+/, '').replace(/\s*\(.*\)$/, '');
      return core.length >= 4 && n.includes(core);
    });
    for (const p of named.length > 0 ? named : own) if (!ids.includes(p.id)) ids.push(p.id);
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

function wordCount(s: string): number {
  return (normalizeText(s).match(/[a-z0-9]+/g) ?? []).length;
}

/**
 * Extract claims from free text. `data` supplies institution names and programmes for context.
 * The input is cleaned (personal numbers removed, max 2,000 characters) before anything else happens.
 */
export function extractClaims(rawText: string, data: ExtractData, patterns?: AliasPattern[]): Claim[] {
  const text = cleanInput(rawText);
  if (!text) return [];
  const aliasPatterns = patterns ?? buildAliasPatterns(data.institutions);
  const instById = new Map(data.institutions.map((i) => [i.id, i]));

  const textInst = findInstitutions(text, aliasPatterns);
  const textCountries = findCountries(text);
  const textInstFor = (named: readonly CountryCode[]): string[] =>
    named.length ? textInst.filter((id) => named.includes(instById.get(id)?.country ?? '')) : textInst;

  const claims: Claim[] = [];
  const push = (c: Omit<Claim, 'id'>) => {
    if (claims.length >= MAX_CLAIMS) return;
    claims.push({ id: `c${claims.length + 1}`, ...c });
  };

  for (const sentence of splitSentences(text)) {
    const sentInst = findInstitutions(sentence, aliasPatterns);
    const sentCountries = findCountries(sentence);
    const clauses = splitClauses(sentence).flatMap(refineClause);

    const pending: { clause: string; detected: Detected[]; inst: string[]; countries: CountryCode[] }[] = clauses.map((clause) => ({
      clause,
      detected: detectTypes(clause),
      inst: findInstitutions(clause, aliasPatterns),
      countries: findCountries(clause),
    }));
    const sentenceHasTyped = pending.some((p) => p.detected.length > 0);

    for (const p of pending) {
      let institutionIds: string[];
      let contextFrom: Claim['contextFrom'];
      if (p.inst.length) {
        institutionIds = p.inst;
        contextFrom = 'clause';
      } else if (sentInst.length) {
        institutionIds = sentInst;
        contextFrom = 'sentence';
      } else if (textInst.length && textInstFor(p.countries.length ? p.countries : sentCountries).length) {
        // From the whole text: when this sentence names a country, only that country's universities
        // ("Germany blocked account ..." never borrows a UK university named elsewhere).
        institutionIds = textInstFor(p.countries.length ? p.countries : sentCountries);
        contextFrom = 'text';
      } else {
        institutionIds = [];
        contextFrom = 'none';
      }
      const scope = contextFrom === 'clause' ? p.clause : contextFrom === 'sentence' ? sentence : text;
      const instCountries = [...new Set(institutionIds.map((id) => instById.get(id)?.country).filter((c): c is CountryCode => !!c && c !== 'PK'))];
      // Country: named in the clause > of a university named in the clause > named in the sentence > of the university > whole text.
      const countries = p.countries.length
        ? p.countries
        : contextFrom === 'clause' && instCountries.length
          ? instCountries
          : sentCountries.length
            ? sentCountries
            : instCountries.length
              ? instCountries
              : textCountries;
      const base = {
        text: p.clause,
        sentence,
        institutionIds,
        programIds: programsFor(institutionIds, data.programs, scope),
        countries,
        contextFrom,
      };

      if (p.detected.length > 0) {
        for (const d of p.detected) {
          let fixed = d;
          if (fixed.money) {
            // A bare "$" is Canadian dollars when the claim is about Canada.
            const bareDollar = fixed.money.currency === 'USD' && !/usd|us\$|us dollar/.test(normalizeText(p.clause));
            if (bareDollar && countries.length === 1 && countries[0] === 'CA') fixed = { ...fixed, money: { ...fixed.money, currency: 'CAD' } };
            // "Everything included, only 1.2 crore": the period word sits in another clause of the same sentence.
            // Borrow it only when this is the sentence's only amount.
            if (fixed.money && fixed.money.period == null && fixed.money.currency && !parseMoney(sentence.replace(p.clause, ' '))) {
              const period = parsePeriod(sentence);
              if (period) fixed = { ...fixed, money: { ...fixed.money, period } };
            }
          }
          push({ ...base, ...fixed });
        }
      } else if (p.inst.length > 0) {
        // A clause that only names a university: a claim of its own only if the sentence promises nothing else.
        if (!sentenceHasTyped) push({ ...base, text: sentence, type: 'institution_mention' });
      } else if (wordCount(p.clause) >= 3) {
        push({ ...base, type: 'other' });
      }
    }
  }

  // Several clauses of one sentence that only name universities collapse into one mention.
  const seen = new Set<string>();
  return claims
    .filter((c) => {
      if (c.type !== 'institution_mention') return true;
      if (seen.has(c.sentence)) return false;
      seen.add(c.sentence);
      return true;
    })
    .map((c, i) => ({ ...c, id: `c${i + 1}` }));
}
