import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { PERSONA_A } from '@/lib/profile';
import { conflicting, FIXED_NOW, likely, makeProgram, unverified, verified, loadEmptySeedDataset } from '@/lib/test-fixtures';
import type { ConditionalAdmission, ConversionRule, GpaRule, Program } from '@/lib/types';
import { buildFitView, programForFitPanel } from './fit-view';

const now = FIXED_NOW;
const student = { cgpa: 2.5, scale: 'cgpa_4' as const, min_pass: null };

const fixtureRule = (overrides: Partial<ConversionRule> = {}): ConversionRule => ({
  id: 'fixture-bavarian',
  scope: 'PK->*',
  from_scale: 'cgpa_4',
  to_scale: 'german',
  formula: 'modified_bavarian',
  params: { nmax: 4, nmin: [1, 2] },
  source_url: 'https://fixture.example.edu/conversion',
  notes: 'Fixture conversion note.',
  ...overrides,
});

const sameScaleMin = (min: number): GpaRule => ({ scale: 'cgpa_4', min, text: 'Fixture wording' });

describe('buildFitView', () => {
  it('missing minimum: Competitive range unknown, Unverified badge, no conversion row', () => {
    const v = buildFitView(student, makeProgram(), [], now);
    expect(v.fit.label).toBe('Competitive range unknown');
    expect(v.fit.reason.code).toBe('MIN_NOT_VERIFIED');
    expect(v.minimum).toEqual({ kind: 'missing', confidence: 'Unverified' });
    expect(v.converted).toBeNull();
    expect(v.conversion).toBeNull();
    expect(v.grade).toBe('2.5 (CGPA out of 4.0)');
  });

  it('a minimum with a value but no evidence is still treated as missing', () => {
    const v = buildFitView(student, makeProgram({ min_gpa_rule: unverified(sameScaleMin(2.0)) }), [], now);
    expect(v.fit.label).toBe('Competitive range unknown');
    expect(v.minimum.kind).toBe('missing');
  });

  it('conflicting minimum: shows the Conflict state, never a value', () => {
    const p = makeProgram({ min_gpa_rule: conflicting(sameScaleMin(2.0), sameScaleMin(3.0)) });
    const v = buildFitView(student, p, [], now);
    expect(v.fit.reason.code).toBe('MIN_CONFLICT');
    expect(v.minimum).toEqual({ kind: 'conflict', confidence: 'Conflict' });
  });

  it('same scale, verified minimum: Meets minimum with source and no conversion needed', () => {
    const p = makeProgram({ min_gpa_rule: verified(sameScaleMin(2.5)) });
    const v = buildFitView(student, p, [], now);
    expect(v.fit.label).toBe('Meets minimum');
    expect(v.minimum).toMatchObject({ kind: 'value', confidence: 'Verified', sourceUrl: 'https://fixture.example.edu/program' });
    expect(v.minimum.kind === 'value' && v.minimum.text).toContain('2.5 or higher');
    expect(v.conversion).toEqual({ kind: 'same_scale' });
    expect(v.converted).toBeNull();
    expect(v.showNarrowHint).toBe(false);
  });

  it('same scale, likely minimum above the grade: Below minimum with a Likely badge', () => {
    const p = makeProgram({ min_gpa_rule: likely(sameScaleMin(3.0)) });
    const v = buildFitView(student, p, [], now);
    expect(v.fit.label).toBe('Below minimum');
    expect(v.minimum).toMatchObject({ kind: 'value', confidence: 'Likely' });
  });

  it('German minimum with a sourced rule: shows the converted RANGE and its scale label', () => {
    const p = makeProgram({ country: 'DE', min_gpa_rule: verified<GpaRule>({ scale: 'german', min: 2.5 }) });
    const v = buildFitView(student, p, [fixtureRule()], now);
    expect(v.converted).not.toBeNull();
    expect(v.converted!.isRange).toBe(true);
    expect(v.converted!.scaleLabel).toMatch(/German grade/);
    expect(v.converted!.value).toMatch(/^\d(\.\d+)?–\d(\.\d+)?$/);
    expect(v.conversion).toEqual({ kind: 'sourced', url: 'https://fixture.example.edu/conversion' });
    expect(v.showNarrowHint).toBe(true);
    expect(v.ruleNotes).toBe('Fixture conversion note.');
    expect(v.minimum.kind === 'value' && v.minimum.text).toContain('or better');
  });

  it('a transcript minimum narrows the range and hides the hint', () => {
    const p = makeProgram({ country: 'DE', min_gpa_rule: verified<GpaRule>({ scale: 'german', min: 2.5 }) });
    const v = buildFitView({ ...student, min_pass: 1 }, p, [fixtureRule()], now);
    expect(v.converted!.isRange).toBe(false);
    expect(v.showNarrowHint).toBe(false);
  });

  it('an unsourced rule: range shown, fit refused, "source not verified" state', () => {
    const p = makeProgram({ country: 'DE', min_gpa_rule: verified<GpaRule>({ scale: 'german', min: 2.5 }) });
    const v = buildFitView(student, p, [fixtureRule({ source_url: null })], now);
    expect(v.fit.reason.code).toBe('CONVERSION_RULE_UNSOURCED');
    expect(v.fit.label).toBe('Competitive range unknown');
    expect(v.converted).not.toBeNull();
    expect(v.conversion).toEqual({ kind: 'unsourced' });
  });

  it('no rule for the scale: "source not verified" state, no converted value', () => {
    const p = makeProgram({ country: 'DE', min_gpa_rule: verified<GpaRule>({ scale: 'german', min: 2.5 }) });
    const v = buildFitView(student, p, [], now);
    expect(v.fit.reason.code).toBe('NO_CONVERSION_RULE');
    expect(v.converted).toBeNull();
    expect(v.conversion).toEqual({ kind: 'unsourced' });
  });

  it('ruled-out program: no fit decision', () => {
    const p = makeProgram({ status: 'ruled_out', min_gpa_rule: verified(sameScaleMin(2.0)) });
    const v = buildFitView(student, p, [], now);
    expect(v.fit.label).toBe('Competitive range unknown');
    expect(v.fit.reason.code).toBe('NOT_ACCEPTING');
  });

  it('every seed program gives "Competitive range unknown" today (no verified minimums yet)', () => {
    const seed = loadEmptySeedDataset();
    for (const p of seed.programs) {
      const v = buildFitView(student, p, seed.conversionRules, now);
      expect(v.fit.label, p.id).toBe('Competitive range unknown');
      expect(v.minimum.kind, p.id).toBe('missing');
    }
  });

  it('never mentions a percentage chance', () => {
    const p = makeProgram({ min_gpa_rule: verified(sameScaleMin(2.0)) });
    const v = buildFitView(student, p, [], now);
    expect(JSON.stringify(v)).not.toMatch(/chance|probab|\d\s*%/i);
  });

  it('passes the student-facing note of the minimum to the panel (e.g. an assumed grade scale)', () => {
    const p = makeProgram({
      min_gpa_rule: {
        ...likely(sameScaleMin(2.7)),
        basis: 'inferred',
        note: 'Fixture: the page gives GPA 2.7 without naming the scale.',
        review_note: 'FIXTURE INTERNAL REVIEW NOTE',
      },
    });
    const v = buildFitView(student, p, [], now);
    expect(v.minimum).toMatchObject({
      kind: 'value',
      confidence: 'Likely',
      note: 'Fixture: the page gives GPA 2.7 without naming the scale.',
    });
    expect(JSON.stringify(v)).not.toContain('FIXTURE INTERNAL REVIEW NOTE');
  });

  it('who-this-course-is-for never changes the fit label (it is a warning only)', () => {
    const base = makeProgram({ min_gpa_rule: verified(sameScaleMin(2.0)) });
    const withNote = makeProgram({
      min_gpa_rule: verified(sameScaleMin(2.0)),
      eligibility_note: verified('Fixture: for graduates of subjects other than computing.'),
    });
    expect(buildFitView(student, withNote, [], now).fit).toEqual(buildFitView(student, base, [], now).fit);
  });
});

