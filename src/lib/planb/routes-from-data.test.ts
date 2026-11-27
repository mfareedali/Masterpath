/**
 * Regression tests for: conditional routes from data, DEADLINE_PASSED (proposal #17), "Not decided yet" and
 * per-reason explanations (proposal #2), and ?target= fallbacks for ruled-out / out-of-scope programs (#23).
 */
import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '../data/seed-source';
import { computeFit } from '../fit';
import { PERSONA_A, PERSONA_B_STRENGTHS } from '../profile';
import { conflicting, daysAgo, likely, makeInstitution, makeProgram, unverified, verified } from '../test-fixtures';
import type {
  ConditionalAdmission,
  ConversionRule,
  Fact,
  FxRate,
  GpaRule,
  Institution,
  Money,
  Profile,
  Program,
} from '../types';
import {
  CONDITIONAL_DETAIL,
  CONDITIONAL_MESSAGE,
  DEADLINE_PASSED_DETAIL,
  MAX_SCORE,
  NO_FLOOR_TEXT,
  SCORE_POINTS,
  buildPlanB,
  checkConditional,
  daysLeftText,
  daysUntil,
  deadlineText,
  directConditionalText,
  explainNoTarget,
  shortlistUnknownHref,
  targetRouteNote,
  undecidedMinimumReason,
  undecidedSummary,
  whyThisOrder,
  type PlanB,
  type PlanBInput,
  type PlanRoute,
  type TargetRow,
} from './index';

const NOV_24 = new Date('2026-11-24T12:00:00Z');
const DEC_02 = new Date('2026-12-02T12:00:00Z');

const fx: FxRate[] = [{ id: 'gbp-pkr', currency: 'GBP', pkr_per_unit: verified(100) }];
const student: Profile = { cgpa: 2.5, scale: 'cgpa_4', field: 'cs', target_countries: ['UK'], budget_pkr: 3_000_000 };

const min = (m: number) => verified<GpaRule>({ scale: 'cgpa_4', min: m });
const gbp = (amount: number) => verified<Money>({ amount, currency: 'GBP', period: 'total' });
const costed = (months: number, tuition: number, living: number): Partial<Program> => ({
  duration_months: verified(months),
  tuition: gbp(tuition),
  living_cost: gbp(living),
});
const listed = verified<'listed' | 'not_listed'>('listed');
const COND_URL = 'https://fixture.example.edu/conditional';
const cond = (v: ConditionalAdmission, fact: (x: ConditionalAdmission) => Fact<ConditionalAdmission> = (x) => verified(x, 1, COND_URL)) => ({
  conditional_admission: fact(v),
});
const COND_TEXT = 'Fixture: grades from 2.5 may be admitted on condition of a 3.0 in the first four courses.';

const INSTITUTIONS: Institution[] = [
  makeInstitution({ id: 'u-target', name: 'Fixture University Target', recognition_list_status: listed }),
  makeInstitution({ id: 'u-low', name: 'Fixture University Low', recognition_list_status: listed }),
  makeInstitution({ id: 'u-cond', name: 'Fixture University Conditional' }),
  makeInstitution({ id: 'u-pre', name: 'Fixture University Pre', recognition_list_status: listed }),
];

function prog(id: string, institution_id: string, overrides: Partial<Program> = {}): Program {
  return makeProgram({ id, institution_id, name: `MSc Fixture ${id}`, ...overrides });
}

function plan(programs: Program[], extra: Partial<PlanBInput> = {}): PlanB {
  return buildPlanB({ profile: student, programs, institutions: INSTITUTIONS, rules: [], fx, now: NOV_24, ...extra });
}

const allRoutes = (p: PlanB): PlanRoute[] => [...p.ranked, ...p.notRanked, ...p.blocked];
const route = (p: PlanB, id: string) => allRoutes(p).find((r) => r.id === id);
const codes = (r: PlanRoute | undefined) => r?.gate.warnings.map((w) => w.code) ?? [];

const TARGET = prog('target', 'u-target', { min_gpa_rule: min(3), ...costed(12, 10_000, 5_000) });

