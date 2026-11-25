/**
 * Consultant Check — compare each claim with Verified/Likely rows ONLY. Pure, no AI, no I/O.
 *
 * Verdicts:
 *  - 'matches'      usable data agrees (with its source)
 *  - 'conflict'     usable data says otherwise ("Differs from official page")
 *  - 'cant_verify'  no usable data ("We can't verify this from official pages yet")
 *
 * Guarantees (admission / visa / scholarship) are never 'matches' unless a usable row explicitly says so.
 * PR / citizenship times are never 'matches': an official minimum wait is not a promise, and which days count
 * depends on the rule. Work-after-study 'sort_months' is a RANKING number, never used as the legal maximum.
 * Wording never accuses anyone: we describe what the official page says, not what the person did.
 *
 * Evidence wording: "official page" (labels and "The official page we hold says") is used ONLY for rows that carry
 * an evidence_snippet. Quotation marks are reserved for that verbatim snippet. Our own wording of a value is shown
 * as "In short: …" and never in quotation marks. Rows without a snippet are "our summary of the official position".
 * `now` is always passed in.
 */
import { allSources, computeConfidence, isUsable, usableValue } from '../confidence';
import { moneyOverDuration, programTotalCost, programTuitionTotal, toPkr } from '../cost';
import { computeFit, SCALE_LABEL } from '../fit';
import { countryName, domainOf, formatDate, formatMonths, formatPkr, safeHref } from '../format';
import type {
  Confidence,
  ConversionRule,
  CountryFact,
  CountryFactKey,
  Fact,
  FxRate,
  GpaRule,
  Institution,
  LanguageReq,
  Money,
  Program,
  SourcedValue,
} from '../types';
import { buildAliasPatterns, normalizeText } from './aliases';
import { CLAIM_TYPE_LABEL, cleanInput, extractClaims, type Claim, type ClaimedMoney, type ClaimType } from './extract';
import { suggestInstitution, type NameSuggestion } from './suggest';

export type Verdict = 'matches' | 'conflict' | 'cant_verify';

/** Verdict labels when the deciding row carries the exact words of the official page (evidence_snippet). */
export const VERDICT_LABEL: Record<Verdict, string> = {
  matches: 'Matches official page',
  conflict: 'Differs from official page',
  cant_verify: "Can't verify",
};

/** Verdict labels when the deciding row is only our summary of the official position (no evidence_snippet). */
export const SUMMARY_VERDICT_LABEL: Record<Exclude<Verdict, 'cant_verify'>, string> = {
  matches: 'Matches our summary of the official position',
  conflict: 'Differs from our summary of the official position',
};

/** Short category names for counts (summary tiles), true for both quoted and summary-based verdicts. */
export const VERDICT_SHORT_LABEL: Record<Verdict, string> = {
  matches: 'Matches',
  conflict: 'Differs',
  cant_verify: "Can't verify",
};

/** What each verdict means, in plain words (legend). */
export const VERDICT_HELP: Record<Verdict, string> = {
  matches: 'An official page we hold says the same thing, in the exact words shown.',
  conflict: 'An official page we hold says something different, in the exact words shown. Ask about it in writing.',
  cant_verify: 'We hold no official data for this yet, or it is a promise official pages do not make.',
};

/** Legend text for the summary-based labels. */
export const SUMMARY_VERDICT_HELP =
  'We hold a summary of an official page, not its exact words. Open the official page and check before you rely on it.';

/** The label for one result: "official page" only when the deciding rows carry exact words. */
export function verdictLabel(verdict: Verdict, quoted: boolean): string {
  return verdict === 'cant_verify' || quoted ? VERDICT_LABEL[verdict] : SUMMARY_VERDICT_LABEL[verdict];
}

/**
 * The label to show for a result. Uses its verdictLabel only when that label belongs to its verdict; otherwise falls
 * back to the cautious summary label, so a stale or missing label can never claim "official page".
 */
export function resultLabel(r: { verdict: Verdict; verdictLabel?: string | null }): string {
  if (r.verdict === 'cant_verify') return VERDICT_LABEL.cant_verify;
  return r.verdictLabel === VERDICT_LABEL[r.verdict] ? VERDICT_LABEL[r.verdict] : SUMMARY_VERDICT_LABEL[r.verdict];
}

/** Display order for summaries: what needs attention first. */
export const VERDICT_ORDER: Verdict[] = ['conflict', 'cant_verify', 'matches'];

export const CANT_VERIFY_TEXT = "We can't verify this from official pages yet.";
export const NO_GUARANTEE_TEXT = 'No official page we hold guarantees this.';
export const NOT_ADVICE_TEXT = 'This is not legal or immigration advice.';

/** Claimed cost below (1 - this) x the official cost counts as "differs". A code threshold, not a real-world fact. */
export const COST_LOWER_TOLERANCE = 0.2;
/** Claimed cost above (1 + this) x the official cost counts as "differs" (it may include other fees). */
export const COST_UPPER_TOLERANCE = 0.25;

export interface CheckSource {
  label: string;
  /** Our plain-words rendering of the value. Shown as "In short: …", never in quotation marks. */
  value: string;
  confidence: Confidence;
  source_url: string | null;
  /** The exact words copied from the official page (evidence_snippet), or null. The only text shown in quotes. */
  snippet?: string | null;
  /** How the clock works for a country rule (clock_note). Plain text. */
  clockNote?: string | null;
  /** The row's student-facing note. Plain text. (The internal review_note is never read.) */
  note?: string | null;
}

export interface CheckLink {
  label: string;
  url: string;
}

export interface CheckResult {
  id: string;
  claim: string;
  type: ClaimType;
  typeLabel: string;
  verdict: Verdict;
  /** VERDICT_LABEL, or SUMMARY_VERDICT_LABEL when the deciding rows hold no exact words from the official page. */
  verdictLabel: string;
  explanation: string;
  sources: CheckSource[];
  questionsToAsk: string[];
  /** Institutions and countries the claim was matched to, for display. */
  about: string[];
  /** How we read the numbers in the claim, e.g. "We read this as PKR 2,500,000 (25 lakh) for the whole programme." */
  reading: string | null;
  /**
   * Official pages to check when the comparison found no usable value (from data rows only). Empty when it did.
   * Shown as "Not verified yet" with the link, also when programme notes are listed in `sources`.
   */
  officialLinks: CheckLink[];
}

export interface CheckData {
  programs: Program[];
  institutions: Institution[];
  countryFacts: CountryFact[];
  conversionRules: ConversionRule[];
  fxRates: FxRate[];
}

export interface CheckSummary {
  total: number;
  matches: number;
  conflict: number;
  cant_verify: number;
}

export interface CheckRun {
  claims: Claim[];
  results: CheckResult[];
  summary: CheckSummary;
  /**
   * A university name that is close to, but not exactly, one we hold ("Brooks"). Only a question for the student:
   * nothing above was checked against it. Null when there is nothing to suggest.
   */
  suggestion: NameSuggestion | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

interface Finding {
  verdict: Verdict | null;
  /** Who/what the finding is about (programme or country), used as a prefix when there are several. */
  scope: string;
  text: string;
  sources: CheckSource[];
  /**
   * True when the rows that decide this finding carry the exact words of the official page.
   * When left out, it is true only if every source of the finding has a snippet.
   */
  quoted?: boolean;
  /**
   * An official row we hold stops this finding from being decided: a notice for Pakistan applicants, or a published
   * route below the minimum. Used to choose a lead that does not say "no data".
   */
  restricted?: boolean;
}

interface Ctx {
  claim: Claim;
  data: CheckData;
  now: Date;
  programs: Program[];
  institutions: Institution[];
  instById: Map<string, Institution>;
}

type Row = SourcedValue<unknown> | null | undefined;

function isBlank(s: string | null | undefined): boolean {
  return s == null || s.trim() === '';
}

/** The row's exact words from the official page, or null. */
function snippetOf(s: Row): string | null {
  return s && !isBlank(s.evidence_snippet) ? (s.evidence_snippet as string).trim() : null;
}

/** True when the row carries the exact words of the official page (an evidence_snippet). */
export function hasSnippet(s: Row): boolean {
  return snippetOf(s) !== null;
}

/** The row's student-facing note (never the internal review_note). A bare "Not verified yet" is dropped. */
function studentNote(s: Row): string | null {
  const n = s?.note?.trim();
  if (!n || /^not verified yet\W*$/i.test(n)) return null;
  return n;
}

/**
 * Exact words in quotation marks. ONLY for evidence snippets: our own wording is never put in quotes.
 * The words are kept as they are; a full stop is added after the closing mark only when they have no end punctuation.
 */
function quote(snippet: string): string {
  const t = snippet.trim();
  return /[.!?]$/.test(t) ? `“${t}”` : `“${t}”.`;
}

/** Our own wording as a sentence, without quotation marks. */
function plain(s: string): string {
  return `${s.trim().replace(/[.\s]+$/, '')}.`;
}

/** "The official page we hold" for rows with exact words; otherwise "Our summary of the official position". */
function who(s: Row): string {
  return hasSnippet(s) ? 'The official page we hold' : 'Our summary of the official position';
}

/** Same, for the middle of a sentence ("… the minimum on the official page we hold"). */
function whoIn(s: Row): string {
  return hasSnippet(s) ? 'on the official page we hold' : 'in our summary of the official position';
}

/**
 * How a rule is cited: the exact words in quotes when we hold them, otherwise our summary, marked as such and
 * never in quotation marks.
 */
function cite(s: Row, summary: string): string {
  const snippet = snippetOf(s);
  return snippet
    ? `The official page we hold says: ${quote(snippet)}`
    : `Our summary of the official position (not a quote): ${plain(summary)}`;
}

function joinAnd(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const DURATION_WORDS: Record<string, number> = {
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
  'twenty-four': 24,
};
const DURATION_NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|${Object.keys(DURATION_WORDS).join('|')})`;
/** "<n> <unit>", "<n>-<unit>" and ranges such as "5 to 10 years" (both ends are lengths the rule names). */
const DURATION_RE = new RegExp(
  String.raw`(?<![a-z0-9.,-])${DURATION_NUM}(?:\s*(?:-|to|or)\s*${DURATION_NUM})?[\s-]*(years?|months?|days?)(?![a-z])`,
  'g',
);

/**
 * Every length of time a rule's text names, in months, in order and without repeats.
 * "2 years" -> 24, "18 months" -> 18, "24-month" -> 24, "1,095 days" -> 36, "five years" -> 60, "5 to 10 years" -> 60, 120.
 */
export function durationsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of normalizeText(text).matchAll(DURATION_RE)) {
    const unit = m[3];
    for (const raw of [m[1], m[2]]) {
      if (raw == null) continue;
      const n = DURATION_WORDS[raw] ?? Number.parseFloat(raw.replace(/,/g, ''));
      if (!Number.isFinite(n) || n <= 0) continue;
      const months = unit.startsWith('year') ? n * 12 : unit.startsWith('month') ? n : (n * 12) / 365;
      const r = Math.round(months * 10) / 10;
      if (!out.some((x) => Math.abs(x - r) < 0.05)) out.push(r);
    }
  }
  return out;
}

const MONTH_WORDS = 'january|february|march|april|may|june|july|august|september|october|november|december';
/** A rule whose length depends on a date ("if you apply by 31 December 2026", "from 2027"). */
const DATE_CONDITION = new RegExp(
  String.raw`\b(?:19|20)\d{2}\b|\b\d{1,2}\s+(?:${MONTH_WORDS})\b|\b(?:${MONTH_WORDS})\s+\d{1,2}\b|\bif you apply\b`,
);

function sameMonths(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.05;
}

/** All the text of a rule that we can read lengths from: our summary plus the exact words, if any. */
function ruleText(s: Row, summary: string): string {
  return [summary, snippetOf(s) ?? ''].join(' \n ');
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-GB') : n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

const PERIOD_TEXT: Record<Money['period'], string> = {
  year: 'per year',
  semester: 'per semester',
  month: 'per month',
  total: 'for the whole programme',
};

/** "£15,000", "€12,000", "PKR 2,500,000 (25 lakh)". */
export function formatAmount(amount: number, currency: string): string {
  if (currency === 'PKR') return formatPkr(amount);
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString('en-GB')}`;
  }
}

