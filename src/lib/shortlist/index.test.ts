import { describe, expect, it } from 'vitest';
import { computeConfidence, emptyFact, isUsable } from '../confidence';
import { programTotalCost } from '../cost';
import { loadSeedDataset } from '../data/seed-source';
import { computeFit } from '../fit';
import { PERSONA_A } from '../profile';
import { FIXED_NOW, conflicting, likely, makeInstitution, makeProgram, unverified, verified, loadEmptySeedDataset } from '../test-fixtures';
import type { CountryFact, CountryFactValue, Fact, FxRate, Money, Profile, Program } from '../types';
import {
  CLOSING_SOON_DAYS,
  buildShortlist,
  checkBudgetFilter,
  checkFitFilter,
  checkIntakeFilter,
  citizenshipRankKey,
  citizenshipShortText,
  closingSoon,
  computeCoverage,
  conditionalRoute,
  totalCostCaveats,
  daysLeftLabel,
  daysToIso,
  deadlineDaysLeft,
  deadlinePassedReason,
  deadlineRankKey,
  emptyRankedMessage,
  fitRankKey,
  gradeText,
  hasUsablePkrRate,
  hiddenSummary,
  isProgramVerified,
  listedCount,
  mergeQuery,
  planBSuggested,
  planBTargetHref,
  profileShortlistPath,
  profileSummaryParts,
  programNotes,
  rankValueText,
  selectedIntakeTerms,
  studyRankKey,
  toggleCountry,
  totalCostRankKey,
  tuitionRankKey,
  type ShortlistInput,
} from './index';

/* ----------------------------------------------------------- fixtures */
// Every value below is fictional ("Fixture University"); none encodes a real requirement, fee or rate.

const now = FIXED_NOW;

const profile: Profile = {
  cgpa: 3.0,
  scale: 'cgpa_4',
  min_pass: null,
  field: 'cs',
  budget_pkr: 5_000_000,
  target_countries: [],
};

const gbp = (amount: number, period: Money['period'] = 'year'): Money => ({ amount, currency: 'GBP', period });

const fx: FxRate[] = [
  { id: 'gbp-pkr', currency: 'GBP', pkr_per_unit: verified(100, 1, 'https://fixture.example.org/fx') },
  { id: 'eur-pkr', currency: 'EUR', pkr_per_unit: unverified() },
];

function cfact(country: string, value: CountryFactValue | null, kind: 'verified' | 'likely' | 'none' | 'conflict' = 'likely'): CountryFact {
  const base: Fact<CountryFactValue> =
    kind === 'verified'
      ? verified(value as CountryFactValue)
      : kind === 'likely'
        ? likely(value as CountryFactValue)
        : kind === 'conflict'
          ? conflicting(value as CountryFactValue, { text: 'Fixture other rule', sort_months: 99 })
          : unverified(value);
  return { ...base, id: `${country}-citizenship-rule`, country, key: 'citizenship_rule' };
}

/** A fully verified fixture program (all four coverage facts Verified, costs complete). */
function fullProgram(overrides: Partial<Program> = {}): Program {
  return makeProgram({
    min_gpa_rule: verified({ scale: 'cgpa_4', min: 2.5 }),
    deadline: verified('2027-03-01'),
    tuition: verified(gbp(20_000)),
    living_cost: verified(gbp(10_000)),
    duration_months: verified(12),
    language_req: verified({ ielts_overall: 6.5 }),
    intake: verified('September 2027'),
    ...overrides,
  });
}

function input(programs: Program[], over: Partial<ShortlistInput> = {}): ShortlistInput {
  return {
    programs,
    institutions: [makeInstitution(), makeInstitution({ id: 'fixture-uni-2', name: 'Second Fixture University' })],
    countryFacts: [
      cfact('UK', { text: 'Fixture UK rule', sort_months: 60 }),
      cfact('DE', { text: 'Fixture DE rule', sort_months: 36 }, 'verified'),
    ],
    conversionRules: [],
    fxRates: fx,
    profile,
    now,
    ...over,
  };
}

const names = (rows: { program: Program }[]) => rows.map((r) => r.program.id);

/**
 * Fact fields on a Program (src/lib/types.ts): 18 until this wave, plus conditional_admission and language_waiver.
 * Coverage counts every one of them ("N of M individual facts verified").
 */
const FACT_FIELDS_PER_PROGRAM = 20;

/* ------------------------------------------------------------ rank keys */

describe('rank keys', () => {
  it("'fit' uses fitSortValue: meets 0, crosses 1, below 2; unverified minimum is not ranked", () => {
    const meets = computeFit(profile, fullProgram({ min_gpa_rule: verified({ scale: 'cgpa_4', min: 2.5 }) }), [], now);
    const below = computeFit(profile, fullProgram({ min_gpa_rule: verified({ scale: 'cgpa_4', min: 3.5 }) }), [], now);
    const unknown = computeFit(profile, fullProgram({ min_gpa_rule: emptyFact() }), [], now);
    const conflict = computeFit(
      profile,
      fullProgram({ min_gpa_rule: conflicting({ scale: 'cgpa_4', min: 2.5 }, { scale: 'cgpa_4', min: 3.0 }) }),
      [],
      now,
    );
    expect(fitRankKey(meets)).toEqual({ value: 0, confidence: 'Verified' });
    expect(fitRankKey(below)).toEqual({ value: 2, confidence: 'Verified' });
    expect(fitRankKey(unknown)).toMatchObject({ value: null, missingReason: 'Minimum grade not verified yet' });
    expect(fitRankKey(conflict)).toMatchObject({ value: null, confidence: 'Conflict' });

    // Range crossing the minimum (German scale, unknown transcript minimum) = 1.
    const rules = [
      {
        id: 'fixture-bavarian',
        scope: 'PK->*',
        from_scale: 'cgpa_4' as const,
        to_scale: 'german' as const,
        formula: 'modified_bavarian' as const,
        params: { nmax: 4, nmin: [1, 2] as [number, number] },
        source_url: 'https://fixture.example.org/rule',
      },
    ];
    const crosses = computeFit(profile, fullProgram({ country: 'DE', min_gpa_rule: verified({ scale: 'german', min: 2.0 }) }), rules, now);
    expect(crosses.reason.code).toBe('STRADDLES_MIN');
    expect(fitRankKey(crosses).value).toBe(1);
  });

  it("'tuition' = whole-programme tuition in PKR via a usable rate", () => {
    expect(tuitionRankKey(fullProgram(), fx, now)).toEqual({ value: 2_000_000, confidence: 'Verified' });
    // 24 months of a per-year fee.
    expect(tuitionRankKey(fullProgram({ duration_months: verified(24) }), fx, now).value).toBe(4_000_000);
    // 18 months is not a whole number of years: cost.ts will not total it, and the reason says so (never a guess).
    expect(tuitionRankKey(fullProgram({ duration_months: verified(18) }), fx, now)).toEqual({
      value: null,
      confidence: 'Unverified',
      missingReason: 'Programme length (18 months) is not a whole number of years, so we cannot total the tuition',
    });
    // Total-period fee needs no duration.
    expect(tuitionRankKey(fullProgram({ tuition: verified(gbp(15_000, 'total')), duration_months: emptyFact() }), fx, now).value).toBe(1_500_000);
  });

  it("'tuition' missing reasons", () => {
    expect(tuitionRankKey(fullProgram({ tuition: emptyFact() }), fx, now)).toMatchObject({
      value: null,
      missingReason: 'Tuition not verified yet',
    });
    expect(tuitionRankKey(fullProgram({ tuition: unverified(gbp(1)) }), fx, now).missingReason).toBe('Tuition not verified yet');
    expect(tuitionRankKey(fullProgram({ tuition: conflicting(gbp(1), gbp(2)) }), fx, now)).toMatchObject({
      confidence: 'Conflict',
      missingReason: 'Tuition sources conflict',
    });
    expect(tuitionRankKey(fullProgram({ duration_months: emptyFact() }), fx, now).missingReason).toMatch(/Programme length not verified yet/);
    const eur = fullProgram({ tuition: verified({ amount: 1000, currency: 'EUR', period: 'year' }) });
    expect(tuitionRankKey(eur, fx, now)).toMatchObject({ value: null, missingReason: 'No verified EUR→PKR exchange rate yet' });
  });

  it("'tuition' takes the weakest confidence of fee, length and rate", () => {
    const k = tuitionRankKey(fullProgram({ tuition: likely(gbp(20_000)) }), fx, now);
    expect(k).toEqual({ value: 2_000_000, confidence: 'Likely' });
  });

  it("'total' = programTotalCost(...).pkr, reason = missing.join", () => {
    expect(totalCostRankKey(programTotalCost(fullProgram(), fx, now))).toEqual({ value: 3_000_000, confidence: 'Verified' });
    const k = totalCostRankKey(programTotalCost(fullProgram({ tuition: emptyFact(), living_cost: emptyFact() }), fx, now));
    expect(k.value).toBeNull();
    expect(k.missingReason).toBe('Tuition not verified yet; Living cost not verified yet');
    const noRate = totalCostRankKey(programTotalCost(fullProgram(), [], now));
    expect(noRate.value).toBeNull();
    expect(noRate.missingReason).toMatch(/GBP/);
  });

  it("'citizenship' = the country's citizenship_rule sort_months with that fact's confidence", () => {
    expect(citizenshipRankKey(cfact('UK', { text: 'x', sort_months: 60 }), now)).toEqual({ value: 60, confidence: 'Likely' });
    expect(citizenshipRankKey(cfact('UK', { text: 'x', sort_months: 24 }, 'verified'), now)).toEqual({ value: 24, confidence: 'Verified' });
    expect(citizenshipRankKey(null, now)).toMatchObject({ value: null, missingReason: 'Citizenship rule not verified yet' });
    expect(citizenshipRankKey(cfact('UK', null, 'none'), now).missingReason).toBe('Citizenship rule not verified yet');
    expect(citizenshipRankKey(cfact('UK', { text: 'x', sort_months: 60 }, 'none'), now).value).toBeNull();
    expect(citizenshipRankKey(cfact('UK', { text: 'x', sort_months: null }), now)).toMatchObject({
      value: null,
      confidence: 'Likely',
      missingReason: 'Citizenship rule has no comparable number of months yet',
    });
    expect(citizenshipRankKey(cfact('UK', { text: 'x', sort_months: 60 }, 'conflict'), now)).toMatchObject({
      value: null,
      confidence: 'Conflict',
    });
  });

  it("'study' = duration_months", () => {
    expect(studyRankKey(fullProgram({ duration_months: verified(24) }), now)).toEqual({ value: 24, confidence: 'Verified' });
    expect(studyRankKey(fullProgram({ duration_months: emptyFact() }), now)).toMatchObject({
      value: null,
      missingReason: 'Programme length not verified yet',
    });
    expect(studyRankKey(fullProgram({ duration_months: conflicting(12, 24) }), now).confidence).toBe('Conflict');
  });

  it("'deadline' = ISO date as whole days", () => {
    const k = deadlineRankKey(fullProgram({ deadline: verified('2027-01-02') }), now);
    expect(k.value).toBe(Date.UTC(2027, 0, 2) / 86_400_000);
    expect(deadlineRankKey(fullProgram({ deadline: emptyFact() }), now).missingReason).toBe('Deadline not verified yet');
    expect(deadlineRankKey(fullProgram({ deadline: verified('rolling') }), now).missingReason).toMatch(/readable/);
    expect(deadlineRankKey(fullProgram({ deadline: conflicting('2027-01-01', '2027-02-01') }), now).confidence).toBe('Conflict');
  });
});

