/**
 * Row <-> type mappers (src/lib/supabase/mappers.ts).
 * Round trips: seed JSON / full fixtures -> DB row (buildSeedRows) -> through Postgres (pg-sim) -> type, deep-equal.
 * Fixture values are fictional ("Fixture University", currency XTS = the ISO 4217 code reserved for tests).
 */
import { describe, expect, it } from 'vitest';
import { computeConfidence, emptyFact } from '@/lib/confidence';
import { loadSeedDataset } from '@/lib/data/seed-source';
import {
  INSTITUTION_FACT_FIELDS,
  PROGRAM_COLUMNS,
  PROGRAM_FACT_FIELDS,
  RowShapeError,
  buildSeedRows,
  countryFactToRow,
  factIsWellFormed,
  isIsoCalendarDate,
  normalizeTimestamp,
  rowToConversionRule,
  rowToCountryFact,
  rowToFxRate,
  rowToInstitution,
  rowToProgram,
  sourceIsWellFormed,
  validateSeedRows,
  type DatasetLike,
  type MapIssue,
} from '@/lib/supabase/mappers';
// The data source re-exports the mappers (the task contract names them there).
import * as source from '@/lib/data/supabase-source';
import { FIXED_NOW, conflicting, likely, makeInstitution, makeProgram, unverified, verified } from '@/lib/test-fixtures';
import type { ConversionRule, CountryFact, Fact, FxRate, Program } from '@/lib/types';
import { throughPostgres } from './pg-sim';

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function roundTrip(d: DatasetLike) {
  const rows = buildSeedRows(d, FIXED_NOW);
  const issues: MapIssue[] = [];
  return {
    rows,
    issues,
    dataset: {
      institutions: rows.institutions.map((r) => rowToInstitution(throughPostgres('institutions', r), issues)),
      programs: rows.programs.map((r) => rowToProgram(throughPostgres('programs', r), issues)),
      countryFacts: rows.country_facts.map((r) => rowToCountryFact(throughPostgres('country_facts', r), issues)),
      conversionRules: rows.conversion_rules.map((r) =>
        rowToConversionRule(throughPostgres('conversion_rules', r), issues),
      ),
      fxRates: rows.fx_rates.map((r) => rowToFxRate(throughPostgres('fx_rates', r), issues)),
    },
  };
}

/* ---------------- Full-data fixtures (fictional) ---------------- */

const FULL_PROGRAM: Program = makeProgram({
  id: 'fixture-msc-full',
  status_note: verified('Fixture status note'),
  intake: verified('Fixture winter intake'),
  deadline: verified('2027-01-15'),
  min_gpa_rule: verified({ scale: 'cgpa_4', min: 3, text: 'Fixture minimum wording', alternatives: [{ scale: 'percent', min: 60 }] }),
  language_req: likely({ ielts_overall: 6.5, toefl_ibt: null, waiver: null, text: 'Fixture language wording' }),
  tuition: verified({ amount: 12345, currency: 'XTS', period: 'year' }),
  living_cost: { ...likely({ amount: 900, currency: 'XTS', period: 'month' }), note: 'Fixture note' },
  duration_months: verified(12, 45), // older than 30 days -> Likely
  scholarship_info: conflicting('Fixture scholarship A', 'Fixture scholarship B'),
  sop_requirements: verified('Fixture statement of purpose wording'),
  lor_count: conflicting(2, 3),
  cv_requirements: unverified('Fixture value with no evidence'),
  tests_required: { ...verified('Fixture: no tests'), basis: 'verbatim' },
  research_considered: { ...likely('Fixture research wording'), basis: 'inferred' },
  progression_guaranteed: verified(false),
  progression_requirement: verified('Fixture progression wording'),
  eligibility_note: verified('Fixture: for graduates of other subjects'),
  conditional_admission: { ...verified({ scale: 'cgpa_4', min: 2.5, text: 'Fixture provisional route' }), review_note: 'Fixture reviewer note' },
  language_waiver: { ...likely('Fixture: medium-of-instruction letter accepted'), note: 'Fixture waiver note' },
  admissions_email: verified('admissions@fixture.example.edu'),
  last_checked: '2026-11-20',
});

/** A conditional route with no stated floor (min null) must round-trip as null, not 0. */
const NO_FLOOR_PROGRAM: Program = makeProgram({
  id: 'fixture-msc-no-floor',
  conditional_admission: verified({ scale: 'cgpa_4', min: null, text: 'Fixture: provisional admission, no floor stated' }),
  min_gpa_rule: verified({ scale: 'cgpa_4', min: 3, alternatives: null }),
});

