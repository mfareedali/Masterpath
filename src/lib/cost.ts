/**
 * Cost maths — plain code over Verified/Likely rows only. Never fills a gap with a guess.
 * Converting to PKR requires a Verified/Likely exchange rate row (data/fx_rates.seed.json) fetched within
 * FX_MAX_AGE_DAYS days.
 */
import { ageInDays, computeConfidence, isUsable } from './confidence';
import { weakestConfidence } from './rank';
import type { Confidence, FxRate, Money, Program } from './types';

/** An exchange rate older than this many days never decides a PKR total or a budget check. */
export const FX_MAX_AGE_DAYS = 45;

export interface CostResult {
  /** Amount in the program's own currency, if tuition and living use the same currency. */
  native: { amount: number; currency: string } | null;
  /** Amount in PKR, only if every needed exchange rate is usable. */
  pkr: number | null;
  confidence: Confidence;
  /** Plain-language list of what is missing, e.g. ["Living cost not verified yet"]. */
  missing: string[];
  /**
   * Student-facing notes of the usable tuition and living-cost facts, e.g. "Tuition: No tuition fees, but a semester
   * contribution is due each semester. Its amount is not verified yet." Shown next to any total, because a total can
   * leave out what a note describes. Plain text (never HTML); review_note is never included.
   */
  caveats: string[];
}

const PERIOD_MONTHS: Record<'year' | 'semester', number> = { year: 12, semester: 6 };

/**
 * Scale a Money value to the whole programme length. Returns null if it cannot be done honestly: no usable length,
 * or a length that is not a whole number of the fee's period (fees are charged per term, so 15 months of a per-semester
 * fee is not 2.5 semesters of it).
 */
export function moneyOverDuration(m: Money, durationMonths: number | null): number | null {
  if (m.period === 'total') return m.amount;
  if (durationMonths == null || !Number.isFinite(durationMonths) || durationMonths <= 0) return null;
  if (m.period === 'month') return Number.isInteger(durationMonths) ? m.amount * durationMonths : null;
  const per = PERIOD_MONTHS[m.period];
  return durationMonths % per === 0 ? (m.amount * durationMonths) / per : null;
}

/**
 * Why moneyOverDuration returned null, in plain words (null when it can total). `label` names the money,
 * e.g. "tuition" or "living cost".
 */
export function moneyOverDurationProblem(m: Money, durationMonths: number | null, label: string): string | null {
  if (moneyOverDuration(m, durationMonths) != null) return null;
  if (durationMonths == null || !Number.isFinite(durationMonths) || durationMonths <= 0) {
    return `Programme length not verified yet (needed to total ${label})`;
  }
  const unit = m.period === 'month' ? 'months' : m.period === 'semester' ? 'semesters' : 'years';
  return `Programme length (${durationMonths} months) is not a whole number of ${unit}, so we cannot total the ${label}`;
}

export type PkrRateStatus =
  | { ok: true; rate: number; confidence: Confidence; fetched_at: string | null }
  | { ok: false; reason: string };

/** A usable, recent PKR rate for a currency, or the plain-language reason there is none. */
export function pkrRateStatus(currency: string, fx: FxRate[], now: Date): PkrRateStatus {
  if (currency === 'PKR') return { ok: true, rate: 1, confidence: 'Verified', fetched_at: null };
  const row = fx.find((r) => r.currency === currency);
  if (!row) return { ok: false, reason: `No verified ${currency}→PKR exchange rate yet` };
  const conf = computeConfidence(row.pkr_per_unit, now);
  if (conf === 'Conflict') return { ok: false, reason: `${currency}→PKR exchange rate sources conflict` };
  const rate = row.pkr_per_unit.value;
  if (!isUsable(conf) || rate == null || !Number.isFinite(rate) || rate <= 0) {
    return { ok: false, reason: `No verified ${currency}→PKR exchange rate yet` };
  }
  const age = ageInDays(row.pkr_per_unit.fetched_at, now);
  if (!Number.isFinite(age)) return { ok: false, reason: `The ${currency}→PKR exchange rate has no date, so we cannot use it` };
  if (age > FX_MAX_AGE_DAYS) return { ok: false, reason: `${currency}→PKR exchange rate is older than ${FX_MAX_AGE_DAYS} days` };
  return { ok: true, rate, confidence: conf, fetched_at: row.pkr_per_unit.fetched_at };
}

