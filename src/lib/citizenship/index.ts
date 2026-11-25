/**
 * Citizenship and cost (screen 6) — pure logic, no AI, no clock of its own (pass `now`).
 *
 * One row per destination country (SUPPORTED_COUNTRIES) built from country_facts rows. Ranking uses
 * rankItems: only Verified/Likely values are ranked. Everything else goes to "Not ranked: data missing"
 * with a plain-language reason. A missing value is never treated as zero or infinity.
 *
 * Never invent a rule, number or link here: every value comes from a data row.
 */
import { z } from '@/lib/zod';
import { allSources, computeConfidence, isUsable } from '@/lib/confidence';
import { pkrRate, toPkr } from '@/lib/cost';
import { countryName, formatDate, formatMoney, formatPkr } from '@/lib/format';
import { SUPPORTED_COUNTRIES } from '@/lib/profile';
import { rankItems, weakestConfidence, type RankKey, type SortDir } from '@/lib/rank';
import type {
  Confidence,
  CountryCode,
  CountryFact,
  CountryFactKey,
  CountryFactValue,
  FxRate,
  Money,
  SourcedValue,
} from '@/lib/types';

/* ---------------- Rows ---------------- */

/** The country_facts keys shown for each destination country. */
export const ROW_FACT_KEYS = [
  'citizenship_rule',
  'post_study_work',
  'pr_route',
  'dual_nationality_destination',
  'citizenship_update',
  'tuition_typical',
  'living_cost_typical',
  'proof_of_funds',
] as const satisfies readonly CountryFactKey[];

export type RowFactKey = (typeof ROW_FACT_KEYS)[number];

/** Secondary facts, in display order (the citizenship rule is shown first, on its own). */
export const SECONDARY_FACT_KEYS = [
  'post_study_work',
  'pr_route',
  'dual_nationality_destination',
  'citizenship_update',
] as const satisfies readonly RowFactKey[];

export const COST_FACT_KEYS = ['tuition_typical', 'living_cost_typical'] as const satisfies readonly RowFactKey[];

export const FACT_LABELS: Record<RowFactKey | 'pakistan_dual_nationality', string> = {
  citizenship_rule: 'Citizenship rule',
  post_study_work: 'Post-study work',
  pr_route: 'Permanent residence route',
  dual_nationality_destination: 'Dual nationality',
  citizenship_update: 'Recent change',
  tuition_typical: 'Typical tuition',
  living_cost_typical: 'Typical living cost',
  proof_of_funds: 'Money to show for the student visa',
  pakistan_dual_nationality: "Pakistan's rule",
};

export interface CountryRow {
  country: CountryCode;
  name: string;
  /** null = no data row at all (shown as "Not verified yet"). */
  facts: Record<RowFactKey, CountryFact | null>;
}

function findFact(facts: readonly CountryFact[], country: string, key: CountryFactKey): CountryFact | null {
  return facts.find((f) => f.country === country && f.key === key) ?? null;
}

/** One row per destination country, always — even when the data has no rows for it. */
export function buildCountryRows(
  facts: readonly CountryFact[],
  countries: readonly CountryCode[] = SUPPORTED_COUNTRIES,
): CountryRow[] {
  return countries.map((country) => {
    const row = {} as Record<RowFactKey, CountryFact | null>;
    for (const key of ROW_FACT_KEYS) row[key] = findFact(facts, country, key);
    return { country, name: countryName(country), facts: row };
  });
}

export const PK_DUAL_NATIONALITY_ID = 'pk-pakistan-dual-nationality';

/**
 * Pakistan's own rule on holding another nationality. Always returns a fact: when the data has no row,
 * an empty (Unverified) stub, so the Pakistan card is always shown and reads "Not verified yet".
 */
export function pakistanDualNationality(facts: readonly CountryFact[]): CountryFact {
  return (
    findFact(facts, 'PK', 'pakistan_dual_nationality') ?? {
      id: PK_DUAL_NATIONALITY_ID,
      country: 'PK',
      key: 'pakistan_dual_nationality',
      value: null,
      source_url: null,
      evidence_snippet: null,
      fetched_at: null,
    }
  );
}

