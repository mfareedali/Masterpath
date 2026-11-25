import { describe, expect, it } from 'vitest';
import {
  FX_MAX_AGE_DAYS,
  moneyOverDuration,
  moneyOverDurationProblem,
  pkrRate,
  pkrRateStatus,
  programTotalCost,
  programTuitionTotal,
  programTuitionTotalProblem,
  toPkr,
} from './cost';
import { loadSeedDataset } from './data/seed-source';
import { FIXED_NOW, conflicting, likely, makeProgram, unverified, verified } from './test-fixtures';
import type { FxRate } from './types';

const fx: FxRate[] = [{ id: 'gbp-pkr', currency: 'GBP', pkr_per_unit: verified(100) }];
/** Demo day. */
const NOW_DEMO = new Date('2026-12-02T09:00:00Z');

describe('programTotalCost', () => {
  it('is Unverified with a reason when data is missing (never guesses)', () => {
    const r = programTotalCost(makeProgram(), fx, FIXED_NOW);
    expect(r.pkr).toBeNull();
    expect(r.confidence).toBe('Unverified');
    expect(r.missing).toContain('Tuition not verified yet');
  });

  it('totals tuition + living over the verified duration and converts with a verified rate', () => {
    const p = makeProgram({
      tuition: verified({ amount: 10_000, currency: 'GBP', period: 'year' as const }),
      living_cost: verified({ amount: 1_000, currency: 'GBP', period: 'month' as const }),
      duration_months: verified(12),
    });
    const r = programTotalCost(p, fx, FIXED_NOW);
    expect(r.native).toEqual({ amount: 22_000, currency: 'GBP' });
    expect(r.pkr).toBe(2_200_000);
    expect(r.confidence).toBe('Verified');
  });

  it('no verified exchange rate -> no PKR figure', () => {
    const p = makeProgram({
      tuition: verified({ amount: 10_000, currency: 'GBP', period: 'total' as const }),
      living_cost: verified({ amount: 9_000, currency: 'GBP', period: 'total' as const }),
    });
    const r = programTotalCost(p, [{ id: 'gbp-pkr', currency: 'GBP', pkr_per_unit: unverified(350) }], FIXED_NOW);
    expect(r.native?.amount).toBe(19_000);
    expect(r.pkr).toBeNull();
    expect(r.missing.join(' ')).toMatch(/exchange rate/);
  });

  it('yearly tuition without a verified duration cannot be totalled', () => {
    const p = makeProgram({ tuition: verified({ amount: 10_000, currency: 'GBP', period: 'year' as const }) });
    expect(programTuitionTotal(p, FIXED_NOW)).toBeNull();
  });
});

/* ---------------- Exchange-rate age (proposal #25) ---------------- */

describe('pkrRate: a stale exchange rate never decides a PKR total', () => {
  const rate = (ageDays: number): FxRate[] => [{ id: 'gbp-pkr', currency: 'GBP', pkr_per_unit: verified(100, ageDays) }];
  const totals = makeProgram({
    tuition: verified({ amount: 10_000, currency: 'GBP', period: 'total' as const }),
    living_cost: verified({ amount: 9_000, currency: 'GBP', period: 'total' as const }),
  });

  it(`a rate up to ${FX_MAX_AGE_DAYS} days old works (Likely after 30 days)`, () => {
    expect(pkrRate('GBP', rate(10), FIXED_NOW)).toEqual({ rate: 100, confidence: 'Verified' });
    expect(pkrRate('GBP', rate(FX_MAX_AGE_DAYS), FIXED_NOW)).toEqual({ rate: 100, confidence: 'Likely' });
    expect(programTotalCost(totals, rate(10), FIXED_NOW).pkr).toBe(1_900_000);
  });

  it('a 46-day-old rate gives no PKR figure, with the reason', () => {
    expect(FX_MAX_AGE_DAYS).toBe(45);
    expect(pkrRate('GBP', rate(46), FIXED_NOW)).toBeNull();
    expect(toPkr(1000, 'GBP', rate(46), FIXED_NOW)).toBeNull();
    expect(pkrRateStatus('GBP', rate(46), FIXED_NOW)).toEqual({ ok: false, reason: 'GBP→PKR exchange rate is older than 45 days' });
    const r = programTotalCost(totals, rate(46), FIXED_NOW);
    expect(r.native).toEqual({ amount: 19_000, currency: 'GBP' });
    expect(r.pkr).toBeNull();
    expect(r.missing).toEqual(['GBP→PKR exchange rate is older than 45 days']);
  });

  it('the audit probe: a 541-day-old verbatim rate is not "Likely forever"', () => {
    expect(programTotalCost(totals, rate(541), FIXED_NOW).pkr).toBeNull();
  });

  it('a summary-basis rate without a date cannot be used; a Conflict says so', () => {
    const undated: FxRate[] = [{ id: 'gbp-pkr', currency: 'GBP', pkr_per_unit: { ...likely(100), fetched_at: null } }];
    expect(pkrRateStatus('GBP', undated, FIXED_NOW)).toEqual({ ok: false, reason: 'The GBP→PKR exchange rate has no date, so we cannot use it' });
    const both: FxRate[] = [{ id: 'gbp-pkr', currency: 'GBP', pkr_per_unit: conflicting(100, 120) }];
    expect(pkrRateStatus('GBP', both, FIXED_NOW)).toEqual({ ok: false, reason: 'GBP→PKR exchange rate sources conflict' });
    expect(pkrRateStatus('GBP', [], FIXED_NOW)).toEqual({ ok: false, reason: 'No verified GBP→PKR exchange rate yet' });
    expect(pkrRateStatus('PKR', [], FIXED_NOW)).toMatchObject({ ok: true, rate: 1 });
  });

  it('the shipped seed has no usable rates yet, so every live total says why', () => {
    const data = loadSeedDataset();
    for (const p of data.programs) {
      const r = programTotalCost(p, data.fxRates, NOW_DEMO);
      expect(r.pkr, p.id).toBeNull();
      expect(r.missing.length, p.id).toBeGreaterThan(0);
    }
  });
});

