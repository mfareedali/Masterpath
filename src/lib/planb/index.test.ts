import { describe, expect, it } from 'vitest';
import { PERSONA_A, PERSONA_B, PERSONA_B_STRENGTHS } from '../profile';
import { loadSeedDataset } from '../data/seed-source';
import {
  FIXED_NOW,
  conflicting,
  likely,
  makeInstitution,
  makeProgram,
  unverified,
  verified,
  loadEmptySeedDataset,
} from '../test-fixtures';
import type { FxRate, GpaRule, Institution, Money, Profile, Program } from '../types';
import {
  ELIGIBILITY_DETAIL,
  IMPROVE_REAPPLY,
  INTEGRITY_NOTE,
  MAX_SCORE,
  PROGRAM_ROUTE_TYPES,
  budgetStatus,
  buildPlanB,
  classifyRoute,
  compareWithDirect,
  hasResearchStrengths,
  notRankedText,
  planBHref,
  programHref,
  signed,
  statusNoteLabel,
  strengthsForProfile,
  whyThisOrder,
  type PlanB,
  type PlanBInput,
  type PlanRoute,
} from './index';

const now = FIXED_NOW;
const fx: FxRate[] = [{ id: 'gbp-pkr', currency: 'GBP', pkr_per_unit: verified(100) }];

const student: Profile = {
  cgpa: 2.5,
  scale: 'cgpa_4',
  field: 'cs',
  target_countries: ['UK'],
  budget_pkr: 3_000_000,
};

const min = (m: number) => verified<GpaRule>({ scale: 'cgpa_4', min: m });
const gbp = (amount: number) => verified<Money>({ amount, currency: 'GBP', period: 'total' });

function uni(id: string, name: string, overrides: Partial<Institution> = {}): Institution {
  return makeInstitution({ id, name, ...overrides });
}

function prog(id: string, institution_id: string, overrides: Partial<Program> = {}): Program {
  return makeProgram({ id, institution_id, name: `MSc Fixture ${id}`, ...overrides });
}

/** A route whose cost and time are fully known. */
function costed(months: number, tuition: number, living: number): Partial<Program> {
  return { duration_months: verified(months), tuition: gbp(tuition), living_cost: gbp(living) };
}

const listed = verified<'listed' | 'not_listed'>('listed');
const notListed = verified<'listed' | 'not_listed'>('not_listed', 1, 'https://fixture.example.edu/recognition-list');

function plan(programs: Program[], institutions: Institution[], extra: Partial<PlanBInput> = {}): PlanB {
  return buildPlanB({ profile: student, programs, institutions, rules: [], fx, now, ...extra });
}

const allRoutes = (p: PlanB): PlanRoute[] => [...p.ranked, ...p.notRanked, ...p.blocked];
const routeFor = (p: PlanB, programId: string) => allRoutes(p).find((r) => r.program.id === programId);

/* A full fixture world: one Below-minimum target and one program per route type. */
const INSTITUTIONS: Institution[] = [
  uni('u-target', 'Fixture University Target', { recognition_list_status: listed }),
  uni('u-low', 'Fixture University Low Floor', { recognition_list_status: listed }),
  uni('u-cond', 'Fixture University Conditional'),
  uni('u-pre', 'Fixture University Pre', { recognition_list_status: listed }),
  uni('u-path', 'Fixture University Pathway'),
  uni('u-score', 'Fixture University Score'),
  uni('u-res', 'Fixture University Research'),
  uni('u-unknown', 'Fixture University Unknown'),
  uni('u-ruled', 'Fixture University Ruled Out'),
  uni('u-blocked', 'Fixture University Blocked', { recognition_list_status: notListed }),
];

const PROGRAMS: Program[] = [
  prog('target', 'u-target', { min_gpa_rule: min(3), ...costed(12, 10_000, 5_000) }),
  prog('low-floor', 'u-low', { min_gpa_rule: min(2), ...costed(12, 8_000, 5_000) }),
  prog('cond', 'u-cond', { pathway_type: 'conditional' }),
  prog('pre', 'u-pre', { pathway_type: 'pre_masters', ...costed(6, 4_000, 3_000) }),
  prog('pre-msc', 'u-pre', { min_gpa_rule: min(3), ...costed(12, 9_000, 5_000) }),
  prog('path', 'u-path', { pathway_type: 'pathway' }),
  prog('score', 'u-score', { pathway_type: 'score_based' }),
  prog('res', 'u-res', { research_considered: verified('Research experience is considered.') }),
  prog('unknown-direct', 'u-unknown'),
  prog('ruled', 'u-ruled', { status: 'ruled_out', status_note: unverified('Fixture note') }),
  prog('blocked', 'u-blocked', { pathway_type: 'conditional' }),
  prog('other-field', 'u-low', { field: 'ee', min_gpa_rule: min(2) }),
  prog('other-country', 'u-low', { country: 'DE', min_gpa_rule: min(2) }),
];