/* ------------------------------------------------------------------ */
/* Conditional routes from data                                        */
/* ------------------------------------------------------------------ */

describe('conditional routes from conditional_admission data', () => {
  const nyitLike = prog('cond-direct', 'u-cond', cond({ scale: 'cgpa_4', min: 2.5, text: COND_TEXT }));
  const noFloor = prog('cond-nofloor', 'u-cond', cond({ scale: 'cgpa_4', min: null, text: 'Fixture: below 3.0, admission is provisional.' }));
  const p = plan([TARGET, nyitLike, noFloor]);

  it('a usable route on the student scale with min <= grade becomes a ranked conditional route', () => {
    const r = route(p, 'conditional:cond-direct')!;
    expect(r).toBeDefined();
    expect(r.type).toBe('conditional');
    expect(r.conditional?.status).toBe('meets_floor');
    expect(r.conditional?.reason).toBe('Your grade, 2.5 on the CGPA (out of 4.0), meets the lower limit this route names (2.5).');
    expect(r.conditional?.sourceUrl).toBe(COND_URL);
    expect(r.conditional?.confidence).toBe('Verified');
    expect(r.rank).not.toBeNull();
    expect(r.score!.feasibility).toMatchObject({ points: SCORE_POINTS.feasibility.conditional, known: true });
    expect(whyThisOrder(r.score!)[0]).toBe(
      'Feasibility: You meet the lower limit this conditional route names (2.5); its conditions still apply. +3 points (best is 6).',
    );
  });

  it('never changes the fit label (fit always comes from the regular minimum)', () => {
    for (const id of ['cond-direct', 'cond-nofloor']) {
      const r = allRoutes(p).find((x) => x.program.id === id)!;
      const regular = computeFit(student, r.program, [], NOV_24);
      expect(r.fit).toEqual(regular);
      expect(r.fit.label).toBe('Competitive range unknown');
    }
    // Same with a regular minimum the student is below: still "Below minimum" on the conditional route.
    const below = prog('cond-below-regular', 'u-cond', { min_gpa_rule: min(2.85), ...cond({ scale: 'cgpa_4', min: 2.5, text: COND_TEXT }) });
    const q = plan([TARGET, below], { target: 'cond-below-regular' });
    expect(q.direct?.fit.label).toBe('Below minimum');
    expect(route(q, 'conditional:cond-below-regular')!.fit.label).toBe('Below minimum');
  });

  it('always carries the CONDITIONAL warning (instead of the generic progression warning)', () => {
    const r = route(p, 'conditional:cond-direct')!;
    const w = r.gate.warnings.find((x) => x.code === 'CONDITIONAL')!;
    expect(w).toEqual({ code: 'CONDITIONAL', message: CONDITIONAL_MESSAGE, detail: CONDITIONAL_DETAIL, sourceUrl: COND_URL, confidence: 'Verified' });
    expect(CONDITIONAL_MESSAGE).toBe('Conditional: you must meet the stated conditions to continue');
    expect(codes(r)).not.toContain('PROGRESSION_NOT_GUARANTEED');
    // A verified progression guarantee never removes it.
    const g = plan([TARGET, { ...nyitLike, progression_guaranteed: verified(true) }]);
    expect(codes(route(g, 'conditional:cond-direct'))).toContain('CONDITIONAL');
  });

  it('min null: still a route, with the "no lower limit" soft warning', () => {
    const r = route(p, 'conditional:cond-nofloor')!;
    expect(r.conditional?.status).toBe('no_floor');
    expect(r.rank).not.toBeNull();
    expect(codes(r).slice(0, 2)).toEqual(['CONDITIONAL', 'CONDITIONAL_NO_FLOOR']);
    expect(r.gate.warnings[1].message).toBe('The page names no lower limit; admission is not assured');
    expect(NO_FLOOR_TEXT).toBe('The page names no lower limit; admission is not assured');
    // One more soft warning: one quality step lower, so it ranks below the route with a stated limit.
    expect(r.score!.quality.points).toBe(route(p, 'conditional:cond-direct')!.score!.quality.points - 1);
    expect(r.rank!).toBeGreaterThan(route(p, 'conditional:cond-direct')!.rank!);
  });

  it('below the route\'s own lower limit: listed under "Not for your grade" with the reason, never a route', () => {
    const q = plan([TARGET, nyitLike], { profile: { ...student, cgpa: 2.4 } });
    expect(route(q, 'conditional:cond-direct')).toBeUndefined();
    expect(q.notForYourGrade.map((n) => n.program.id)).toEqual(['cond-direct']);
    expect(q.notForYourGrade[0].check.reason).toBe(
      'Your grade, 2.4 on the CGPA (out of 4.0), is below the lower limit this route names (2.5).',
    );
    expect(q.coverage.find((c) => c.type === 'conditional')).toMatchObject({ shown: 0, notForYourGrade: 1 });
  });

  it('only a Verified or Likely conditional_admission is used', () => {
    for (const fact of [
      unverified<ConditionalAdmission>({ scale: 'cgpa_4', min: 2.5, text: COND_TEXT }),
      conflicting<ConditionalAdmission>({ scale: 'cgpa_4', min: 2.5, text: COND_TEXT }, { scale: 'cgpa_4', min: 2.0, text: COND_TEXT }),
    ]) {
      const q = plan([TARGET, prog('c', 'u-cond', { conditional_admission: fact })]);
      expect(allRoutes(q).some((r) => r.program.id === 'c')).toBe(false);
      expect(q.notForYourGrade).toEqual([]);
    }
    const l = plan([TARGET, prog('c', 'u-cond', cond({ scale: 'cgpa_4', min: 2.5, text: COND_TEXT }, (x) => likely(x)))]);
    expect(route(l, 'conditional:c')?.conditional?.confidence).toBe('Likely');
  });

  it('another scale is reached only through a SOURCED conversion rule', () => {
    const german = (m: number) => prog('c-de', 'u-cond', cond({ scale: 'german', min: m, text: 'Fixture: German grade route.' }));
    const rule = (source_url: string | null): ConversionRule => ({
      id: 'fixture-bavarian',
      scope: 'PK->*',
      from_scale: 'cgpa_4',
      to_scale: 'german',
      formula: 'modified_bavarian',
      params: { nmax: 4, nmin: [1, 2] },
      source_url,
    });

    // No rule, or an unsourced rule: not decided (never a route, never "not for your grade").
    for (const rules of [[], [rule(null)]]) {
      const q = plan([TARGET, german(4)], { rules });
      expect(allRoutes(q).some((r) => r.program.id === 'c-de')).toBe(false);
      const u = q.undecided.find((x) => x.program.id === 'c-de')!;
      expect(u.conditional?.status).toBe('undecided');
      expect(u.conditional?.reason).toMatch(/German grade/);
      expect(q.coverage.find((c) => c.type === 'conditional')).toMatchObject({ shown: 0, notDecided: 1 });
    }
    expect(plan([TARGET, german(4)], { rules: [rule(null)] }).undecided.find((x) => x.program.id === 'c-de')!.conditional!.reason).toMatch(
      /has no official source yet/,
    );

    // Sourced rule: 2.5/4 converts to 2.5–3.25 (German, lower is better).
    const sourced = [rule('https://fixture.example.edu/conversion')];
    const meets = plan([TARGET, german(4)], { rules: sourced });
    expect(route(meets, 'conditional:c-de')?.conditional?.reason).toBe(
      'Your converted grade, 2.5–3.25 on the German grade (1.0 best – 4.0 pass), meets the lower limit this route names (4.0 or better).',
    );
    const below = plan([TARGET, german(2)], { rules: sourced });
    expect(below.notForYourGrade.map((n) => n.check.status)).toEqual(['below_floor']);
    const crosses = plan([TARGET, german(3)], { rules: sourced });
    expect(crosses.undecided.find((x) => x.program.id === 'c-de')?.conditional?.reason).toMatch(/crosses the lower limit/);
  });

  it('a percentage student vs a CGPA route with no rule: not decided, worded with their own scale', () => {
    const c = checkConditional({ cgpa: 62, scale: 'percent' }, nyitLike, [], NOV_24)!;
    expect(c.status).toBe('undecided');
    expect(c.reason).toMatch(/no sourced rule converts your percentage to it yet/);
  });

  it('is not added when the student meets the regular minimum (the direct route covers it)', () => {
    const meetsRegular = prog('meets', 'u-low', { min_gpa_rule: min(2), ...cond({ scale: 'cgpa_4', min: 2.5, text: COND_TEXT }) });
    const q = plan([TARGET, meetsRegular]);
    expect(allRoutes(q).filter((r) => r.program.id === 'meets').map((r) => r.type)).toEqual(['lower_floor_direct']);
  });

  it('the direct target can also be a conditional route, clearly labelled', () => {
    const t = prog('t-cond', 'u-cond', { min_gpa_rule: min(2.85), ...cond({ scale: 'cgpa_4', min: 2.5, text: COND_TEXT }) });
    const q = plan([TARGET, t], { target: 't-cond' });
    expect(q.direct?.program.id).toBe('t-cond');
    expect(q.direct?.conditional?.status).toBe('meets_floor');
    expect(directConditionalText(q.direct!)).toMatch(/also has an official conditional route/);
    const r = route(q, 'conditional:t-cond')!;
    expect(r.isTarget).toBe(true);
    expect(targetRouteNote(r.type)).toBe(
      'Same program as your target above. The target card is regular entry; this card is its conditional route.',
    );
    // Other routes are not marked as the target.
    expect(allRoutes(q).filter((x) => x.isTarget).map((x) => x.id)).toEqual(['conditional:t-cond']);
  });

  it('a conditional programme (pathway type) uses its own lower limit too', () => {
    const pathwayCond = (m: number | null) => prog('pc', 'u-cond', { pathway_type: 'conditional', ...cond({ scale: 'cgpa_4', min: m, text: COND_TEXT }) });
    const ok = plan([TARGET, pathwayCond(2.5)]);
    expect(codes(route(ok, 'conditional:pc'))).toContain('CONDITIONAL');
    expect(codes(route(ok, 'conditional:pc'))).not.toContain('PROGRESSION_NOT_GUARANTEED');
    const below = plan([TARGET, pathwayCond(3)]);
    expect(route(below, 'conditional:pc')).toBeUndefined();
    expect(below.notForYourGrade.map((n) => n.program.id)).toEqual(['pc']);
  });

  it('never outranks a known-good direct route, and strengths change nothing', () => {
    const low = prog('low', 'u-low', { min_gpa_rule: min(2), ...costed(12, 8_000, 5_000) });
    const q = plan([TARGET, low, nyitLike]);
    expect(route(q, 'lower_floor_direct:low')!.rank).toBe(1);
    expect(route(q, 'lower_floor_direct:low')!.score!.total).toBe(MAX_SCORE);
    expect(route(q, 'conditional:cond-direct')!.score!.feasibility.points).toBeLessThan(SCORE_POINTS.feasibility.max);
    const withS = plan([TARGET, low, nyitLike], { strengths: PERSONA_B_STRENGTHS });
    const sum = (x: PlanB) => allRoutes(x).map((r) => [r.id, r.fit.label, r.score?.total, r.rank]);
    expect(sum(withS)).toEqual(sum(q));
  });

  it('never carries the internal review_note', () => {
    const fact = { ...verified<ConditionalAdmission>({ scale: 'cgpa_4', min: 2.5, text: COND_TEXT }, 1, COND_URL), note: 'Fixture student note.', review_note: 'INTERNAL reviewer text' };
    const q = plan([TARGET, prog('c', 'u-cond', { conditional_admission: fact })]);
    const r = route(q, 'conditional:c')!;
    expect(r.conditional?.note).toBe('Fixture student note.');
    expect(JSON.stringify([r.conditional, r.gate, r.score])).not.toContain('INTERNAL');
  });
});

