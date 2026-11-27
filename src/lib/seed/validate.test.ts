import { describe, expect, it } from 'vitest';
import programsSeed from '@data/programs.seed.json';
import countryFactsSeed from '@data/country_facts.seed.json';
import conversionRulesSeed from '@data/conversion_rules.seed.json';
import fxRatesSeed from '@data/fx_rates.seed.json';
import { emptyFact } from '../confidence';
import { FIXED_NOW, conflicting, daysAgo, likely, makeInstitution, makeProgram, unverified, verified } from '../test-fixtures';
import { formatReport, validateSeed, type SeedFiles, type ValidationReport } from './validate';

const ALLOW = ['fixture.example.edu'];

/* Fictional "Fixture University" data only. */
function fullProgram(overrides: Record<string, unknown> = {}) {
  return {
    ...makeProgram({
      intake: verified('Fixture winter intake'),
      deadline: verified('2027-01-15'),
      min_gpa_rule: verified({ scale: 'cgpa_4' as const, min: 3, text: 'Fixture minimum text' }),
      language_req: verified({ ielts_overall: 6.5 }),
      tuition: verified({ amount: 1000, currency: 'GBP', period: 'year' as const }),
      living_cost: likely({ amount: 500, currency: 'GBP', period: 'month' as const }),
      duration_months: verified(12),
      lor_count: verified(2),
      progression_guaranteed: verified(false),
      admissions_email: verified('admissions@fixture.example.edu'),
      last_checked: '2026-11-20',
    }),
    ...overrides,
  };
}

function countryFact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fixture-de-citizenship-rule',
    country: 'DE',
    key: 'citizenship_rule',
    ...verified({ text: 'Fixture rule text for tests', sort_months: 60 }),
    ...overrides,
  };
}

function fxRate(overrides: Record<string, unknown> = {}) {
  return { id: 'fixture-eur-pkr', currency: 'EUR', pkr_per_unit: verified(100), ...overrides };
}

interface Parts {
  institutions?: unknown[];
  programs?: unknown[];
  country_facts?: unknown[];
  conversion_rules?: unknown[];
  fx_rates?: unknown[];
}

function files(parts: Parts = {}): SeedFiles {
  return {
    programs: {
      $schema: './schemas/programs.schema.json',
      version: 1,
      institutions: parts.institutions ?? [makeInstitution()],
      programs: parts.programs ?? [fullProgram()],
    },
    countryFacts: { version: 1, country_facts: parts.country_facts ?? [countryFact()] },
    conversionRules: {
      version: 1,
      conversion_rules: parts.conversion_rules ?? [
        {
          id: 'fixture-rule',
          scope: 'PK->*',
          from_scale: 'cgpa_4',
          to_scale: 'german',
          formula: 'modified_bavarian',
          params: { nmax: 4, nmin: [1, 2] },
          source_url: null,
          evidence_snippet: null,
          fetched_at: null,
        },
      ],
    },
    fxRates: { version: 1, fx_rates: parts.fx_rates ?? [fxRate()] },
  };
}

function run(parts: Parts = {}): ValidationReport {
  return validateSeed(files(parts), FIXED_NOW, { allowlist: ALLOW });
}

const errors = (r: ValidationReport) => r.issues.filter((i) => i.severity === 'error');
const warnings = (r: ValidationReport) => r.issues.filter((i) => i.severity === 'warning');
const hasError = (r: ValidationReport, path: string, re: RegExp) =>
  errors(r).some((i) => i.path === path && re.test(i.message));

describe('validateSeed — current seed files', () => {
  it('pass with no errors today', () => {
    const report = validateSeed(
      {
        programs: programsSeed,
        countryFacts: countryFactsSeed,
        conversionRules: conversionRulesSeed,
        fxRates: fxRatesSeed,
      },
      new Date(),
    );
    expect(errors(report)).toEqual([]);
    expect(report.coverage.programs.total).toBeGreaterThan(0);
  });
});

