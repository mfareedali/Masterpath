import { describe, expect, it } from 'vitest';
import { plausibilityFlags } from './plausibility';

const NOW = '2026-11-27T10:00:00Z';

describe('plausibilityFlags', () => {
  it('accepts ordinary tuition and flags a wrong period or unknown currency', () => {
    expect(plausibilityFlags('money', { amount: 2190, currency: 'CHF', period: 'semester' }, 'CHF 2190 / semester', NOW)).toEqual([]);
    expect(plausibilityFlags('money', { amount: 48300, currency: 'GBP', period: 'month' }, 'x', NOW)[0]).toMatch(/above the usual range/);
    expect(plausibilityFlags('money', { amount: 12, currency: 'EUR', period: 'year' }, 'x', NOW)[0]).toMatch(/unusually low/);
    expect(plausibilityFlags('money', { amount: 500, currency: 'XYZ', period: 'year' }, 'x', NOW)[0]).toMatch(/no plausibility bounds/);
  });

  it('flags zero tuition for a human (it may be a waived fee, not the tuition)', () => {
    expect(plausibilityFlags('money', { amount: 0, currency: 'EUR', period: 'semester' }, 'x', NOW).join(' ')).toMatch(/zero amount/);
  });

  it('range-checks grade minimums per scale', () => {
    expect(plausibilityFlags('gpa_rule', { scale: 'cgpa_4', min: 3.0, text: 'x' }, 'x', NOW)).toEqual([]);
    expect(plausibilityFlags('gpa_rule', { scale: 'cgpa_4', min: 6, text: 'x' }, 'x', NOW)[0]).toMatch(/outside 1.5-4/);
    expect(plausibilityFlags('gpa_rule', { scale: 'percent', min: 20, text: 'x' }, 'x', NOW)[0]).toMatch(/outside 40-100/);
  });

  it('requires a year on dates and flags past or far-future deadlines', () => {
    expect(plausibilityFlags('deadline', '2027-05-31', 'Deadline: 31 May 2027', NOW)).toEqual([]);
    expect(plausibilityFlags('deadline', '2027-05-31', 'compulsory deadline: May 31', NOW)[0]).toMatch(/gives no year/);
    expect(plausibilityFlags('deadline', '2026-01-15', 'closes 15 January 2026', NOW).join(' ')).toMatch(/in the past/);
    expect(plausibilityFlags('deadline', '2031-01-15', 'closes 15 January 2031', NOW).join(' ')).toMatch(/two years/);
  });

  it('checks durations, letters and language scores', () => {
    expect(plausibilityFlags('duration_months', 24, 'x', NOW)).toEqual([]);
    expect(plausibilityFlags('duration_months', 2, 'x', NOW)[0]).toMatch(/outside/);
    expect(plausibilityFlags('lor_count', 9, 'x', NOW)[0]).toMatch(/unusually many/);
    expect(plausibilityFlags('language_req', { ielts_overall: 15, toefl_ibt: null, waiver: null, text: 'x' }, 'x', NOW)[0]).toMatch(/IELTS/);
  });
});