/* ---------------- Rank options and query ---------------- */

export const CITIZENSHIP_RANK_KEYS = ['citizenship', 'psw', 'tuition', 'total'] as const;
export type CitizenshipRankKey = (typeof CITIZENSHIP_RANK_KEYS)[number];

export const DEFAULT_RANK: CitizenshipRankKey = 'citizenship';

export interface RankOption {
  key: CitizenshipRankKey;
  label: string;
  /** 'psw' defaults to descending: the longer work permit first. */
  defaultDir: SortDir;
  dirLabels: Record<SortDir, string>;
}

export const RANK_OPTIONS: readonly RankOption[] = [
  { key: 'citizenship', label: 'Citizenship rule', defaultDir: 'asc', dirLabels: { asc: 'Shortest first', desc: 'Longest first' } },
  { key: 'psw', label: 'Post-study work', defaultDir: 'desc', dirLabels: { asc: 'Shortest first', desc: 'Longest first' } },
  { key: 'tuition', label: 'Tuition', defaultDir: 'asc', dirLabels: { asc: 'Lowest first', desc: 'Highest first' } },
  { key: 'total', label: 'Total cost', defaultDir: 'asc', dirLabels: { asc: 'Lowest first', desc: 'Highest first' } },
];

export function rankOption(key: CitizenshipRankKey): RankOption {
  return RANK_OPTIONS.find((o) => o.key === key) as RankOption;
}

export function defaultDir(key: CitizenshipRankKey): SortDir {
  return rankOption(key).defaultDir;
}

export const citizenshipQuerySchema = z.object({
  rank: z.enum(CITIZENSHIP_RANK_KEYS).catch(DEFAULT_RANK),
  dir: z.enum(['asc', 'desc']).optional().catch(undefined),
});