/* ------------------------------------------------------------------ */
/* Proposal #17: deadline passed                                       */
/* ------------------------------------------------------------------ */

describe('DEADLINE_PASSED (soft warning, usable deadlines only)', () => {
  const DL_URL = 'https://fixture.example.edu/deadline';
  const deadline = (iso: string) => ({ ...verified(iso, 1, DL_URL), fetched_at: daysAgo(1, DEC_02) });
  const twin = (id: string, name: string, iso: string): Program =>
    prog(id, 'u-low', { name, min_gpa_rule: min(2), ...costed(12, 8_000, 5_000), deadline: deadline(iso) });
  // Alphabetically the closed route would win a tie; the warning must put it below the open one.
  const closed = twin('closed', 'MSc Fixture Alpha', '2026-11-30');
  const open = twin('open', 'MSc Fixture Beta', '2027-03-01');
  const p = plan([TARGET, closed, open], { now: DEC_02 });

  it('warns when a usable deadline is before today, and the closed route ranks below the open one', () => {
    const c = route(p, 'lower_floor_direct:closed')!;
    const o = route(p, 'lower_floor_direct:open')!;
    expect(c.gate.warnings.find((w) => w.code === 'DEADLINE_PASSED')).toEqual({
      code: 'DEADLINE_PASSED',
      message: 'The deadline we hold (30 Nov 2026) has passed',
      detail: DEADLINE_PASSED_DETAIL,
      sourceUrl: DL_URL,
      confidence: 'Verified',
    });
    expect(codes(o)).not.toContain('DEADLINE_PASSED');
    expect(c.score!.quality.points).toBe(o.score!.quality.points - 1);
    expect(c.score!.feasibility).toEqual(o.score!.feasibility);
    expect(o.rank).toBe(1);
    expect(c.rank).toBe(2);
    expect(c.fit).toEqual(o.fit);
    expect(c.gate.status).toBe('warn');
  });

  it('shows the deadline with days left on each route', () => {
    const o = route(p, 'lower_floor_direct:open')!;
    expect(o.deadlines).toHaveLength(1);
    expect(o.deadlines[0]).toMatchObject({ label: 'Application deadline', date: '2027-03-01', daysLeft: 89, confidence: 'Verified' });
    expect(deadlineText('2027-03-01', o.deadlines[0])).toBe('1 Mar 2027 (89 days left)');
    expect(route(p, 'lower_floor_direct:closed')!.deadlines[0].daysLeft).toBe(-2);
    expect(daysLeftText(-2)).toBe('This date has passed');
    expect(daysLeftText(0)).toBe('Last day today');
    expect(daysLeftText(1)).toBe('1 day left');
    expect(daysUntil('not a date', DEC_02)).toBeNull();
  });

  it('a deadline that is today has not passed', () => {
    const q = plan([TARGET, twin('today', 'MSc Fixture Today', '2026-12-02')], { now: DEC_02 });
    const r = route(q, 'lower_floor_direct:today')!;
    expect(r.deadlines[0].daysLeft).toBe(0);
    expect(codes(r)).not.toContain('DEADLINE_PASSED');
  });

  it('an Unverified or conflicting deadline never warns and has no days-left text', () => {
    for (const fact of [unverified('2026-11-30'), conflicting('2026-11-30', '2026-11-29')]) {
      const q = plan([TARGET, prog('u', 'u-low', { min_gpa_rule: min(2), ...costed(12, 8_000, 5_000), deadline: fact })], { now: DEC_02 });
      const r = route(q, 'lower_floor_direct:u')!;
      expect(codes(r)).not.toContain('DEADLINE_PASSED');
      expect(r.deadlines[0].date).toBeNull();
      expect(deadlineText('2026-11-30', r.deadlines[0])).toBe('30 Nov 2026');
    }
  });

  it("checks the follow-on Masters' deadline on a pre-master's route and names that program", () => {
    const pre = prog('pre', 'u-pre', { pathway_type: 'pre_masters', ...costed(6, 4_000, 3_000), deadline: deadline('2027-01-15') });
    const msc = prog('pre-msc', 'u-pre', { min_gpa_rule: min(3), ...costed(12, 9_000, 5_000), deadline: deadline('2026-11-01') });
    const q = plan([TARGET, pre, msc], { now: DEC_02 });
    const r = route(q, 'pre_masters:pre')!;
    expect(r.deadlines.map((d) => [d.label, d.daysLeft])).toEqual([
      ["Pre-master's deadline", 44],
      ['Masters deadline', -31],
    ]);
    const w = r.gate.warnings.filter((x) => x.code === 'DEADLINE_PASSED');
    expect(w.map((x) => x.message)).toEqual(['The deadline we hold for MSc Fixture pre-msc (1 Nov 2026) has passed']);
  });

  it('the target card carries its deadline (no warning there; it is the comparison)', () => {
    const t = { ...TARGET, deadline: deadline('2026-11-30') };
    const q = plan([t], { now: DEC_02 });
    expect(q.direct?.deadline).toMatchObject({ date: '2026-11-30', daysLeft: -2 });
  });
});