const FULL_INSTITUTION = makeInstitution({
  hec_status: verified('Fixture listed status'),
  pqr_status: likely('Fixture PQR status'),
  anabin_status: conflicting('H+', 'H-'),
  recognition_list_status: verified('listed'),
  notes: 'Fixture notes',
});

const FULL_COUNTRY_FACTS: CountryFact[] = [
  {
    id: 'xx-citizenship-rule',
    country: 'XX',
    key: 'citizenship_rule',
    value: { text: 'Fixture rule text', sort_months: 60, clock_note: 'Fixture clock note' },
    source_url: 'https://fixture.example.gov/citizenship',
    evidence_snippet: 'Fixture snippet',
    fetched_at: '2026-11-20',
    basis: 'verbatim',
    note: 'Fixture note',
  },
  {
    id: 'xx-living-cost-typical',
    country: 'XX',
    key: 'living_cost_typical',
    value: { text: 'Fixture cost text', money: { amount: 700, currency: 'XTS', period: 'month' } },
    source_url: 'https://fixture.example.gov/cost-a',
    evidence_snippet: null,
    fetched_at: '2026-11-01',
    basis: 'summary',
    conflicts: [
      {
        value: { text: 'Fixture other cost text', money: { amount: 800, currency: 'XTS', period: 'month' } },
        source_url: 'https://fixture.example.gov/cost-b',
        evidence_snippet: 'Fixture other snippet',
        fetched_at: '2026-11-02',
      },
    ],
  },
  { id: 'xx-pr-route', country: 'XX', key: 'pr_route', value: null, source_url: null, evidence_snippet: null, fetched_at: null, note: 'Fixture: not verified yet' },
  {
    id: 'xx-proof-of-funds',
    country: 'XX',
    key: 'proof_of_funds',
    value: { text: 'Fixture blocked account rule', money: { amount: 11904, currency: 'XTS', period: 'year' }, clock_note: 'Fixture clock note' },
    source_url: 'https://fixture.example.gov/funds',
    evidence_snippet: 'Fixture funds snippet 11904',
    fetched_at: '2026-11-24',
    review_note: 'Fixture reviewer note',
  },
];

/**
 * country_facts.note and review_note are flat nullable columns: an explicit null and an absent key are both stored as
 * NULL and both mean "no note", so the mapper returns them absent. Compare with that one normalisation only.
 */
function nullNotesAsAbsent(facts: CountryFact[]): CountryFact[] {
  return facts.map((f) => {
    const out = { ...f };
    if (out.note === null) delete out.note;
    if (out.review_note === null) delete out.review_note;
    return out;
  });
}

const FULL_RULE: ConversionRule = {
  id: 'fixture-rule',
  scope: 'PK->XX',
  from_scale: 'cgpa_4',
  to_scale: 'german',
  formula: 'modified_bavarian',
  params: { nmax: 4, nmin: [1, 2] },
  source_url: 'https://fixture.example.gov/conversion',
  evidence_snippet: 'Fixture formula snippet',
  fetched_at: '2026-11-20',
  notes: 'Fixture notes',
};

const FULL_FX: FxRate = { id: 'xts-pkr', currency: 'XTS', pkr_per_unit: verified(123.45, 3, 'https://fixture.example.gov/fx') };

const FULL: DatasetLike = {
  institutions: [FULL_INSTITUTION],
  programs: [FULL_PROGRAM, NO_FLOOR_PROGRAM],
  countryFacts: FULL_COUNTRY_FACTS,
  conversionRules: [FULL_RULE],
  fxRates: [FULL_FX],
};

/* ---------------- Tests ---------------- */