export interface CitizenshipQuery {
  rank: CitizenshipRankKey;
  dir: SortDir;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse ?rank=&dir= safely. Unknown values fall back to the defaults (never throw). */
export function parseCitizenshipQuery(sp: SearchParams | null | undefined): CitizenshipQuery {
  const parsed = citizenshipQuerySchema.parse({ rank: first(sp?.rank), dir: first(sp?.dir) });
  return { rank: parsed.rank, dir: parsed.dir ?? defaultDir(parsed.rank) };
}

export const CITIZENSHIP_PATH = '/citizenship';

/** Canonical link for a ranking. Default values are left out, so the default view is plain /citizenship. */
export function citizenshipHref(q: { rank: CitizenshipRankKey; dir?: SortDir }): string {
  const params = new URLSearchParams();
  if (q.rank !== DEFAULT_RANK) params.set('rank', q.rank);
  const dir = q.dir ?? defaultDir(q.rank);
  if (dir !== defaultDir(q.rank)) params.set('dir', dir);
  const s = params.toString();
  return s ? `${CITIZENSHIP_PATH}?${s}` : CITIZENSHIP_PATH;
}

/* ---------------- Rank keys ---------------- */

export interface CountryRankKey extends RankKey {
  /**
   * Short display of the ranked value, e.g. "36 months (the number this rule is ranked by)" or
   * "PKR 120,000 per year". Null when the row cannot be ranked.
   */
  display: string | null;
  /** Extra plain-text detail, e.g. the amount in its own currency. */
  detail?: string | null;
  /**
   * Whether the display line carries a confidence badge. False for the months number of a rule: code picked
   * that number to sort by, no source states it, so it must not look like a Verified statement. The rule's own
   * text (with its own badge and evidence) is what counts.
   */
  showBadge: boolean;
}

function missingKey(reason: string, confidence: Confidence = 'Unverified'): CountryRankKey {
  return { value: null, confidence, missingReason: reason, display: null, detail: null, showBadge: false };
}

/**
 * The months number a rule is ranked by, in plain words. Never a code-made legal paraphrase of the rule
 * (e.g. "1,095 days of physical presence in 5 years" is not restated as a residence minimum, and "2 years or
 * 18 months depending on the date you apply" is not restated as a permit maximum). Same idea as the shortlist.
 */
export function rankNumberText(months: number): string {
  return `${months} ${months === 1 ? 'month' : 'months'} (the number this rule is ranked by)`;
}

/** Shown under the months number: the exact rule is what counts, not the number we sort by. */
export const RANK_NUMBER_DETAIL = 'Read the exact rule: its wording is what counts.';

/** Reason a fact cannot be used, or null when it is usable (Verified/Likely). */
function unusableReason(fact: CountryFact | null, label: string, now: Date): string | null {
  if (!fact || fact.value == null) return `${label} not verified yet`;
  const conf = computeConfidence(fact, now);
  if (conf === 'Conflict') return `Sources disagree on the ${label.toLowerCase()}`;
  if (!isUsable(conf)) return `${label} not verified yet`;
  return null;
}

/**
 * Ranks by a months number (citizenship_rule / post_study_work). The number is only a sort key taken from the
 * rule (see DECISIONS.md); the display says exactly that and carries no confidence badge.
 */
function monthsKey(fact: CountryFact | null, label: string, now: Date): CountryRankKey {
  const conf = computeConfidence(fact, now);
  const reason = unusableReason(fact, label, now);
  if (reason) return missingKey(reason, conf);
  const months = fact?.value?.sort_months;
  if (months == null || !Number.isFinite(months) || months < 0) {
    return missingKey(`${label} has no single number of months to compare`, conf);
  }
  return { value: months, confidence: conf, display: rankNumberText(months), detail: RANK_NUMBER_DETAIL, showBadge: false };
}

const MONTHS_PER_PERIOD: Record<Exclude<Money['period'], 'total'>, number> = { year: 12, semester: 6, month: 1 };

/** Typical yearly amount. Null for a 'total' amount (no honest way to make it yearly). */
export function yearlyAmount(m: Money | null | undefined): number | null {
  if (!m || !Number.isFinite(m.amount) || m.amount < 0) return null;
  if (m.period === 'total') return null;
  return (m.amount * 12) / MONTHS_PER_PERIOD[m.period];
}

type MoneyPart =
  | { ok: true; pkr: number; confidence: Confidence; native: Money }
  | { ok: false; reason: string; confidence: Confidence };

/** One yearly money fact in PKR, through a Verified/Likely exchange rate only. */
function moneyPart(fact: CountryFact | null, label: string, fx: FxRate[], now: Date): MoneyPart {
  const conf = computeConfidence(fact, now);
  const reason = unusableReason(fact, label, now);
  if (reason) return { ok: false, reason, confidence: conf };
  const money = fact?.value?.money ?? null;
  if (!money) return { ok: false, reason: `${label} has no amount to compare`, confidence: conf };
  const yearly = yearlyAmount(money);
  if (yearly == null) return { ok: false, reason: `${label} is not given per year`, confidence: conf };
  const native: Money = { amount: yearly, currency: money.currency, period: 'year' };
  // Zero is zero in any currency: no exchange rate is needed to compare it.
  if (yearly === 0) return { ok: true, pkr: 0, confidence: conf, native };
  const conv = toPkr(yearly, money.currency, fx, now);
  if (!conv) return { ok: false, reason: `No verified ${money.currency}→PKR exchange rate yet`, confidence: 'Unverified' };
  return { ok: true, pkr: conv.pkr, confidence: weakestConfidence(conf, conv.confidence), native };
}

export function countryRankKey(row: CountryRow, key: CitizenshipRankKey, fx: FxRate[], now: Date): CountryRankKey {
  switch (key) {
    case 'citizenship':
      return monthsKey(row.facts.citizenship_rule, FACT_LABELS.citizenship_rule, now);
    case 'psw':
      return monthsKey(row.facts.post_study_work, 'Post-study work rule', now);
    case 'tuition': {
      const t = moneyPart(row.facts.tuition_typical, FACT_LABELS.tuition_typical, fx, now);
      if (!t.ok) return missingKey(t.reason, t.confidence);
      return {
        value: t.pkr,
        confidence: t.confidence,
        display: `${formatPkr(t.pkr)} per year`,
        detail: formatMoney(t.native),
        showBadge: true,
      };
    }
    case 'total': {
      const t = moneyPart(row.facts.tuition_typical, FACT_LABELS.tuition_typical, fx, now);
      const l = moneyPart(row.facts.living_cost_typical, FACT_LABELS.living_cost_typical, fx, now);
      const reasons = [t, l].filter((p): p is Extract<MoneyPart, { ok: false }> => !p.ok).map((p) => p.reason);
      if (!t.ok || !l.ok) {
        return missingKey([...new Set(reasons)].join('; '), weakestConfidence(t.confidence, l.confidence));
      }
      const pkr = t.pkr + l.pkr;
      return {
        value: pkr,
        confidence: weakestConfidence(t.confidence, l.confidence),
        display: `${formatPkr(pkr)} per year`,
        detail: `Tuition ${formatMoney(t.native)} + living ${formatMoney(l.native)}`,
        showBadge: true,
      };
    }
  }
}

/* ---------------- Ranking ---------------- */

export interface RankedCountry {
  row: CountryRow;
  rank: number;
  key: CountryRankKey;
}

export interface NotRankedCountry {
  row: CountryRow;
  reason: string;
  key: CountryRankKey;
}

export interface CitizenshipRanking {
  rank: CitizenshipRankKey;
  dir: SortDir;
  ranked: RankedCountry[];
  notRanked: NotRankedCountry[];
}

export function rankCountries(
  rows: readonly CountryRow[],
  query: CitizenshipQuery,
  fx: FxRate[],
  now: Date,
): CitizenshipRanking {
  const items = rows.map((row) => ({ row, key: countryRankKey(row, query.rank, fx, now) }));
  const result = rankItems(items, (i) => i.key, query.dir, (a, b) => a.row.name.localeCompare(b.row.name));
  return {
    rank: query.rank,
    dir: query.dir,
    ranked: result.ranked.map((r) => ({ row: r.item.row, rank: r.rank, key: r.item.key })),
    notRanked: result.notRanked.map((n) => ({ row: n.item.row, reason: n.reason, key: n.item.key })),
  };
}

/** One-line summary for screen readers (aria-live) and the results header. */
export function rankingSummary(r: CitizenshipRanking): string {
  const opt = rankOption(r.rank);
  const n = r.ranked.length;
  const m = r.notRanked.length;
  return `Ranked by ${opt.label.toLowerCase()}, ${opt.dirLabels[r.dir].toLowerCase()}. ${n} ${
    n === 1 ? 'country' : 'countries'
  } ranked, ${m} not ranked because data is missing.`;
}

/* ---------------- Conflicts ---------------- */

/** Facts of a row whose official sources disagree (shown with both values and links). */
export function conflictedFacts(row: CountryRow, now: Date): { key: RowFactKey; label: string; fact: CountryFact }[] {
  const out: { key: RowFactKey; label: string; fact: CountryFact }[] = [];
  for (const key of ROW_FACT_KEYS) {
    const fact = row.facts[key];
    if (fact && computeConfidence(fact, now) === 'Conflict') out.push({ key, label: FACT_LABELS[key], fact });
  }
  return out;
}

/**
 * Plain-text question to send to the official office when sources disagree. No address is invented:
 * the student finds the contact on the official page.
 */
export function buildCountryQuestion(opts: {
  countryName: string;
  topic: string;
  sources: SourcedValue<CountryFactValue>[];
}): string {
  const lines = opts.sources.map(
    (s, i) => `  ${i + 1}. "${s.value?.text ?? ''}" (source: ${s.source_url ?? 'no link'})`,
  );
  return [
    "To: (the contact address on the official government page)",
    `Subject: Question about the ${opts.topic.toLowerCase()} in ${opts.countryName}`,
    '',
    'Hello,',
    '',
    `I am a student from Pakistan planning a Masters in ${opts.countryName}.`,
    `I found different information about the ${opts.topic.toLowerCase()} on official pages:`,
    ...lines,
    '',
    'Could you please confirm which rule applies today, and from which date?',
    '',
    'Thank you for your help.',
    '',
    'Kind regards,',
    '[Your name]',
  ].join('\n');
}

/** All sources of a conflicted fact, for buildCountryQuestion. */
export function conflictSources(fact: CountryFact): SourcedValue<CountryFactValue>[] {
  return allSources(fact);
}

/* ---------------- Copy ---------------- */

/** The prominent call-out at the top of the page. Never promises an outcome. */
export const CITIZENSHIP_CALLOUT = {
  title: 'Earliest rule, not a guarantee.',
  body: 'Not immigration advice. Rules change - always check the official page.',
} as const;

/** Plain text of a money fact for display: "€X per year" plus the source's own wording. */
export function moneyFactText(v: CountryFactValue): string {
  if (!v.money) return v.text;
  const amount = formatMoney(v.money);
  return v.text && v.text.trim() !== '' ? `${amount}. ${v.text}` : amount;
}

/* ---------------- Money to show for the student visa ---------------- */

/**
 * The money a student must show for the student visa (proof_of_funds). Shown for every country, NEVER ranked or
 * used to filter: each country counts it differently (the UK asks for living costs per month plus course fees,
 * Canada's amount leaves tuition out, and in the US the school works it out for the I-20), so the numbers are
 * not comparable. countryRankKey never reads this key.
 */
export const VISA_FUNDS_KEY = 'proof_of_funds' as const satisfies RowFactKey;

/** Why visa money is never ranked (no numbers, so it cannot go stale against the data). */
export const VISA_FUNDS_NOT_COMPARABLE =
  'Countries count this money differently (per month or per year, with or without tuition, or worked out by your university), so the amounts cannot be compared.';

/** The one line under every visa-money block. */
export const VISA_FUNDS_NOT_RANKED = `Not ranked. ${VISA_FUNDS_NOT_COMPARABLE} Read each country's rule.`;

/** Shown instead of a PKR amount when there is no Verified/Likely exchange rate. */
export const NO_PKR_RATE = 'No verified PKR rate yet';

/** Shown instead of a PKR amount when the amount itself is not Verified/Likely (never convert an unverified number). */
export const NO_PKR_UNVERIFIED = 'Not converted to PKR because the amount is not verified yet';

export type VisaFundsPkr =
  | { ok: true; text: string; confidence: Confidence; detail: string }
  | { ok: false; text: string };

export interface VisaFundsView {
  /** 'empty' = no value (Not verified yet); 'conflict' = sources disagree (both shown); 'value' = one value. */
  state: 'empty' | 'conflict' | 'value';
  /** Computed confidence of the fact. */
  confidence: Confidence;
  /** The rule in plain words, from the data. */
  text: string | null;
  /** The amount in its own currency, e.g. "€11,904 per year". Null when the source gives no single amount. */
  amount: string | null;
  /** The PKR line. Null when there is no amount (or it is already in PKR). */
  pkr: VisaFundsPkr | null;
  /** How the money is checked (the row's clock_note), or null. */
  howChecked: string | null;
}

const PERIOD_WORDS: Record<Money['period'], string> = {
  year: 'per year',
  semester: 'per semester',
  month: 'per month',
  total: 'in total',
};

function isValidMoney(m: Money | null | undefined): m is Money {
  return (
    m != null &&
    Number.isFinite(m.amount) &&
    m.amount >= 0 &&
    typeof m.currency === 'string' &&
    m.currency.trim() !== '' &&
    m.period in PERIOD_WORDS
  );
}

function blankToNull(s: string | null | undefined): string | null {
  return s != null && s.trim() !== '' ? s : null;
}

/**
 * The PKR line for a visa-money amount: only through a Verified/Likely exchange rate, and only when the amount
 * itself is Verified/Likely. The badge is the weaker of the two. Nothing is estimated in place of a missing rate.
 */
function visaFundsPkr(money: Money, conf: Confidence, fx: FxRate[], now: Date): VisaFundsPkr | null {
  if (money.currency.toUpperCase() === 'PKR') return null; // already in rupees
  if (!isUsable(conf)) return { ok: false, text: NO_PKR_UNVERIFIED };
  const rate = pkrRate(money.currency, fx, now);
  if (!rate) return { ok: false, text: NO_PKR_RATE };
  const checked = fx.find((r) => r.currency === money.currency)?.pkr_per_unit.fetched_at ?? null;
  const how = checked
    ? `Converted from ${money.currency} with the exchange rate checked ${formatDate(checked)}.`
    : `Converted from ${money.currency} with our exchange rate.`;
  return {
    ok: true,
    text: `${formatPkr(money.amount * rate.rate)} ${PERIOD_WORDS[money.period]}`,
    confidence: weakestConfidence(conf, rate.confidence),
    detail: `${how} The official amount is the one in ${money.currency}.`,
  };
}

/** Everything the visa-money block shows, decided in code from one proof_of_funds row. */
export function visaFundsView(fact: CountryFact | null, fx: FxRate[], now: Date): VisaFundsView {
  const confidence = computeConfidence(fact, now);
  const v = fact?.value ?? null;
  const none = { text: null, amount: null, pkr: null, howChecked: null };
  if (!fact || v == null) return { state: 'empty', confidence, ...none };
  if (confidence === 'Conflict') return { state: 'conflict', confidence, ...none };
  const money = isValidMoney(v.money) ? v.money : null;
  return {
    state: 'value',
    confidence,
    text: blankToNull(v.text),
    amount: money ? formatMoney(money) : null,
    pkr: money ? visaFundsPkr(money, confidence, fx, now) : null,
    howChecked: blankToNull(v.clock_note),
  };
}

/* ---------------- Evidence and notes ---------------- */

export interface EvidenceLanguage {
  /** BCP-47 code for the lang attribute, e.g. "de". */
  code: string;
  /** Shown as "(original German)". */
  name: string;
}

const GERMAN: EvidenceLanguage = { code: 'de', name: 'German' };

/**
 * First path segments that official German-language pages use, e.g. bundesregierung.de/breg-de/…,
 * bamf.de/DE/…, auswaertiges-amt.de/de/… (the English pages use /breg-en/, /EN/, /en/).
 */
const GERMAN_FIRST_SEGMENTS: ReadonlySet<string> = new Set(['breg-de', 'de']);

/**
 * Language of a non-English evidence snippet, judged from its source URL only (kept simple on purpose).
 * Null = English, or unknown.
 */
export function evidenceLanguage(sourceUrl: string | null | undefined): EvidenceLanguage | null {
  if (!sourceUrl) return null;
  let first: string | undefined;
  try {
    first = new URL(sourceUrl).pathname.split('/').filter(Boolean)[0];
  } catch {
    return null;
  }
  return first && GERMAN_FIRST_SEGMENTS.has(first.toLowerCase()) ? GERMAN : null;
}

/**
 * The student-facing note of a fact (plain text), or null. Only `note` is ever shown; the internal reviewer
 * note is never read here. A note that only repeats "Not verified yet" is dropped, because the UI already says so.
 */
export function studentNote(fact: Pick<SourcedValue<unknown>, 'note'> | null | undefined): string | null {
  const note = fact?.note?.trim();
  if (!note) return null;
  if (/^not verified yet\W*$/i.test(note)) return null;
  return note;
}