export function formatClaimedMoney(m: ClaimedMoney): string {
  if (m.amount === 0 && m.currency === null) return 'no tuition fee';
  const amount = m.currency ? formatAmount(m.amount, m.currency) : fmtNum(m.amount);
  return m.period ? `${amount} ${PERIOD_TEXT[m.period]}` : `${amount} (period not stated)`;
}

function fmtLanguage(v: LanguageReq): string {
  const parts: string[] = [];
  if (v.ielts_overall != null) parts.push(`IELTS ${v.ielts_overall} overall`);
  if (v.toefl_ibt != null) parts.push(`TOEFL iBT ${v.toefl_ibt}`);
  if (v.waiver) parts.push(`Waiver: ${v.waiver}`);
  if (v.text) parts.push(v.text);
  return parts.join('; ') || 'No details';
}

function fmtGpaRule(r: GpaRule): string {
  return r.text?.trim() ? r.text.trim() : `${fmtNum(r.min)} on the ${SCALE_LABEL[r.scale]}`;
}

function fmtTestScores(v: LanguageReq): string {
  const parts: string[] = [];
  if (v.ielts_overall != null) parts.push(`IELTS ${v.ielts_overall} overall`);
  if (v.toefl_ibt != null) parts.push(`TOEFL iBT ${v.toefl_ibt}`);
  return parts.join(' or ');
}

/**
 * Sources for a fact: the usable value, or every value when sources conflict. Unverified values are never shown.
 * Each source carries its exact words (evidence_snippet) and its student-facing note; never the review_note.
 */
function factSources<T>(
  label: string,
  fact: Fact<T> | null | undefined,
  now: Date,
  fmt: (v: T) => string,
  clockNote?: string | null,
): CheckSource[] {
  if (!fact) return [];
  const conf = computeConfidence(fact, now);
  if (conf === 'Conflict') {
    return allSources(fact).map((s, i) => ({
      label: `${label} (source ${i + 1})`,
      value: fmt(s.value as T),
      confidence: 'Conflict' as const,
      source_url: s.source_url,
      snippet: snippetOf(s),
      clockNote: null,
      note: studentNote(s),
    }));
  }
  if (!isUsable(conf) || fact.value == null) return [];
  return [
    {
      label,
      value: fmt(fact.value),
      confidence: conf,
      source_url: fact.source_url,
      snippet: snippetOf(fact),
      clockNote: isBlank(clockNote) ? null : (clockNote as string).trim(),
      note: studentNote(fact),
    },
  ];
}

function progLabel(p: Program, ctx: Ctx): string {
  const inst = ctx.instById.get(p.institution_id);
  return inst ? `${inst.name} — ${p.name}` : p.name;
}

function conflictFinding<T>(scope: string, label: string, fact: Fact<T>, now: Date, fmt: (v: T) => string): Finding {
  return { verdict: null, scope, text: 'Official sources disagree on this, so we will not decide.', sources: factSources(label, fact, now, fmt) };
}

function findingQuoted(f: Finding): boolean {
  return f.quoted ?? (f.sources.length > 0 && f.sources.every((s) => !isBlank(s.snippet)));
}

function addSource(list: CheckSource[], s: CheckSource): boolean {
  if (list.some((x) => x.label === s.label && x.value === s.value && x.source_url === s.source_url)) return false;
  list.push(s);
  return true;
}

/**
 * Combine findings into one verdict + explanation. Any difference wins; then any match; else can't verify.
 * `quoted` is true when a deciding finding rests on rows with the exact words of the official page.
 * `cantVerifyLead` replaces the default lead when the verdict is "can't verify" (e.g. we hold the rule, but it decides nothing).
 */
function decide(
  findings: Finding[],
  opts: { lead?: string; cantVerifyLead?: string; emptyText?: string; tail?: string[] } = {},
): Outcome {
  const conflicts = findings.filter((f) => f.verdict === 'conflict');
  const matches = findings.filter((f) => f.verdict === 'matches');
  const unknown = findings.filter((f) => f.verdict === null);
  const verdict: Verdict = conflicts.length ? 'conflict' : matches.length ? 'matches' : 'cant_verify';
  const deciding = verdict === 'conflict' ? conflicts : verdict === 'matches' ? matches : [];
  const quoted = deciding.some(findingQuoted);
  const scopes = new Set(findings.map((f) => f.scope));
  const line = (f: Finding) => (scopes.size > 1 && f.scope ? `${f.scope}: ${f.text}` : f.text);

  const head =
    opts.lead ??
    (verdict === 'conflict'
      ? quoted
        ? 'This differs from the official page.'
        : 'This differs from our summary of the official position.'
      : verdict === 'matches'
        ? quoted
          ? 'This matches the official page we hold.'
          : 'This matches our summary of the official position.'
        : (opts.cantVerifyLead ?? CANT_VERIFY_TEXT));
  const body = [...conflicts, ...matches, ...unknown].map(line);
  if (findings.length === 0 && opts.emptyText) body.push(opts.emptyText);
  const explanation = [head, ...body, ...(opts.tail ?? [])].filter(Boolean).join(' ');

  const sources: CheckSource[] = [];
  for (const f of [...conflicts, ...matches, ...unknown]) for (const s of f.sources) addSource(sources, s);
  return { verdict, explanation, sources, quoted };
}

const NEED_UNIVERSITY = 'Tell us which university and programme, and we can compare it with the official pages we hold.';
const NEED_COUNTRY = "We couldn't tell which country this is about. Add the country and check again.";

function countryFact(data: CheckData, country: string, key: CountryFactKey): CountryFact | null {
  return data.countryFacts.find((f) => f.country === country && f.key === key) ?? null;
}

/* ------------------------------------------------------------------ */
/* Comparators                                                         */
/* ------------------------------------------------------------------ */

/** `quoted`: the deciding rows carry exact words from the official page (only matters for matches / conflict). */
type Outcome = { verdict: Verdict; explanation: string; sources: CheckSource[]; quoted?: boolean };

function entryContextSources(ctx: Ctx): CheckSource[] {
  const out: CheckSource[] = [];
  for (const p of ctx.programs) {
    out.push(...factSources(`${progLabel(p, ctx)}: minimum grade`, p.min_gpa_rule, ctx.now, fmtGpaRule));
    out.push(...factSources(`${progLabel(p, ctx)}: English test`, p.language_req, ctx.now, fmtLanguage));
  }
  return out;
}

function compareAdmissionPromise(ctx: Ctx): Outcome {
  const { now } = ctx;
  const findings: Finding[] = [];
  for (const p of ctx.programs) {
    if (!['pre_masters', 'pathway', 'conditional'].includes(p.pathway_type)) continue;
    const label = `${progLabel(p, ctx)}: progression to the Masters`;
    const conf = computeConfidence(p.progression_guaranteed, now);
    if (conf === 'Conflict') {
      findings.push(conflictFinding(progLabel(p, ctx), label, p.progression_guaranteed, now, (v) => (v ? 'Guaranteed' : 'Not guaranteed')));
      continue;
    }
    const v = usableValue(p.progression_guaranteed, now);
    if (v === null) continue;
    const req = usableValue(p.progression_requirement, now);
    const sources = [
      ...factSources(label, p.progression_guaranteed, now, (x) => (x ? 'Guaranteed' : 'Not guaranteed')),
      ...factSources(`${progLabel(p, ctx)}: progression requirement`, p.progression_requirement, now, (x) => x),
    ];
    const condition = req ? ` The condition, in short: ${plain(req)}` : '';
    const finding: Finding =
      v
        ? {
            verdict: 'matches',
            scope: progLabel(p, ctx),
            text: `${who(p.progression_guaranteed)} says progression from this route to the Masters is guaranteed if you meet its conditions.${condition} This is about progression, not about getting a place on the route itself.`,
            sources,
            quoted: hasSnippet(p.progression_guaranteed),
          }
        : {
            verdict: 'conflict',
            scope: progLabel(p, ctx),
            text: `${who(p.progression_guaranteed)} says progression to the Masters is not guaranteed.${condition}`,
            sources,
            quoted: hasSnippet(p.progression_guaranteed),
          };
    // A programme that limits Pakistan applicants never confirms an admission promise.
    findings.push(withRestriction(finding, p, ctx));
  }
  if (findings.some((f) => f.verdict)) return decide(findings);
  // A notice that limits Pakistan applicants is quoted in the answer itself, not only listed below it.
  for (const p of ctx.programs) {
    if (findings.some((f) => f.scope === progLabel(p, ctx))) continue;
    const r = pakistanRestriction(p, ctx);
    if (r) findings.push({ ...r, restricted: true });
  }
  if (findings.some((f) => f.restricted)) {
    const d = decide(findings, { cantVerifyLead: NO_GUARANTEE_TEXT });
    return {
      ...d,
      explanation: `${d.explanation} Ask for the university's own written offer before you pay anyone.`,
      sources: [...d.sources, ...entryContextSources(ctx)],
    };
  }
  return {
    verdict: 'cant_verify',
    explanation: `${NO_GUARANTEE_TEXT} Ask for the university's own written offer before you pay anyone.${
      ctx.programs.length === 0 ? ' Which university is this about?' : ''
    }`,
    sources: entryContextSources(ctx),
  };
}