describe('round trip: seed JSON -> DB row -> type', () => {
  const seed = loadSeedDataset();
  const { dataset, issues, rows } = roundTrip(seed);

  it('is deep-equal for every table', () => {
    expect(dataset.institutions).toEqual(json(seed.institutions));
    expect(dataset.programs).toEqual(json(seed.programs));
    expect(dataset.countryFacts).toEqual(nullNotesAsAbsent(json(seed.countryFacts)));
    expect(dataset.conversionRules).toEqual(json(seed.conversionRules));
    expect(dataset.fxRates).toEqual(json(seed.fxRates));
    expect(issues).toEqual([]);
  });

  it('keeps the new fields exactly: conditional routes, language waivers, GPA alternatives, proof of funds', () => {
    const byId = new Map(dataset.programs.map((p) => [p.id, p]));
    const seeded = seed.programs.filter((p) => p.conditional_admission.value != null || p.language_waiver.value != null);
    expect(seeded.length).toBeGreaterThan(0);
    for (const p of seeded) {
      expect(byId.get(p.id)!.conditional_admission, p.id).toEqual(json(p.conditional_admission));
      expect(byId.get(p.id)!.language_waiver, p.id).toEqual(json(p.language_waiver));
    }
    expect(byId.get('brookes-msc-cs')!.min_gpa_rule.value?.alternatives).toEqual([{ scale: 'percent', min: 60 }]);
    expect(byId.get('uccs-mscs')!.conditional_admission.value?.min).toBeNull();
    const funds = dataset.countryFacts.filter((f) => f.key === 'proof_of_funds');
    const seedFunds = seed.countryFacts.filter((f) => f.key === 'proof_of_funds');
    expect(funds.map((f) => f.country).sort()).toEqual(seedFunds.map((f) => f.country).sort());
    expect(funds.find((f) => f.country === 'DE')?.value?.money).toEqual({ amount: 11904, currency: 'EUR', period: 'year' });
    for (const f of funds) {
      expect(computeConfidence(f, FIXED_NOW), f.id).toBe(computeConfidence(seedFunds.find((s) => s.id === f.id)!, FIXED_NOW));
    }
  });

  it('an explicit null note and an absent note both come back as "no note"', () => {
    const base = FULL_COUNTRY_FACTS[0];
    const withNull = rowToCountryFact(throughPostgres('country_facts', countryFactToRow({ ...base, note: null, review_note: null })));
    const absent: CountryFact = { ...base };
    delete absent.note;
    const withAbsent = rowToCountryFact(throughPostgres('country_facts', countryFactToRow(absent)));
    expect(withNull).toEqual(withAbsent);
    expect('note' in withNull).toBe(false);
  });

  it('keeps every row (nothing silently dropped)', () => {
    expect(dataset.programs).toHaveLength(seed.programs.length);
    expect(dataset.institutions).toHaveLength(seed.institutions.length);
    expect(dataset.countryFacts).toHaveLength(seed.countryFacts.length);
    expect(dataset.programs.find((p) => p.id === 'ljmu-msc-cs')?.status).toBe('ruled_out');
  });

  it('passes the same checks as the SQL CHECK constraints', () => {
    expect(validateSeedRows(rows)).toEqual([]);
  });

  it('computes the same confidence before and after', () => {
    for (const [i, p] of seed.programs.entries()) {
      for (const k of PROGRAM_FACT_FIELDS) {
        expect(computeConfidence(dataset.programs[i][k] as Fact<unknown>, FIXED_NOW)).toBe(computeConfidence(p[k] as Fact<unknown>, FIXED_NOW));
      }
    }
    for (const [i, f] of seed.countryFacts.entries()) {
      expect(computeConfidence(dataset.countryFacts[i], FIXED_NOW)).toBe(computeConfidence(f, FIXED_NOW));
    }
  });
});