/** PKR per unit for a currency, or null when no usable rate fetched within FX_MAX_AGE_DAYS exists. */
export function pkrRate(currency: string, fx: FxRate[], now: Date): { rate: number; confidence: Confidence } | null {
  const s = pkrRateStatus(currency, fx, now);
  return s.ok ? { rate: s.rate, confidence: s.confidence } : null;
}

export function toPkr(amount: number, currency: string, fx: FxRate[], now: Date): { pkr: number; confidence: Confidence } | null {
  const r = pkrRate(currency, fx, now);
  return r ? { pkr: amount * r.rate, confidence: r.confidence } : null;
}

function usableMonths(p: Program, now: Date): number | null {
  return isUsable(computeConfidence(p.duration_months, now)) ? p.duration_months.value : null;
}

/** Tuition for the whole programme. */
export function programTuitionTotal(p: Program, now: Date): { amount: number; currency: string; confidence: Confidence } | null {
  const tc = computeConfidence(p.tuition, now);
  if (!isUsable(tc) || !p.tuition.value) return null;
  const dc = computeConfidence(p.duration_months, now);
  const total = moneyOverDuration(p.tuition.value, usableMonths(p, now));
  if (total == null) return null;
  return {
    amount: total,
    currency: p.tuition.value.currency,
    confidence: p.tuition.value.period === 'total' ? tc : weakestConfidence(tc, dc),
  };
}

/** Why programTuitionTotal returned null, in plain words (null when it returns a total). */
export function programTuitionTotalProblem(p: Program, now: Date): string | null {
  const tc = computeConfidence(p.tuition, now);
  if (tc === 'Conflict') return 'Tuition sources conflict';
  if (!isUsable(tc) || !p.tuition.value) return 'Tuition not verified yet';
  return moneyOverDurationProblem(p.tuition.value, usableMonths(p, now), 'tuition');
}

/** Student-facing notes of the usable tuition and living-cost facts (see CostResult.caveats). */
export function costCaveats(p: Program, now: Date): string[] {
  const out: string[] = [];
  for (const [fact, label] of [
    [p.tuition, 'Tuition'],
    [p.living_cost, 'Living cost'],
  ] as const) {
    const note = fact.note;
    if (!isUsable(computeConfidence(fact, now)) || !fact.value) continue;
    if (typeof note === 'string' && note.trim() !== '') out.push(`${label}: ${note.trim()}`);
  }
  return out;
}

/** Tuition + living for the whole programme. */
export function programTotalCost(p: Program, fx: FxRate[], now: Date): CostResult {
  const missing: string[] = [];
  const confs: Confidence[] = [];
  const caveats = costCaveats(p, now);

  const tc = computeConfidence(p.tuition, now);
  const lc = computeConfidence(p.living_cost, now);
  const dc = computeConfidence(p.duration_months, now);
  if (!isUsable(tc) || !p.tuition.value) missing.push(tc === 'Conflict' ? 'Tuition sources conflict' : 'Tuition not verified yet');
  if (!isUsable(lc) || !p.living_cost.value) missing.push(lc === 'Conflict' ? 'Living-cost sources conflict' : 'Living cost not verified yet');
  const months = usableMonths(p, now);

  const parts: { amount: number; currency: string }[] = [];
  for (const [fact, conf, label] of [
    [p.tuition, tc, 'tuition'],
    [p.living_cost, lc, 'living cost'],
  ] as const) {
    if (!isUsable(conf) || !fact.value) continue;
    const total = moneyOverDuration(fact.value, months);
    if (total == null) {
      missing.push(moneyOverDurationProblem(fact.value, months, label) ?? `Cannot total ${label}`);
      continue;
    }
    parts.push({ amount: total, currency: fact.value.currency });
    confs.push(conf);
    if (fact.value.period !== 'total') confs.push(dc);
  }

  if (missing.length > 0 || parts.length < 2) {
    return { native: null, pkr: null, confidence: 'Unverified', missing: missing.length ? missing : ['Cost data incomplete'], caveats };
  }

  const sameCurrency = parts.every((x) => x.currency === parts[0].currency);
  const native = sameCurrency ? { amount: parts.reduce((s, x) => s + x.amount, 0), currency: parts[0].currency } : null;

  let pkr: number | null = 0;
  for (const part of parts) {
    const rate = pkrRateStatus(part.currency, fx, now);
    if (!rate.ok) {
      pkr = null;
      missing.push(rate.reason);
      break;
    }
    pkr += part.amount * rate.rate;
    confs.push(rate.confidence);
  }

  return { native, pkr, confidence: weakestConfidence(...confs), missing, caveats };
}