describe('validateSeed — full fixture data', () => {
  it('has no errors or warnings and counts coverage', () => {
    const r = run();
    expect(r.issues).toEqual([]);
    expect(r.coverage.programs).toMatchObject({ total: 1, active: 1, ruledOut: 0, fullyVerified: 1 });
    expect(r.coverage.programFacts.Verified).toBe(9);
    expect(r.coverage.programFacts.Likely).toBe(1);
    // 20 program facts: 9 Verified + 1 Likely above; the other 10 are empty (status_note, scholarship_info,
    // sop_requirements, cv_requirements, tests_required, research_considered, progression_requirement,
    // eligibility_note, conditional_admission, language_waiver).
    expect(r.coverage.programFacts.Unverified).toBe(10);
    expect(r.coverage.programFacts.Verified + r.coverage.programFacts.Likely + r.coverage.programFacts.Unverified).toBe(20);
    expect(r.coverage.institutionFacts.Unverified).toBe(4);
    expect(r.coverage.countryFacts.Verified).toBe(1);
    expect(r.coverage.fxRates.Verified).toBe(1);
    expect(r.coverage.conversionRules).toEqual({ total: 1, withSource: 0 });
  });

  it('counts conflicts and does not call a program with a conflicting core field fully verified', () => {
    const r = run({ programs: [fullProgram({ deadline: conflicting('2027-01-15', '2027-02-01') })] });
    expect(errors(r)).toEqual([]);
    expect(r.coverage.programFacts.Conflict).toBe(1);
    expect(r.coverage.programs.fullyVerified).toBe(0);
  });

  it('ruled-out programs are not counted as active', () => {
    const r = run({ programs: [fullProgram({ status: 'ruled_out' })] });
    expect(r.coverage.programs).toMatchObject({ active: 0, ruledOut: 1, fullyVerified: 0 });
  });
});

describe('schema validation', () => {
  it('rejects unknown keys, wrong types and impossible dates', () => {
    const r = run({
      programs: [fullProgram({ ranking_score: 5, lor_count: verified('two'), deadline: verified('2027-02-30') })],
    });
    expect(errors(r).some((i) => /unknown key "ranking_score"/.test(i.message))).toBe(true);
    expect(errors(r).some((i) => i.path === '/programs/0/lor_count/value')).toBe(true);
    expect(errors(r).some((i) => i.path === '/programs/0/deadline/value')).toBe(true);
  });

  it('rejects a GPA minimum outside its scale and an unknown currency format', () => {
    const r = run({
      programs: [
        fullProgram({
          min_gpa_rule: verified({ scale: 'cgpa_4', min: 7 }),
          tuition: verified({ amount: 1000, currency: 'pounds', period: 'year' }),
        }),
      ],
    });
    expect(errors(r).some((i) => i.path.startsWith('/programs/0/min_gpa_rule/value'))).toBe(true);
    expect(errors(r).some((i) => i.path.startsWith('/programs/0/tuition/value'))).toBe(true);
  });

  it('allows the "$schema" key', () => {
    expect(errors(run())).toEqual([]);
  });
});