describe('route generation', () => {
  const p = plan(PROGRAMS, INSTITUTIONS);

  it('generates a route for each route type from the fixture rows', () => {
    const types = new Set(allRoutes(p).map((r) => r.type));
    for (const t of PROGRAM_ROUTE_TYPES) expect(types.has(t)).toBe(true);
    expect(routeFor(p, 'low-floor')?.type).toBe('lower_floor_direct');
    expect(routeFor(p, 'cond')?.type).toBe('conditional');
    expect(routeFor(p, 'pre')?.type).toBe('pre_masters');
    expect(routeFor(p, 'path')?.type).toBe('pathway');
    expect(routeFor(p, 'score')?.type).toBe('score_based');
    expect(routeFor(p, 'res')?.type).toBe('research_led');
  });

  it('picks the first Below-minimum target by default and does not list it as a route', () => {
    expect(p.mode).toBe('target');
    expect(p.direct?.program.id).toBe('target');
    expect(p.direct?.fit.label).toBe('Below minimum');
    expect(routeFor(p, 'target')).toBeUndefined();
    expect(p.belowMinimum.map((t) => t.program.id)).toEqual(['target', 'pre-msc']);
  });

  it('a direct program is a lower-floor route only when the student meets a Verified/Likely minimum', () => {
    expect(routeFor(p, 'unknown-direct')).toBeUndefined();
    const likelyMin = prog('likely-min', 'u-low', { min_gpa_rule: likely<GpaRule>({ scale: 'cgpa_4', min: 2 }) });
    const unverifiedMin = prog('unverified-min', 'u-low', { min_gpa_rule: unverified<GpaRule>({ scale: 'cgpa_4', min: 2 }) });
    const q = plan([...PROGRAMS, likelyMin, unverifiedMin], INSTITUTIONS);
    expect(routeFor(q, 'likely-min')?.type).toBe('lower_floor_direct');
    expect(routeFor(q, 'unverified-min')).toBeUndefined();
  });

  it('only uses programs in the student field and target countries', () => {
    expect(routeFor(p, 'other-field')).toBeUndefined();
    expect(routeFor(p, 'other-country')).toBeUndefined();
  });

  it('research-led covers pathway_type research_led and a usable research_considered fact', () => {
    const byType = prog('res-type', 'u-res', { pathway_type: 'research_led' });
    const unverifiedResearch = prog('res-unverified', 'u-res', { research_considered: unverified('maybe') });
    const q = plan([...PROGRAMS, byType, unverifiedResearch], INSTITUTIONS);
    expect(routeFor(q, 'res-type')?.type).toBe('research_led');
    expect(routeFor(q, 'res-unverified')).toBeUndefined();
  });

  it('excludes ruled-out programs with a reason', () => {
    expect(routeFor(p, 'ruled')).toBeUndefined();
    const ex = p.excluded.find((e) => e.program.id === 'ruled');
    expect(ex?.reason).toMatch(/ruled out/i);
    expect(classifyRoute(PROGRAMS.find((x) => x.id === 'ruled')!, p.direct!.fit, now)).toBeNull();
  });

  it('reports coverage for every route type', () => {
    expect(p.coverage.map((c) => c.type)).toEqual([...PROGRAM_ROUTE_TYPES]);
    expect(p.coverage.find((c) => c.type === 'conditional')).toEqual({
      type: 'conditional',
      shown: 1,
      blocked: 1,
      notDecided: 0,
      notForYourGrade: 0,
    });
  });
});

