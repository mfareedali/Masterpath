import { describe, expect, it } from 'vitest';
import { emptyFact } from '../confidence';
import { loadSeedDataset } from '../data/seed-source';
import { PERSONA_A } from '../profile';
import type { ConditionalAdmission, ConversionRule } from '../types';
import { FIXED_NOW, conflicting, likely, makeProgram, unverified, verified } from '../test-fixtures';
import { computeFit, convertGrade, fitSortValue, minimumForScale, modifiedBavarian } from './index';

const BAVARIAN: ConversionRule = {
  id: 'test-bavarian',
  scope: 'PK->*',
  from_scale: 'cgpa_4',
  to_scale: 'german',
  formula: 'modified_bavarian',
  params: { nmax: 4, nmin: [1, 2] },
  source_url: 'https://fixture.example.edu/grade-conversion',
};
const RULES = [BAVARIAN];

const ukMin3 = makeProgram({ country: 'UK', min_gpa_rule: verified({ scale: 'cgpa_4' as const, min: 3.0 }) });
const deMin25 = makeProgram({ country: 'DE', min_gpa_rule: verified({ scale: 'german' as const, min: 2.5 }) });

describe('modified Bavarian formula (worked examples)', () => {
  it('2.5/4 with Nmin 1.0 -> 2.5', () => expect(modifiedBavarian(2.5, 4, 1)).toBeCloseTo(2.5));
  it('2.5/4 with Nmin 2.0 -> 3.25', () => expect(modifiedBavarian(2.5, 4, 2)).toBeCloseTo(3.25));
  it('4.0/4 is always 1.0 (best)', () => expect(modifiedBavarian(4, 4, 2)).toBeCloseTo(1));
  it('3.5/4 with Nmin 1.0 -> 1.5', () => expect(modifiedBavarian(3.5, 4, 1)).toBeCloseTo(1.5));
});

describe('convertGrade returns a RANGE and the rule source', () => {
  it('unknown transcript Nmin gives a range', () => {
    const r = convertGrade({ cgpa: 2.5, scale: 'cgpa_4' }, 'german', 'DE', RULES);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.range.low).toBe(2.5);
      expect(r.range.high).toBe(3.25);
      expect(r.range.better).toBe('lower');
      expect(r.range.rule_source_url).toBe(BAVARIAN.source_url);
    }
  });
  it('known transcript Nmin narrows it to one value', () => {
    const r = convertGrade({ cgpa: 2.5, scale: 'cgpa_4', min_pass: 2 }, 'german', 'DE', RULES);
    expect(r.ok && r.range.low === 3.25 && r.range.high === 3.25).toBe(true);
  });
  it('identity needs no rule', () => {
    const r = convertGrade({ cgpa: 2.5, scale: 'cgpa_4' }, 'cgpa_4', 'UK', []);
    expect(r.ok && r.range.rule_id === null && r.range.low === 2.5).toBe(true);
  });
  it('no rule -> NO_CONVERSION_RULE', () => {
    const r = convertGrade({ cgpa: 4.2, scale: 'cgpa_5' }, 'german', 'DE', RULES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_CONVERSION_RULE');
  });
});