describe('next steps next to the label (they never change it)', () => {
  const route: ConditionalAdmission = { scale: 'cgpa_4', min: 2.5, text: 'Fixture: GPA 2.5 to 2.84 may be admitted conditionally.' };

  it('Below minimum: links to Plan B; any other reason does not', () => {
    expect(buildFitView(student, makeProgram({ min_gpa_rule: verified(sameScaleMin(3.0)) }), [], now).showPlanB).toBe(true);
    expect(buildFitView(student, makeProgram({ min_gpa_rule: verified(sameScaleMin(2.0)) }), [], now).showPlanB).toBe(false);
    expect(buildFitView(student, makeProgram(), [], now).showPlanB).toBe(false);
    const ruledOut = makeProgram({ status: 'ruled_out', min_gpa_rule: verified(sameScaleMin(3.0)) });
    expect(buildFitView(student, ruledOut, [], now).showPlanB).toBe(false);
  });

  it('a usable route below the minimum is shown with its lines and badge, and the label stays the same', () => {
    const base = makeProgram({ min_gpa_rule: verified(sameScaleMin(3.0)) });
    const withRoute = makeProgram({
      min_gpa_rule: verified(sameScaleMin(3.0)),
      conditional_admission: { ...verified(route), note: 'Fixture route note', review_note: 'FIXTURE INTERNAL ROUTE NOTE' },
    });
    const v = buildFitView(student, withRoute, [], now);
    expect(v.fit).toEqual(buildFitView(student, base, [], now).fit);
    expect(v.fit.label).toBe('Below minimum');
    expect(v.conditional).toEqual({
      lines: ["This route's minimum: 2.5 or higher (CGPA out of 4.0)", 'In short: Fixture: GPA 2.5 to 2.84 may be admitted conditionally.'],
      confidence: 'Verified',
      sourceUrl: 'https://fixture.example.edu/program',
      note: 'Fixture route note',
    });
    expect(JSON.stringify(v)).not.toContain('FIXTURE INTERNAL');
  });

  it('a route with no floor shows only its summary', () => {
    const p = makeProgram({ conditional_admission: likely<ConditionalAdmission>({ scale: 'cgpa_4', min: null, text: 'Fixture provisional route' }) });
    const v = buildFitView(student, p, [], now);
    expect(v.fit.reason.code).toBe('MIN_NOT_VERIFIED');
    expect(v.conditional?.lines).toEqual(['In short: Fixture provisional route']);
    expect(v.conditional?.confidence).toBe('Likely');
  });

  it('no route block when the route is Unverified or in Conflict, when the minimum is met, or when ruled out', () => {
    const cases: Program[] = [
      makeProgram({ min_gpa_rule: verified(sameScaleMin(3.0)), conditional_admission: unverified(route) }),
      makeProgram({ min_gpa_rule: verified(sameScaleMin(3.0)), conditional_admission: conflicting(route, { ...route, min: 2.0 }) }),
      makeProgram({ min_gpa_rule: verified(sameScaleMin(2.0)), conditional_admission: verified(route) }),
      makeProgram({ status: 'ruled_out', conditional_admission: verified(route) }),
    ];
    for (const p of cases) expect(buildFitView(student, p, [], now).conditional).toBeNull();
  });

  it('no conversion rule: the next step and the official minimum (summary + evidence), label unchanged', () => {
    const p = makeProgram({
      country: 'DE',
      min_gpa_rule: verified<GpaRule>({ scale: 'german', min: 2.5, text: '“Fixture: 2.5 or better”' }),
    });
    const v = buildFitView({ cgpa: 3.4, scale: 'cgpa_5', min_pass: null }, p, [], now);
    expect(v.fit.reason.code).toBe('NO_CONVERSION_RULE');
    expect(v.fit.label).toBe('Competitive range unknown');
    expect(v.noConversion).toEqual({ summary: 'Fixture: 2.5 or better', evidence: p.min_gpa_rule.evidence_snippet });
    expect(v.showPlanB).toBe(false);
    // Any other reason: no such block.
    expect(buildFitView(student, makeProgram({ min_gpa_rule: verified(sameScaleMin(3.0)) }), [], now).noConversion).toBeNull();
  });

  it('live seed, persona A: Brookes is Below minimum with a Plan B link; NYIT and UCCS show their route; labels unchanged', () => {
    const live = loadSeedDataset();
    const at = new Date('2026-11-24T12:00:00Z');
    const view = (id: string) => buildFitView(PERSONA_A, live.programs.find((p) => p.id === id) as Program, live.conversionRules, at);
    const brookes = view('brookes-msc-cs');
    expect(brookes.fit.label).toBe('Below minimum');
    expect(brookes.showPlanB).toBe(true);
    expect(brookes.conditional).toBeNull();
    for (const id of ['nyit-mscs', 'uccs-mscs']) {
      const v = view(id);
      const p = live.programs.find((x) => x.id === id) as Program;
      const without = buildFitView(PERSONA_A, { ...p, conditional_admission: unverified() }, live.conversionRules, at);
      expect(v.fit, id).toEqual(without.fit);
      expect(v.conditional, id).not.toBeNull();
      expect(v.conditional?.confidence, id).toBe('Verified');
    }
    expect(view('nyit-mscs').conditional?.lines[0]).toBe("This route's minimum: 2.5 or higher (CGPA out of 4.0)");
    expect(view('uccs-mscs').conditional?.lines).toHaveLength(1);
  });
});