/* ---------------- Whole terms only (proposal #26) ---------------- */

describe('moneyOverDuration: fees are totalled only over whole semesters or years', () => {
  const sem = { amount: 1000, currency: 'EUR', period: 'semester' as const };
  const year = { amount: 20_000, currency: 'GBP', period: 'year' as const };

  it('the four audit probes are not totalled', () => {
    expect(moneyOverDuration(sem, 15)).toBeNull();
    expect(moneyOverDuration(sem, 16)).toBeNull();
    expect(moneyOverDuration(year, 18)).toBeNull();
    expect(moneyOverDuration(year, 16)).toBeNull();
  });

  it('whole periods are unchanged', () => {
    expect(moneyOverDuration(sem, 24)).toBe(4000);
    expect(moneyOverDuration(sem, 12)).toBe(2000);
    expect(moneyOverDuration(year, 12)).toBe(20_000);
    expect(moneyOverDuration(year, 24)).toBe(40_000);
    expect(moneyOverDuration({ amount: 900, currency: 'GBP', period: 'month' }, 16)).toBe(14_400);
    expect(moneyOverDuration({ amount: 5, currency: 'GBP', period: 'total' }, null)).toBe(5);
  });

  it('no length, a zero length or a fractional month count is never totalled', () => {
    expect(moneyOverDuration(year, null)).toBeNull();
    expect(moneyOverDuration(year, 0)).toBeNull();
    expect(moneyOverDuration({ amount: 900, currency: 'GBP', period: 'month' }, 12.5)).toBeNull();
  });

  it('says why in plain words', () => {
    expect(moneyOverDurationProblem(sem, 15, 'tuition')).toBe(
      'Programme length (15 months) is not a whole number of semesters, so we cannot total the tuition',
    );
    expect(moneyOverDurationProblem(year, 18, 'living cost')).toBe(
      'Programme length (18 months) is not a whole number of years, so we cannot total the living cost',
    );
    expect(moneyOverDurationProblem(year, null, 'tuition')).toBe('Programme length not verified yet (needed to total tuition)');
    expect(moneyOverDurationProblem(year, 12, 'tuition')).toBeNull();
  });

  it('programTotalCost and programTuitionTotal carry the reason instead of a pro-rated total', () => {
    const p = makeProgram({
      tuition: verified(year),
      living_cost: verified({ amount: 1_000, currency: 'GBP', period: 'month' as const }),
      duration_months: verified(16),
    });
    const r = programTotalCost(p, fx, FIXED_NOW);
    expect(r.native).toBeNull();
    expect(r.missing).toEqual(['Programme length (16 months) is not a whole number of years, so we cannot total the tuition']);
    expect(programTuitionTotal(p, FIXED_NOW)).toBeNull();
    expect(programTuitionTotalProblem(p, FIXED_NOW)).toMatch(/not a whole number of years/);
    expect(programTuitionTotalProblem(makeProgram(), FIXED_NOW)).toBe('Tuition not verified yet');
    expect(programTuitionTotalProblem({ ...p, duration_months: verified(12) }, FIXED_NOW)).toBeNull();
  });
});

/* ---------------- Caveats from student-facing notes (proposal #11) ---------------- */

describe('CostResult.caveats', () => {
  it('lists the usable tuition and living notes, never review notes or unusable facts', () => {
    const p = makeProgram({
      tuition: {
        ...verified({ amount: 0, currency: 'EUR', period: 'semester' as const }),
        note: ' Fixture: a semester fee is due. ',
        review_note: 'internal reviewer text',
      },
      living_cost: { ...unverified({ amount: 1, currency: 'EUR', period: 'month' as const }), note: 'Fixture: unverified note' },
      duration_months: verified(24),
    });
    const r = programTotalCost(p, fx, FIXED_NOW);
    expect(r.caveats).toEqual(['Tuition: Fixture: a semester fee is due.']);
    expect(JSON.stringify(r)).not.toMatch(/internal reviewer|unverified note/);
    expect(programTotalCost(makeProgram(), fx, FIXED_NOW).caveats).toEqual([]);
  });

  it.each([FIXED_NOW, NOW_DEMO])('live Würzburg: the "Verified" total carries the semester-contribution note (now %s)', (now) => {
    const data = loadSeedDataset();
    const w = data.programs.find((p) => p.id === 'wuerzburg-msc-cs')!;
    const r = programTotalCost(w, data.fxRates, now);
    expect(r.native).toEqual({ amount: 24_000, currency: 'EUR' });
    expect(r.caveats).toHaveLength(1);
    expect(r.caveats[0]).toMatch(/^Tuition: .*semester contribution/);
    expect(r.caveats[0]).toContain(w.tuition.note!.trim());
  });
});