describe('computeFit — three labels only, code decides', () => {
  it('Persona A (2.5/4) vs verified 3.0/4 minimum -> Below minimum', () => {
    const f = computeFit({ cgpa: 2.5, scale: 'cgpa_4' }, ukMin3, RULES, FIXED_NOW);
    expect(f.label).toBe('Below minimum');
    expect(f.reason.code).toBe('BELOW_MIN');
    expect(f.required?.min).toBe(3);
  });

  it('3.2/4 vs 3.0 -> Meets minimum; exactly 3.0 also meets', () => {
    expect(computeFit({ cgpa: 3.2, scale: 'cgpa_4' }, ukMin3, RULES, FIXED_NOW).label).toBe('Meets minimum');
    expect(computeFit({ cgpa: 3.0, scale: 'cgpa_4' }, ukMin3, RULES, FIXED_NOW).label).toBe('Meets minimum');
  });

  it('German: 2.5/4 with unknown Nmin straddles 2.5 -> Competitive range unknown', () => {
    const f = computeFit({ cgpa: 2.5, scale: 'cgpa_4' }, deMin25, RULES, FIXED_NOW);
    expect(f.label).toBe('Competitive range unknown');
    expect(f.reason.code).toBe('STRADDLES_MIN');
    expect(f.converted).toMatchObject({ low: 2.5, high: 3.25 });
  });

  it('German: known Nmin 2.0 -> 3.25 -> Below minimum; Nmin 1.0 -> 2.5 -> Meets minimum', () => {
    expect(computeFit({ cgpa: 2.5, scale: 'cgpa_4', min_pass: 2 }, deMin25, RULES, FIXED_NOW).label).toBe('Below minimum');
    expect(computeFit({ cgpa: 2.5, scale: 'cgpa_4', min_pass: 1 }, deMin25, RULES, FIXED_NOW).label).toBe('Meets minimum');
  });

  it('German: 3.5/4 -> 1.5–1.75 -> Meets minimum', () => {
    const f = computeFit({ cgpa: 3.5, scale: 'cgpa_4' }, deMin25, RULES, FIXED_NOW);
    expect(f.label).toBe('Meets minimum');
    expect(f.converted).toMatchObject({ low: 1.5, high: 1.75 });
  });

  it('rule without an official source -> no decision', () => {
    const f = computeFit({ cgpa: 3.5, scale: 'cgpa_4' }, deMin25, [{ ...BAVARIAN, source_url: null }], FIXED_NOW);
    expect(f.label).toBe('Competitive range unknown');
    expect(f.reason.code).toBe('CONVERSION_RULE_UNSOURCED');
  });

  it('unverified minimum -> MIN_NOT_VERIFIED (never guesses)', () => {
    const p = makeProgram({ min_gpa_rule: unverified({ scale: 'cgpa_4' as const, min: 3.0 }) });
    const f = computeFit({ cgpa: 2.0, scale: 'cgpa_4' }, p, RULES, FIXED_NOW);
    expect(f.label).toBe('Competitive range unknown');
    expect(f.reason.code).toBe('MIN_NOT_VERIFIED');
  });

  it('conflicting minimum -> MIN_CONFLICT', () => {
    const p = makeProgram({ min_gpa_rule: conflicting({ scale: 'cgpa_4' as const, min: 3.0 }, { scale: 'cgpa_4' as const, min: 2.75 }) });
    expect(computeFit({ cgpa: 2.5, scale: 'cgpa_4' }, p, RULES, FIXED_NOW).reason.code).toBe('MIN_CONFLICT');
  });

  it('Likely minimum is usable', () => {
    const p = makeProgram({ min_gpa_rule: likely({ scale: 'cgpa_4' as const, min: 2.5 }) });
    const f = computeFit({ cgpa: 2.5, scale: 'cgpa_4' }, p, RULES, FIXED_NOW);
    expect(f.label).toBe('Meets minimum');
    expect(f.required?.confidence).toBe('Likely');
  });

  it('invalid input and ruled-out programs never get a fit decision', () => {
    expect(computeFit({ cgpa: 4.5, scale: 'cgpa_4' }, ukMin3, RULES, FIXED_NOW).reason.code).toBe('INVALID_INPUT');
    const ruledOut = makeProgram({ status: 'ruled_out', min_gpa_rule: ukMin3.min_gpa_rule });
    expect(computeFit({ cgpa: 3.9, scale: 'cgpa_4' }, ruledOut, RULES, FIXED_NOW).reason.code).toBe('NOT_ACCEPTING');
  });

  it('never returns a percentage or probability field', () => {
    const f = computeFit({ cgpa: 2.5, scale: 'cgpa_4' }, ukMin3, RULES, FIXED_NOW);
    expect(JSON.stringify(f)).not.toMatch(/%|probab|chance/i);
  });

  it('fitSortValue ranks Meets < Straddles < Below and excludes unknowns', () => {
    expect(fitSortValue(computeFit({ cgpa: 3.5, scale: 'cgpa_4' }, ukMin3, RULES, FIXED_NOW))).toBe(0);
    expect(fitSortValue(computeFit({ cgpa: 2.5, scale: 'cgpa_4' }, deMin25, RULES, FIXED_NOW))).toBe(1);
    expect(fitSortValue(computeFit({ cgpa: 2.5, scale: 'cgpa_4' }, ukMin3, RULES, FIXED_NOW))).toBe(2);
    expect(fitSortValue(computeFit({ cgpa: 2.5, scale: 'cgpa_4' }, makeProgram(), RULES, FIXED_NOW))).toBeNull();
  });
});

/* ---------------- Minimums printed for another scale in the same snippet (proposals #22 / #37) ---------------- */