describe('integrity gate', () => {
  it('hard-blocks a route whose institution is not on the official recognition list (usable value)', () => {
    const p = plan(PROGRAMS, INSTITUTIONS);
    const r = routeFor(p, 'blocked')!;
    expect(r.gate.status).toBe('blocked');
    expect(r.gate.block?.reason).toMatch(/not on the destination's official recognition list/);
    expect(r.gate.block?.sourceUrl).toBe('https://fixture.example.edu/recognition-list');
    expect(r.gate.block?.confidence).toBe('Verified');
    expect(r.score).toBeNull();
    expect(r.rank).toBeNull();
    expect(p.blocked.map((x) => x.program.id)).toEqual(['blocked']);
    expect([...p.ranked, ...p.notRanked].some((x) => x.program.id === 'blocked')).toBe(false);
  });

  it('does not block on an Unverified or conflicting recognition value; it warns instead', () => {
    for (const fact of [unverified<'listed' | 'not_listed'>('not_listed'), conflicting<'listed' | 'not_listed'>('listed', 'not_listed')]) {
      const insts = INSTITUTIONS.map((i) => (i.id === 'u-blocked' ? { ...i, recognition_list_status: fact } : i));
      const r = routeFor(plan(PROGRAMS, insts), 'blocked')!;
      expect(r.gate.status).toBe('warn');
      const w = r.gate.warnings.find((x) => x.code === 'RECOGNITION_NOT_VERIFIED');
      expect(w?.message).toBe('Check the institution is on the official recognition list before you pay anything');
    }
  });

  it('warns that progression is not guaranteed for pre-master\'s, pathway and conditional routes', () => {
    const p = plan(PROGRAMS, INSTITUTIONS);
    for (const id of ['pre', 'path', 'cond']) {
      const w = routeFor(p, id)!.gate.warnings.find((x) => x.code === 'PROGRESSION_NOT_GUARANTEED');
      expect(w?.message).toBe('The official page does not guarantee progression to the Masters');
    }
    for (const id of ['score', 'res', 'low-floor']) {
      expect(routeFor(p, id)!.gate.warnings.some((x) => x.code === 'PROGRESSION_NOT_GUARANTEED')).toBe(false);
    }
  });

  it('a verified guarantee removes the progression warning; a verified "no" keeps it with the condition', () => {
    const yes = PROGRAMS.map((x) => (x.id === 'pre' ? { ...x, progression_guaranteed: verified(true) } : x));
    expect(routeFor(plan(yes, INSTITUTIONS), 'pre')!.gate.warnings.some((w) => w.code === 'PROGRESSION_NOT_GUARANTEED')).toBe(false);

    const no = PROGRAMS.map((x) =>
      x.id === 'pre'
        ? { ...x, progression_guaranteed: verified(false), progression_requirement: verified('Pass all fixture modules.') }
        : x,
    );
    const w = routeFor(plan(no, INSTITUTIONS), 'pre')!.gate.warnings.find((x) => x.code === 'PROGRESSION_NOT_GUARANTEED');
    expect(w?.detail).toMatch(/depends on conditions/);
    expect(w?.detail).toMatch(/Pass all fixture modules/);
  });

  it('an unverified "guaranteed" value does not remove the warning', () => {
    const progs = PROGRAMS.map((x) => (x.id === 'pre' ? { ...x, progression_guaranteed: unverified(true) } : x));
    expect(routeFor(plan(progs, INSTITUTIONS), 'pre')!.gate.warnings.some((w) => w.code === 'PROGRESSION_NOT_GUARANTEED')).toBe(true);
  });

  it('warns when cost is not verified, over budget, or above going direct', () => {
    const p = plan(PROGRAMS, INSTITUTIONS);
    expect(routeFor(p, 'cond')!.gate.warnings.map((w) => w.code)).toContain('COST_NOT_VERIFIED');

    // pre (7,000) + pre-msc (14,000) = 21,000 GBP = 2,100,000 PKR; direct = 15,000 GBP = 1,500,000 PKR.
    const pre = routeFor(p, 'pre')!;
    expect(pre.cost.pkr).toBe(2_100_000);
    expect(pre.gate.warnings.map((w) => w.code)).toContain('COSTS_MORE_THAN_DIRECT');
    expect(pre.gate.warnings.map((w) => w.code)).not.toContain('OVER_BUDGET');

    const tight = plan(PROGRAMS, INSTITUTIONS, { profile: { ...student, budget_pkr: 2_000_000 } });
    const over = routeFor(tight, 'pre')!;
    expect(over.budget).toBe('over');
    expect(over.gate.warnings.find((w) => w.code === 'OVER_BUDGET')?.detail).toMatch(/above your budget/);
  });
});

describe('time and cost versus going direct', () => {
  const p = plan(PROGRAMS, INSTITUTIONS);

  it("adds pre-master's and Masters time when both are known", () => {
    const r = routeFor(p, 'pre')!;
    expect(r.followOn?.id).toBe('pre-msc');
    expect(r.time.months).toBe(18);
    expect(r.time.parts.map((x) => x.label)).toEqual(["Pre-master's", 'Masters']);
    expect(r.vsDirect.timeDiffMonths).toBe(6);
    expect(r.vsDirect.timeText).toBe('6 months longer than going direct');
    expect(r.vsDirect.costDiff).toEqual({ amount: 600_000, currency: 'PKR' });
    expect(r.vsDirect.costText).toMatch(/^PKR 600,000 .* more than going direct$/);
  });

  it('says "Not verified" (null) when the Masters it leads to is not in the data', () => {
    const progs = PROGRAMS.filter((x) => x.id !== 'pre-msc');
    const r = routeFor(plan(progs, INSTITUTIONS), 'pre')!;
    expect(r.followOn).toBeNull();
    expect(r.time.months).toBeNull();
    expect(r.time.missing).toContain('The Masters this route leads to is not in our data yet');
    expect(r.cost.pkr).toBeNull();
    expect(r.gate.warnings.map((w) => w.code)).toContain('COST_NOT_VERIFIED');
  });

  it('a lower-floor direct route compares cost and time with the target', () => {
    const r = routeFor(p, 'low-floor')!;
    expect(r.time.months).toBe(12);
    expect(r.vsDirect.timeText).toBe('Same time as going direct');
    expect(r.vsDirect.costDiff).toEqual({ amount: -200_000, currency: 'PKR' });
    expect(r.vsDirect.costText).toMatch(/less than going direct$/);
  });

  it('never compares unknown values', () => {
    const r = routeFor(p, 'cond')!;
    expect(r.time.months).toBeNull();
    expect(r.vsDirect.timeDiffMonths).toBeNull();
    expect(r.vsDirect.timeText).toMatch(/not verified/);
    expect(r.vsDirect.costDiff).toBeNull();
  });

  it('without a single target there is nothing to compare with', () => {
    const c = compareWithDirect({ time: p.direct!.time, cost: p.direct!.cost }, null);
    expect(c.timeDiffMonths).toBeNull();
    expect(c.timeText).toMatch(/Pick one target/);
  });

  it('budget status uses PKR only through a verified rate', () => {
    const noRate = plan(PROGRAMS, INSTITUTIONS, { fx: [] });
    const r = routeFor(noRate, 'low-floor')!;
    expect(r.cost.pkr).toBeNull();
    expect(r.cost.native).toEqual({ amount: 13_000, currency: 'GBP' });
    expect(r.budget).toBe('not_comparable');
    expect(budgetStatus(r.cost, null)).toBe('no_budget');
    expect(budgetStatus({ ...r.cost, pkr: null, native: null }, 1)).toBe('unknown');
  });
});

describe('ranking', () => {
  it('a fully known, good route scores the maximum and ranks first', () => {
    const p = plan(PROGRAMS, INSTITUTIONS);
    const top = p.ranked[0];
    expect(top.program.id).toBe('low-floor');
    expect(top.rank).toBe(1);
    expect(top.score?.total).toBe(MAX_SCORE);
  });

  it('unknown data never ranks above known-good data', () => {
    const p = plan(PROGRAMS, INSTITUTIONS);
    const good = routeFor(p, 'low-floor')!;
    for (const r of [...p.ranked, ...p.notRanked]) {
      if (r === good) continue;
      if (r.rank != null) expect(r.rank).toBeGreaterThan(good.rank!);
      expect(r.score!.total).toBeLessThan(good.score!.total);
    }
  });

  it('routes with nothing verified go to "Not ranked: data missing", never dropped', () => {
    const p = plan(PROGRAMS, INSTITUTIONS);
    const ids = p.notRanked.map((r) => r.program.id).sort();
    expect(ids).toEqual(['cond', 'path', 'res', 'score']);
    for (const r of p.notRanked) {
      expect(r.rank).toBeNull();
      expect(r.notRankedReason).toMatch(/^Not ranked/);
    }
  });

  it('feasibility outweighs cheap-and-easy: below minimum never beats meets minimum on equal quality and cost', () => {
    const cheapBelow = prog('cheap-below', 'u-low', { min_gpa_rule: min(3), research_considered: verified('yes'), ...costed(12, 1_000, 1_000) });
    const p = plan([...PROGRAMS, cheapBelow], INSTITUTIONS);
    const below = routeFor(p, 'cheap-below')!;
    expect(below.type).toBe('research_led');
    expect(below.fit.label).toBe('Below minimum');
    expect(below.rank!).toBeGreaterThan(routeFor(p, 'low-floor')!.rank!);
  });

  it('ties are ordered by name', () => {
    const a = prog('tie-b', 'u-low', { name: 'MSc Fixture Beta', min_gpa_rule: min(2), ...costed(12, 8_000, 5_000) });
    const b = prog('tie-a', 'u-low', { name: 'MSc Fixture Alpha', min_gpa_rule: min(2), ...costed(12, 8_000, 5_000) });
    const p = plan([PROGRAMS[0], a, b], INSTITUTIONS);
    expect(p.ranked.map((r) => r.program.name)).toEqual(['MSc Fixture Alpha', 'MSc Fixture Beta']);
  });

  it('"Why this order" explains all three components and the total', () => {
    const p = plan(PROGRAMS, INSTITUTIONS);
    const lines = whyThisOrder(routeFor(p, 'pre')!.score!);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^Feasibility: Minimum grade not verified yet\. \+3 points/);
    expect(lines[1]).toMatch(/^Quality: On the official recognition list \(\+2\), 2 warnings \(−2\)/);
    expect(lines[2]).toMatch(/^Cost: Within your budget\. \+2 points/);
    expect(lines[3]).toBe(`Total: 5 out of ${MAX_SCORE}. Higher totals come first. Ties are ordered by name.`);
    expect(signed(-1)).toBe('−1');
    expect(signed(0)).toBe('0');
  });
});