describe('round trip: full fixture data', () => {
  const { dataset, issues, rows } = roundTrip(FULL);

  it('is deep-equal (values, sources, basis, notes and conflicts kept)', () => {
    expect(dataset.programs).toEqual(json(FULL.programs));
    expect(dataset.institutions).toEqual(json(FULL.institutions));
    expect(dataset.countryFacts).toEqual(nullNotesAsAbsent(json(FULL.countryFacts)));
    expect(dataset.conversionRules).toEqual(json(FULL.conversionRules));
    expect(dataset.fxRates).toEqual(json(FULL.fxRates));
    expect(issues).toEqual([]);
    expect(validateSeedRows(rows)).toEqual([]);
  });

  it('keeps Verified, Likely, Unverified and Conflict exactly', () => {
    const p = dataset.programs[0];
    expect(computeConfidence(p.tuition, FIXED_NOW)).toBe('Verified');
    expect(computeConfidence(p.language_req, FIXED_NOW)).toBe('Likely');
    expect(computeConfidence(p.duration_months, FIXED_NOW)).toBe('Likely');
    expect(computeConfidence(p.cv_requirements, FIXED_NOW)).toBe('Unverified');
    expect(computeConfidence(p.scholarship_info, FIXED_NOW)).toBe('Conflict');
    expect(computeConfidence(p.lor_count, FIXED_NOW)).toBe('Conflict');
    expect(p.progression_guaranteed.value).toBe(false); // false is a value, not "missing"
    expect(computeConfidence(dataset.institutions[0].anabin_status, FIXED_NOW)).toBe('Conflict');
    expect(computeConfidence(dataset.countryFacts[1], FIXED_NOW)).toBe('Conflict');
    expect(computeConfidence(dataset.countryFacts[2], FIXED_NOW)).toBe('Unverified');
    expect(computeConfidence(dataset.fxRates[0].pkr_per_unit, FIXED_NOW)).toBe('Verified');
  });

  it('a full timestamp in a timestamptz column comes back as the same instant', () => {
    const fact: CountryFact = { ...FULL_COUNTRY_FACTS[0], fetched_at: '2026-11-23T12:34:56.789Z' };
    const back = rowToCountryFact(throughPostgres('country_facts', countryFactToRow(fact)));
    expect(Date.parse(back.fetched_at as string)).toBe(Date.parse(fact.fetched_at as string));
    expect(computeConfidence(back, FIXED_NOW)).toBe(computeConfidence(fact, FIXED_NOW));
  });
});