describe('GpaRule.alternatives: decide on the minimum printed for the student scale (no conversion)', () => {
  const withPercent = makeProgram({
    country: 'UK',
    min_gpa_rule: likely({ scale: 'cgpa_4' as const, min: 2.7, text: 'Fixture: 60% or GPA 2.7', alternatives: [{ scale: 'percent' as const, min: 60 }] }),
  });

  it('minimumForScale picks the rule scale first, then an alternative, else the rule', () => {
    const rule = withPercent.min_gpa_rule.value!;
    expect(minimumForScale(rule, 'cgpa_4')).toEqual({ scale: 'cgpa_4', min: 2.7, alternative: false });
    expect(minimumForScale(rule, 'percent')).toEqual({ scale: 'percent', min: 60, alternative: true });
    expect(minimumForScale(rule, 'cgpa_5')).toEqual({ scale: 'cgpa_4', min: 2.7, alternative: false });
    expect(minimumForScale({ scale: 'cgpa_4', min: 3 }, 'percent')).toEqual({ scale: 'cgpa_4', min: 3, alternative: false });
    expect(minimumForScale({ scale: 'cgpa_4', min: 3, alternatives: null }, 'percent').alternative).toBe(false);
  });

  it('percent 62 -> Meets minimum; 58 -> Below minimum; exactly 60 meets; required reports the chosen scale', () => {
    const meets = computeFit({ cgpa: 62, scale: 'percent' }, withPercent, RULES, FIXED_NOW);
    expect(meets.label).toBe('Meets minimum');
    expect(meets.required).toMatchObject({ scale: 'percent', min: 60, confidence: 'Likely' });
    expect(meets.converted).toMatchObject({ scale: 'percent', low: 62, high: 62, rule_id: null, rule_formula: 'identity' });
    expect(meets.reason.message).toMatch(/no conversion was needed/);
    expect(computeFit({ cgpa: 58, scale: 'percent' }, withPercent, RULES, FIXED_NOW).label).toBe('Below minimum');
    expect(computeFit({ cgpa: 60, scale: 'percent' }, withPercent, RULES, FIXED_NOW).label).toBe('Meets minimum');
  });

  it('a scale with no printed minimum still needs a sourced conversion rule', () => {
    const f = computeFit({ cgpa: 4.2, scale: 'cgpa_5' }, withPercent, RULES, FIXED_NOW);
    expect(f.reason.code).toBe('NO_CONVERSION_RULE');
    expect(f.required).toMatchObject({ scale: 'cgpa_4', min: 2.7 });
  });

  it('the rule scale is unchanged for CGPA students (2.5/4 is still Below the 2.7 minimum)', () => {
    const f = computeFit({ cgpa: 2.5, scale: 'cgpa_4' }, withPercent, RULES, FIXED_NOW);
    expect(f.label).toBe('Below minimum');
    expect(f.required).toMatchObject({ scale: 'cgpa_4', min: 2.7 });
  });

  it('alternatives never bypass the evidence gates (Unverified or Conflict still decide nothing)', () => {
    const alt = { scale: 'cgpa_4' as const, min: 2.7, alternatives: [{ scale: 'percent' as const, min: 60 }] };
    const unv = makeProgram({ min_gpa_rule: unverified(alt) });
    expect(computeFit({ cgpa: 90, scale: 'percent' }, unv, RULES, FIXED_NOW).reason.code).toBe('MIN_NOT_VERIFIED');
    const conf = makeProgram({ min_gpa_rule: conflicting(alt, { ...alt, min: 3 }) });
    expect(computeFit({ cgpa: 90, scale: 'percent' }, conf, RULES, FIXED_NOW).reason.code).toBe('MIN_CONFLICT');
  });

  it('a percentage result never shows a "%" sign or chance wording', () => {
    const f = computeFit({ cgpa: 62, scale: 'percent' }, withPercent, RULES, FIXED_NOW);
    expect(JSON.stringify(f)).not.toMatch(/%|probab|chance/i);
    expect(f.reason.message).toMatch(/62 out of 100/);
  });
});

describe('live seed: Oxford Brookes "60% or GPA 2.7"', () => {
  const data = loadSeedDataset();
  const brookes = data.programs.find((p) => p.id === 'brookes-msc-cs')!;

  it.each([FIXED_NOW, new Date('2026-12-02T09:00:00Z')])('62%% meets, 55%% is below, persona A unchanged (now %s)', (now) => {
    const pct62 = computeFit({ cgpa: 62, scale: 'percent' }, brookes, data.conversionRules, now);
    expect(pct62.label).toBe('Meets minimum');
    expect(pct62.required).toMatchObject({ scale: 'percent', min: 60, confidence: 'Likely' });
    const pct55 = computeFit({ cgpa: 55, scale: 'percent' }, brookes, data.conversionRules, now);
    expect(pct55.label).toBe('Below minimum');
    const personaA = computeFit(PERSONA_A, brookes, data.conversionRules, now);
    expect(personaA.label).toBe('Below minimum');
    expect(personaA.required).toMatchObject({ scale: 'cgpa_4', min: 2.7, confidence: 'Likely' });
  });
});

describe('conditional routes and language waivers never change the fit label (live seed)', () => {
  const data = loadSeedDataset();
  const profiles = [PERSONA_A, { cgpa: 2.6, scale: 'cgpa_4' as const }, { cgpa: 62, scale: 'percent' as const }];

  it.each([FIXED_NOW, new Date('2026-12-02T09:00:00Z')])('for every program (now %s)', (now) => {
    const withRoute = data.programs.filter((p) => p.conditional_admission.value != null || p.language_waiver.value != null);
    expect(withRoute.length).toBeGreaterThan(0);
    for (const p of data.programs) {
      const stripped = { ...p, conditional_admission: emptyFact<ConditionalAdmission>(), language_waiver: emptyFact<string>() };
      for (const prof of profiles) {
        expect(computeFit(prof, p, data.conversionRules, now), p.id).toEqual(computeFit(prof, stripped, data.conversionRules, now));
      }
    }
  });
});