function compareVisaPromise(): Outcome {
  return {
    verdict: 'cant_verify',
    explanation: `${NO_GUARANTEE_TEXT} Ask who makes the final visa decision, and get any promise in writing. ${NOT_ADVICE_TEXT}`,
    sources: [],
  };
}

/** A proof-of-funds rule that says the money must be shown / proven / paid in. */
const FUNDS_MUST = /\bmust\b|\brequired\b|\bhave to\b/;
const BLOCKED_ACCOUNT = /blocked account|sperrkonto/;

/** The claimed amount in the official row's period (month <-> year only). Null when the periods cannot be matched. */
function inPeriod(m: ClaimedMoney, period: Money['period']): number | null {
  if (m.period == null || m.period === period) return m.amount;
  if (m.period === 'month' && period === 'year') return m.amount * 12;
  if (m.period === 'year' && period === 'month') return m.amount / 12;
  return null;
}

/**
 * Money to show for the student visa (proof_of_funds country rows). "No bank statement / no blocked account needed"
 * differs when the usable rule says the money must be shown (for a blocked account: when the rule names one). A lower
 * claimed amount differs only in the rule's own currency, or through usable exchange-rate rows. Never 'matches':
 * showing money is a condition, not a promise of a visa.
 */
function compareVisaMoney(ctx: Ctx): Outcome {
  const { claim, data, now } = ctx;
  if (claim.countries.length === 0) return { verdict: 'cant_verify', explanation: `${CANT_VERIFY_TEXT} ${NEED_COUNTRY} ${NOT_ADVICE_TEXT}`, sources: [] };
  const findings: Finding[] = [];
  let heldRule = false;
  for (const c of claim.countries) {
    const scope = countryName(c);
    const fact = countryFact(data, c, 'proof_of_funds');
    const label = `${scope}: money to show for a student visa`;
    if (fact && computeConfidence(fact, now) === 'Conflict') {
      findings.push(conflictFinding(scope, label, fact, now, (v) => v.text));
      continue;
    }
    const v = usableValue(fact, now);
    if (!v) {
      findings.push({ verdict: null, scope, text: `We don't hold the official rule on money to show for a ${scope} student visa yet.`, sources: [] });
      continue;
    }
    heldRule = true;
    const sources = factSources(label, fact, now, (x) => x.text, v.clock_note);
    const rule = citeWithShort(fact, v.text);
    const t = normalizeText(ruleText(fact, v.text));
    if (claim.fundsKind === 'none') {
      const contradicts = FUNDS_MUST.test(t) && (claim.fundsItem !== 'blocked_account' || BLOCKED_ACCOUNT.test(t));
      findings.push(
        contradicts
          ? { verdict: 'conflict', scope, text: `${rule} This says the money must be shown.`, sources, quoted: hasSnippet(fact) }
          : { verdict: null, scope, text: `${rule} Check every condition on the official page.`, sources },
      );
      continue;
    }
    const m = claim.money;
    const off = v.money;
    if (!m || !m.currency || !off) {
      findings.push({ verdict: null, scope, text: `${rule} This rule does not give one amount we can compare with what you were told.`, sources });
      continue;
    }
    const claimed = inPeriod(m, off.period);
    const officialText = formatClaimedMoney({ ...off, raw: '' });
    if (claimed == null) {
      findings.push({ verdict: null, scope, text: `${rule} The official amount we hold is ${officialText}, for a different period than what you were told.`, sources });
      continue;
    }
    const same = m.currency === off.currency;
    const r = ratio({ amount: claimed, currency: m.currency }, { amount: off.amount, currency: off.currency }, null, data.fxRates, now);
    if (r == null) {
      findings.push({
        verdict: null,
        scope,
        text: `${rule} The official amount we hold is ${officialText}. We have no verified exchange rate to compare it with ${m.currency} yet.`,
        sources,
      });
      continue;
    }
    // Same currency: any lower amount differs. Through exchange rates: allow 2% for rate rounding.
    const lower = same ? r < 1 - 1e-9 : r < 0.98;
    const fx = same ? [] : fxSources([m.currency, off.currency], data.fxRates, now);
    findings.push(
      lower
        ? { verdict: 'conflict', scope, text: `${rule} That is ${officialText}, more than you were told.`, sources: [...sources, ...fx], quoted: hasSnippet(fact) }
        : { verdict: null, scope, text: `${rule} The official amount we hold is ${officialText}. Check every condition on the official page.`, sources: [...sources, ...fx] },
    );
  }
  return decide(findings, { tail: [NOT_ADVICE_TEXT], cantVerifyLead: heldRule ? RULE_ALONE_LEAD : undefined });
}

function compareScholarshipPromise(ctx: Ctx): Outcome {
  const { now } = ctx;
  const findings: Finding[] = [];
  for (const p of ctx.programs) {
    const label = `${progLabel(p, ctx)}: scholarships`;
    const conf = computeConfidence(p.scholarship_info, now);
    if (conf === 'Conflict') {
      findings.push(conflictFinding(progLabel(p, ctx), label, p.scholarship_info, now, (x) => x));
      continue;
    }
    const v = usableValue(p.scholarship_info, now);
    if (!v) continue;
    const sources = factSources(label, p.scholarship_info, now, (x) => x);
    const explicit = /\b(guarantee[sd]?|automatic(ally)?)\b/i.test(v) && !/\bnot\s+(guarantee|automatic)/i.test(v);
    findings.push({
      verdict: explicit ? 'matches' : null,
      scope: progLabel(p, ctx),
      text: explicit
        ? `${who(p.scholarship_info)} says this about scholarships. In short: ${plain(v)} Check the conditions to get and keep it.`
        : `${who(p.scholarship_info)} says this about scholarships. In short: ${plain(v)}`,
      sources,
      quoted: hasSnippet(p.scholarship_info),
    });
  }
  if (findings.some((f) => f.verdict === 'matches')) return decide(findings);
  const d = decide(findings, { lead: `${NO_GUARANTEE_TEXT}` });
  return {
    verdict: 'cant_verify',
    explanation: `${d.explanation} Ask for the scholarship letter from the university itself.${ctx.programs.length === 0 ? ' Which university is this about?' : ''}`,
    sources: d.sources,
  };
}

/** A waiver row that says a Pakistani degree does not skip the English test ("No waiver for a Pakistani degree: …"). */
const NO_WAIVER = /\bno (waivers?|exemptions?)\b|\bpakistan\w* (is|are) not (on|in)\b|\bdoes not waive\b|\bdo not issue waivers\b/;
/** Wording that makes a "no waiver" sentence conditional, so we will not call it a difference. */
const WAIVER_CONDITION = /\bunless\b|\bexcept\b|\bonly if\b|\bmay be exempt\b/;

/** The exact words in quotes plus our short wording, or only our summary when we hold no exact words. */
function citeWithShort(s: Row, summary: string): string {
  return hasSnippet(s) ? `${cite(s, summary)} In short: ${plain(summary)}` : cite(s, summary);
}

/**
 * The usable language_waiver row decides a "no IELTS / MOI is enough" claim: a waiver text that says a Pakistani
 * degree is not exempt differs; any other waiver text has conditions, so we only show it. Null without a usable row.
 */
function waiverFinding(p: Program, ctx: Ctx): Finding | null {
  const { now } = ctx;
  const scope = progLabel(p, ctx);
  const label = `${scope}: English test waiver`;
  const conf = computeConfidence(p.language_waiver, now);
  const reqSources = factSources(`${scope}: English test`, p.language_req, now, fmtLanguage);
  if (conf === 'Conflict') {
    const f = conflictFinding(scope, label, p.language_waiver, now, (x) => x);
    return { ...f, sources: [...f.sources, ...reqSources] };
  }
  const w = usableValue(p.language_waiver, now);
  if (!w) return null;
  const sources = [...factSources(label, p.language_waiver, now, (x) => x), ...reqSources];
  const t = normalizeText(w);
  if (NO_WAIVER.test(t) && !WAIVER_CONDITION.test(t)) {
    return {
      verdict: 'conflict',
      scope,
      text: `${citeWithShort(p.language_waiver, w)} This means a Pakistani degree does not skip the English test here.`,
      sources,
      quoted: hasSnippet(p.language_waiver),
    };
  }
  return {
    verdict: null,
    scope,
    text: `${citeWithShort(p.language_waiver, w)} These are conditions, so we will not decide whether they apply to you. Ask them in writing which document the university accepts instead of a test, and check that you meet every condition.`,
    sources,
  };
}

function compareLanguage(ctx: Ctx): Outcome {
  const { now } = ctx;
  if (ctx.programs.length === 0) return { verdict: 'cant_verify', explanation: `${CANT_VERIFY_TEXT} ${NEED_UNIVERSITY}`, sources: [] };
  let heldWaiver = false;
  const findings: Finding[] = ctx.programs.map((p) => {
    const scope = progLabel(p, ctx);
    const label = `${scope}: English test`;
    // The programme's own waiver rule for Pakistani degrees decides first.
    const waiver = waiverFinding(p, ctx);
    if (waiver) {
      heldWaiver = true;
      return waiver;
    }
    const conf = computeConfidence(p.language_req, now);
    if (conf === 'Conflict') return conflictFinding(scope, label, p.language_req, now, fmtLanguage);
    const v = usableValue(p.language_req, now);
    if (!v) return { verdict: null, scope, text: "We don't hold the English test rules from an official page yet.", sources: [] };
    const sources = factSources(label, p.language_req, now, fmtLanguage);
    const src = who(p.language_req);
    if (v.waiver && v.waiver.trim()) {
      return { verdict: 'matches', scope, text: `${src} mentions a waiver. In short: ${plain(v.waiver)} Check that it applies to you.`, sources };
    }
    if (v.ielts_overall != null || v.toefl_ibt != null) {
      return { verdict: 'conflict', scope, text: `${src} says the programme asks for ${fmtTestScores(v)}. We hold no waiver for this programme.`, sources };
    }
    return { verdict: null, scope, text: `${src} does not give a clear test score or waiver.`, sources };
  });
  return decide(findings, { cantVerifyLead: heldWaiver ? RULE_ALONE_LEAD : undefined });
}

/** IELTS bands and new-scale TOEFL scores (1–6) with one decimal ("6.0", "4.0"); old-scale TOEFL as whole numbers. */
function fmtScore(test: string, n: number): string {
  return test === 'IELTS' || (test === 'TOEFL' && n <= 6) ? n.toFixed(1) : fmtNum(n);
}