describe('improve and reapply', () => {
  it('is always present, even with no programs at all', () => {
    const p = plan([], []);
    expect(p.improve).toBe(IMPROVE_REAPPLY);
    expect(p.improve.type).toBe('improve_reapply');
    expect(p.direct).toBeNull();
    expect(p.explanation).toMatch(/no programs in your field/);
  });

  it('is generic advice with no invented numbers, durations or costs', () => {
    const text = [...IMPROVE_REAPPLY.steps, IMPROVE_REAPPLY.timeText, IMPROVE_REAPPLY.costText, IMPROVE_REAPPLY.help].join(' ');
    expect(text).not.toMatch(/\d/);
    expect(IMPROVE_REAPPLY.timeText).toBe('At least one application cycle');
    expect(text).toMatch(/work experience/);
    expect(text).toMatch(/language test/);
    expect(text).toMatch(/research or build projects/);
  });
});

describe('target selection', () => {
  it('?target=<id> picks that program', () => {
    const p = plan(PROGRAMS, INSTITUTIONS, { target: 'pre-msc' });
    expect(p.direct?.program.id).toBe('pre-msc');
    // The former default target is now a regular candidate, and it is not a route (Below, no research).
    expect(routeFor(p, 'target')).toBeUndefined();
  });

  it('?target=all compares with no single target', () => {
    const p = plan(PROGRAMS, INSTITUTIONS, { target: 'all' });
    expect(p.mode).toBe('all');
    expect(p.direct).toBeNull();
    expect(p.explanation).toBeNull();
    expect(routeFor(p, 'pre')!.vsDirect.timeText).toMatch(/Pick one target/);
  });

  it('an unknown id falls back with a notice', () => {
    const p = plan(PROGRAMS, INSTITUTIONS, { target: 'does-not-exist' });
    expect(p.notice).toMatch(/could not find/);
    expect(p.direct?.program.id).toBe('target');
  });

  it('a non-direct program (e.g. a pre-master\'s) is never used as the "going direct" baseline', () => {
    const p = plan(PROGRAMS, INSTITUTIONS, { target: 'pre' });
    expect(p.direct?.program.id).toBe('target');
    expect(p.notice).toBe(
      'MSc Fixture pre at Fixture University Pre is not a direct Masters, so we cannot compare other routes with it. We compare with your first target that is below the minimum.',
    );
    // It stays in the list as a route, with its warnings.
    expect(routeFor(p, 'pre')?.type).toBe('pre_masters');

    const none = plan(
      PROGRAMS.filter((x) => x.id !== 'target' && x.id !== 'pre-msc'),
      INSTITUTIONS,
      { target: 'pre' },
    );
    expect(none.direct).toBeNull();
    expect(none.notice).toMatch(/We show routes for all your targets\.$/);
  });

  it('when nothing is Below minimum the plan still renders every route type with an explanation', () => {
    const progs = PROGRAMS.filter((x) => x.id !== 'target' && x.id !== 'pre-msc');
    const p = plan(progs, INSTITUTIONS);
    expect(p.mode).toBe('all');
    expect(p.direct).toBeNull();
    expect(p.explanation).toMatch(/None of your targets is "Below minimum"/);
    expect(p.coverage).toHaveLength(PROGRAM_ROUTE_TYPES.length);
  });

  it('the research-led case of the target itself is kept as a route', () => {
    const progs = PROGRAMS.map((x) => (x.id === 'target' ? { ...x, research_considered: verified('Research is considered.') } : x));
    const p = plan(progs, INSTITUTIONS);
    const r = routeFor(p, 'target')!;
    expect(r.type).toBe('research_led');
    expect(r.vsDirect.timeText).toBe('Same time as going direct');
  });
});