describe('row -> type never invents a value', () => {
  const base = buildSeedRows({ ...FULL, countryFacts: [], conversionRules: [], fxRates: [] }).programs[0];

  it('a value with the wrong shape becomes "Not verified yet" and is reported', () => {
    const issues: MapIssue[] = [];
    const p = rowToProgram(
      { ...base, tuition: { value: 'cheap', source_url: 'https://fixture.example.edu/fees', evidence_snippet: 'x', fetched_at: '2026-11-20' } },
      issues,
    );
    expect(p.tuition.value).toBeNull();
    expect(computeConfidence(p.tuition, FIXED_NOW)).toBe('Unverified');
    expect(issues.some((i) => i.field === 'tuition')).toBe(true);
  });

  it('removes non-http links (no javascript: URLs reach the UI)', () => {
    const issues: MapIssue[] = [];
    const p = rowToProgram(
      {
        ...base,
        official_url: 'javascript:alert(1)',
        intake: { value: 'Fixture', source_url: 'javascript:alert(1)', evidence_snippet: null, fetched_at: null },
      },
      issues,
    );
    expect(p.official_url).toBeNull();
    expect(p.intake.source_url).toBeNull();
    expect(issues.map((i) => i.field)).toEqual(expect.arrayContaining(['official_url', 'intake']));
  });

  it('a missing or broken fact column is an empty (Unverified) fact', () => {
    const issues: MapIssue[] = [];
    const p = rowToProgram({ ...base, deadline: null, intake: 'not an object' as unknown as null }, issues);
    expect(p.deadline).toEqual(emptyFact());
    expect(p.intake).toEqual(emptyFact());
    expect(issues.some((i) => i.field === 'intake')).toBe(true);
  });

  it('ignores a bad conflicts list and an unknown basis, and reports both', () => {
    const issues: MapIssue[] = [];
    const p = rowToProgram(
      { ...base, intake: { value: 'Fixture', source_url: null, evidence_snippet: null, fetched_at: null, basis: 'guess', conflicts: 'x' } },
      issues,
    );
    expect(p.intake.basis).toBeUndefined();
    expect(p.intake.conflicts).toBeUndefined();
    expect(issues.filter((i) => i.field === 'intake')).toHaveLength(2);
  });

  it('checks value shapes per field', () => {
    const bad = (field: string, value: unknown) =>
      rowToProgram({ ...base, [field]: { value, source_url: null, evidence_snippet: null, fetched_at: null } })[field as keyof Program];
    expect((bad('deadline', 'not a date') as Fact<string>).value).toBeNull();
    expect((bad('conditional_admission', { scale: 'cgpa_4', min: '2.5', text: 'x' }) as Fact<unknown>).value).toBeNull();
    expect((bad('conditional_admission', { scale: 'cgpa_4', min: 2.5 }) as Fact<unknown>).value).toBeNull(); // no text
    expect((bad('language_waiver', true) as Fact<unknown>).value).toBeNull();
    expect((bad('min_gpa_rule', { scale: 'cgpa_4', min: 3, alternatives: [{ scale: 'percent', min: '60' }] }) as Fact<unknown>).value).toBeNull();
    expect((bad('min_gpa_rule', { scale: 'cgpa_4', min: 3, alternatives: [{ scale: 'gpa_10', min: 6 }] }) as Fact<unknown>).value).toBeNull();
    expect((bad('lor_count', 2.5) as Fact<number>).value).toBeNull();
    expect((bad('duration_months', -1) as Fact<number>).value).toBeNull();
    expect((bad('progression_guaranteed', 'yes') as Fact<boolean>).value).toBeNull();
    expect((bad('admissions_email', 'not-an-email') as Fact<string>).value).toBeNull();
    expect((bad('min_gpa_rule', { scale: 'gpa_10', min: 3 }) as Fact<unknown>).value).toBeNull();
    expect((bad('tuition', { amount: 100, currency: 'eur', period: 'year' }) as Fact<unknown>).value).toBeNull();
  });

  it('throws on rows that cannot be used at all (the loader skips them)', () => {
    expect(() => rowToProgram({ ...base, status: 'open' })).toThrow(RowShapeError);
    expect(() => rowToProgram({ ...base, pathway_type: 'shortcut' })).toThrow(RowShapeError);
    expect(() => rowToProgram({ ...base, id: '' })).toThrow(RowShapeError);
    expect(() => rowToProgram({ ...base, name: '  ' })).toThrow(RowShapeError);
    const inst = buildSeedRows(FULL).institutions[0];
    expect(() => rowToInstitution({ ...inst, kind: 'partner' })).toThrow(RowShapeError);
  });

  it('country facts: unknown key throws, midnight-UTC timestamps become plain dates', () => {
    const row = countryFactToRow(FULL_COUNTRY_FACTS[0]);
    expect(() => rowToCountryFact({ ...row, key: 'visa_chances' })).toThrow(RowShapeError);
    expect(rowToCountryFact({ ...row, fetched_at: '2026-11-20T00:00:00+00:00' }).fetched_at).toBe('2026-11-20');
    const issues: MapIssue[] = [];
    expect(rowToCountryFact({ ...row, value: { sort_months: 3 } }, issues).value).toBeNull(); // no text
    expect(issues).toHaveLength(1);
  });

  it('conversion rules: bad params, formula or scale throw (never guess a formula)', () => {
    const row = buildSeedRows(FULL).conversion_rules[0];
    expect(() => rowToConversionRule({ ...row, params: { nmax: 'four' } })).toThrow(RowShapeError);
    expect(() => rowToConversionRule({ ...row, params: { nmin: [1, 2, 3] } })).toThrow(RowShapeError);
    expect(() => rowToConversionRule({ ...row, formula: 'magic' })).toThrow(RowShapeError);
    expect(() => rowToConversionRule({ ...row, from_scale: 'gpa_10' })).toThrow(RowShapeError);
    const noParams = rowToConversionRule({ ...row, params: null });
    expect('params' in noParams).toBe(false);
  });

  it('fx rates: currency must be ISO-4217, the rate must be a positive number', () => {
    const row = buildSeedRows(FULL).fx_rates[0];
    expect(() => rowToFxRate({ ...row, currency: 'xts' })).toThrow(RowShapeError);
    const zero = rowToFxRate({ ...row, pkr_per_unit: { ...(row.pkr_per_unit as object), value: 0 } });
    expect(zero.pkr_per_unit.value).toBeNull();
  });
});