/**
 * "IELTS 5.5 is enough" / "requires TOEFL 70": the claimed overall score against the usable minimum.
 * Lower than the official minimum differs (with the official number). Equal matches; higher matches only when the
 * claim says the score is accepted ("is enough"), not when it states a higher minimum.
 */
function compareLanguageScore(ctx: Ctx): Outcome {
  const { claim, now } = ctx;
  const test = claim.test === 'TOEFL' ? 'TOEFL' : 'IELTS';
  const score = claim.score;
  if (ctx.programs.length === 0 || score == null) return { verdict: 'cant_verify', explanation: `${CANT_VERIFY_TEXT} ${NEED_UNIVERSITY}`, sources: [] };
  const cl = `${test} ${fmtScore(test, score)}`;
  let heldRule = false;
  const findings: Finding[] = ctx.programs.map((p) => {
    const scope = progLabel(p, ctx);
    const label = `${scope}: English test`;
    const conf = computeConfidence(p.language_req, now);
    if (conf === 'Conflict') return conflictFinding(scope, label, p.language_req, now, fmtLanguage);
    const v = usableValue(p.language_req, now);
    if (!v) return { verdict: null, scope, text: "We don't hold the English test rules from an official page yet.", sources: [] };
    heldRule = true;
    const sources = factSources(label, p.language_req, now, fmtLanguage);
    const official = test === 'IELTS' ? v.ielts_overall : v.toefl_ibt;
    const at = whoIn(p.language_req);
    if (official == null) {
      return { verdict: null, scope, text: `${who(p.language_req)} gives no ${test} overall score we can compare. In short: ${plain(fmtLanguage(v))}`, sources };
    }
    if (test === 'TOEFL' && score <= 6 && official > 6) {
      return {
        verdict: null,
        scope,
        text: `${cl} looks like a score on the new TOEFL scale (1 to 6). The minimum ${at} is ${fmtScore(test, official)} on the older 0 to 120 scale, so we cannot compare them.`,
        sources,
      };
    }
    const off = `${test} ${fmtScore(test, official)} overall`;
    if (score < official - 1e-9) {
      return { verdict: 'conflict', scope, text: `The minimum ${at} is ${off}, higher than ${cl}.`, sources };
    }
    if (Math.abs(score - official) < 1e-9) {
      return { verdict: 'matches', scope, text: `The minimum ${at} is also ${off}. Check the minimum for each part of the test too.`, sources };
    }
    return claim.scoreMode === 'minimum'
      ? { verdict: null, scope, text: `The minimum ${at} is ${off}, lower than ${cl}. Ask which official page gives ${cl}.`, sources }
      : {
          verdict: 'matches',
          scope,
          text: `${cl} meets the minimum ${at}: ${off}. Check the minimum for each part of the test too. Meeting the minimum does not mean you will be admitted.`,
          sources,
        };
  });
  return decide(findings, { cantVerifyLead: heldRule ? RULE_ALONE_LEAD : undefined });
}

/** A tests_required row that clearly requires the test, for everyone it names. */
const TEST_REQUIRED = /\brequired\b|\bhave to submit\b|\bmust (submit|take|provide|send)\b/;
/** Wording that makes a requirement conditional or optional: then we only show the exact words. */
const TEST_NOT_CLEAR = /not required|\boptional\b|recommend\w*|encourag\w*|\bunless\b|\bexcept\w*\b|\bif\b|waiv\w*|exempt\w*/;

/**
 * "No GRE needed" against the usable tests_required row. Differs only when the row clearly says the test is required
 * (no "unless", "if", "optional", "recommended"); otherwise can't verify, with the official words.
 */
function compareTests(ctx: Ctx): Outcome {
  const { claim, now } = ctx;
  const test = claim.test === 'GMAT' ? 'GMAT' : 'GRE';
  if (ctx.programs.length === 0) return { verdict: 'cant_verify', explanation: `${CANT_VERIFY_TEXT} ${NEED_UNIVERSITY}`, sources: [] };
  let heldRule = false;
  const findings: Finding[] = ctx.programs.map((p) => {
    const scope = progLabel(p, ctx);
    const label = `${scope}: GRE / GMAT`;
    const conf = computeConfidence(p.tests_required, now);
    if (conf === 'Conflict') return conflictFinding(scope, label, p.tests_required, now, (x) => x);
    const v = usableValue(p.tests_required, now);
    if (!v) return { verdict: null, scope, text: "We don't hold the GRE / GMAT rules from an official page yet.", sources: [] };
    heldRule = true;
    const sources = factSources(label, p.tests_required, now, (x) => x);
    const t = normalizeText(`${v} \n ${snippetOf(p.tests_required) ?? ''}`);
    const rule = citeWithShort(p.tests_required, v);
    if (!new RegExp(`\\b${test.toLowerCase()}\\b`).test(t)) {
      return { verdict: null, scope, text: `${rule} This rule does not mention the ${test}.`, sources };
    }
    if (TEST_REQUIRED.test(t) && !TEST_NOT_CLEAR.test(t)) {
      return { verdict: 'conflict', scope, text: `${rule} This says the ${test} is required.`, sources, quoted: hasSnippet(p.tests_required) };
    }
    return {
      verdict: null,
      scope,
      text: `${rule} This rule has conditions, or says the test is optional or recommended, so we will not decide whether you need it. Ask them in writing which part of the rule applies to you.`,
      sources,
    };
  });
  return decide(findings, { cantVerifyLead: heldRule ? RULE_ALONE_LEAD : undefined });
}

/** The bare grade: "2.5", "60%". */
function gradeValue(value: number, scale: GpaRule['scale']): string {
  return scale === 'percent' ? `${fmtNum(value)}%` : fmtNum(value);
}

/** "a CGPA of 2.5", "60%", "a German grade of 2.5". */
function fmtGrade(value: number, scale: GpaRule['scale']): string {
  return scale === 'percent' ? gradeValue(value, scale) : `${scale === 'german' ? 'a German grade' : 'a CGPA'} of ${gradeValue(value, scale)}`;
}

/** True when `value` is worse than `min` on this scale (on the German scale lower is better). */
function worseThan(value: number, min: number, scale: GpaRule['scale']): boolean {
  return scale === 'german' ? value > min + 1e-9 : value < min - 1e-9;
}

/** The programme's minimum-grade finding (min_gpa_rule only, plus its alternatives on the claim's own scale). */
function minGradeFinding(p: Program, ctx: Ctx): Finding {
  const { claim, now } = ctx;
  const scope = progLabel(p, ctx);
  const label = `${scope}: minimum grade`;
  const conf = computeConfidence(p.min_gpa_rule, now);
  if (conf === 'Conflict') return conflictFinding(scope, label, p.min_gpa_rule, now, fmtGpaRule);
  const rule = usableValue(p.min_gpa_rule, now);
  if (!rule) return { verdict: null, scope, text: "We don't hold the minimum CGPA from an official page yet.", sources: [] };
  const sources = factSources(label, p.min_gpa_rule, now, fmtGpaRule);
  // rule.text is our wording of the page: "In short:", never in quotation marks. The exact words are in the source.
  const minText = `In short: ${plain(fmtGpaRule(rule))}`;
  const at = whoIn(p.min_gpa_rule);
  if (!claim.gpa) {
    return { verdict: null, scope, text: `${who(p.min_gpa_rule)} gives a minimum grade. ${minText} Ask what exact CGPA they mean.`, sources };
  }
  const g = claim.gpa;
  // A minimum printed in the same snippet on the claim's own scale (e.g. "60% or GPA 2.7") is used directly.
  const own = g.scale === rule.scale ? { scale: rule.scale, min: rule.min } : (rule.alternatives ?? []).find((a) => a.scale === g.scale);
  if (claim.gpaMode === 'minimum') {
    if (!own) return { verdict: null, scope, text: 'The official minimum is on a different grade scale, so we cannot compare it directly.', sources };
    return Math.abs(own.min - g.value) < 1e-9
      ? { verdict: 'matches', scope, text: `The minimum ${at} is also ${gradeValue(own.min, own.scale)}. ${minText}`, sources }
      : { verdict: 'conflict', scope, text: `The minimum ${at} is not ${gradeValue(g.value, g.scale)}. ${minText}`, sources };
  }
  if (own && own.scale !== rule.scale) {
    return worseThan(g.value, own.min, own.scale)
      ? { verdict: 'conflict', scope, text: `${fmtGrade(g.value, g.scale)} is below the ${fmtGrade(own.min, own.scale)} minimum ${at}. ${minText}`, sources }
      : {
          verdict: 'matches',
          scope,
          text: `${fmtGrade(g.value, g.scale)} meets the ${fmtGrade(own.min, own.scale)} minimum ${at}. ${minText} Meeting the minimum does not mean you will be admitted.`,
          sources,
        };
  }
  {
    const fit = computeFit({ cgpa: g.value, scale: g.scale, min_pass: null }, p, ctx.data.conversionRules, now);
    switch (fit.reason.code) {
      case 'MEETS_MIN':
        return {
          verdict: 'matches',
          scope,
          text: `A CGPA of ${fmtNum(g.value)} meets the minimum ${at}. ${minText} Meeting the minimum does not mean you will be admitted.`,
          sources,
        };
      case 'BELOW_MIN':
        return { verdict: 'conflict', scope, text: `A CGPA of ${fmtNum(g.value)} is below the minimum ${at}. ${minText}`, sources };
      case 'STRADDLES_MIN':
        return { verdict: null, scope, text: `Converted to the ${SCALE_LABEL[rule.scale]}, ${fmtNum(g.value)} could fall on either side of the minimum, so we will not decide.`, sources };
      case 'CONVERSION_RULE_UNSOURCED':
      case 'NO_CONVERSION_RULE':
        return { verdict: null, scope, text: `The official minimum is on the ${SCALE_LABEL[rule.scale]}, and we have no sourced way to convert a CGPA to it yet.`, sources };
      case 'NOT_ACCEPTING':
        return { verdict: null, scope, text: 'Our list marks this programme as ruled out. Check its official page.', sources };
      default:
        return { verdict: null, scope, text: 'We cannot decide this from the official minimum.', sources };
    }
  }
}

/**
 * An official route below the regular minimum (conditional_admission) never turns a claim into a match. When the claim
 * does not meet the regular minimum, the route is shown and the answer is "can't verify", unless the claimed grade is
 * also below the route's own lowest grade (then it differs).
 */