describe('evidence rules', () => {
  it('a hand-written "confidence": "Verified" without a snippet is an error', () => {
    const fact = { ...unverified('Fixture text value'), source_url: 'https://fixture.example.edu/p', confidence: 'Verified' };
    const r = run({ programs: [fullProgram({ intake: fact })] });
    expect(hasError(r, '/programs/0/intake/confidence', /needs both source_url and evidence_snippet/)).toBe(true);
  });

  it('a hand-written "confidence": "Verified" without a source_url is an error', () => {
    const fact = { ...verified('Fixture text value'), source_url: null, confidence: 'Verified' };
    const r = run({ programs: [fullProgram({ intake: fact })] });
    expect(hasError(r, '/programs/0/intake/confidence', /needs both/)).toBe(true);
  });

  it('other hand-written confidence keys are only a warning', () => {
    const r = run({ programs: [fullProgram({ intake: { ...verified('Fixture text value'), confidence: 'Likely' } })] });
    expect(errors(r)).toEqual([]);
    expect(warnings(r).some((i) => /computed in code/.test(i.message))).toBe(true);
  });

  it('evidence_snippet without source_url is an error', () => {
    const r = run({ programs: [fullProgram({ intake: { ...verified('Fixture text value'), source_url: null } })] });
    expect(hasError(r, '/programs/0/intake', /evidence_snippet has no source_url/)).toBe(true);
  });

  it('a value with default/verbatim basis but no snippet is a warning, not an error', () => {
    const fact = { value: 'Fixture text value', source_url: 'https://fixture.example.edu/p', evidence_snippet: null, fetched_at: daysAgo(1) };
    const r = run({ programs: [fullProgram({ scholarship_info: fact })] });
    expect(errors(r)).toEqual([]);
    const w = warnings(r).find((i) => i.path === '/programs/0/scholarship_info');
    expect(w?.message).toMatch(/^Unverified value present/);
    const explicit = run({ programs: [fullProgram({ scholarship_info: { ...fact, basis: 'verbatim' } })] });
    expect(warnings(explicit).some((i) => /^Unverified value present/.test(i.message))).toBe(true);
  });

  it('a summary without a source_url is an "Unverified value present" warning', () => {
    const r = run({ country_facts: [countryFact({ evidence_snippet: null, source_url: null, basis: 'inferred' })] });
    expect(errors(r)).toEqual([]);
    expect(warnings(r).some((i) => /Unverified value present: basis "inferred"/.test(i.message))).toBe(true);
  });

  it('checks every source inside "conflicts"', () => {
    const fact = conflicting('2027-01-15', '2027-02-01');
    fact.conflicts![0] = { ...fact.conflicts![0], source_url: 'http://fixture.example.edu/b' };
    const r = run({ programs: [fullProgram({ deadline: fact })] });
    expect(hasError(r, '/programs/0/deadline/conflicts/0/source_url', /must use https/)).toBe(true);
  });

  it('warns about evidence without a value', () => {
    const r = run({ programs: [fullProgram({ intake: { ...verified('x'), value: null } })] });
    expect(warnings(r).some((i) => /evidence_snippet without a value/.test(i.message))).toBe(true);
  });

  it('warns when a source host is not on the allowlist', () => {
    const r = run({ programs: [fullProgram({ intake: verified('Fixture text value', 1, 'https://blog.example.com/post') })] });
    expect(errors(r)).toEqual([]);
    expect(warnings(r).some((i) => /not on data\/ingest\.allowlist\.json/.test(i.message))).toBe(true);
  });

  it('warns about a usable deadline that has passed', () => {
    const r = run({ programs: [fullProgram({ deadline: verified('2026-01-15') })] });
    expect(warnings(r).some((i) => /has passed/.test(i.message))).toBe(true);
  });
});

