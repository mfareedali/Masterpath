/**
 * Plausibility checks for proposed values (pure). They never reject: a flagged proposal is still written to the
 * proposals file, but it carries `flags` and is NOT eligible for automatic merging: a human must look at it.
 * The limits are sanity bounds for typical Masters programs, not facts about any university.
 */
import { mentionsNumber } from './text-rules';
import type { ValueKind } from './fields';

/** Upper bound for a plausible YEARLY amount per currency (tuition or living cost). Unknown currency: flagged. */
const MAX_YEARLY: Record<string, number> = {
  USD: 120_000, EUR: 120_000, GBP: 100_000, CAD: 120_000, AUD: 120_000, NZD: 120_000, CHF: 60_000,
  SEK: 400_000, NOK: 400_000, DKK: 300_000, JPY: 8_000_000, KRW: 40_000_000, CNY: 400_000, MYR: 150_000,
  TRY: 1_500_000, AED: 300_000, PLN: 150_000, CZK: 600_000, HUF: 8_000_000, SGD: 100_000, HKD: 500_000,
};

const GPA_RANGE: Record<string, [number, number]> = {
  cgpa_4: [1.5, 4],
  cgpa_5: [2, 5],
  percent: [40, 100],
  german: [1, 4],
};

const DAY_MS = 86_400_000;

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function moneyFlags(v: Record<string, unknown>): string[] {
  const amount = typeof v.amount === 'number' ? v.amount : null;
  const currency = typeof v.currency === 'string' ? v.currency : '';
  const period = typeof v.period === 'string' ? v.period : '';
  if (amount === null) return [];
  const flags: string[] = [];
  const perYear = period === 'month' ? amount * 12 : period === 'semester' ? amount * 2 : period === 'year' ? amount : null;
  const max = MAX_YEARLY[currency];
  if (max === undefined) flags.push(`no plausibility bounds for currency ${currency || '(missing)'}: check the amount by hand`);
  else if (perYear !== null && perYear > max) flags.push(`${amount} ${currency} per ${period} is above the usual range (about ${max} ${currency} a year): check the amount and the period`);
  else if (period === 'total' && amount > max * 3) flags.push(`${amount} ${currency} in total is above the usual range: check the amount`);
  if (amount === 0) flags.push('zero amount: check it is the tuition itself and not only a fee that is waived');
  else if (perYear !== null && perYear < 100 && currency !== 'JPY' && currency !== 'KRW') flags.push(`${amount} ${currency} per ${period} is unusually low: check the period`);
  return flags;
}

function gpaFlags(scale: unknown, min: unknown): string[] {
  if (typeof min !== 'number' || typeof scale !== 'string') return [];
  const range = GPA_RANGE[scale];
  if (!range) return [];
  return min < range[0] || min > range[1] ? [`minimum ${min} on the ${scale} scale is outside ${range[0]}-${range[1]}: check the scale`] : [];
}

/** Flags for one proposed value. `snippet` is the evidence text, `fetchedAt` an ISO timestamp (the run's clock). */
export function plausibilityFlags(kind: ValueKind, value: unknown, snippet: string, fetchedAt: string): string[] {
  const flags: string[] = [];
  const o = obj(value);
  switch (kind) {
    case 'money':
      if (o) flags.push(...moneyFlags(o));
      break;
    case 'gpa_rule':
      if (o) flags.push(...gpaFlags(o.scale, o.min));
      break;
    case 'conditional_admission':
      if (o) flags.push(...gpaFlags(o.scale, o.min));
      break;
    case 'deadline': {
      if (typeof value !== 'string') break;
      const t = Date.parse(`${value}T00:00:00Z`);
      const now = Date.parse(fetchedAt);
      const year = Number(value.slice(0, 4));
      if (!mentionsNumber(snippet, year)) flags.push(`the page gives no year for this date (the year ${year} was inferred): confirm it on the page`);
      if (Number.isFinite(t) && Number.isFinite(now)) {
        if (t < now - DAY_MS) flags.push('the deadline is already in the past: the page may describe an old cycle');
        if (t > now + 730 * DAY_MS) flags.push('the deadline is more than two years away: check the year');
      }
      break;
    }
    case 'duration_months':
      if (typeof value === 'number' && (value < 6 || value > 72)) flags.push(`${value} months is outside the usual 6-72 months: check the unit`);
      break;
    case 'lor_count':
      if (typeof value === 'number' && value > 5) flags.push(`${value} recommendation letters is unusually many: check the page`);
      break;
    case 'language_req':
      if (o) {
        if (typeof o.ielts_overall === 'number' && (o.ielts_overall < 4.5 || o.ielts_overall > 9)) flags.push(`IELTS ${o.ielts_overall} is outside 4.5-9`);
        if (typeof o.toefl_ibt === 'number' && (o.toefl_ibt < 40 || o.toefl_ibt > 120)) flags.push(`TOEFL iBT ${o.toefl_ibt} is outside 40-120`);
      }
      break;
    default:
      break;
  }
  return flags;
}