describe('programForFitPanel', () => {
  it('keeps conditional_admission (for the route block) without its review_note; other facts stay empty', () => {
    const route: ConditionalAdmission = { scale: 'cgpa_4', min: 2.5, text: 'Fixture route' };
    const p = makeProgram({
      conditional_admission: { ...verified(route), review_note: 'FIXTURE INTERNAL ROUTE NOTE' },
      language_waiver: verified('Fixture waiver'),
      deadline: verified('2027-01-15'),
    });
    const slim = programForFitPanel(p);
    expect(slim.conditional_admission.value).toEqual(route);
    expect(JSON.stringify(slim)).not.toContain('FIXTURE INTERNAL');
    expect(slim.language_waiver.value).toBeNull();
    expect(slim.deadline.value).toBeNull();
    expect(buildFitView(student, slim, [], now).conditional).toEqual(buildFitView(student, p, [], now).conditional);
  });

  it('keeps only min_gpa_rule, without the internal review_note (also on conflicting sources)', () => {
    const rule = conflicting(sameScaleMin(2.0), sameScaleMin(3.0));
    rule.review_note = 'FIXTURE INTERNAL REVIEW NOTE A';
    rule.note = 'Fixture student note';
    rule.conflicts![0].review_note = 'FIXTURE INTERNAL REVIEW NOTE B';
    const p = makeProgram({
      min_gpa_rule: rule,
      eligibility_note: { ...verified('Fixture eligibility'), review_note: 'FIXTURE INTERNAL REVIEW NOTE C' },
    });
    const slim = programForFitPanel(p);
    const json = JSON.stringify(slim);
    expect(json).not.toContain('FIXTURE INTERNAL REVIEW NOTE');
    expect(json).not.toContain('review_note');
    expect(slim.min_gpa_rule.note).toBe('Fixture student note');
    expect(slim.min_gpa_rule.conflicts).toHaveLength(1);
    expect(slim.eligibility_note.value).toBeNull();
    // Slimming never changes the fit decision.
    expect(buildFitView(student, slim, [], now).fit).toEqual(buildFitView(student, p, [], now).fit);
    // The input is not mutated.
    expect(p.min_gpa_rule.review_note).toBe('FIXTURE INTERNAL REVIEW NOTE A');
  });
});