/* ------------------------------------------------------------------ */
/* Proposal #2: "Not decided yet" + per-reason explanation              */
/* ------------------------------------------------------------------ */

describe('"Not decided yet" list and explainNoTarget (proposal #2)', () => {
  const germanMin = verified<GpaRule>({ scale: 'german', min: 2.5 });
  const unknownMin = prog('unknown-min', 'u-low');
  const noRule = prog('no-rule', 'u-low', { min_gpa_rule: germanMin });
  const conflict = prog('conflict', 'u-low', {
    min_gpa_rule: conflicting<GpaRule>({ scale: 'cgpa_4', min: 2 }, { scale: 'cgpa_4', min: 3 }),
  });
  const meets = prog('meets', 'u-low', { min_gpa_rule: min(2) });
  const ruled = prog('ruled', 'u-low', { status: 'ruled_out' });
  const p = plan([TARGET, unknownMin, noRule, conflict, meets, ruled]);

  it('lists direct programs whose minimum cannot decide fit, each with its own reason', () => {
    expect(p.undecided.map((u) => [u.program.id, u.minimumReason])).toEqual([
      ['conflict', 'Official sources disagree on the minimum grade.'],
      ['no-rule', 'We cannot convert your CGPA (out of 4.0) to the German grade (1.0 best – 4.0 pass) scale its minimum uses yet: no sourced conversion rule.'],
      ['unknown-min', 'Minimum grade not verified yet.'],
    ]);
    // Decided programs (Below / Meets) and ruled-out programs are not in the list.
    expect(p.undecided.some((u) => ['target', 'meets', 'ruled'].includes(u.program.id))).toBe(false);
    // It is a list: nothing in it is ranked or scored.
    expect(Object.keys(p.undecided[0]).sort()).toEqual(['conditional', 'institution', 'isTarget', 'minimumReason', 'program', 'routeAbove']);
    expect(undecidedSummary(3)).toBe(
      '3 programs need you to check the minimum grade on the official page. Each one says what to look at.',
    );
  });

  it('marks the target and programs already shown as a route', () => {
    const c = prog('c', 'u-cond', cond({ scale: 'cgpa_4', min: 2.5, text: COND_TEXT }));
    const q = plan([unknownMin, c], { target: 'unknown-min' });
    expect(q.undecided.find((u) => u.program.id === 'unknown-min')).toMatchObject({ isTarget: true, routeAbove: false });
    expect(q.undecided.find((u) => u.program.id === 'c')).toMatchObject({ isTarget: false, routeAbove: true });
  });

  it('explainNoTarget words each reason separately', () => {
    const row = (pr: Program, fit = computeFit(student, pr, [], NOV_24)): TargetRow => ({ program: pr, institution: null, fit, chipLabel: pr.name });
    const rows = [row(unknownMin), row(unknownMin), row(noRule), row(conflict)];
    expect(explainNoTarget(rows, 0, 'cgpa_4')).toBe(
      'None of your targets is "Below minimum" on verified data. ' +
        'For 2 targets the minimum grade is not verified yet, so we cannot tell. ' +
        'For 1 target we cannot convert your CGPA (out of 4.0) to the scale the minimum uses yet, because no sourced conversion rule exists. ' +
        'For 1 target official sources disagree on the minimum grade. ' +
        'Every route type is shown below so you can plan ahead.',
    );
    const pct = { ...student, scale: 'percent' as const, cgpa: 62 };
    const cgpaMin = prog('cgpa-min', 'u-low', { min_gpa_rule: min(2.7) });
    expect(explainNoTarget([row(cgpaMin, computeFit(pct, cgpaMin, [], NOV_24))], 0, 'percent')).toMatch(
      /For 1 target we cannot convert your percentage to the scale the minimum uses yet/,
    );
    expect(explainNoTarget(rows, 1, 'cgpa_4')).toBeNull();
    expect(explainNoTarget([], 0, 'cgpa_4')).toMatch(/no programs in your field/);
  });

  it('undecidedMinimumReason is null when fit is decided', () => {
    expect(undecidedMinimumReason(computeFit(student, meets, [], NOV_24), 'cgpa_4')).toBeNull();
    expect(undecidedMinimumReason(computeFit(student, TARGET, [], NOV_24), 'cgpa_4')).toBeNull();
  });

  it('links to the shortlist filtered to "Competitive range unknown", keeping the profile params', () => {
    expect(shortlistUnknownHref({})).toBe('/shortlist?fit=unknown');
    expect(shortlistUnknownHref({ cgpa: '2.5', scale: 'cgpa_4', target: 'x', junk: 'y' })).toBe('/shortlist?cgpa=2.5&scale=cgpa_4&fit=unknown');
  });
});