describe('strengths', () => {
  it('never change the fit label or the order; they only add a note on research-led routes', () => {
    const without = plan(PROGRAMS, INSTITUTIONS);
    const withS = plan(PROGRAMS, INSTITUTIONS, { strengths: PERSONA_B_STRENGTHS });
    const summary = (p: PlanB) => allRoutes(p).map((r) => [r.id, r.fit.label, r.score?.total ?? null, r.rank]);
    expect(summary(withS)).toEqual(summary(without));
    expect(withS.direct?.fit.label).toBe(without.direct?.fit.label);
    expect(routeFor(withS, 'res')!.researchMayMatter).toBe(true);
    expect(routeFor(without, 'res')!.researchMayMatter).toBe(false);
    expect(routeFor(withS, 'cond')!.researchMayMatter).toBe(false);
  });

  it('server side, persona B is treated as having the demo strengths', () => {
    expect(strengthsForProfile(PERSONA_B)).toBe(PERSONA_B_STRENGTHS);
    expect(strengthsForProfile(PERSONA_A)).toBeNull();
    expect(hasResearchStrengths(PERSONA_B_STRENGTHS)).toBe(true);
    expect(hasResearchStrengths(null)).toBe(false);
    expect(hasResearchStrengths({ publications: [], research: [] })).toBe(false);
  });
});