describe('deadlines and programme length match the seed schema (proposal #27)', () => {
  const base = buildSeedRows({ ...FULL, countryFacts: [], conversionRules: [], fxRates: [] }).programs[0];
  const sourced = (value: unknown) => ({
    value,
    source_url: 'https://fixture.example.edu/p',
    evidence_snippet: 'Fixture snippet text',
    fetched_at: '2026-11-20',
  });

  it.each([['15 January'], ['January 2027'], ['2027-02-30'], ['2027-13-01'], ['2027-1-15'], ['2027-01-15T00:00:00Z'], [' 2027-01-15']])(
    'deadline %j is Not verified yet, with one issue (never a day nobody stated)',
    (value) => {
      const issues: MapIssue[] = [];
      const p = rowToProgram({ ...base, deadline: sourced(value) }, issues);
      expect(p.deadline.value).toBeNull();
      expect(computeConfidence(p.deadline, FIXED_NOW)).toBe('Unverified');
      expect(issues.filter((i) => i.field === 'deadline')).toHaveLength(1);
    },
  );

  it('real calendar dates pass, including 29 February in a leap year', () => {
    expect(isIsoCalendarDate('2027-01-15')).toBe(true);
    expect(isIsoCalendarDate('2028-02-29')).toBe(true);
    expect(isIsoCalendarDate('2027-02-29')).toBe(false);
    expect(isIsoCalendarDate(20270115)).toBe(false);
    expect(rowToProgram({ ...base, deadline: sourced('2028-02-29') }).deadline.value).toBe('2028-02-29');
  });

  it.each([[0], [-1], [73], [12.5], ['12']])('duration_months %j is Not verified yet, with one issue (no free degree)', (value) => {
    const issues: MapIssue[] = [];
    const p = rowToProgram({ ...base, duration_months: sourced(value) }, issues);
    expect(p.duration_months.value).toBeNull();
    expect(issues.filter((i) => i.field === 'duration_months')).toHaveLength(1);
  });

  it('1 and 72 months are the bounds', () => {
    expect(rowToProgram({ ...base, duration_months: sourced(1) }).duration_months.value).toBe(1);
    expect(rowToProgram({ ...base, duration_months: sourced(72) }).duration_months.value).toBe(72);
  });

  it('a bad deadline inside conflicts is dropped too, so it cannot fake a Conflict', () => {
    const issues: MapIssue[] = [];
    const p = rowToProgram({ ...base, deadline: { ...sourced('2027-01-15'), conflicts: [sourced('15 January')] } }, issues);
    expect(p.deadline.value).toBe('2027-01-15');
    expect(p.deadline.conflicts?.[0].value).toBeNull();
    expect(computeConfidence(p.deadline, FIXED_NOW)).toBe('Verified');
  });
});

describe('normalizeTimestamp', () => {
  it.each([
    ['2026-11-23T00:00:00+00:00', '2026-11-23'],
    ['2026-11-23T00:00:00Z', '2026-11-23'],
    ['2026-11-23 00:00:00+00', '2026-11-23'],
    ['2026-11-23T00:00:00.000+00:00', '2026-11-23'],
    ['2026-11-23T12:00:00+00:00', '2026-11-23T12:00:00+00:00'],
    ['2026-11-23T00:00:00+05:00', '2026-11-23T00:00:00+05:00'],
    ['2026-11-23', '2026-11-23'],
  ])('%s -> %s', (input, out) => {
    expect(normalizeTimestamp(input)).toBe(out);
  });
  it('non-strings are null', () => {
    expect(normalizeTimestamp(null)).toBeNull();
    expect(normalizeTimestamp(123)).toBeNull();
  });
});

describe('factIsWellFormed mirrors the SQL CHECK fact_is_well_formed(jsonb)', () => {
  const ok = { value: 'x', source_url: 'https://fixture.example.edu', evidence_snippet: 'quote', fetched_at: '2026-11-20' };
  it('accepts empty and complete facts', () => {
    expect(factIsWellFormed(emptyFact())).toBe(true);
    expect(factIsWellFormed(ok)).toBe(true);
    expect(factIsWellFormed({ ...ok, basis: 'summary', note: null, conflicts: [ok] })).toBe(true);
    expect(factIsWellFormed({ ...ok, conflicts: null })).toBe(true);
  });
  it('a snippet requires a source URL', () => {
    expect(factIsWellFormed({ ...ok, source_url: null })).toBe(false);
    expect(factIsWellFormed({ ...ok, source_url: '  ' })).toBe(false);
    expect(factIsWellFormed({ ...ok, conflicts: [{ ...ok, source_url: null }] })).toBe(false);
  });
  it('rejects bad shapes', () => {
    expect(factIsWellFormed(null)).toBe(false);
    expect(factIsWellFormed([])).toBe(false);
    expect(factIsWellFormed({ source_url: null })).toBe(false); // no "value" key
    expect(factIsWellFormed({ ...ok, source_url: 'javascript:alert(1)' })).toBe(false);
    expect(factIsWellFormed({ ...ok, fetched_at: 'yesterday' })).toBe(false);
    expect(factIsWellFormed({ ...ok, basis: 'guess' })).toBe(false);
    expect(factIsWellFormed({ ...ok, note: 5 })).toBe(false);
    expect(factIsWellFormed({ ...ok, conflicts: 'x' })).toBe(false);
    expect(sourceIsWellFormed({ ...ok, evidence_snippet: 7 })).toBe(false);
  });
});