/* -------------------------------------------------------- buildShortlist */

describe('buildShortlist: ranking', () => {
  const p1 = fullProgram({ id: 'p1', name: 'MSc Fixture A', tuition: verified(gbp(30_000)), deadline: verified('2027-02-01') });
  const p2 = fullProgram({ id: 'p2', name: 'MSc Fixture B', tuition: verified(gbp(10_000)), deadline: verified('2027-01-01') });
  const p3 = fullProgram({ id: 'p3', name: 'MSc Fixture C', tuition: emptyFact(), min_gpa_rule: verified({ scale: 'cgpa_4', min: 3.5 }) });
  const p4 = fullProgram({ id: 'p4', name: 'MSc Fixture D', min_gpa_rule: emptyFact(), deadline: emptyFact() });
  const all = [p1, p2, p3, p4];

  it("default rank is 'fit' ascending with a program-name tiebreak", () => {
    const s = buildShortlist(input(all));
    expect(s.query.rank).toBe('fit');
    expect(names(s.ranked)).toEqual(['p1', 'p2', 'p3']); // meets, meets (A < B by name), below
    expect(s.ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(names(s.notRanked)).toEqual(['p4']);
    expect(s.notRanked[0].reason).toBe('Minimum grade not verified yet');
  });

  it('desc flips the order', () => {
    const s = buildShortlist(input(all, { query: { dir: 'desc' } }));
    expect(names(s.ranked)).toEqual(['p3', 'p1', 'p2']);
  });

  it('tuition: missing tuition goes to "Not ranked" with a reason, never treated as zero', () => {
    const s = buildShortlist(input(all, { query: { rank: 'tuition' } }));
    expect(names(s.ranked)).toEqual(['p2', 'p4', 'p1']); // 1.0M, 2.0M, 3.0M
    expect(s.notRanked.map((r) => [r.program.id, r.reason])).toEqual([['p3', 'Tuition not verified yet']]);
  });

  it('deadline ranking', () => {
    const s = buildShortlist(input(all, { query: { rank: 'deadline' } }));
    expect(names(s.ranked)).toEqual(['p2', 'p1', 'p3']);
    expect(s.notRanked[0].reason).toBe('Deadline not verified yet');
  });

  it('citizenship ranking uses the country fact; programs in a country without a usable rule are not ranked', () => {
    const de = fullProgram({ id: 'de1', name: 'MSc Fixture DE', country: 'DE' });
    const ch = fullProgram({ id: 'ch1', name: 'MSc Fixture CH', country: 'CH' });
    const s = buildShortlist(input([p1, de, ch], { query: { rank: 'citizenship' } }));
    expect(names(s.ranked)).toEqual(['de1', 'p1']); // 36 < 60 months
    expect(s.notRanked.map((r) => r.reason)).toEqual(['Citizenship rule not verified yet']);
    expect(s.ranked[0].citizenship?.country).toBe('DE');
  });

  it('total and study ranking', () => {
    const long = fullProgram({ id: 'long', name: 'MSc Fixture Long', duration_months: verified(24) });
    const s = buildShortlist(input([p1, long], { query: { rank: 'study' } }));
    expect(names(s.ranked)).toEqual(['p1', 'long']);
    const t = buildShortlist(input([p1, long], { query: { rank: 'total' } }));
    expect(t.ranked.map((r) => r.key.value)).toEqual([4_000_000, 6_000_000]); // p1: (30k+10k)*100; long: (20k+10k)*2*100
  });

  it('attaches institution names and computed views', () => {
    const s = buildShortlist(input([p1]));
    expect(s.ranked[0].institutionName).toBe('Fixture University');
    expect(s.ranked[0].withinBudget).toBe(true); // 4.0M <= 5.0M
    expect(s.ranked[0].deadlinePassed).toBe(false);
    const past = buildShortlist(input([fullProgram({ deadline: verified('2026-01-01') })]));
    expect(past.ranked[0].deadlinePassed).toBe(true);
    const unknownInst = buildShortlist(input([fullProgram({ institution_id: 'nope' })]));
    expect(unknownInst.ranked[0].institutionName).toBe('nope');
  });
});

describe('buildShortlist: filters', () => {
  const uk = fullProgram({ id: 'uk', name: 'MSc Fixture UK' });
  const de = fullProgram({ id: 'de', name: 'MSc Fixture DE', country: 'DE' });
  const cheap = fullProgram({ id: 'cheap', name: 'MSc Fixture Cheap', tuition: verified(gbp(5_000)) }); // 1.5M total
  const pricey = fullProgram({ id: 'pricey', name: 'MSc Fixture Pricey', tuition: verified(gbp(60_000)) }); // 7.0M total
  const noCost = fullProgram({ id: 'nocost', name: 'MSc Fixture No Cost', living_cost: emptyFact() });
  const spring = fullProgram({ id: 'spring', name: 'MSc Fixture Spring', intake: verified('January 2028') });
  const noIntake = fullProgram({ id: 'nointake', name: 'MSc Fixture No Intake', intake: unverified('January 2028') });

  it('country: defaults to the profile target countries, else all', () => {
    const all = buildShortlist(input([uk, de]));
    expect(all.filters.countrySource).toBe('all');
    expect(names(all.ranked).sort()).toEqual(['de', 'uk']);

    const targeted = buildShortlist(input([uk, de], { profile: { ...profile, target_countries: ['DE'] } }));
    expect(targeted.filters).toMatchObject({ countries: ['DE'], countrySource: 'profile' });
    expect(names(targeted.ranked)).toEqual(['de']);
    expect(targeted.hidden).toMatchObject({ total: 1, country: 1 });

    const override = buildShortlist(input([uk, de], { profile: { ...profile, target_countries: ['DE'] }, query: { country: 'all' } }));
    expect(names(override.ranked).sort()).toEqual(['de', 'uk']);

    const explicit = buildShortlist(input([uk, de], { query: { country: ['UK'] } }));
    expect(explicit.filters.countrySource).toBe('query');
    expect(names(explicit.ranked)).toEqual(['uk']);
    expect(explicit.options.countries).toEqual(['DE', 'UK']);
  });

  it('budget: within/over is decided only with a usable PKR total; missing cost goes to "Can\'t check"', () => {
    const s = buildShortlist(input([cheap, pricey, noCost], { query: { budget: true } }));
    expect(names(s.ranked)).toEqual(['cheap']);
    expect(s.hidden).toMatchObject({ total: 1, budget: 1 });
    expect(names(s.cantCheck)).toEqual(['nocost']);
    expect(s.cantCheck[0].reasons).toEqual(['Budget: Living cost not verified yet']);
    expect(s.filters.budget).toBe(true);
  });

  it('budget filter without a profile budget is not applied and is flagged', () => {
    const s = buildShortlist(input([cheap, pricey], { profile: { ...profile, budget_pkr: null }, query: { budget: true } }));
    expect(s.filters).toMatchObject({ budget: false, budgetUnavailable: true });
    expect(s.ranked).toHaveLength(2);
    expect(s.cantCheck).toHaveLength(0);
    expect(s.ranked[0].withinBudget).toBeNull();
  });

  it('budget filter with no exchange rate puts every program in "Can\'t check", none dropped', () => {
    const s = buildShortlist(input([cheap, pricey], { fxRates: [], query: { budget: true } }));
    expect(s.ranked).toHaveLength(0);
    expect(s.hidden.total).toBe(0);
    expect(names(s.cantCheck).sort()).toEqual(['cheap', 'pricey']);
    expect(s.cantCheck[0].reasons[0]).toMatch(/^Budget: No verified GBP/);
  });

  it('intake: options come from usable values only; missing intake goes to "Can\'t check"', () => {
    const s0 = buildShortlist(input([uk, spring, noIntake]));
    expect(s0.options.intakes).toEqual(['january', 'september']);

    const s = buildShortlist(input([uk, spring, noIntake], { query: { intake: ['january'] } }));
    expect(names(s.ranked)).toEqual(['spring']);
    expect(s.hidden).toMatchObject({ total: 1, intake: 1 });
    expect(names(s.cantCheck)).toEqual(['nointake']);
    expect(s.cantCheck[0].reasons).toEqual(['Intake: not verified yet']);
  });

  it('intake values not in the data are ignored', () => {
    const s = buildShortlist(input([uk, spring], { query: { intake: ['Made up intake'] } }));
    expect(s.filters.intake).toEqual([]);
    expect(s.ranked).toHaveLength(2);
    // A valid term no program offers is ignored too.
    expect(buildShortlist(input([uk, spring], { query: { intake: ['october'] } })).filters.intake).toEqual([]);
  });

  it('fit: decided labels filter; undecided ones go to "Can\'t check" unless "unknown" is selected', () => {
    const meets = fullProgram({ id: 'meets', name: 'MSc Fixture Meets' });
    const below = fullProgram({ id: 'below', name: 'MSc Fixture Below', min_gpa_rule: verified({ scale: 'cgpa_4', min: 3.5 }) });
    const unknown = fullProgram({ id: 'unknown', name: 'MSc Fixture Unknown', min_gpa_rule: emptyFact() });

    const s = buildShortlist(input([meets, below, unknown], { query: { fit: ['meets'] } }));
    expect(names(s.ranked)).toEqual(['meets']);
    expect(s.hidden).toMatchObject({ total: 1, fit: 1 });
    expect(names(s.cantCheck)).toEqual(['unknown']);
    expect(s.cantCheck[0].reasons).toEqual(['Fit: minimum grade not verified yet']);

    const withUnknown = buildShortlist(input([meets, below, unknown], { query: { fit: ['meets', 'unknown'] } }));
    expect(names(withUnknown.ranked)).toEqual(['meets']);
    expect(names(withUnknown.notRanked)).toEqual(['unknown']); // included, but not rankable by fit
    expect(withUnknown.cantCheck).toHaveLength(0);
  });

  it('a program failing one filter is hidden even if another is unknown; several unknowns are all listed', () => {
    const overButNoIntake = fullProgram({ id: 'x', name: 'MSc Fixture X', tuition: verified(gbp(60_000)), intake: emptyFact() });
    const bothUnknown = fullProgram({ id: 'y', name: 'MSc Fixture Y', living_cost: emptyFact(), intake: emptyFact() });
    const s = buildShortlist(
      input([overButNoIntake, bothUnknown, spring], { query: { budget: true, intake: ['january'] } }),
    );
    expect(s.hidden.budget).toBe(1);
    expect(names(s.cantCheck)).toEqual(['y']);
    expect(s.cantCheck[0].reasons).toEqual(['Intake: not verified yet', 'Budget: Living cost not verified yet']);
    expect(names(s.ranked)).toEqual(['spring']);
  });

  it('activeFilterCount counts explicit filters only', () => {
    expect(buildShortlist(input([uk])).activeFilterCount).toBe(0);
    expect(buildShortlist(input([uk], { query: { fit: ['meets'], budget: true, country: ['UK'] } })).activeFilterCount).toBe(3);
  });
});

describe('buildShortlist: field and ruled-out', () => {
  it('only programs in the profile field are included', () => {
    const cs = fullProgram({ id: 'cs1', name: 'MSc Fixture CS' });
    const ee = fullProgram({ id: 'ee1', name: 'MSc Fixture EE', field: 'ee' });
    const s = buildShortlist(input([cs, ee]));
    expect(names(s.ranked)).toEqual(['cs1']);
    expect(s.noProgramsForField).toBe(false);
    expect(s.field).toEqual({ slug: 'cs', label: 'Computer Science' });
  });

  it('flags a field with no seeded programs', () => {
    const s = buildShortlist(input([fullProgram()], { profile: { ...profile, field: 'other' } }));
    expect(s.noProgramsForField).toBe(true);
    expect(s.ranked).toHaveLength(0);
    expect(s.notRanked).toHaveLength(0);
  });

  it('ruled-out programs are listed separately and never ranked, filtered by country only', () => {
    const out = fullProgram({ id: 'out', name: 'MSc Fixture Out', status: 'ruled_out', status_note: verified('Fixture note') });
    const ok = fullProgram({ id: 'ok', name: 'MSc Fixture Ok' });
    const s = buildShortlist(input([out, ok], { query: { rank: 'tuition', fit: ['below'], budget: true } }));
    expect(names(s.ruledOut)).toEqual(['out']);
    expect([...s.ranked, ...s.notRanked, ...s.cantCheck].some((r) => r.program.id === 'out')).toBe(false);
    const de = buildShortlist(input([out, ok], { query: { country: ['DE'] } }));
    expect(de.ruledOut).toHaveLength(0);
  });
});

describe('coverage', () => {
  it('a program is verified only when min grade, deadline, tuition and language are all Verified', () => {
    expect(isProgramVerified(fullProgram(), now)).toBe(true);
    expect(isProgramVerified(fullProgram({ tuition: likely(gbp(1)) }), now)).toBe(false);
    expect(isProgramVerified(fullProgram({ deadline: verified('2027-01-01', 45) }), now)).toBe(false); // too old
    expect(isProgramVerified(fullProgram({ language_req: emptyFact() }), now)).toBe(false);
    expect(isProgramVerified(fullProgram({ min_gpa_rule: conflicting({ scale: 'cgpa_4', min: 2 }, { scale: 'cgpa_4', min: 3 }) }), now)).toBe(false);
  });

  it('counts active programs in the field, plus every field', () => {
    const programs = [
      fullProgram({ id: 'a' }),
      fullProgram({ id: 'b', tuition: emptyFact() }),
      fullProgram({ id: 'c', status: 'ruled_out' }),
      fullProgram({ id: 'd', field: 'ee' }),
      fullProgram({ id: 'e', field: 'zz-custom' }),
    ];
    const c = computeCoverage(programs, 'cs', now);
    expect(c.verified).toBe(1);
    expect(c.total).toBe(2);
    expect(c.byField).toEqual([
      { field: 'cs', label: 'Computer Science', verified: 1, total: 2 },
      { field: 'ee', label: 'Electrical Engineering', verified: 1, total: 1 },
      { field: 'zz-custom', label: 'zz-custom', verified: 1, total: 1 },
    ]);
    expect(buildShortlist(input(programs)).coverage.total).toBe(2);
  });
});

describe('helpers', () => {
  it('checkFitFilter / checkIntakeFilter / checkBudgetFilter with nothing selected pass', () => {
    const p = fullProgram({ min_gpa_rule: emptyFact(), intake: emptyFact() });
    expect(checkFitFilter(computeFit(profile, p, [], now), []).result).toBe('pass');
    expect(checkIntakeFilter(p, [], now).result).toBe('pass');
    expect(checkIntakeFilter(fullProgram({ intake: conflicting('September 2027', 'January 2028') }), ['september'], now)).toEqual({
      result: 'unknown',
      reason: 'Intake: sources disagree',
    });
    expect(checkBudgetFilter(programTotalCost(fullProgram(), fx, now), 3_000_000).result).toBe('pass');
    expect(checkBudgetFilter(programTotalCost(fullProgram(), fx, now), 2_999_999).result).toBe('fail');
  });

  it('toggleCountry', () => {
    expect(toggleCountry(null, 'DE')).toEqual(['DE']);
    expect(toggleCountry(['DE'], 'UK')).toEqual(['DE', 'UK']);
    expect(toggleCountry(['DE', 'UK'], 'DE')).toEqual(['UK']);
    expect(toggleCountry(['DE'], 'DE')).toBeNull(); // empty, no profile default -> default (all)
    expect(toggleCountry(['DE'], 'DE', ['DE', 'UK'])).toBe('all'); // empty with a profile default -> explicit all
    expect(toggleCountry(['DE'], 'UK', ['UK', 'DE'])).toBeNull(); // equals the profile default -> no param
  });

  it('mergeQuery ignores undefined fields', () => {
    expect(mergeQuery({ rank: undefined, dir: 'desc' })).toMatchObject({ rank: 'fit', dir: 'desc' });
    expect(mergeQuery(undefined).rank).toBe('fit');
  });

  it("citizenshipShortText shows the row's own wording, never a paraphrase of its months key", () => {
    expect(citizenshipShortText({ text: 'Fixture rule text', sort_months: 36 })).toBe('Fixture rule text');
    expect(citizenshipShortText({ text: '  Fixture rule  ', sort_months: null })).toBe('Fixture rule');
  });

  it('rankValueText formats the ranked value for each key', () => {
    expect(rankValueText('fit', 0)).toBeNull();
    expect(rankValueText('tuition', null)).toBeNull();
    expect(rankValueText('tuition', Number.NaN)).toBeNull();
    expect(rankValueText('tuition', 2_000_000)).toBe('PKR 2,000,000 (20 lakh) tuition for the whole programme');
    expect(rankValueText('total', 3_000_000)).toBe('PKR 3,000,000 (30 lakh) for the whole degree');
    expect(rankValueText('citizenship', 36)).toBe('36 months (the number this rule is compared by)');
    expect(rankValueText('study', 24)).toBe('2 years');
    expect(rankValueText('study', 18)).toBe('18 months');
    const days = deadlineRankKey(fullProgram({ deadline: verified('2027-01-15') }), now).value as number;
    expect(daysToIso(days)).toBe('2027-01-15');
    expect(rankValueText('deadline', days)).toBe('15 Jan 2027');
  });

  it('listedCount / hiddenSummary / emptyRankedMessage', () => {
    const uk = fullProgram({ id: 'uk', name: 'MSc Fixture UK' });
    const de = fullProgram({ id: 'de', name: 'MSc Fixture DE', country: 'DE', min_gpa_rule: emptyFact() });

    const none = buildShortlist(input([uk, de]));
    expect(listedCount(none)).toBe(2);
    expect(hiddenSummary(none)).toBeNull();

    const targeted = buildShortlist(input([uk, de], { profile: { ...profile, target_countries: ['UK'] } }));
    expect(hiddenSummary(targeted)).toBe('1 program is hidden by your filters: country (1).');

    const two = buildShortlist(
      input([uk, de, fullProgram({ id: 'pricey', name: 'MSc Fixture Pricey', tuition: verified(gbp(60_000)) })], {
        query: { country: ['UK'], budget: true },
      }),
    );
    expect(hiddenSummary(two)).toBe('2 programs are hidden by your filters: country (1), budget (1).');

    // Nothing listed because filters hid everything.
    const hiddenAll = buildShortlist(input([uk], { query: { country: ['DE'] } }));
    expect(emptyRankedMessage(hiddenAll)).toBe('No programs match your filters.');
    // Nothing listed and nothing hidden (only ruled-out programs).
    const onlyOut = buildShortlist(input([fullProgram({ status: 'ruled_out' })]));
    expect(emptyRankedMessage(onlyOut)).toBe('No open programs for these countries yet.');
    // Listed but not rankable (minimum grade missing).
    const unrankable = buildShortlist(input([de]));
    expect(unrankable.ranked).toHaveLength(0);
    expect(emptyRankedMessage(unrankable)).toMatch(/^No program can be ranked by fit yet/);
    const unrankableTuition = buildShortlist(input([fullProgram({ tuition: emptyFact() })], { query: { rank: 'tuition' } }));
    expect(emptyRankedMessage(unrankableTuition)).toMatch(/^No program can be ranked by tuition yet/);
  });

  it('profile summary text', () => {
    expect(gradeText({ cgpa: 2.5, scale: 'cgpa_4' })).toBe('CGPA 2.5 / 4.0');
    expect(gradeText({ cgpa: 3.2, scale: 'cgpa_5' })).toBe('CGPA 3.2 / 5.0');
    expect(gradeText({ cgpa: 72, scale: 'percent' })).toBe('72%');
    expect(profileSummaryParts(PERSONA_A)).toEqual([
      'CGPA 2.5 / 4.0',
      'Computer Science',
      'Germany, United Kingdom, Canada, United States',
      'Budget PKR 6,000,000 (60 lakh)',
    ]);
    expect(profileSummaryParts({ ...profile, budget_pkr: null }).slice(2)).toEqual(['All countries', 'No budget set']);
  });
});

/* ------------------------------------------------------- seed data run */

describe('seed dataset with persona A (today: no verified program facts)', () => {
  const data = loadEmptySeedDataset();
  const base = { ...data, profile: PERSONA_A, now };

  it('nothing is ranked by fit; every program is listed with a reason; LJMU is ruled out', () => {
    const s = buildShortlist(base);
    expect(s.ranked).toHaveLength(0);
    expect(s.notRanked.length).toBeGreaterThan(0);
    for (const r of s.notRanked) expect(r.reason).toBe('Minimum grade not verified yet');
    expect(s.ruledOut.map((r) => r.program.id)).toEqual(['ljmu-msc-cs']);
    expect(s.notRanked.some((r) => r.program.id === 'ljmu-msc-cs')).toBe(false);
    // Persona A targets DE/UK/CA/US, so the CH program is hidden by the default country filter (counted, not lost).
    const activeCs = data.programs.filter((p) => p.field === 'cs' && p.status === 'active');
    expect(s.notRanked.length + s.hidden.total).toBe(activeCs.length);
    expect(s.filters.countrySource).toBe('profile');
  });

  it('every rank key leaves today\'s programs unranked except citizenship (country facts are Likely)', () => {
    for (const rank of ['tuition', 'total', 'study', 'deadline'] as const) {
      const s = buildShortlist({ ...base, query: { rank } });
      expect(s.ranked, rank).toHaveLength(0);
    }
    const c = buildShortlist({ ...base, query: { rank: 'citizenship' } });
    for (const r of c.ranked) expect(['DE', 'CA']).toContain(r.program.country);
    for (const r of c.notRanked) expect(r.reason).toBe('Citizenship rule not verified yet');
  });

  it('data-dependent filters put every program in "Can\'t check", never dropping one', () => {
    const s = buildShortlist({ ...base, query: { budget: true, fit: ['meets'] } });
    expect(s.ranked).toHaveLength(0);
    expect(s.notRanked).toHaveLength(0);
    expect(s.cantCheck.length).toBeGreaterThan(0);
    expect(s.hidden.budget).toBe(0);
    expect(s.hidden.fit).toBe(0);
    expect(s.options.intakes).toEqual([]);
    expect(s.coverage.verified).toBe(0);
    expect(s.coverage.total).toBe(data.programs.filter((p) => p.field === 'cs' && p.status === 'active').length);
  });
});

describe('coverage: individual facts', () => {
  it('counts every fact field of active programs in the field, by computed confidence', () => {
    const a = makeProgram({ id: 'a', deadline: verified('2027-01-15'), tuition: likely({ amount: 1, currency: 'GBP', period: 'year' as const }) });
    const b = makeProgram({ id: 'b' });
    const ruledOut = makeProgram({ id: 'c', status: 'ruled_out', deadline: verified('2027-01-15') });
    const c = computeCoverage([a, b, ruledOut], 'cs', now);
    expect(c.facts.verified).toBe(1);
    expect(c.facts.likely).toBe(1);
    expect(c.facts.total).toBe(2 * FACT_FIELDS_PER_PROGRAM);
  });

  it('counts conditional_admission and language_waiver like every other fact field', () => {
    const a = makeProgram({
      id: 'a',
      conditional_admission: verified({ scale: 'cgpa_4' as const, min: 2.5, text: 'Fixture conditional route' }),
      language_waiver: likely('Fixture waiver wording'),
    });
    const c = computeCoverage([a], 'cs', now);
    expect(c.facts).toEqual({ verified: 1, likely: 1, total: FACT_FIELDS_PER_PROGRAM });
  });
});

/* ------------------------------------------- intake terms (review finding) */

describe('intake filter over start terms', () => {
  const tum = fullProgram({ id: 'tum', name: 'MSc Fixture TUM-like', country: 'DE', intake: verified('Summer or Winter semester') });
  const brookes = fullProgram({ id: 'brookes', name: 'MSc Fixture Brookes-like', intake: verified('January 2027, September 2027') });
  const qmul = fullProgram({ id: 'qmul', name: 'MSc Fixture QMUL-like', intake: verified('January 2027 and September 2027') });
  const imperial = fullProgram({ id: 'imperial', name: 'MSc Fixture Imperial-like', intake: verified('October 2027') });
  const unreadable = fullProgram({ id: 'rolling', name: 'MSc Fixture Rolling', intake: verified('Rolling admission') });
  const all = [tum, brookes, qmul, imperial, unreadable];
  const listed = (s: ReturnType<typeof buildShortlist>) => [...s.ranked, ...s.notRanked].map((r) => r.program.id).sort();

  it('chips are distinct terms, never two chips for the same intakes', () => {
    const s = buildShortlist(input(all));
    expect(s.options.intakes).toEqual(['january', 'september', 'october', 'summer-semester', 'winter-semester']);
  });

  it(`"October" keeps the semester program visible under "Can't check" instead of hiding it`, () => {
    const s = buildShortlist(input(all, { query: { intake: ['october'] } }));
    expect(listed(s)).toEqual(['imperial']);
    expect(s.hidden).toMatchObject({ total: 2, intake: 2 }); // Brookes-like and QMUL-like: January, September only
    expect(s.cantCheck.map((r) => r.program.id).sort()).toEqual(['rolling', 'tum']);
    expect(s.cantCheck.find((r) => r.program.id === 'tum')?.reasons).toEqual([
      `Intake: "Summer or Winter semester" can't be compared with October`,
    ]);
    expect(s.cantCheck.find((r) => r.program.id === 'rolling')?.reasons).toEqual([
      `Intake: "Rolling admission" can't be compared with October`,
    ]);
  });

  it('"January 2027, September 2027" and "January 2027 and September 2027" match the same chip', () => {
    const s = buildShortlist(input(all, { query: { intake: ['september'] } }));
    expect(listed(s)).toEqual(['brookes', 'qmul']);
    expect(s.hidden.intake).toBe(1); // Imperial-like (October only)
  });

  it('an old shared link with the raw intake text still works and no longer hides the other spelling', () => {
    const s = buildShortlist(input(all, { query: { intake: ['January 2027, September 2027'] } }));
    expect(s.filters.intake).toEqual(['january', 'september']);
    expect(listed(s)).toEqual(['brookes', 'qmul']);
    expect(selectedIntakeTerms(['October 2027', 'october', 'nonsense'], ['october'])).toEqual(['october']);
  });

  it(`"Winter semester" passes the semester program; month programs go to "Can't check", never hidden`, () => {
    const s = buildShortlist(input(all, { query: { intake: ['winter-semester'] } }));
    expect(listed(s)).toEqual(['tum']);
    expect(s.hidden.total).toBe(0);
    expect(s.cantCheck.map((r) => r.program.id).sort()).toEqual(['brookes', 'imperial', 'qmul', 'rolling']);
  });

  it('checkIntakeFilter: a usable intake that cannot be read is unknown, never fail', () => {
    expect(checkIntakeFilter(unreadable, ['january'], now).result).toBe('unknown');
    expect(checkIntakeFilter(imperial, ['january'], now).result).toBe('fail');
    expect(checkIntakeFilter(fullProgram({ intake: likely('January and September') }), ['january'], now).result).toBe('pass');
  });

  it("live seed: the reviewer's cases (TUM, Brookes, QMUL, Imperial)", () => {
    const seed = loadSeedDataset();
    const base = { ...seed, profile: { ...PERSONA_A, target_countries: [] }, now };
    const intakeOf = (id: string) => seed.programs.find((p) => p.id === id)?.intake.value;
    expect(intakeOf('tum-msc-informatics')).toBe('Summer or Winter semester');
    expect(intakeOf('brookes-msc-cs')).toBe('January 2027, September 2027');
    expect(intakeOf('qmul-premasters-cs')).toBe('January 2027 and September 2027');

    const chips = buildShortlist(base).options.intakes;
    expect(chips).toEqual(expect.arrayContaining(['january', 'september', 'october', 'summer-semester', 'winter-semester']));
    expect(new Set(chips).size).toBe(chips.length);

    const shown = (s: ReturnType<typeof buildShortlist>) =>
      [...s.ranked, ...s.notRanked, ...s.cantCheck].map((r) => r.program.id);

    const october = buildShortlist({ ...base, query: { intake: ['october'] } });
    expect(shown(october)).toContain('tum-msc-informatics'); // was hidden before the fix
    expect(october.cantCheck.find((r) => r.program.id === 'tum-msc-informatics')?.reasons).toEqual([
      `Intake: "Summer or Winter semester" can't be compared with October`,
    ]);
    expect(shown(october)).toContain('imperial-msc-computing');

    const january = buildShortlist({ ...base, query: { intake: ['january'] } });
    const passed = [...january.ranked, ...january.notRanked].map((r) => r.program.id);
    expect(passed).toEqual(expect.arrayContaining(['brookes-msc-cs', 'qmul-premasters-cs'])); // both spellings
    expect(passed).not.toContain('imperial-msc-computing');
  });
});

/* ------------------------------------------------- notes (review finding) */

describe('programNotes', () => {
  it('shows a usable status_note of an active program and a usable eligibility_note', () => {
    const p = fullProgram({ status_note: verified('Fixture status note'), eligibility_note: likely('Fixture eligibility') });
    const n = programNotes(p, now);
    expect(n.status?.value).toBe('Fixture status note');
    expect(n.eligibility?.value).toBe('Fixture eligibility');
  });

  it('leaves out Unverified or empty notes; a ruled-out status note stays on the ruled-out card', () => {
    const rumour = fullProgram({ status_note: unverified('Fixture rumour'), eligibility_note: unverified('Fixture rumour') });
    expect(programNotes(rumour, now)).toEqual({ status: null, eligibility: null });
    expect(programNotes(fullProgram({ status_note: verified('  ') }), now).status).toBeNull();
    expect(programNotes(fullProgram({ status: 'ruled_out', status_note: verified('Fixture out') }), now).status).toBeNull();
    const old = fullProgram({ eligibility_note: undefined as unknown as Program['eligibility_note'] });
    expect(programNotes(old, now).eligibility).toBeNull();
  });

  it('a Conflict note is shown (both sources), never silently dropped', () => {
    expect(programNotes(fullProgram({ eligibility_note: conflicting('Fixture A', 'Fixture B') }), now).eligibility).not.toBeNull();
  });

  it('notes never change fit, filters or ranking', () => {
    const plain = fullProgram({ id: 'a', name: 'MSc Fixture A' });
    const noted = fullProgram({
      id: 'b',
      name: 'MSc Fixture B',
      status_note: verified('Fixture status note'),
      eligibility_note: verified('Fixture: for graduates of other subjects'),
    });
    for (const rank of ['fit', 'tuition', 'total', 'deadline', 'study'] as const) {
      const s = buildShortlist(input([noted, plain], { query: { rank, fit: ['meets'] } }));
      expect(s.ranked.map((r) => r.program.id), rank).toEqual(['a', 'b']); // tie -> name order
      expect(s.ranked[0].key).toEqual(s.ranked[1].key);
      expect(s.ranked[0].fit).toEqual(s.ranked[1].fit);
    }
  });

  it('live seed: Brookes shows its verified Pakistan note; Imperial and QMUL show who the course is for', () => {
    const seed = loadSeedDataset();
    const p = (id: string) => seed.programs.find((x) => x.id === id) as Program;
    expect(programNotes(p('brookes-msc-cs'), now).status?.value).toMatch(/^Extra compliance measures for Pakistan applicants/);
    expect(programNotes(p('imperial-msc-computing'), now).eligibility?.value).toMatch(/subjects other than computing/);
    expect(programNotes(p('qmul-premasters-cs'), now).eligibility?.value).toMatch(/not related to Computer Science/);
    expect(programNotes(p('tum-msc-informatics'), now)).toEqual({ status: null, eligibility: null });
  });
});

describe('coverage: 20 fact fields per program on the live seed', () => {
  it('counts eligibility_note, conditional_admission and language_waiver with every other fact field', () => {
    const seed = loadSeedDataset();
    const activeCs = seed.programs.filter((p) => p.field === 'cs' && p.status === 'active');
    expect(computeCoverage(seed.programs, 'cs', now).facts.total).toBe(FACT_FIELDS_PER_PROGRAM * activeCs.length);
  });

  it('the fixture program has exactly that many fact fields (a new Program fact must update this number)', () => {
    const facts = Object.values(makeProgram()).filter((v) => v && typeof v === 'object' && 'value' in v);
    expect(facts).toHaveLength(FACT_FIELDS_PER_PROGRAM);
  });
});

/* ------------------------------------------- wave: deadlines (proposals #14, #30, #32) */

const DEC_2 = new Date('2026-12-02T09:00:00Z');
/** ISO date `days` from DEC_2 (UTC calendar days). */
const fromDec2 = (days: number) => daysToIso(Math.floor(DEC_2.getTime() / 86_400_000) + days);

describe('deadline ranking never ranks a passed deadline', () => {
  it('deadlineRankKey: a usable passed date is not ranked, with its date and "not verified yet" for the next one', () => {
    expect(deadlineRankKey(fullProgram({ deadline: verified('2026-11-30') }), DEC_2)).toEqual({
      value: null,
      confidence: 'Verified',
      missingReason: 'Deadline has passed (30 Nov 2026). The next deadline is not verified yet.',
    });
    expect(deadlinePassedReason('2026-12-01')).toBe('Deadline has passed (1 Dec 2026). The next deadline is not verified yet.');
    // Today is still open and ranked.
    expect(deadlineRankKey(fullProgram({ deadline: verified('2026-12-02') }), DEC_2).value).toBe(Date.UTC(2026, 11, 2) / 86_400_000);
    // An Unverified past date keeps its own reason: code never computes with an unusable date.
    expect(deadlineRankKey(fullProgram({ deadline: unverified('2026-11-30') }), DEC_2).missingReason).toBe('Deadline not verified yet');
    expect(deadlineRankKey(fullProgram({ deadline: conflicting('2026-11-30', '2026-11-29') }), DEC_2).missingReason).toBe(
      'Deadline sources conflict',
    );
  });

  it('fixtures: open dates are ranked (asc and desc, contiguous ranks); passed ones go to "Not ranked" and keep deadlinePassed', () => {
    const open1 = fullProgram({ id: 'open1', name: 'MSc Fixture Open 1', deadline: verified('2026-12-09') });
    const open2 = fullProgram({ id: 'open2', name: 'MSc Fixture Open 2', deadline: verified('2027-01-15') });
    const closed = fullProgram({ id: 'closed', name: 'MSc Fixture Closed', deadline: verified('2026-11-30') });
    const none = fullProgram({ id: 'none', name: 'MSc Fixture None', deadline: emptyFact() });
    for (const dir of ['asc', 'desc'] as const) {
      const s = buildShortlist(input([closed, open2, none, open1], { now: DEC_2, query: { rank: 'deadline', dir } }));
      expect(names(s.ranked), dir).toEqual(dir === 'asc' ? ['open1', 'open2'] : ['open2', 'open1']);
      expect(s.ranked.map((r) => r.rank)).toEqual([1, 2]);
      expect(s.notRanked.map((r) => [r.program.id, r.reason])).toEqual([
        ['closed', 'Deadline has passed (30 Nov 2026). The next deadline is not verified yet.'],
        ['none', 'Deadline not verified yet'],
      ]);
      const c = s.notRanked.find((r) => r.program.id === 'closed')!;
      expect(c.deadlinePassed).toBe(true);
      expect(c.deadlineDaysLeft).toBe(-2);
    }
    // Ranking by fit is unchanged: the passed program is still ranked there, flagged as passed.
    const byFit = buildShortlist(input([closed, open1], { now: DEC_2 }));
    expect(names(byFit.ranked)).toEqual(['closed', 'open1']);
    expect(byFit.ranked[0].deadlinePassed).toBe(true);
  });

  it('live seed, 2 Dec 2026, all countries: CMU is first; ETH, Toronto and UIUC are not ranked, with the reason', () => {
    const live = loadSeedDataset();
    const s = buildShortlist({ ...live, profile: { ...PERSONA_A, target_countries: [] }, now: DEC_2, query: { rank: 'deadline' } });
    expect(s.ranked[0].program.id).toBe('cmu-mscs');
    expect(s.ranked[0].rank).toBe(1);
    for (const r of s.ranked) expect(r.deadlinePassed, r.program.id).toBe(false);
    const reason = (id: string) => s.notRanked.find((r) => r.program.id === id)?.reason;
    expect(reason('ethz-msc-cs')).toBe('Deadline has passed (30 Nov 2026). The next deadline is not verified yet.');
    expect(reason('utoronto-mscac')).toBe('Deadline has passed (1 Dec 2026). The next deadline is not verified yet.');
    expect(reason('uiuc-mscs')).toBe('Deadline has passed (1 Dec 2026). The next deadline is not verified yet.');
    // Still listed with the date (cards show "Date has passed"); nothing is hidden.
    const eth = s.notRanked.find((r) => r.program.id === 'ethz-msc-cs')!;
    expect(eth.program.deadline.value).toBe('2026-11-30');
    expect(eth.deadlinePassed).toBe(true);
    expect(s.hidden.total).toBe(0);
  });

  it('live seed, 24 Nov 2026: nothing has passed yet, so ETH is first and no "has passed" reason appears', () => {
    const live = loadSeedDataset();
    const s = buildShortlist({ ...live, profile: { ...PERSONA_A, target_countries: [] }, now, query: { rank: 'deadline' } });
    expect(s.ranked[0].program.id).toBe('ethz-msc-cs');
    expect(names(s.ranked).slice(1, 4).sort()).toEqual(['cmu-mscs', 'uiuc-mscs', 'utoronto-mscac']);
    expect(s.ranked[3].program.id).toBe('cmu-mscs');
    expect(s.notRanked.some((r) => r.reason.startsWith('Deadline has passed'))).toBe(false);
  });
});

describe('days left and "Deadlines in the next 30 days"', () => {
  it('deadlineDaysLeft exists only for usable, readable dates; daysLeftLabel wording', () => {
    expect(deadlineDaysLeft(fullProgram({ deadline: verified('2026-12-09') }), DEC_2)).toBe(7);
    expect(deadlineDaysLeft(fullProgram({ deadline: verified('2026-12-02') }), DEC_2)).toBe(0);
    expect(deadlineDaysLeft(fullProgram({ deadline: verified('2026-11-30') }), DEC_2)).toBe(-2);
    expect(deadlineDaysLeft(fullProgram({ deadline: likely('2026-12-09') }), DEC_2)).toBe(7);
    expect(deadlineDaysLeft(fullProgram({ deadline: unverified('2026-12-09') }), DEC_2)).toBeNull();
    expect(deadlineDaysLeft(fullProgram({ deadline: conflicting('2026-12-09', '2026-12-10') }), DEC_2)).toBeNull();
    expect(deadlineDaysLeft(fullProgram({ deadline: verified('rolling') }), DEC_2)).toBeNull();
    expect(daysLeftLabel(12)).toBe('12 days left');
    expect(daysLeftLabel(1)).toBe('1 day left');
    expect(daysLeftLabel(0)).toBe('Closes today');
    expect(daysLeftLabel(-1)).toBe('Date has passed');
  });

  it('closingSoon: usable dates 0-30 days away only (boundaries included), sorted, with confidence and the student note', () => {
    expect(CLOSING_SOON_DAYS).toBe(30);
    const rows = [
      fullProgram({ id: 'd30', name: 'MSc Fixture D30', deadline: verified(fromDec2(30)) }),
      fullProgram({ id: 'd31', name: 'MSc Fixture D31', deadline: verified(fromDec2(31)) }),
      fullProgram({
        id: 'd0',
        name: 'MSc Fixture D0',
        deadline: { ...likely(fromDec2(0)), note: 'Fixture noon cut-off.', review_note: 'Fixture internal.' },
      }),
      fullProgram({ id: 'past', name: 'MSc Fixture Past', deadline: verified(fromDec2(-1)) }),
      fullProgram({ id: 'unv', name: 'MSc Fixture Unverified', deadline: unverified(fromDec2(3)) }),
      fullProgram({ id: 'con', name: 'MSc Fixture Conflict', deadline: conflicting(fromDec2(3), fromDec2(4)) }),
      fullProgram({ id: 'd5', name: 'MSc Fixture D5', deadline: verified(fromDec2(5)) }),
    ];
    const s = buildShortlist(input(rows, { now: DEC_2 }));
    const soon = closingSoon(s, DEC_2);
    expect(soon.map((r) => [r.program.id, r.days, r.confidence])).toEqual([
      ['d0', 0, 'Likely'],
      ['d5', 5, 'Verified'],
      ['d30', 30, 'Verified'],
    ]);
    expect(soon[0].note).toBe('Fixture noon cut-off.');
    expect(soon[0].iso).toBe(fromDec2(0));
    expect(soon[0].institutionName).toBe('Fixture University');
    expect(JSON.stringify(soon.map((r) => r.note))).not.toContain('Fixture internal');
    expect(closingSoon(s, DEC_2, 5).map((r) => r.program.id)).toEqual(['d0', 'd5']);
    expect(closingSoon({ ranked: [], notRanked: [], cantCheck: [] }, DEC_2)).toEqual([]);
  });

  it('closingSoon only re-shows listed rows: country and fit filters apply; "Can\'t check" rows are included', () => {
    const uk = fullProgram({ id: 'uk', name: 'MSc Fixture UK', deadline: verified(fromDec2(3)) });
    const de = fullProgram({ id: 'de', name: 'MSc Fixture DE', country: 'DE', deadline: verified(fromDec2(4)) });
    const below = fullProgram({
      id: 'below',
      name: 'MSc Fixture Below',
      deadline: verified(fromDec2(2)),
      min_gpa_rule: verified({ scale: 'cgpa_4', min: 3.5 }),
    });
    const s = buildShortlist(input([uk, de, below], { now: DEC_2, query: { country: ['UK'], fit: ['meets'] } }));
    expect(closingSoon(s, DEC_2).map((r) => r.program.id)).toEqual(['uk']);

    const noIntake = fullProgram({ id: 'ni', name: 'MSc Fixture No intake', intake: emptyFact(), deadline: verified(fromDec2(1)) });
    const s2 = buildShortlist(input([uk, noIntake], { now: DEC_2, query: { intake: ['september'] } }));
    expect(names(s2.cantCheck)).toEqual(['ni']);
    expect(closingSoon(s2, DEC_2).map((r) => r.program.id)).toEqual(['ni', 'uk']);
  });

  it("live seed, persona A's countries: Toronto, UIUC (7 days) and CMU (15) on 24 Nov; only CMU (7) on 2 Dec", () => {
    const live = loadSeedDataset();
    const nov = closingSoon(buildShortlist({ ...live, profile: PERSONA_A, now }), now);
    expect(nov.map((r) => r.program.id).slice(0, 2).sort()).toEqual(['uiuc-mscs', 'utoronto-mscac']);
    expect(nov.map((r) => [r.program.id, r.days, r.confidence]).sort()).toEqual([
      ['cmu-mscs', 15, 'Verified'],
      ['uiuc-mscs', 7, 'Likely'],
      ['utoronto-mscac', 7, 'Verified'],
    ]);
    expect(nov[2].program.id).toBe('cmu-mscs');
    // ETH (Switzerland, 6 days away) is not one of persona A's countries.
    expect(nov.map((r) => r.program.id)).not.toContain('ethz-msc-cs');
    expect(nov.find((r) => r.program.id === 'utoronto-mscac')?.note).toMatch(/11:59 p\.m\. Toronto time/);

    const dec = closingSoon(buildShortlist({ ...live, profile: PERSONA_A, now: DEC_2 }), DEC_2);
    expect(dec.map((r) => [r.program.id, r.days])).toEqual([['cmu-mscs', 7]]);
  });
});

/* ----------------------------------------- wave: Plan B link + conditional route (#2) */

describe('Plan B link and the official route below the minimum', () => {
  const below = fullProgram({ id: 'below', name: 'MSc Fixture Below', min_gpa_rule: verified({ scale: 'cgpa_4', min: 3.5 }) });
  const meets = fullProgram({ id: 'meets', name: 'MSc Fixture Meets' });
  const unknown = fullProgram({ id: 'unknown', name: 'MSc Fixture Unknown', min_gpa_rule: emptyFact() });
  const preBelow = fullProgram({
    id: 'pre',
    name: 'MSc Fixture Pre',
    pathway_type: 'pre_masters',
    min_gpa_rule: verified({ scale: 'cgpa_4', min: 3.5 }),
  });
  const routeValue = { scale: 'cgpa_4' as const, min: 2.5, text: 'Fixture conditional route wording' };
  const route = verified(routeValue);

  it('planBSuggested: direct programs that are Below minimum or whose range crosses it', () => {
    const s = buildShortlist(input([below, meets, unknown, preBelow]));
    const row = (id: string) => [...s.ranked, ...s.notRanked].find((r) => r.program.id === id)!;
    expect(planBSuggested(row('below'))).toBe(true);
    expect(planBSuggested(row('meets'))).toBe(false);
    expect(planBSuggested(row('unknown'))).toBe(false);
    expect(planBSuggested(row('pre'))).toBe(false);
    const rules = [
      {
        id: 'fixture-bavarian',
        scope: 'PK->*',
        from_scale: 'cgpa_4' as const,
        to_scale: 'german' as const,
        formula: 'modified_bavarian' as const,
        params: { nmax: 4, nmin: [1, 2] as [number, number] },
        source_url: 'https://fixture.example.org/rule',
      },
    ];
    const de = fullProgram({ id: 'de', country: 'DE', min_gpa_rule: verified({ scale: 'german', min: 2.0 }) });
    const crosses = computeFit(profile, de, rules, now);
    expect(crosses.reason.code).toBe('STRADDLES_MIN');
    expect(planBSuggested({ program: de, fit: crosses })).toBe(true);
  });

  it('planBTargetHref keeps the profile query and adds the target', () => {
    expect(planBTargetHref('?cgpa=2.5&scale=cgpa_4&field=cs', 'brookes-msc-cs')).toBe(
      '/plan-b?cgpa=2.5&scale=cgpa_4&field=cs&target=brookes-msc-cs',
    );
    expect(planBTargetHref('', 'a b')).toBe('/plan-b?target=a%20b');
  });

  it('live seed, persona A: the link is offered for the Below-minimum programmes only (Brookes, NYIT, UCCS, USF)', () => {
    const live = loadSeedDataset();
    const s = buildShortlist({ ...live, profile: { ...PERSONA_A, target_countries: [] }, now });
    const offered = [...s.ranked, ...s.notRanked, ...s.cantCheck].filter(planBSuggested).map((r) => r.program.id).sort();
    expect(offered).toEqual(['brookes-msc-cs', 'nyit-mscs', 'uccs-mscs', 'usf-mscs']);
  });

  it('conditionalRoute: usable routes only, never when the regular minimum is met, never on ruled-out programs', () => {
    const fitOf = (p: Program) => computeFit(profile, p, [], now);
    const withRoute = { ...below, conditional_admission: route };
    expect(conditionalRoute(withRoute, fitOf(withRoute), now)?.value?.text).toBe('Fixture conditional route wording');
    const unknownWithRoute = { ...unknown, conditional_admission: likely(routeValue) };
    expect(conditionalRoute(unknownWithRoute, fitOf(unknownWithRoute), now)?.value?.text).toBe('Fixture conditional route wording');
    const meetsWithRoute = { ...meets, conditional_admission: route };
    expect(conditionalRoute(meetsWithRoute, fitOf(meetsWithRoute), now)).toBeNull();
    const unv = { ...below, conditional_admission: unverified(routeValue) };
    expect(conditionalRoute(unv, fitOf(unv), now)).toBeNull();
    const con = { ...below, conditional_admission: conflicting(routeValue, { ...routeValue, min: 2.0 }) };
    expect(conditionalRoute(con, fitOf(con), now)).toBeNull();
    const blank = { ...below, conditional_admission: verified({ scale: 'cgpa_4' as const, min: null, text: '  ' }) };
    expect(conditionalRoute(blank, fitOf(blank), now)).toBeNull();
    const out = { ...withRoute, status: 'ruled_out' as const };
    expect(conditionalRoute(out, fitOf(out), now)).toBeNull();
    expect(conditionalRoute(below, fitOf(below), now)).toBeNull();
  });

  it('a conditional route or a language waiver never changes the fit label, filters or ranking', () => {
    const plain = buildShortlist(input([below, meets]));
    const extra = buildShortlist(
      input([
        { ...below, conditional_admission: route, language_waiver: verified('Fixture waiver wording') },
        { ...meets, conditional_admission: route },
      ]),
    );
    expect(extra.ranked.map((r) => [r.program.id, r.rank, r.fit.label, r.key])).toEqual(
      plain.ranked.map((r) => [r.program.id, r.rank, r.fit.label, r.key]),
    );
    for (const fit of [['below'], ['meets']] as const) {
      expect(names(buildShortlist(input([{ ...below, conditional_admission: route }, meets], { query: { fit: [...fit] } })).ranked)).toEqual(
        names(buildShortlist(input([below, meets], { query: { fit: [...fit] } })).ranked),
      );
    }
  });

  it('live seed, persona A: NYIT, UCCS and Würzburg show their official route; the fit label is unchanged', () => {
    const live = loadSeedDataset();
    const s = buildShortlist({ ...live, profile: { ...PERSONA_A, target_countries: [] }, now });
    const rows = [...s.ranked, ...s.notRanked, ...s.cantCheck];
    const withRoute = rows.filter((r) => conditionalRoute(r.program, r.fit, now)).map((r) => r.program.id).sort();
    expect(withRoute).toEqual(['nyit-mscs', 'uccs-mscs', 'wuerzburg-msc-cs']);
    for (const id of withRoute) {
      const r = rows.find((x) => x.program.id === id)!;
      const bare = { ...r.program, conditional_admission: emptyFact<never>() };
      expect(computeFit(PERSONA_A, bare, live.conversionRules, now).label, id).toBe(r.fit.label);
    }
  });
});

/* ------------------------------------------------------ wave: small helpers (#4c, #9, #36, #11) */

describe('cost caveats, PKR rate availability, fallback field and the shareable profile link', () => {
  it('totalCostCaveats: the plain-text caveats of a shown total; none without a total', () => {
    const cost = programTotalCost(fullProgram(), fx, now);
    expect(totalCostCaveats(cost)).toEqual([]);
    expect(totalCostCaveats({ ...cost, caveats: ['Tuition: Fixture fee note.', '  ', 3] } as never)).toEqual(['Tuition: Fixture fee note.']);
    expect(totalCostCaveats({ ...cost, caveats: undefined } as never)).toEqual([]);
    // From cost.ts: the usable tuition note becomes a caveat on the total.
    const noted = programTotalCost(fullProgram({ tuition: { ...verified(gbp(20_000)), note: 'Fixture semester fee extra.' } }), fx, now);
    expect(totalCostCaveats(noted)).toEqual(['Tuition: Fixture semester fee extra.']);
    // No total shown (here: no rate, and the currencies differ): the note stays under Tuition only.
    const noTotal = programTotalCost(
      fullProgram({ tuition: { ...verified(gbp(20_000)), note: 'Fixture semester fee extra.' }, living_cost: verified({ amount: 1, currency: 'EUR', period: 'year' as const }) }),
      fx,
      now,
    );
    expect(noTotal.pkr).toBeNull();
    expect(noTotal.native).toBeNull();
    expect(totalCostCaveats(noTotal)).toEqual([]);
  });

  it('hasUsablePkrRate / options.pkrRateAvailable', () => {
    expect(hasUsablePkrRate(fx, now)).toBe(true);
    expect(hasUsablePkrRate([], now)).toBe(false);
    expect(hasUsablePkrRate([fx[1]], now)).toBe(false); // the EUR row is Unverified
    expect(buildShortlist(input([fullProgram()])).options.pkrRateAvailable).toBe(true);
    expect(buildShortlist(input([fullProgram()], { fxRates: [] })).options.pkrRateAvailable).toBe(false);
    const live = loadSeedDataset();
    expect(buildShortlist({ ...live, profile: PERSONA_A, now }).options.pkrRateAvailable).toBe(
      live.fxRates.some((r) => r.pkr_per_unit.value != null && isUsable(computeConfidence(r.pkr_per_unit, now))),
    );
  });

  it('a field with no programs offers Computer Science (the field we have); otherwise no fallback', () => {
    const live = loadSeedDataset();
    // 'other' has no seeded programs (Data Science, Software and Electrical Engineering do since 27 Nov 2026).
    const other = buildShortlist({ ...live, profile: { ...PERSONA_A, field: 'other' }, now });
    expect(other.noProgramsForField).toBe(true);
    expect(other.fallbackField).toEqual({ slug: 'cs', label: 'Computer Science' });
    expect(buildShortlist({ ...live, profile: PERSONA_A, now }).fallbackField).toBeNull();
    // No Computer Science programs in the data either: nothing to offer.
    expect(buildShortlist(input([], { profile: { ...profile, field: 'ds' } })).fallbackField).toBeNull();
  });

  it('profileShortlistPath carries grade, field, budget and countries only (never name, university or degree)', () => {
    const path = profileShortlistPath(PERSONA_A);
    const u = new URL(path, 'https://masterspath.example');
    expect(u.pathname).toBe('/shortlist');
    expect([...u.searchParams.keys()].sort()).toEqual(['budget', 'cgpa', 'countries', 'field', 'scale']);
    expect(u.searchParams.get('cgpa')).toBe('2.5');
    expect(u.searchParams.get('scale')).toBe('cgpa_4');
    expect(u.searchParams.get('field')).toBe('cs');
    expect(u.searchParams.get('budget')).toBe('6000000');
    expect(u.searchParams.get('countries')).toBe('DE,UK,CA,US');
    expect(decodeURIComponent(path)).not.toMatch(/Demo|University|BS Computer|persona/i);

    const cs = new URL(profileShortlistPath({ ...PERSONA_A, field: 'ds' }, { field: 'cs' }), 'https://masterspath.example');
    expect(cs.searchParams.get('field')).toBe('cs');
    expect(cs.searchParams.get('budget')).toBe('6000000');

    const ranked = new URL(profileShortlistPath(PERSONA_A, { rank: 'deadline', dir: 'desc' }), 'https://masterspath.example');
    expect(ranked.searchParams.get('rank')).toBe('deadline');
    expect(ranked.searchParams.get('dir')).toBe('desc');
    expect(profileShortlistPath(PERSONA_A, { rank: 'fit', dir: 'asc' })).toBe(path);
  });
});