describe('wording', () => {
  it('never outputs percentages or "chances"', () => {
    const plans = [
      plan(PROGRAMS, INSTITUTIONS),
      plan(PROGRAMS, INSTITUTIONS, { target: 'all', profile: { ...student, scale: 'percent', cgpa: 65 } }),
      plan([], []),
    ];
    for (const p of plans) {
      const text = JSON.stringify(p) + allRoutes(p).flatMap((r) => (r.score ? whyThisOrder(r.score) : [])).join(' ');
      expect(text).not.toMatch(/%/);
      expect(text).not.toMatch(/chance|probab|guarantee[ds]? (?:admission|a place)/i);
    }
    expect(INTEGRITY_NOTE).toBe(
      'We never rank by ease alone. Routes that look easy or cheap but carry risk are warned or blocked.',
    );
  });
});

describe('seed data + persona A (the demo moment)', () => {
  const seed = loadEmptySeedDataset();
  const p = buildPlanB({
    profile: PERSONA_A,
    programs: seed.programs,
    institutions: seed.institutions,
    rules: seed.conversionRules,
    fx: seed.fxRates,
    now,
    strengths: strengthsForProfile(PERSONA_A),
  });

  it('shows the QMUL pre-master\'s route with the progression-not-guaranteed warning', () => {
    const r = routeFor(p, 'qmul-premasters-cs');
    expect(r).toBeDefined();
    expect(r!.type).toBe('pre_masters');
    expect(r!.gate.status).toBe('warn');
    expect(r!.gate.warnings.map((w) => w.message)).toContain(
      'The official page does not guarantee progression to the Masters',
    );
    expect(r!.gate.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['COST_NOT_VERIFIED', 'RECOGNITION_NOT_VERIFIED']),
    );
    // Nothing about it is verified, so it is shown but not ranked (no invented order).
    expect(r!.time.months).toBeNull();
    expect(r!.cost.pkr).toBeNull();
  });

  it('never shows the ruled-out LJMU program as a route, and says why it is excluded', () => {
    expect(routeFor(p, 'ljmu-msc-cs')).toBeUndefined();
    expect(p.excluded.map((e) => e.program.id)).toContain('ljmu-msc-cs');
  });

  it('with today\'s unverified data, no target is Below minimum, so every route type is explained', () => {
    expect(p.direct).toBeNull();
    expect(p.mode).toBe('all');
    expect(p.explanation).toMatch(/not verified yet/);
    expect(p.coverage).toHaveLength(PROGRAM_ROUTE_TYPES.length);
    expect(p.improve.steps.length).toBeGreaterThan(0);
  });
});