describe('validateSeedRows', () => {
  it('reports duplicate ids, bad ids, unknown institutions and snippets without a source', () => {
    const rows = buildSeedRows(FULL);
    const p = rows.programs[0];
    const problems = validateSeedRows({
      ...rows,
      programs: [
        p,
        p,
        { ...p, id: 'Bad Id' },
        { ...p, id: 'orphan', institution_id: 'nowhere' },
        { ...p, id: 'no-source', tuition: { value: 1, source_url: null, evidence_snippet: 'quote', fetched_at: null } },
      ],
      country_facts: [...rows.country_facts, { ...rows.country_facts[0], id: 'xx-dup' }],
      conversion_rules: [{ ...rows.conversion_rules[0], source_url: null }],
    });
    expect(problems.join('\n')).toMatch(/duplicate id/);
    expect(problems.join('\n')).toMatch(/lowercase letters/);
    expect(problems.join('\n')).toMatch(/unknown institution nowhere/);
    expect(problems.join('\n')).toMatch(/no-source\.tuition/);
    expect(problems.join('\n')).toMatch(/duplicate \(country, key\)/);
    expect(problems.join('\n')).toMatch(/conversion_rules\/fixture-rule: snippet without source URL/);
  });

  it('rejects values the mappers would drop (one contract for writing and reading)', () => {
    const rows = buildSeedRows(FULL);
    const p = rows.programs[0];
    const src = { source_url: 'https://fixture.example.edu/p', evidence_snippet: 'Fixture snippet text', fetched_at: '2026-11-20' };
    const problems = validateSeedRows({
      ...rows,
      programs: [
        { ...p, id: 'bad-deadline', deadline: { value: '15 January', ...src } },
        { ...p, id: 'zero-months', duration_months: { value: 0, ...src } },
        { ...p, id: 'bad-conflict', deadline: { value: '2027-01-15', ...src, conflicts: [{ value: 'January 2027', ...src }] } },
      ],
    }).join('\n');
    expect(problems).toMatch(/programs\/bad-deadline\.deadline: value has the wrong shape/);
    expect(problems).toMatch(/programs\/zero-months\.duration_months: value has the wrong shape/);
    expect(problems).toMatch(/programs\/bad-conflict\.deadline\.conflicts\[0\]: value has the wrong shape/);
    expect(validateSeedRows(rows)).toEqual([]);
  });
});

describe('row builders', () => {
  it('fills the confidence CACHE column only when asked, using computeConfidence', () => {
    for (const f of FULL_COUNTRY_FACTS) {
      expect(countryFactToRow(f, FIXED_NOW).confidence).toBe(computeConfidence(f, FIXED_NOW));
      expect('confidence' in countryFactToRow(f)).toBe(false);
    }
  });

  it('rowToCountryFact never reads the confidence cache', () => {
    const row = { ...countryFactToRow(FULL_COUNTRY_FACTS[2]), confidence: 'Verified' as const };
    const fact = rowToCountryFact(row);
    expect('confidence' in fact).toBe(false);
    expect(computeConfidence(fact, FIXED_NOW)).toBe('Unverified');
  });

  it('lists every Fact field of Program and Institution', () => {
    const isFact = (v: unknown) => typeof v === 'object' && v !== null && 'value' in v && 'source_url' in v;
    const programFacts = Object.entries(makeProgram()).filter(([, v]) => isFact(v)).map(([k]) => k);
    const institutionFacts = Object.entries(makeInstitution()).filter(([, v]) => isFact(v)).map(([k]) => k);
    expect([...PROGRAM_FACT_FIELDS].sort()).toEqual(programFacts.sort());
    expect([...INSTITUTION_FACT_FIELDS].sort()).toEqual(institutionFacts.sort());
    for (const k of PROGRAM_FACT_FIELDS) expect(PROGRAM_COLUMNS).toContain(k);
  });

  it('the data source exports the mappers named in the contract', () => {
    expect(source.rowToProgram).toBe(rowToProgram);
    expect(source.rowToInstitution).toBe(rowToInstitution);
    expect(source.rowToCountryFact).toBe(rowToCountryFact);
    expect(source.rowToConversionRule).toBe(rowToConversionRule);
    expect(source.rowToFxRate).toBe(rowToFxRate);
    expect(source.supabaseSource.name).toBe('supabase');
  });
});