/* ------------------------------------------------------------------ */
/* Proposal #23: ?target= fallbacks                                     */
/* ------------------------------------------------------------------ */

describe('?target= a ruled-out or out-of-scope program falls back with a notice (proposal #23)', () => {
  const ruled = prog('ruled', 'u-low', { status: 'ruled_out', min_gpa_rule: min(3) });
  const otherCountry = prog('other-country', 'u-low', { country: 'DE', min_gpa_rule: min(3) });
  const otherField = prog('other-field', 'u-low', { field: 'ee', min_gpa_rule: min(3) });
  const programs = [TARGET, ruled, otherCountry, otherField];

  it('a ruled-out program is never the "going direct" baseline', () => {
    const p = plan(programs, { target: 'ruled' });
    expect(p.direct?.program.id).toBe('target');
    expect(p.notice).toBe(
      'MSc Fixture ruled at Fixture University Low is marked as ruled out in our data, so we cannot compare other routes with it. We compare with your first target that is below the minimum.',
    );
  });

  it('a program outside the student field or countries is never the baseline', () => {
    for (const id of ['other-country', 'other-field']) {
      const p = plan(programs, { target: id });
      expect(p.direct?.program.id).toBe('target');
      expect(p.notice).toMatch(/is outside your field or your target countries, so we cannot compare other routes with it\./);
    }
  });

  it('with nothing Below minimum it falls back to all targets', () => {
    const p = plan([ruled, prog('unknown', 'u-low')], { target: 'ruled' });
    expect(p.direct).toBeNull();
    expect(p.mode).toBe('all');
    expect(p.notice).toMatch(/We show routes for all your targets\.$/);
  });
});