function withConditionalRoute(base: Finding, p: Program, ctx: Ctx): Finding {
  const { claim, now } = ctx;
  if (base.verdict === 'matches') return base;
  const scope = progLabel(p, ctx);
  const label = `${scope}: route below the minimum`;
  const conf = computeConfidence(p.conditional_admission, now);
  const routeSources = factSources(label, p.conditional_admission, now, (v) => v.text);
  if (conf === 'Conflict') {
    return {
      verdict: null,
      scope,
      text: `${base.text} Official sources disagree about a route below the minimum, so we will not decide.`,
      sources: [...base.sources, ...routeSources],
    };
  }
  const ca = usableValue(p.conditional_admission, now);
  if (!ca) return base;
  const sources = [...base.sources, ...routeSources];
  // Our wording of the route, without quotation marks; its exact words are in the source.
  const route = `This programme publishes a route below its minimum: ${plain(ca.text)}`;
  // Keep what the regular minimum says, when we hold it.
  const before = base.sources.length > 0 ? `${base.text} ` : '';
  const g = claim.gpa;
  if (g && g.scale === ca.scale && ca.min != null && worseThan(g.value, ca.min, ca.scale)) {
    const grade = fmtGrade(g.value, g.scale);
    return {
      verdict: 'conflict',
      scope,
      text: `${before}${grade[0].toUpperCase()}${grade.slice(1)} is also below ${gradeValue(ca.min, ca.scale)}, the lowest grade of the route this programme publishes below its minimum. In short: ${plain(ca.text)}`,
      sources,
      quoted: hasSnippet(p.conditional_admission),
    };
  }
  const otherScale = g && g.scale !== ca.scale ? ` This route is on the ${SCALE_LABEL[ca.scale]}, so we will not compare your grade with it.` : '';
  return {
    verdict: null,
    scope,
    text: `${before}${route}${otherScale} Ask them in writing whether this route applies to you, and on what conditions.`,
    sources,
    restricted: true,
  };
}

function compareGpa(ctx: Ctx): Outcome {
  if (ctx.programs.length === 0) return { verdict: 'cant_verify', explanation: `${CANT_VERIFY_TEXT} ${NEED_UNIVERSITY}`, sources: [] };
  const findings: Finding[] = ctx.programs.map((p) => withConditionalRoute(minGradeFinding(p, ctx), p, ctx));
  return decide(findings, { cantVerifyLead: findings.some((f) => f.restricted) ? RULE_ALONE_LEAD : undefined });
}

/** Claimed money as a whole-programme total, or the reason it cannot be one. */
function claimedTotal(m: ClaimedMoney, p: Program, now: Date): { amount: number; currency: string } | 'no_currency' | 'needs_duration' {
  if (!m.currency) return 'no_currency';
  if (!m.period || m.period === 'total') return { amount: m.amount, currency: m.currency };
  const months = usableValue(p.duration_months, now);
  const total = moneyOverDuration({ amount: m.amount, currency: m.currency, period: m.period }, months);
  return total == null ? 'needs_duration' : { amount: total, currency: m.currency };
}

/** claimed / official, in the same currency or via usable PKR exchange-rate rows. Null when we cannot compare honestly. */
function ratio(
  claimed: { amount: number; currency: string },
  official: { amount: number; currency: string } | null,
  officialPkr: number | null,
  fx: FxRate[],
  now: Date,
): number | null {
  if (official && official.currency === claimed.currency && official.amount > 0) return claimed.amount / official.amount;
  const claimedPkr = toPkr(claimed.amount, claimed.currency, fx, now)?.pkr ?? null;
  const offPkr = officialPkr ?? (official ? (toPkr(official.amount, official.currency, fx, now)?.pkr ?? null) : null);
  if (claimedPkr == null || offPkr == null || offPkr <= 0) return null;
  return claimedPkr / offPkr;
}

function fxSources(currencies: string[], fx: FxRate[], now: Date): CheckSource[] {
  const out: CheckSource[] = [];
  for (const c of [...new Set(currencies)]) {
    if (c === 'PKR') continue;
    const row = fx.find((r) => r.currency === c);
    if (row) out.push(...factSources(`Exchange rate ${c} to PKR`, row.pkr_per_unit, now, (v) => `1 ${c} = PKR ${fmtNum(v)}`));
  }
  return out;
}

function costVerdict(r: number, officialText: string, what: string): Pick<Finding, 'verdict' | 'text'> {
  if (r < 1 - COST_LOWER_TOLERANCE) return { verdict: 'conflict', text: `This is less than the official ${what} we hold: about ${officialText}.` };
  if (r > 1 + COST_UPPER_TOLERANCE) {
    return { verdict: 'conflict', text: `This is more than the official ${what} we hold (about ${officialText}). Ask what the extra amount pays for.` };
  }
  return { verdict: 'matches', text: `This is close to the official ${what} we hold: about ${officialText}.` };
}

function compareTotalCost(ctx: Ctx): Outcome {
  const { claim, now, data } = ctx;
  const m = claim.money;
  if (!m) return { verdict: 'cant_verify', explanation: CANT_VERIFY_TEXT, sources: [] };
  if (ctx.programs.length === 0) return { verdict: 'cant_verify', explanation: `${CANT_VERIFY_TEXT} ${NEED_UNIVERSITY}`, sources: [] };
  const findings: Finding[] = ctx.programs.map((p) => {
    const scope = progLabel(p, ctx);
    const cost = programTotalCost(p, data.fxRates, now);
    const sources = [
      ...factSources(`${scope}: tuition`, p.tuition, now, (v) => formatClaimedMoney({ ...v, raw: '' })),
      ...factSources(`${scope}: living costs`, p.living_cost, now, (v) => formatClaimedMoney({ ...v, raw: '' })),
      ...factSources(`${scope}: programme length`, p.duration_months, now, (v) => formatMonths(v)),
    ];
    if (cost.native == null && cost.pkr == null) {
      return { verdict: null, scope, text: `${cost.missing.join('. ')}.`, sources };
    }
    const claimed = claimedTotal(m, p, now);
    if (claimed === 'no_currency') return { verdict: null, scope, text: 'The amount has no currency, so we cannot compare it.', sources };
    if (claimed === 'needs_duration') {
      return { verdict: null, scope, text: 'This amount is not for the whole programme, and the programme length is not verified yet.', sources };
    }
    const r = ratio(claimed, cost.native, cost.pkr, data.fxRates, now);
    const fxUsed = fxSources([claimed.currency, cost.native?.currency ?? ''].filter(Boolean), data.fxRates, now);
    if (r == null) {
      const officialText = cost.native ? formatAmount(cost.native.amount, cost.native.currency) : formatPkr(cost.pkr);
      return {
        verdict: null,
        scope,
        text: `The official tuition and living costs we hold come to about ${officialText}, but we have no verified exchange rate to compare it with ${claimed.currency} yet.`,
        sources,
      };
    }
    const officialText = cost.native && cost.native.currency === claimed.currency ? formatAmount(cost.native.amount, cost.native.currency) : formatPkr(cost.pkr);
    return { ...costVerdict(r, `${officialText} for the whole programme`, 'tuition and living costs'), scope, sources: [...sources, ...fxUsed] };
  });
  return decide(findings);
}