describe('numbers in structured values must come from the same snippet', () => {
  const brookesLike = (snippet: string, alternatives: unknown) => ({
    ...verified({ scale: 'cgpa_4', min: 2.7, text: 'Fixture: 60% or GPA 2.7', alternatives }),
    evidence_snippet: snippet,
  });

  it('a GpaRule alternative printed in the snippet passes', () => {
    const r = run({ programs: [fullProgram({ min_gpa_rule: brookesLike('Fixture entry: 2:2 60% or GPA 2.7', [{ scale: 'percent', min: 60 }]) })] });
    expect(errors(r)).toEqual([]);
  });

  it('a GpaRule alternative missing from the snippet is an ERROR', () => {
    const r = run({ programs: [fullProgram({ min_gpa_rule: brookesLike('Fixture entry: 2:2 or GPA 2.7', [{ scale: 'percent', min: 60 }]) })] });
    expect(hasError(r, '/programs/0/min_gpa_rule/value/alternatives/0/min', /alternative minimum 60 \(percent\) is not written/)).toBe(true);
    // 6 does not count as 60, and 60 does not count as 600
    const near = run({ programs: [fullProgram({ min_gpa_rule: brookesLike('Fixture entry: 600 or 6 or GPA 2.7', [{ scale: 'percent', min: 60 }]) })] });
    expect(errors(near).some((i) => /alternative minimum 60/.test(i.message))).toBe(true);
  });

  it('alternatives inside conflicts are checked against their own snippet', () => {
    const fact = {
      ...brookesLike('Fixture entry: 60% or GPA 2.7', [{ scale: 'percent', min: 60 }]),
      conflicts: [{ ...brookesLike('Fixture other page: GPA 2.7 only', [{ scale: 'percent', min: 60 }]), source_url: 'https://fixture.example.edu/b' }],
    };
    const r = run({ programs: [fullProgram({ min_gpa_rule: fact })] });
    expect(hasError(r, '/programs/0/min_gpa_rule/conflicts/0/value/alternatives/0/min', /not written/)).toBe(true);
    expect(errors(r).filter((i) => /alternative minimum/.test(i.message))).toHaveLength(1);
  });

  it('a conditional_admission minimum missing from its snippet is a warning; "4.0" counts as 4; null has no check', () => {
    const route = (min: number | null, snippet: string) => ({
      ...verified({ scale: 'german', min, text: 'Fixture aptitude test route' }),
      evidence_snippet: snippet,
    });
    const missing = run({ programs: [fullProgram({ conditional_admission: route(2.5, 'Fixture: applicants may take an aptitude test') })] });
    expect(errors(missing)).toEqual([]);
    expect(warnings(missing).some((i) => i.path === '/programs/0/conditional_admission/value/min' && /2.5 is not written/.test(i.message))).toBe(true);
    const asDecimal = run({ programs: [fullProgram({ conditional_admission: route(4, 'Fixture: grade 2.6 - 3.0 needs 4.0 in the test') })] });
    expect(warnings(asDecimal).some((i) => /conditional admission minimum/.test(i.message))).toBe(false);
    const noFloor = run({ programs: [fullProgram({ conditional_admission: route(null, 'Fixture: no lower floor is stated') })] });
    expect(warnings(noFloor).some((i) => /conditional admission minimum/.test(i.message))).toBe(false);
  });

  it('live seed: Brookes "60% or GPA 2.7" and every conditional route pass these checks', () => {
    const report = validateSeed(
      { programs: programsSeed, countryFacts: countryFactsSeed, conversionRules: conversionRulesSeed, fxRates: fxRatesSeed },
      FIXED_NOW,
    );
    expect(report.issues.filter((i) => /alternative minimum|conditional admission minimum/.test(i.message))).toEqual([]);
  });
});

describe('a conflict without a source (proposal #28)', () => {
  it('is a warning and does not make the fact a Conflict in coverage', () => {
    const fact = { ...verified('Fixture winter intake'), conflicts: [{ value: 'Fixture summer intake', source_url: null, evidence_snippet: null, fetched_at: null }] };
    const r = run({ programs: [fullProgram({ intake: fact })] });
    expect(errors(r)).toEqual([]);
    expect(warnings(r).some((i) => i.path === '/programs/0/intake/conflicts/0' && /conflict without a source_url is ignored/.test(i.message))).toBe(true);
    expect(r.coverage.programFacts.Conflict).toBe(0);
    expect(r.coverage.programs.fullyVerified).toBe(1);
  });

  it('a sourced conflict is still a Conflict, with no "ignored" warning', () => {
    const r = run({ programs: [fullProgram({ intake: conflicting('Fixture winter intake', 'Fixture summer intake') })] });
    expect(r.coverage.programFacts.Conflict).toBe(1);
    expect(warnings(r).some((i) => /conflict without a source_url/.test(i.message))).toBe(false);
  });
});

describe('URL rules', () => {
  it('source_url, official_url and website must be https', () => {
    const r = run({
      institutions: [makeInstitution({ website: 'http://fixture.example.edu' })],
      programs: [
        fullProgram({ official_url: 'ftp://fixture.example.edu/p', intake: verified('Fixture text value', 1, 'http://fixture.example.edu/p') }),
      ],
    });
    expect(hasError(r, '/institutions/0/website', /must use https/)).toBe(true);
    expect(hasError(r, '/programs/0/official_url', /must use https/)).toBe(true);
    expect(hasError(r, '/programs/0/intake/source_url', /must use https/)).toBe(true);
  });

  it('rejects credentials and invalid URLs, and does not duplicate the schema error', () => {
    const r = run({
      programs: [fullProgram({ official_url: 'https://user:pw@fixture.example.edu/p', intake: verified('Fixture text value', 1, 'not a url') })],
    });
    expect(hasError(r, '/programs/0/official_url', /username or password/)).toBe(true);
    expect(hasError(r, '/programs/0/intake/source_url', /not a valid URL/)).toBe(true);
    expect(errors(r).filter((i) => i.path === '/programs/0/intake/source_url')).toHaveLength(1);
  });
});