describe('eligibility warning (soft, listed first, never blocks, never changes fit)', () => {
  const NOTE = 'For graduates whose degree is not in a computing subject.';
  const URL = 'https://fixture.example.edu/eligibility';
  const withNote = (ids: string[], fact = verified(NOTE, 1, URL)) =>
    PROGRAMS.map((x) => (ids.includes(x.id) ? { ...x, eligibility_note: fact } : x));

  it('is the first warning on the route, quotes the note, and links its source with its confidence', () => {
    const r = routeFor(plan(withNote(['pre']), INSTITUTIONS), 'pre')!;
    expect(r.gate.status).toBe('warn');
    expect(r.gate.warnings[0]).toEqual({
      code: 'ELIGIBILITY',
      message: `Check you are eligible: ${NOTE}`,
      detail: ELIGIBILITY_DETAIL,
      sourceUrl: URL,
      confidence: 'Verified',
    });
    expect(r.gate.warnings[1].code).toBe('PROGRESSION_NOT_GUARANTEED');
  });

  it("is raised from the Masters a pre-master's leads to, and names that program", () => {
    const r = routeFor(plan(withNote(['pre-msc']), INSTITUTIONS), 'pre')!;
    expect(r.followOn?.id).toBe('pre-msc');
    expect(r.gate.warnings[0].code).toBe('ELIGIBILITY');
    expect(r.gate.warnings[0].detail).toBe(`From the official page for MSc Fixture pre-msc. ${ELIGIBILITY_DETAIL}`);
  });

  it('the same note on the first stage and on the Masters is shown once', () => {
    const r = routeFor(plan(withNote(['pre', 'pre-msc']), INSTITUTIONS), 'pre')!;
    expect(r.gate.warnings.filter((w) => w.code === 'ELIGIBILITY')).toHaveLength(1);
  });

  it('counts as one soft warning in the quality score, and never changes fit, blocks or hides the route', () => {
    const before = plan(PROGRAMS, INSTITUTIONS);
    const after = plan(withNote(['low-floor', 'pre', 'cond']), INSTITUTIONS);
    for (const id of ['low-floor', 'pre', 'cond']) {
      const a = routeFor(before, id)!;
      const b = routeFor(after, id)!;
      expect(b.fit).toEqual(a.fit);
      expect(b.type).toBe(a.type);
      expect(b.gate.status).toBe('warn');
      expect(b.gate.warnings.length).toBe(a.gate.warnings.length + 1);
      expect(b.score!.quality.points).toBe(a.score!.quality.points - 1);
      expect(b.score!.feasibility).toEqual(a.score!.feasibility);
    }
    expect(after.blocked.map((r) => r.program.id)).toEqual(before.blocked.map((r) => r.program.id));
    expect(routeFor(after, 'low-floor')!.rank).toBe(1);
    expect(routeFor(after, 'low-floor')!.score!.total).toBe(MAX_SCORE - 1);
  });

  it('only a Verified or Likely note warns (never an Unverified or conflicting one)', () => {
    for (const fact of [unverified(NOTE), conflicting(NOTE, 'A different fixture note.')]) {
      const r = routeFor(plan(withNote(['pre'], fact), INSTITUTIONS), 'pre')!;
      expect(r.gate.warnings.some((w) => w.code === 'ELIGIBILITY')).toBe(false);
    }
    const r = routeFor(plan(withNote(['pre'], likely(NOTE)), INSTITUTIONS), 'pre')!;
    expect(r.gate.warnings[0]).toMatchObject({ code: 'ELIGIBILITY', confidence: 'Likely' });
  });

  it('adds the student-facing note but never the internal review_note', () => {
    const fact = { ...verified(NOTE, 1, URL), note: 'Fixture student note.', review_note: 'INTERNAL fixture reviewer text' };
    const r = routeFor(plan(withNote(['pre'], fact), INSTITUTIONS), 'pre')!;
    expect(r.gate.warnings[0].detail).toBe(`${ELIGIBILITY_DETAIL} Note: Fixture student note.`);
    // The gate output is what the card renders: it must never carry reviewer text.
    expect(JSON.stringify(r.gate)).not.toContain('INTERNAL');
  });
});

describe('"Not ranked yet" says plainly why a route cannot be ordered', () => {
  it('lists each unknown part of the score', () => {
    const r = routeFor(plan(PROGRAMS, INSTITUTIONS), 'cond')!;
    expect(r.rank).toBeNull();
    expect(r.notRankedReason).toBe(
      'Not ranked yet: minimum grade not verified yet, recognition not verified yet and total cost not verified yet',
    );
  });

  it('says when official sources disagree instead of "not verified"', () => {
    const insts = INSTITUTIONS.map((i) =>
      i.id === 'u-cond' ? { ...i, recognition_list_status: conflicting<'listed' | 'not_listed'>('listed', 'not_listed') } : i,
    );
    const progs = PROGRAMS.map((x) =>
      x.id === 'cond'
        ? { ...x, min_gpa_rule: conflicting<GpaRule>({ scale: 'cgpa_4', min: 2 }, { scale: 'cgpa_4', min: 3 }) }
        : x,
    );
    const r = routeFor(plan(progs, insts), 'cond')!;
    expect(r.fit.reason.code).toBe('MIN_CONFLICT');
    expect(r.notRankedReason).toBe(
      'Not ranked yet: official sources disagree on the minimum grade, official sources disagree on recognition and total cost not verified yet',
    );
  });

  it('ranked routes carry no not-ranked reason, and their known parts have nothing missing', () => {
    const p = plan(PROGRAMS, INSTITUTIONS);
    expect(p.ranked.length).toBeGreaterThan(0);
    for (const r of p.ranked) {
      expect(r.notRankedReason).toBeNull();
      expect(r.score!.rankable).toBe(true);
      expect(whyThisOrder(r.score!)).toHaveLength(4);
    }
    const pre = routeFor(p, 'pre')!;
    expect(pre.score!.quality.missing).toBeNull();
    expect(pre.score!.cost.missing).toBeNull();
    expect(notRankedText(pre.score!)).toBe('Not ranked yet: minimum grade not verified yet');
  });
});