function compareTuition(ctx: Ctx): Outcome {
  const { claim, now, data } = ctx;
  const m = claim.money;
  if (!m) return { verdict: 'cant_verify', explanation: CANT_VERIFY_TEXT, sources: [] };
  if (ctx.programs.length === 0) return { verdict: 'cant_verify', explanation: `${CANT_VERIFY_TEXT} ${NEED_UNIVERSITY}`, sources: [] };
  const fmtMoney = (v: Money) => formatClaimedMoney({ ...v, raw: '' });
  const findings: Finding[] = ctx.programs.map((p) => {
    const scope = progLabel(p, ctx);
    const label = `${scope}: tuition`;
    const conf = computeConfidence(p.tuition, now);
    if (conf === 'Conflict') return conflictFinding(scope, label, p.tuition, now, fmtMoney);
    const fee = usableValue(p.tuition, now);
    if (!fee) return { verdict: null, scope, text: "We don't hold the tuition fee from an official page yet.", sources: [] };
    const sources = [...factSources(label, p.tuition, now, fmtMoney), ...factSources(`${scope}: programme length`, p.duration_months, now, (v) => formatMonths(v))];

    if (m.amount === 0) {
      return fee.amount === 0
        ? { verdict: 'matches', scope, text: `${who(p.tuition)} lists no tuition fee.`, sources, quoted: hasSnippet(p.tuition) }
        : { verdict: 'conflict', scope, text: `${who(p.tuition)} lists tuition of ${fmtMoney(fee)}.`, sources, quoted: hasSnippet(p.tuition) };
    }
    if (!m.currency) return { verdict: null, scope, text: 'The amount has no currency, so we cannot compare it.', sources };

    // Same period on both sides (e.g. both per year): compare directly.
    if (m.period && m.period !== 'total' && m.period === fee.period) {
      const r = ratio({ amount: m.amount, currency: m.currency }, { amount: fee.amount, currency: fee.currency }, null, data.fxRates, now);
      if (r != null) {
        const same = fee.currency === m.currency;
        const officialText = same ? fmtMoney(fee) : `${formatPkr(toPkr(fee.amount, fee.currency, data.fxRates, now)?.pkr)} ${PERIOD_TEXT[fee.period]}`;
        return { ...costVerdict(r, officialText, 'tuition fee'), scope, sources: [...sources, ...(same ? [] : fxSources([fee.currency, m.currency], data.fxRates, now))] };
      }
    }
    const total = programTuitionTotal(p, now);
    const claimed = claimedTotal(m, p, now);
    if (!total || claimed === 'needs_duration' || claimed === 'no_currency') {
      return { verdict: null, scope, text: `The official tuition we hold is ${fmtMoney(fee)}, but the programme length is not verified, so we cannot total it.`, sources };
    }
    const r = ratio(claimed, { amount: total.amount, currency: total.currency }, null, data.fxRates, now);
    if (r == null) {
      return {
        verdict: null,
        scope,
        text: `The official tuition we hold is ${fmtMoney(fee)}, but we have no verified exchange rate to compare it with ${claimed.currency} yet.`,
        sources,
      };
    }
    const officialText =
      total.currency === claimed.currency
        ? `${formatAmount(total.amount, total.currency)} for the whole programme`
        : `${formatPkr(toPkr(total.amount, total.currency, data.fxRates, now)?.pkr)} for the whole programme`;
    return { ...costVerdict(r, officialText, 'tuition fee'), scope, sources: [...sources, ...fxSources([total.currency, claimed.currency], data.fxRates, now)] };
  });
  return decide(findings);
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseIso(iso: string): { y: number; m: number; d: number } | null {
  const mt = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return mt ? { y: +mt[1], m: +mt[2], d: +mt[3] } : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when the whole day of `d` (UTC) is before today's date. The deadline day itself is not "passed". */
function dayHasPassed(d: { y: number; m: number; d: number }, now: Date): boolean {
  return Math.floor(Date.UTC(d.y, d.m - 1, d.d) / DAY_MS) < Math.floor(now.getTime() / DAY_MS);
}

/** "15 December", "30 November 2027", "March 2027": the claimed date in plain words. */
function claimedDateText(d: NonNullable<Claim['date']>): string {
  return [d.day, d.month ? MONTH_NAMES[d.month - 1] : null, d.year].filter((x) => x != null).join(' ') || d.raw;
}

/** A notice that limits applications from Pakistan (e.g. "Pakistan: no offers beyond …"). */
const PAKISTAN_LIMIT =
  /\bno (new )?(offers?|cas|applications?|admissions?)\b|\bnot (accepting|considering|open)\b|\bsuspend\w*|\bpaus(e|ed|ing)\b|\bclosed to\b|\brestrict\w*/;

/**
 * Why an intake or admission claim for this programme must never be confirmed: the programme is ruled out, or its
 * usable status_note limits applications from Pakistan. Null when nothing limits it.
 */
function pakistanRestriction(p: Program, ctx: Ctx): Finding | null {
  const { now } = ctx;
  const note = usableValue(p.status_note, now);
  const noteText = note != null ? normalizeText(`${note} ${snippetOf(p.status_note) ?? ''}`) : '';
  const scope = progLabel(p, ctx);
  if (note != null && /\bpakistan/.test(noteText) && PAKISTAN_LIMIT.test(noteText)) {
    return {
      verdict: null,
      scope,
      text: `${cite(p.status_note, note)} Because of this notice for Pakistan applicants, we will not confirm this for you. Ask the university in writing whether you can still get an offer for this intake.`,
      sources: factSources(noticeLabel(p, ctx), p.status_note, now, (x) => x),
    };
  }
  if (p.status === 'ruled_out') {
    return {
      verdict: null,
      scope,
      text: 'Our list marks this programme as ruled out, so we will not confirm this for you. Check the official page.',
      sources: [],
    };
  }
  return null;
}

/** A 'matches' finding for a programme with a Pakistan restriction becomes "can't verify", with the notice quoted. */
function withRestriction(f: Finding, p: Program, ctx: Ctx): Finding {
  if (f.verdict !== 'matches') return f;
  const r = pakistanRestriction(p, ctx);
  if (!r) return f;
  return { ...r, text: `${f.text} ${r.text}`, sources: [...f.sources, ...r.sources], restricted: true };
}

/** Lead for a "can't verify" that a programme notice (not missing data) decided. */
const RESTRICTED_LEAD = "We can't confirm this from the official pages we hold.";

function compareDeadline(ctx: Ctx): Outcome {
  const { claim, now } = ctx;
  const role = claim.dateRole ?? 'deadline';
  const urgencyLead = 'No official page we hold says how many seats are left or that you must pay now. Take time to check the official deadline.';
  if (ctx.programs.length === 0) {
    return { verdict: 'cant_verify', explanation: role === 'urgency' ? urgencyLead : `${CANT_VERIFY_TEXT} ${NEED_UNIVERSITY}`, sources: [] };
  }
  const deadlineFinding = (p: Program): Finding => {
    const scope = progLabel(p, ctx);
    if (role === 'intake') {
      const label = `${scope}: intake`;
      const conf = computeConfidence(p.intake, now);
      if (conf === 'Conflict') return conflictFinding(scope, label, p.intake, now, (x) => x);
      const v = usableValue(p.intake, now);
      if (!v) return { verdict: null, scope, text: "We don't hold the intake from an official page yet.", sources: [] };
      const sources = factSources(label, p.intake, now, (x) => x);
      const month = claim.date?.month ? MONTH_NAMES[claim.date.month - 1] : null;
      const has = month != null && new RegExp(`\\b(${month}|${month.slice(0, 3)})\\b`, 'i').test(v);
      return { verdict: has ? 'matches' : null, scope, text: `${who(p.intake)} gives the intake. In short: ${plain(v)}`, sources };
    }
    const label = `${scope}: application deadline`;
    const conf = computeConfidence(p.deadline, now);
    if (conf === 'Conflict') return conflictFinding(scope, label, p.deadline, now, formatDate);
    const v = usableValue(p.deadline, now);
    if (!v) return { verdict: null, scope, text: "We don't hold the deadline from an official page yet.", sources: [] };
    const sources = factSources(label, p.deadline, now, formatDate);
    const src = who(p.deadline);
    const off = parseIso(v);
    // A passed date is never presented as something to plan for.
    const passed = off != null && dayHasPassed(off, now);
    const passedNote = passed ? ' This date has passed.' : '';
    if (role === 'urgency' || !claim.date || !off) {
      return { verdict: null, scope, text: `${src} gives the deadline as ${formatDate(v)}.${passedNote}`, sources };
    }
    const c = claim.date;
    const cy = c.year ?? off.y;
    const same = cy === off.y && c.month === off.m && (c.day == null || c.day === off.d);
    if (same) return { verdict: 'matches', scope, text: `${src} gives the deadline as ${formatDate(v)}.${passedNote}`, sources };
    const claimedKey = cy * 10000 + (c.month ?? 0) * 100 + (c.day ?? 31);
    const offKey = off.y * 10000 + off.m * 100 + off.d;
    // After the official date has passed, a later date (or a date with no year) may be for the next intake. We don't
    // hold that deadline, so we never call it a difference.
    if (passed && (claimedKey > offKey || c.year == null)) {
      return {
        verdict: null,
        scope,
        text: `The official deadline we hold, ${formatDate(v)}, has passed. We don't hold the next deadline yet, so we can't check ${claimedDateText(c)}. Ask which intake this date is for, in writing, and check the official page.`,
        sources,
      };
    }
    return claimedKey > offKey
      ? { verdict: 'conflict', scope, text: `${src} gives an earlier deadline: ${formatDate(v)}. Plan for the official date.`, sources }
      : {
          verdict: 'conflict',
          scope,
          text: `${src} gives the deadline as ${formatDate(v)}. Ask if the date you were given is their own internal deadline.${passed ? ' Both dates have passed.' : ''}`,
          sources,
        };
  };
  // An intake or deadline for a programme that limits Pakistan applicants is never confirmed.
  const findings: Finding[] = ctx.programs.map((p) => withRestriction(deadlineFinding(p), p, ctx));
  if (role === 'urgency') {
    const d = decide(findings, { lead: urgencyLead });
    return { ...d, verdict: 'cant_verify' };
  }
  return decide(findings, { cantVerifyLead: findings.some((f) => f.restricted) ? RESTRICTED_LEAD : undefined });
}

/**
 * The claim counts time spent studying or on a temporary permit ("citizenship in 3 years after your masters").
 * Read from the whole sentence, because "Study in Canada, citizenship in 3 years" splits into two clauses.
 */
const STUDY_TIME =
  /\b(stud(y|ies|ying)|students?|masters?|master's|msc|ms|mba|phd|degree|bachelor'?s?|graduat\w*|universit(y|ies)|college|course|program(me)?s?|temporary|work permit|pgwp|parhai|padhai)\b/;

/** The rule says some people can take a different (e.g. faster) path, so its main number is not everyone's minimum. */
const OTHER_PATHS = /\b(faster|shorter|slower|reduced|reduction|accelerated|fast[- ]track|exceptions?|depending)\b/;

/** Lead for a "can't verify" when we do hold the rule, but the rule alone cannot confirm a promise. */
const RULE_ALONE_LEAD = "We can't confirm this from the official rule alone.";

function compareResidence(ctx: Ctx): Outcome {
  const { claim, data, now } = ctx;
  const citizenship = claim.subject === 'citizenship';
  const what = citizenship ? 'citizenship' : 'PR (settlement)';
  if (claim.countries.length === 0) return { verdict: 'cant_verify', explanation: `${CANT_VERIFY_TEXT} ${NEED_COUNTRY} ${NOT_ADVICE_TEXT}`, sources: [] };
  const countsStudy = STUDY_TIME.test(normalizeText(`${claim.text} ${claim.sentence}`));
  const claimed = claim.months != null ? formatMonths(claim.months) : null;
  const studyAsk = countsStudy
    ? ' You were told this counts time spent studying. Ask them to show the official rule that says study time counts, and how much of it.'
    : '';
  const findings: Finding[] = [];
  let heldRule = false;
  for (const c of claim.countries) {
    const scope = countryName(c);
    const key: CountryFactKey = citizenship ? 'citizenship_rule' : 'pr_route';
    const fact = countryFact(data, c, key);
    const label = `${scope}: ${citizenship ? 'citizenship rule' : 'PR / settlement route'}`;
    const conf = computeConfidence(fact, now);
    if (fact && conf === 'Conflict') {
      findings.push(conflictFinding(scope, label, fact, now, (v) => v.text));
      continue;
    }
    const v = usableValue(fact, now);
    const extra: CheckSource[] = citizenship
      ? factSources(`${scope}: recent change`, countryFact(data, c, 'citizenship_update'), now, (x) => x.text)
      : [];
    if (!v) {
      findings.push({ verdict: null, scope, text: `We don't hold the official ${what} rule for ${scope} yet.`, sources: extra });
      continue;
    }
    heldRule = true;
    const sources = [...factSources(label, fact, now, (x) => x.text, v.clock_note), ...extra];
    const rule = cite(fact, v.text);
    // The rule on which days count (e.g. student days count as half days). Our wording: no quotation marks.
    const dayRule = !isBlank(v.clock_note) ? ` Whether your time counts depends on this rule: ${plain(v.clock_note as string)}` : '';
    const official = v.sort_months ?? null;
    if (claim.months == null || official == null) {
      findings.push({ verdict: null, scope, text: `${rule}${dayRule}${studyAsk}`, sources });
      continue;
    }
    // sort_months is the minimum wait. A shorter claim differs only when it is also shorter than every length the
    // rule's own text names, so we never say "about X, not Y" next to a quote that names Y or less.
    const named = durationsIn(ruleText(fact, v.text));
    const shortest = Math.min(official, ...named);
    if (claim.months < official && claim.months >= shortest) {
      const lengths = joinAnd([...new Set([official, ...named])].sort((a, b) => a - b).map((m) => formatMonths(m)));
      findings.push({
        verdict: null,
        scope,
        text: `${rule} This rule names more than one length of time (${lengths}), so we will not decide whether ${claimed} is possible for you.${dayRule}${studyAsk}`,
        sources,
      });
      continue;
    }
    if (claim.months < official) {
      const otherPaths = OTHER_PATHS.test(normalizeText(ruleText(fact, v.text)))
        ? ` The rule also says some paths are faster or slower, so ask which exact route gives ${claimed}, and for its official page.`
        : '';
      findings.push({
        verdict: 'conflict',
        scope,
        text: `${rule} That is about ${formatMonths(official)}, not ${claimed}.${otherPaths}`,
        sources,
        quoted: hasSnippet(fact),
      });
      continue;
    }
    // An official minimum wait is never a promise: equal or longer claims are not confirmed.
    findings.push({
      verdict: null,
      scope,
      text: `${rule} The official minimum is about ${formatMonths(official)}.${
        dayRule || ' A minimum time is not a promise. Check every condition on the official page.'
      }${studyAsk}`,
      sources,
    });
  }
  return decide(findings, { tail: [NOT_ADVICE_TEXT], cantVerifyLead: heldRule ? RULE_ALONE_LEAD : undefined });
}

function compareWork(ctx: Ctx): Outcome {
  const { claim, data, now } = ctx;
  if (claim.countries.length === 0) return { verdict: 'cant_verify', explanation: `${CANT_VERIFY_TEXT} ${NEED_COUNTRY} ${NOT_ADVICE_TEXT}`, sources: [] };
  const findings: Finding[] = [];
  const claimed = claim.months != null ? formatMonths(claim.months) : null;
  let heldRule = false;
  for (const c of claim.countries) {
    const scope = countryName(c);
    if (claim.workKind === 'during_study') {
      findings.push({ verdict: null, scope, text: `We don't hold an official rule on work hours during study for ${scope} yet.`, sources: [] });
      continue;
    }
    const fact = countryFact(data, c, 'post_study_work');
    const label = `${scope}: work after study`;
    const conf = computeConfidence(fact, now);
    if (fact && conf === 'Conflict') {
      findings.push(conflictFinding(scope, label, fact, now, (v) => v.text));
      continue;
    }
    const v = usableValue(fact, now);
    if (!v) {
      findings.push({ verdict: null, scope, text: `We don't hold the official work-after-study rule for ${scope} yet.`, sources: [] });
      continue;
    }
    heldRule = true;
    const sources = factSources(label, fact, now, (x) => x.text, v.clock_note);
    const rule = cite(fact, v.text);
    if (claim.months == null || claimed == null) {
      findings.push({ verdict: null, scope, text: rule, sources });
      continue;
    }
    // sort_months is only a RANKING number (e.g. the UK row ranks by 18 months although the page also says 2 years).
    // We compare only with the lengths the rule's own text names.
    const text = ruleText(fact, v.text);
    const named = durationsIn(text);
    const dated = DATE_CONDITION.test(normalizeText(text));
    const listed = named.some((m) => sameMonths(m, claim.months as number));
    if (named.length === 0) {
      findings.push({ verdict: null, scope, text: `${rule} The rule does not give one length we can compare with ${claimed}, so we will not decide.`, sources });
      continue;
    }
    if (named.length > 1 || dated) {
      const lengths = joinAnd(named.map((m) => formatMonths(m)));
      const why =
        named.length > 1
          ? ` This rule names more than one length (${lengths})${dated ? ', with conditions such as the date you apply' : ''}, so we will not decide which one applies to you.`
          : ` The length in this rule (${lengths}) comes with a date condition, so we will not decide whether it applies to you.`;
      const ask = listed
        ? ` ${claimed} is one of the lengths in the rule. Check the conditions before you rely on it.`
        : ` The rule does not name ${claimed}. Ask for the official page that gives ${claimed}.`;
      findings.push({ verdict: null, scope, text: `${rule}${why}${ask}`, sources });
      continue;
    }
    // One length, no date condition: treat it as the maximum.
    const max = named[0];
    findings.push(
      claim.months > max && !sameMonths(claim.months, max)
        ? { verdict: 'conflict', scope, text: `${rule} That is up to about ${formatMonths(max)}, not ${claimed}.`, sources, quoted: hasSnippet(fact) }
        : {
            verdict: 'matches',
            scope,
            text: `${rule} That is up to about ${formatMonths(max)}. Check the conditions that apply to you.`,
            sources,
            quoted: hasSnippet(fact),
          },
    );
  }
  return decide(findings, { tail: [NOT_ADVICE_TEXT], cantVerifyLead: heldRule ? RULE_ALONE_LEAD : undefined });
}

/** Reads a plain-text status from an official list. 'unknown' when the wording is not clear. */
export function statusLooks(s: string): 'positive' | 'negative' | 'unknown' {
  const t = s.trim().toLowerCase();
  if (/^h\s?\+\s?\/\s?-$|^h\+-$/.test(t)) return 'unknown';
  if (/\b(not|no|non|un)[-\s]?(recogni|listed|approved|accredit|valid)|^h\s?-$/.test(t)) return 'negative';
  if (/recogni|listed|approved|accredit|^h\s?\+$|\byes\b|\bvalid\b/.test(t)) return 'positive';
  return 'unknown';
}

function compareRecognition(ctx: Ctx): Outcome {
  const { claim, now } = ctx;
  if (claim.recognitionKind === 'ranked') {
    return {
      verdict: 'cant_verify',
      explanation: `${CANT_VERIFY_TEXT} We don't track university rankings. Ask which ranking and which year, then check that ranking's own website.`,
      sources: [],
    };
  }
  if (ctx.institutions.length === 0) return { verdict: 'cant_verify', explanation: `${CANT_VERIFY_TEXT} Which university is this about?`, sources: [] };
  const findings: Finding[] = ctx.institutions.map((inst) => {
    const scope = inst.name;
    if (claim.recognitionKind === 'listed') {
      const f = inst.recognition_list_status;
      const label = `${scope}: official recognition list`;
      const conf = computeConfidence(f, now);
      if (conf === 'Conflict') return conflictFinding(scope, label, f, now, (v) => (v === 'listed' ? 'Listed' : 'Not listed'));
      const v = usableValue(f, now);
      if (!v) return { verdict: null, scope, text: "We don't hold this university's place on an official recognition list yet.", sources: [] };
      const sources = factSources(label, f, now, (x) => (x === 'listed' ? 'Listed' : 'Not listed'));
      const list = hasSnippet(f) ? 'The official recognition list we hold' : 'Our summary of the official recognition list';
      return v === 'listed'
        ? { verdict: 'matches', scope, text: `${list} includes this university.`, sources }
        : { verdict: 'conflict', scope, text: `${list} does not include this university.`, sources };
    }
    const anabin = claim.recognitionKind === 'anabin';
    const f = anabin ? inst.anabin_status : inst.hec_status;
    const label = `${scope}: ${anabin ? 'anabin status' : 'HEC status'}`;
    const conf = computeConfidence(f, now);
    if (conf === 'Conflict') return conflictFinding(scope, label, f, now, (x) => x);
    const v = usableValue(f, now);
    if (!v) return { verdict: null, scope, text: `We don't hold this university's ${anabin ? 'anabin' : 'HEC'} status from an official list yet.`, sources: [] };
    const sources = factSources(label, f, now, (x) => x);
    const shows = `${hasSnippet(f) ? 'The official list we hold' : 'Our summary of the official list'} shows this status: ${plain(v)}`;
    if (anabin && claim.anabinMarker) {
      const same = v.replace(/\s/g, '').toLowerCase() === claim.anabinMarker.replace(/\s/g, '').toLowerCase();
      return { verdict: same ? 'matches' : 'conflict', scope, text: shows, sources };
    }
    const look = statusLooks(v);
    return {
      verdict: look === 'positive' ? 'matches' : look === 'negative' ? 'conflict' : null,
      scope,
      text: shows,
      sources,
    };
  });
  return decide(findings);
}

/** Label of a programme's status_note: a ruled-out reason, or a notice for applicants on an active programme. */
function noticeLabel(p: Program, ctx: Ctx): string {
  return `${progLabel(p, ctx)}: ${p.status === 'ruled_out' ? 'why it is ruled out' : 'notice for applicants'}`;
}

function eligibilityLabel(p: Program, ctx: Ctx): string {
  return `${progLabel(p, ctx)}: who the course is for`;
}

function compareMention(ctx: Ctx): Outcome {
  const { now } = ctx;
  const names = ctx.institutions.map((i) => i.name);
  const findings: Finding[] = [];
  for (const p of ctx.programs) {
    if (p.status !== 'ruled_out') continue;
    const scope = progLabel(p, ctx);
    const label = noticeLabel(p, ctx);
    const conf = computeConfidence(p.status_note, now);
    if (conf === 'Conflict') {
      findings.push(conflictFinding(scope, label, p.status_note, now, (x) => x));
      continue;
    }
    const v = usableValue(p.status_note, now);
    findings.push(
      v
        ? {
            verdict: 'conflict',
            scope,
            text: `${who(p.status_note)} has a notice about this programme. In short: ${plain(v)}`,
            sources: factSources(label, p.status_note, now, (x) => x),
          }
        : { verdict: null, scope, text: 'Our list marks this programme as ruled out, but the reason is not verified yet. Check the official page.', sources: [] },
    );
  }
  const lead = `We found ${names.join(' and ') || 'this university'} in our list. There is no specific promise here to compare.`;
  if (findings.some((f) => f.verdict)) return decide(findings);
  const d = decide(findings, { lead });
  return { ...d, explanation: `${d.explanation} Ask which programme they mean, then check its facts.`.replace(/\s+/g, ' ') };
}

/**
 * Official notes on the programmes a claim names, added to EVERY programme claim as extra sources: the status_note
 * (e.g. extra compliance measures for Pakistan applicants) and the eligibility_note (who the course is for).
 * Usable or conflicting rows only. They never change the verdict, and eligibility never decides fit.
 */
function programNotes(ctx: Ctx, already: readonly CheckSource[]): { sources: CheckSource[]; lines: string[] } {
  const { now } = ctx;
  const sources: CheckSource[] = [];
  const lines: string[] = [];
  const many = ctx.programs.length > 1;
  for (const p of ctx.programs) {
    const prefix = many ? `${progLabel(p, ctx)}: ` : '';
    const notes: { fact: Fact<string>; label: string; intro: string }[] = [
      { fact: p.status_note, label: noticeLabel(p, ctx), intro: 'has a notice for applicants to this programme' },
      { fact: p.eligibility_note, label: eligibilityLabel(p, ctx), intro: 'says who this course is for' },
    ];
    for (const n of notes) {
      const conf = computeConfidence(n.fact, now);
      if (conf !== 'Conflict' && !isUsable(conf)) continue;
      let added = false;
      for (const s of factSources(n.label, n.fact, now, (x) => x)) {
        if (already.some((x) => x.label === s.label && x.value === s.value && x.source_url === s.source_url)) continue;
        added = addSource(sources, s) || added;
      }
      if (!added) continue;
      lines.push(
        conf === 'Conflict'
          ? `${prefix}Official sources disagree about a note on this programme. Both are shown below.`
          : `${prefix}${who(n.fact)} also ${n.intro}. Read it below.`,
      );
    }
  }
  return { sources, lines };
}

function compareOther(): Outcome {
  return {
    verdict: 'cant_verify',
    explanation: `${CANT_VERIFY_TEXT} We couldn't match it to a fact we track, so ask for the official page that says it.`,
    sources: [],
  };
}

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

export function questionsFor(claim: Claim): string[] {
  const dur = claim.months != null ? formatMonths(claim.months) : null;
  switch (claim.type) {
    case 'guaranteed_admission':
      return [
        'Can you send me the official university page that says admission is guaranteed?',
        'Can I see the offer letter from the university itself, with all its conditions?',
        'If I am not admitted, what happens to the money I paid? Please confirm the refund terms in writing.',
      ];
    case 'visa_guaranteed':
      return [
        'Which official government page says the visa is guaranteed?',
        'Who makes the final visa decision, and will you put this promise in writing?',
        'If the visa is refused, what happens to the money I paid? Please confirm the refund terms in writing.',
      ];
    case 'scholarship_guaranteed':
      return [
        'Can you send the official scholarship page and its rules?',
        'Is this scholarship confirmed in writing by the university, and what are the conditions to keep it?',
      ];
    case 'no_language_test':
      return [
        `Which official page says ${claim.test && claim.test !== 'an English test' ? claim.test : 'an English test'} is not required for Pakistani applicants?`,
        'If there is a waiver, which exact document does the university accept instead? Please send the official page.',
      ];
    case 'language_score': {
      const score = claim.score != null ? ` ${fmtScore(claim.test ?? '', claim.score)}` : '';
      return [
        `Which official page says ${claim.test ?? 'this test'}${score} is enough for this programme?`,
        'Is there also a minimum score for each part of the test? Please send the official page.',
      ];
    }
    case 'tests':
      return [
        `Which official page says the ${claim.test ?? 'GRE'} is not required for applicants with a Pakistani degree?`,
        'If there is an exception or waiver, what are its exact conditions? Please send the official page.',
      ];
    case 'visa_money':
      return [
        'Which official government page gives this rule or amount for the student visa?',
        'How long must the money be held, and in what kind of account?',
      ];
    case 'gpa_requirement':
      return [
        claim.gpa
          ? `Which official page says ${fmtGrade(claim.gpa.value, claim.gpa.scale)} is accepted for this programme?`
          : 'What exact minimum CGPA does the official page ask for? Please send the link.',
        'Is this the minimum for applicants with a Pakistani bachelor’s degree?',
      ];
    case 'total_cost':
      return [
        'Please confirm in writing the total cost including tuition, living costs and fees, with the official source.',
        'Does this amount include your own service fee?',
      ];
    case 'tuition':
      return ['Please send the official fees page for this programme and the year it applies to.', 'Is this fee for one year or for the whole programme?'];
    case 'deadline':
      return claim.dateRole === 'urgency'
        ? ['Which official page says the seats are almost full?', 'Can I have a few days to check the official page before I pay anything?']
        : claim.dateRole === 'intake'
          ? ['Which official page shows this date?', "Is this the university's own deadline, or a deadline you set?"]
          : ['Which official page shows this date?', 'Which intake is this deadline for?', "Is this the university's own deadline, or a deadline you set?"];
    case 'pr_or_citizenship_time': {
      const what = claim.subject === 'citizenship' ? 'citizenship' : 'PR';
      return [
        dur ? `Which official government page says ${what} is possible in ${dur}?` : `Which official government page explains this ${what} route?`,
        'Does time spent as a student count towards this? Please show me the official rule.',
      ];
    }
    case 'work_rights':
      return ['Which official government page says this about work rights?', 'Does this apply to my degree and the year I would apply?'];
    case 'recognition':
      return claim.recognitionKind === 'ranked'
        ? ['Which ranking is this, and for which year? Please send the link.']
        : ['Which official list shows this, and can you send the link?'];
    case 'institution_mention':
      return ['Which exact programme and intake do you mean? Please send the official programme page.'];
    case 'other':
    default:
      return ['Can you show me the official page that says this?'];
  }
}

/** All questions from several results: differences first, then promises, then the rest. Deduplicated. */
export function collectQuestions(results: readonly CheckResult[], max = 8): string[] {
  const rank = (r: CheckResult) =>
    r.verdict === 'conflict' ? 0 : ['guaranteed_admission', 'visa_guaranteed', 'scholarship_guaranteed'].includes(r.type) ? 1 : r.verdict === 'cant_verify' ? 2 : 3;
  const ordered = [...results].map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i);
  const out: string[] = [];
  for (const { r } of ordered) for (const q of r.questionsToAsk) if (!out.includes(q) && out.length < max) out.push(q);
  return out;
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

function reading(claim: Claim): string | null {
  if (claim.money) return `We read this as ${formatClaimedMoney(claim.money)}.`;
  if (claim.type === 'gpa_requirement' && claim.gpa) {
    const g = claim.gpa;
    return `We read this as ${g.scale === 'percent' ? `${fmtNum(g.value)}%` : `a CGPA of ${fmtNum(g.value)} out of ${g.scale === 'cgpa_5' ? '5.0' : '4.0'}`}.`;
  }
  if ((claim.type === 'pr_or_citizenship_time' || claim.type === 'work_rights') && claim.months != null) {
    return `We read this as ${formatMonths(claim.months)}.`;
  }
  if (claim.type === 'deadline' && claim.date?.month) {
    return `We read this as ${claimedDateText(claim.date)}.`;
  }
  if (claim.type === 'language_score' && claim.score != null) {
    return `We read this as ${claim.test ?? 'a test score of'} ${fmtScore(claim.test ?? '', claim.score)} overall.`;
  }
  return null;
}

function officialLinks(ctx: Ctx, sources: CheckSource[]): CheckLink[] {
  const links: CheckLink[] = [];
  const add = (label: string, url: string | null | undefined) => {
    const href = safeHref(url);
    if (!href || links.some((l) => l.url === href) || sources.some((s) => safeHref(s.source_url) === href)) return;
    links.push({ label, url: href });
  };
  for (const p of ctx.programs) {
    const inst = ctx.instById.get(p.institution_id);
    if (p.official_url) add(`${p.name} official page (${domainOf(p.official_url)})`, p.official_url);
    else if (inst?.website) add(`${inst.name} official website (${domainOf(inst.website)})`, inst.website);
  }
  for (const inst of ctx.institutions) if (inst.website) add(`${inst.name} official website (${domainOf(inst.website)})`, inst.website);
  return links.slice(0, 3);
}

export function compareClaim(claim: Claim, data: CheckData, now: Date): CheckResult {
  const instById = new Map(data.institutions.map((i) => [i.id, i]));
  const ctx: Ctx = {
    claim,
    data,
    now,
    programs: claim.programIds.map((id) => data.programs.find((p) => p.id === id)).filter((p): p is Program => !!p),
    institutions: claim.institutionIds.map((id) => instById.get(id)).filter((i): i is Institution => !!i),
    instById,
  };

  let out: Outcome;
  switch (claim.type) {
    case 'guaranteed_admission':
      out = compareAdmissionPromise(ctx);
      break;
    case 'visa_guaranteed':
      out = compareVisaPromise();
      break;
    case 'scholarship_guaranteed':
      out = compareScholarshipPromise(ctx);
      break;
    case 'no_language_test':
      out = compareLanguage(ctx);
      break;
    case 'language_score':
      out = compareLanguageScore(ctx);
      break;
    case 'tests':
      out = compareTests(ctx);
      break;
    case 'visa_money':
      out = compareVisaMoney(ctx);
      break;
    case 'gpa_requirement':
      out = compareGpa(ctx);
      break;
    case 'total_cost':
      out = compareTotalCost(ctx);
      break;
    case 'tuition':
      out = compareTuition(ctx);
      break;
    case 'deadline':
      out = compareDeadline(ctx);
      break;
    case 'pr_or_citizenship_time':
      out = compareResidence(ctx);
      break;
    case 'work_rights':
      out = compareWork(ctx);
      break;
    case 'recognition':
      out = compareRecognition(ctx);
      break;
    case 'institution_mention':
      out = compareMention(ctx);
      break;
    default:
      out = compareOther();
  }

  const countryBased =
    claim.type === 'pr_or_citizenship_time' || claim.type === 'work_rights' || claim.type === 'visa_guaranteed' || claim.type === 'visa_money';
  const about = [
    ...(countryBased ? [] : ctx.institutions.map((i) => i.name)),
    ...claim.countries.map((c) => countryName(c)),
  ].filter((v, i, a) => a.indexOf(v) === i);

  // Official notes on the named programmes (never for country rules, whose programme context may come from elsewhere).
  const notes = countryBased ? { sources: [], lines: [] } : programNotes(ctx, out.sources);
  // For an admission promise, an official notice (e.g. an offer cut-off) matters most, so it comes first.
  const sources = claim.type === 'guaranteed_admission' ? [...notes.sources, ...out.sources] : [...out.sources, ...notes.sources];
  const explanation = [out.explanation, ...notes.lines].join(' ');

  return {
    id: claim.id,
    claim: claim.text,
    type: claim.type,
    typeLabel: CLAIM_TYPE_LABEL[claim.type],
    verdict: out.verdict,
    verdictLabel: verdictLabel(out.verdict, out.quoted ?? false),
    explanation: explanation.replace(/\s+/g, ' ').trim(),
    sources,
    questionsToAsk: questionsFor(claim).slice(0, 3),
    about,
    reading: reading(claim),
    // Only when the comparison itself found no usable row, so "Not verified yet" is shown even beside programme notes.
    officialLinks: countryBased || out.sources.length > 0 ? [] : officialLinks(ctx, sources),
  };
}

export function compareClaims(claims: readonly Claim[], data: CheckData, now: Date): CheckResult[] {
  return claims.map((c) => compareClaim(c, data, now));
}

export function summarize(results: readonly CheckResult[]): CheckSummary {
  const s: CheckSummary = { total: results.length, matches: 0, conflict: 0, cant_verify: 0 };
  for (const r of results) s[r.verdict] += 1;
  return s;
}

/** Extract + compare in one call, plus a "Did you mean …?" suggestion for a misspelled university name. */
export function runCheck(text: string, data: CheckData, now: Date): CheckRun {
  const patterns = buildAliasPatterns(data.institutions);
  const claims = extractClaims(text, data, patterns);
  const results = compareClaims(claims, data, now);
  return { claims, results, summary: summarize(results), suggestion: suggestInstitution(cleanInput(text), data.institutions, patterns) };
}