describe('date rules', () => {
  it('fetched_at must be a valid date and not in the future', () => {
    const future = { ...verified('Fixture text value'), fetched_at: '2027-06-01' };
    const invalid = { ...verified('Fixture text value'), fetched_at: '2026-13-01' };
    const r = run({ programs: [fullProgram({ intake: future, cv_requirements: invalid, last_checked: '2030-01-01' })] });
    expect(hasError(r, '/programs/0/intake/fetched_at', /in the future/)).toBe(true);
    expect(hasError(r, '/programs/0/cv_requirements/fetched_at', /not a valid date/)).toBe(true);
    expect(hasError(r, '/programs/0/last_checked', /in the future/)).toBe(true);
  });

  it('tolerates "today" written in a time zone ahead of UTC', () => {
    const r = run({ programs: [fullProgram({ intake: { ...verified('Fixture text value'), fetched_at: '2026-11-25' } })] });
    expect(errors(r)).toEqual([]);
  });
});

describe('snippet and text rules', () => {
  it('snippets must be 12-600 characters', () => {
    const short = { ...verified('Fixture text value'), evidence_snippet: 'too short' };
    const long = { ...verified('Fixture text value'), evidence_snippet: 'x'.repeat(601) };
    const r = run({ programs: [fullProgram({ intake: short, cv_requirements: long })] });
    expect(hasError(r, '/programs/0/intake/evidence_snippet', /too short/)).toBe(true);
    expect(hasError(r, '/programs/0/cv_requirements/evidence_snippet', /too long/)).toBe(true);
  });

  it('rejects HTML tags in snippets and string values, but allows "<" in plain text', () => {
    const html = { ...verified('Fixture text value'), evidence_snippet: 'Apply by <b>15 January</b> via the portal' };
    const r = run({
      institutions: [makeInstitution({ name: 'Fixture <script>alert(1)</script> University' })],
      programs: [fullProgram({ intake: html, sop_requirements: verified('Score < 3 is fine in plain text') })],
    });
    expect(hasError(r, '/programs/0/intake/evidence_snippet', /HTML tag/)).toBe(true);
    expect(hasError(r, '/institutions/0/name', /HTML tag/)).toBe(true);
    expect(errors(r).some((i) => i.path.startsWith('/programs/0/sop_requirements'))).toBe(false);
  });

  it('forbids admission-probability wording in keys and text', () => {
    const r = run({
      programs: [
        fullProgram({
          admission_probability: 0.4,
          scholarship_info: verified('You have a 70% chance of a scholarship'),
          sop_requirements: verified('Your chance of admission is high'),
          cv_requirements: verified('Admission chance: good'),
          tests_required: verified('Probability of success depends'),
        }),
      ],
    });
    const forbidden = errors(r).filter((i) => /admission probability/.test(i.message));
    // The fixture snippets quote the value, so they are flagged as well.
    expect(forbidden.map((i) => i.path)).toEqual(
      expect.arrayContaining([
        '/programs/0/admission_probability',
        '/programs/0/cv_requirements/value',
        '/programs/0/scholarship_info/value',
        '/programs/0/sop_requirements/value',
        '/programs/0/tests_required/value',
        '/programs/0/tests_required/evidence_snippet',
      ]),
    );
    expect(forbidden.every((i) => !i.path.includes('intake'))).toBe(true);
  });
});