describe('status note label', () => {
  it('names Pakistan only when the official note is about Pakistan; otherwise neutral wording', () => {
    expect(statusNoteLabel('Extra compliance measures for Pakistan applicants.')).toBe('Note for Pakistan applicants');
    expect(statusNoteLabel('Applications for this intake are closed.')).toBe('Note from the official page');
  });
});

describe("today's seed + persona A + target usf-mscs: Plan B warns instead of pushing", () => {
  const seed = loadSeedDataset();
  const build = (programs: Program[] = seed.programs) =>
    buildPlanB({
      profile: PERSONA_A,
      programs,
      institutions: seed.institutions,
      rules: seed.conversionRules,
      fx: seed.fxRates,
      now,
      target: 'usf-mscs',
      strengths: strengthsForProfile(PERSONA_A),
    });
  const p = build();
  const qmul = seed.programs.find((x) => x.id === 'qmul-premasters-cs')!;

  it('compares with USF', () => {
    expect(p.direct?.program.id).toBe('usf-mscs');
    expect(p.notice).toBeNull();
  });

  it('the QMUL route shows the eligibility warning first, then the progression-not-guaranteed warning', () => {
    const r = routeFor(p, 'qmul-premasters-cs')!;
    expect(r).toBeDefined();
    expect(r.gate.status).toBe('warn');
    expect(r.gate.warnings.map((w) => w.code).slice(0, 2)).toEqual(['ELIGIBILITY', 'PROGRESSION_NOT_GUARANTEED']);
    const w = r.gate.warnings[0];
    expect(w.message).toBe(`Check you are eligible: ${qmul.eligibility_note.value}`);
    expect(w.message).toMatch(/not related to Computer Science/);
    expect(w.sourceUrl).toBe(qmul.eligibility_note.source_url);
    expect(w.confidence).toBe('Verified');
    expect(r.gate.warnings[1].message).toBe('The official page does not guarantee progression to the Masters');
    expect(JSON.stringify(r.gate)).not.toContain(qmul.eligibility_note.review_note ?? '\u0000');
  });

  it('the eligibility note never changes fit, never blocks, and costs one quality step', () => {
    const stripped = build(seed.programs.map((x) => (x.id === qmul.id ? { ...x, eligibility_note: unverified<string>() } : x)));
    const a = routeFor(p, qmul.id)!;
    const b = routeFor(stripped, qmul.id)!;
    expect(a.fit).toEqual(b.fit);
    expect(a.gate.warnings.length).toBe(b.gate.warnings.length + 1);
    expect(a.score!.quality.points).toBe(b.score!.quality.points - 1);
    expect(p.blocked.some((r) => r.program.id === qmul.id)).toBe(false);
  });

  it('says plainly why the QMUL route cannot be put in order', () => {
    const r = routeFor(p, qmul.id)!;
    expect(r.rank).toBeNull();
    expect(r.notRankedReason).toBe(
      'Not ranked yet: minimum grade not verified yet, recognition not verified yet and total cost not verified yet',
    );
  });

  it("Brookes' Pakistan status note is usable and gets the Pakistan label", () => {
    const brookes = seed.programs.find((x) => x.id === 'brookes-msc-cs')!;
    expect(statusNoteLabel(brookes.status_note.value ?? '')).toBe('Note for Pakistan applicants');
  });
});

describe('links', () => {
  it('keeps the shareable profile params and drops anything else', () => {
    const sp = { cgpa: '2.5', scale: 'cgpa_4', countries: 'DE,UK', target: 'old', junk: 'x' };
    expect(planBHref(sp, 'qmul-premasters-cs')).toBe('/plan-b?cgpa=2.5&scale=cgpa_4&countries=DE%2CUK&target=qmul-premasters-cs');
    expect(planBHref({}, null)).toBe('/plan-b');
    expect(planBHref({}, 'all')).toBe('/plan-b?target=all');
    expect(programHref({ cgpa: ['3', '4'] }, 'a b')).toBe('/program/a%20b?cgpa=3');
  });
});