/* ------------------------------------------------------------------ */
/* Today's real data (pinned dates)                                    */
/* ------------------------------------------------------------------ */

describe("today's seed + persona A: conditional routes, deadlines, not decided", () => {
  const seed = loadSeedDataset();
  const build = (now: Date, target?: string, profile: Profile = PERSONA_A) =>
    buildPlanB({
      profile,
      programs: seed.programs,
      institutions: seed.institutions,
      rules: seed.conversionRules,
      fx: seed.fxRates,
      now,
      target,
    });

  for (const now of [NOV_24, DEC_02]) {
    describe(`on ${now.toISOString().slice(0, 10)}`, () => {
      const p = build(now);

      it('NYIT (min 2.5) and UCCS (no floor) are ranked conditional routes with "Why this order"', () => {
        const nyit = route(p, 'conditional:nyit-mscs')!;
        const uccs = route(p, 'conditional:uccs-mscs')!;
        expect(nyit.conditional?.status).toBe('meets_floor');
        expect(nyit.conditional?.min).toBe(2.5);
        expect(nyit.conditional?.quote).toMatch(/GPA of 3\.0 or higher in the first four graduate courses/);
        expect(uccs.conditional?.status).toBe('no_floor');
        for (const r of [nyit, uccs]) {
          expect(r.rank).not.toBeNull();
          expect(r.score!.rankable).toBe(true);
          expect(whyThisOrder(r.score!)).toHaveLength(4);
          expect(codes(r)).toContain('CONDITIONAL');
          // Fit is untouched by the conditional route.
          expect(r.fit).toEqual(computeFit(PERSONA_A, r.program, seed.conversionRules, now));
        }
        expect(codes(uccs)).toContain('CONDITIONAL_NO_FLOOR');
        expect(codes(nyit)).not.toContain('CONDITIONAL_NO_FLOOR');
        expect(nyit.rank!).toBeLessThan(uccs.rank!);
        expect(p.coverage.find((c) => c.type === 'conditional')).toMatchObject({ shown: 3, notDecided: 0, notForYourGrade: 0 });
      });

      it('Würzburg (German scale, conversion rule now sourced) is no longer blanket "not decided"', () => {
        const w = route(p, 'conditional:wuerzburg-msc-cs');
        // The rule is sourced (KIT page citing the KMK recommendation), so the German-scale programme can be judged,
        // either as a conditional route or as undecided for a reason other than the missing source.
        if (w) expect(w.conditional?.status).not.toBe('undecided');
        else expect(p.undecided.find((u) => u.program.id === 'wuerzburg-msc-cs')?.conditional?.reason ?? '').not.toMatch(/no official source yet/);
        expect(p.notForYourGrade).toEqual([]);
      });

      it('the not-decided list names unverified minimums and marks the conditional routes above', () => {
        const ids = p.undecided.map((u) => u.program.id);
        expect(ids).toEqual(expect.arrayContaining(['tum-msc-informatics']));
        // NYIT (2.85) and UCCS (3.0) got Verified minimums on 2026-11-27, so they are decided, not listed here.
        expect(ids).not.toContain('nyit-mscs');
        expect(ids).not.toContain('uccs-mscs');
        expect(ids).not.toContain('usf-mscs');
        expect(ids).not.toContain('ljmu-msc-cs');
        expect(p.undecided.find((u) => u.program.id === 'wuerzburg-msc-cs')?.routeAbove).toBe(true);
      });

      it('the UCCS card has its deadline with days left; no live route has a passed deadline', () => {
        const uccs = route(p, 'conditional:uccs-mscs')!;
        expect(uccs.deadlines[0]).toMatchObject({ date: '2027-03-01', daysLeft: now === NOV_24 ? 97 : 89 });
        for (const r of allRoutes(p)) expect(codes(r)).not.toContain('DEADLINE_PASSED');
      });
    });
  }

  it('a 2.4 student is below the NYIT route and sees it under "Not for your grade"', () => {
    const p = build(NOV_24, undefined, { ...PERSONA_A, cgpa: 2.4 });
    expect(route(p, 'conditional:nyit-mscs')).toBeUndefined();
    expect(p.notForYourGrade.map((n) => n.program.id)).toEqual(['nyit-mscs']);
    expect(route(p, 'conditional:uccs-mscs')).toBeDefined();
  });

  it('target=nyit-mscs: the target is also its own conditional route, labelled as such', () => {
    const p = build(NOV_24, 'nyit-mscs');
    expect(p.direct?.program.id).toBe('nyit-mscs');
    expect(route(p, 'conditional:nyit-mscs')?.isTarget).toBe(true);
    expect(directConditionalText(p.direct!)).toMatch(/also has an official conditional route/);
  });

  it('target=ljmu-msc-cs (ruled out) and target=ethz-msc-cs (Switzerland, not a persona A country) fall back', () => {
    const ljmu = build(NOV_24, 'ljmu-msc-cs');
    expect(ljmu.direct?.program.id).not.toBe('ljmu-msc-cs');
    expect(ljmu.direct?.fit.label).toBe('Below minimum');
    expect(ljmu.notice).toMatch(/at Liverpool John Moores University is marked as ruled out in our data/);
    const eth = build(NOV_24, 'ethz-msc-cs');
    expect(eth.direct?.program.id).not.toBe('ethz-msc-cs');
    expect(eth.notice).toMatch(/is outside your field or your target countries/);
  });
});