describe('id and reference rules', () => {
  it('ids must be unique', () => {
    const r = run({
      institutions: [makeInstitution(), makeInstitution()],
      programs: [fullProgram(), fullProgram()],
      fx_rates: [fxRate(), fxRate({ id: 'fixture-eur-pkr-2' })],
    });
    expect(hasError(r, '/institutions/1/id', /duplicate id "fixture-uni"/)).toBe(true);
    expect(hasError(r, '/programs/1/id', /duplicate id "fixture-msc-cs"/)).toBe(true);
    expect(hasError(r, '/fx_rates/1/currency', /duplicate currency "EUR"/)).toBe(true);
  });

  it('program.institution_id must exist', () => {
    const r = run({ programs: [fullProgram({ institution_id: 'no-such-uni' })] });
    expect(hasError(r, '/programs/0/institution_id', /does not match any institution/)).toBe(true);
  });

  it('warns when a program country differs from its institution', () => {
    const r = run({ programs: [fullProgram({ country: 'DE' })] });
    expect(warnings(r).some((i) => i.path === '/programs/0/country')).toBe(true);
  });

  it('country facts must have unique (country, key) and allowed keys', () => {
    const r = run({
      country_facts: [countryFact(), countryFact({ id: 'fixture-de-2' }), countryFact({ id: 'fixture-de-3', key: 'fastest_citizenship' })],
    });
    expect(hasError(r, '/country_facts/1', /duplicate country fact DE "citizenship_rule"/)).toBe(true);
    expect(hasError(r, '/country_facts/2/key', /unknown country fact key "fastest_citizenship"/)).toBe(true);
  });

  it('conversion rule ranges must be [low, high]', () => {
    const r = run({
      conversion_rules: [
        {
          id: 'fixture-rule',
          scope: 'PK->*',
          from_scale: 'cgpa_4',
          to_scale: 'german',
          formula: 'modified_bavarian',
          params: { nmax: 4, nmin: [2, 1] },
          source_url: null,
        },
      ],
    });
    expect(hasError(r, '/conversion_rules/0/params/nmin', /\[low, high\]/)).toBe(true);
  });

  it('survives malformed files without throwing', () => {
    const r = validateSeed({ programs: null, countryFacts: [], conversionRules: 'x', fxRates: { fx_rates: 'no' } }, FIXED_NOW);
    expect(r.errors).toBeGreaterThan(0);
  });
});

describe('formatReport', () => {
  it('lists errors, groups warnings and prints coverage', () => {
    const noSnippet = { value: 'Fixture text value', source_url: null, evidence_snippet: null, fetched_at: null };
    const r = run({
      programs: [
        fullProgram({ official_url: 'http://fixture.example.edu', scholarship_info: noSnippet, cv_requirements: noSnippet, tests_required: emptyFact() }),
      ],
    });
    const text = formatReport(r, { maxWarningExamples: 1 });
    expect(text).toMatch(/ERRORS \(1\)/);
    expect(text).toMatch(/Unverified value present: no evidence_snippet.*\(2\)/);
    expect(text).toMatch(/… and 1 more/);
    expect(text).toMatch(/Fully verified: 1\/1/);
    expect(text).toMatch(/Seed validation FAILED/);
    expect(formatReport(run())).toMatch(/Seed validation passed/);
  });
});

describe('duplicate programmes', () => {
  it('rejects the same institution + normalised name under two ids', () => {
    const a = fullProgram({ id: 'fixture-a', name: 'MSc Data Science', official_url: 'https://fixture.example.edu/a' });
    const b = fullProgram({ id: 'fixture-b', name: 'Master of Science in Data Science', official_url: 'https://fixture.example.edu/b' });
    const r = run({ programs: [a, b] });
    expect(hasError(r, '/programs/1/name', /same programme as \/programs\/0/)).toBe(true);
  });

  it('rejects two programmes with the same canonical official_url (www, trailing slash and tracking ignored)', () => {
    const a = fullProgram({ id: 'fixture-a', name: 'MSc Alpha', official_url: 'https://www.fixture.example.edu/p/' });
    const b = fullProgram({ id: 'fixture-b', name: 'MSc Beta', official_url: 'https://fixture.example.edu/p?utm_source=x' });
    const r = run({ programs: [a, b] });
    expect(hasError(r, '/programs/1/official_url', /same canonical official_url/)).toBe(true);
  });

  it('allows different programmes at one institution and the same name at different institutions', () => {
    const a = fullProgram({ id: 'fixture-a', name: 'MSc Alpha', official_url: 'https://fixture.example.edu/a' });
    const b = fullProgram({ id: 'fixture-b', name: 'MSc Beta', official_url: 'https://fixture.example.edu/b' });
    expect(errors(run({ programs: [a, b] })).filter((i) => /same programme|canonical/.test(i.message))).toEqual([]);
  });
});
