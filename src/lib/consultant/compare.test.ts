import { describe, expect, it } from 'vitest';
import {
  FIXED_NOW,
  conflicting,
  daysAgo,
  likely,
  makeInstitution,
  makeProgram,
  unverified,
  verified,
  loadEmptySeedDataset,
} from '../test-fixtures';
import type { CountryFact, CountryFactKey, CountryFactValue, Fact, FxRate, Institution, Program } from '../types';
import { loadSeedDataset } from '../data/seed-source';
import {
  CANT_VERIFY_TEXT,
  NO_GUARANTEE_TEXT,
  NOT_ADVICE_TEXT,
  SUMMARY_VERDICT_LABEL,
  VERDICT_LABEL,
  collectQuestions,
  compareClaim,
  durationsIn,
  formatAmount,
  questionsFor,
  runCheck,
  statusLooks,
  summarize,
  verdictLabel,
  type CheckData,
  type CheckResult,
} from './compare';
import { EXAMPLE_CLAIMS } from './examples';
import { extractClaims } from './extract';
import { buildQuestionsText, buildShareText } from './share';

const NOW = FIXED_NOW;

function countryFact(country: string, key: CountryFactKey, fact: Fact<CountryFactValue>): CountryFact {
  return { id: `fixture-${country}-${key}`, country, key, ...fact };
}

function fxRow(currency: string, fact: Fact<number>): FxRate {
  return { id: `fixture-${currency}`, currency, pkr_per_unit: fact };
}

function data(p: Partial<Program> = {}, i: Partial<Institution> = {}, extra: Partial<CheckData> = {}): CheckData {
  return {
    programs: [makeProgram(p)],
    institutions: [makeInstitution(i)],
    countryFacts: [],
    conversionRules: [],
    fxRates: [],
    ...extra,
  };
}

/** Runs the check and returns the single result of the given claim type. */
function check(text: string, d: CheckData, type?: CheckResult['type']): CheckResult {
  const run = runCheck(text, d, NOW);
  const r = type ? run.results.find((x) => x.type === type) : run.results[0];
  if (!r) throw new Error(`No ${type ?? ''} result for: ${text} (got ${run.results.map((x) => x.type).join(', ')})`);
  return r;
}

const ACCUSING = /\b(lie|lies|lied|lying|liar|fraud\w*|scam\w*|cheat\w*|fake|dishonest\w*|mislead\w*|con artist|crook|trick\w*)\b/i;

function allText(r: CheckResult): string {
  return [r.claim, r.typeLabel, r.explanation, r.reading ?? '', ...r.questionsToAsk, ...r.sources.map((s) => `${s.label} ${s.value} ${s.note ?? ''}`)].join('\n');
}

const GBP_YEAR = (amount: number) => ({ amount, currency: 'GBP', period: 'year' as const });

describe('English test claims', () => {
  const claim = 'Fixture University: no IELTS needed';

  it('conflict when a usable row asks for an IELTS score', () => {
    const r = check(claim, data({ language_req: verified({ ielts_overall: 6.5 }) }));
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toMatch(/differs from the official page/i);
    expect(r.explanation).toContain('IELTS 6.5');
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]).toMatchObject({ confidence: 'Verified', source_url: 'https://fixture.example.edu/program' });
    expect(r.sources[0].value).toContain('IELTS 6.5');
    expect(r.questionsToAsk).toContain('Which official page says IELTS is not required for Pakistani applicants?');
  });

  it('a Likely row is also usable', () => {
    const r = check(claim, data({ language_req: likely({ toefl_ibt: 90 }) }));
    expect(r.verdict).toBe('conflict');
    expect(r.sources[0].confidence).toBe('Likely');
  });

  it('matches when the official page mentions a waiver', () => {
    const r = check(claim, data({ language_req: verified({ ielts_overall: 6.5, waiver: 'Fixture waiver for English-medium degrees' }) }));
    expect(r.verdict).toBe('matches');
    expect(r.explanation).toContain('Fixture waiver for English-medium degrees');
  });

  it("can't verify when the row is Unverified (never used)", () => {
    const r = check(claim, data({ language_req: unverified({ ielts_overall: 6.5 }) }));
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain(CANT_VERIFY_TEXT);
    expect(r.sources).toEqual([]);
    // Falls back to the official page link from the data row.
    expect(r.officialLinks[0]?.url).toBe('https://fixture.example.edu/program');
  });

  it("can't verify when sources conflict, and shows both", () => {
    const r = check(claim, data({ language_req: conflicting({ ielts_overall: 6 }, { ielts_overall: 7 }) }));
    expect(r.verdict).toBe('cant_verify');
    expect(r.sources.map((s) => s.confidence)).toEqual(['Conflict', 'Conflict']);
    expect(r.sources.map((s) => s.source_url)).toEqual(['https://fixture.example.edu/page-a', 'https://fixture.example.edu/page-b']);
  });

  it("can't verify without a university", () => {
    const r = check('No IELTS needed', data({ language_req: verified({ ielts_overall: 6.5 }) }));
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toMatch(/which university/i);
  });
});

describe('cost claims', () => {
  const full = {
    tuition: verified(GBP_YEAR(10_000)),
    living_cost: verified(GBP_YEAR(8_000)),
    duration_months: verified(12),
  };
  const withFx = (p: Partial<Program> = full) => data(p, {}, { fxRates: [fxRow('GBP', verified(300, 1, 'https://fixture.example.edu/fx'))] });

  it('conflict: claimed total far below the usable total cost', () => {
    const r = check('Fixture University total cost 25 lakh', withFx(), 'total_cost');
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('less than');
    expect(r.explanation).toContain('PKR 5,400,000');
    expect(r.reading).toBe('We read this as PKR 2,500,000 (25 lakh) for the whole programme.');
    expect(r.sources.map((s) => s.label)).toEqual([
      'Fixture University — MSc Fixture Computing: tuition',
      'Fixture University — MSc Fixture Computing: living costs',
      'Fixture University — MSc Fixture Computing: programme length',
      'Exchange rate GBP to PKR',
    ]);
  });

  it('matches when the claim is close to the usable total', () => {
    expect(check('Fixture University total cost 55 lakh', withFx(), 'total_cost').verdict).toBe('matches');
    expect(check('Fixture University total cost £18,000 all inclusive', data(full), 'total_cost').verdict).toBe('matches');
  });

  it('a claim well above the usable total also differs (asks what the extra pays for)', () => {
    const r = check('Fixture University total cost 1.2 crore', withFx(), 'total_cost');
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('Ask what the extra amount pays for');
  });

  it("can't verify without a usable exchange rate", () => {
    const r = check('Fixture University total cost 25 lakh', data(full), 'total_cost');
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain('no verified exchange rate');
    const unv = check('Fixture University total cost 25 lakh', data(full, {}, { fxRates: [fxRow('GBP', unverified(300))] }), 'total_cost');
    expect(unv.verdict).toBe('cant_verify');
  });

  it("can't verify when living costs are missing", () => {
    const r = check('Fixture University total cost 25 lakh', withFx({ ...full, living_cost: unverified() }), 'total_cost');
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain('Living cost not verified yet');
  });

  it('tuition per year: matches / differs', () => {
    expect(check('Fixture University tuition is £10,000 per year', data(full), 'tuition').verdict).toBe('matches');
    const r = check('Fixture University tuition is £4,000 per year', data(full), 'tuition');
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('£10,000 per year');
  });

  it('"tuition is free" differs from a usable fee and matches a zero fee', () => {
    expect(check('Tuition is free at Fixture University', data(full), 'tuition').verdict).toBe('conflict');
    expect(
      check('Tuition is free at Fixture University', data({ tuition: verified({ amount: 0, currency: 'EUR', period: 'semester' }) }), 'tuition')
        .verdict,
    ).toBe('matches');
  });
});

describe('CGPA claims', () => {
  const min = { min_gpa_rule: verified({ scale: 'cgpa_4' as const, min: 3, text: 'Fixture minimum CGPA 3.0 out of 4.0' }) };

  it('below the usable minimum differs', () => {
    const r = check('Fixture University accepts 2.5 CGPA', data(min));
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('Fixture minimum CGPA 3.0 out of 4.0');
  });

  it('meeting the minimum matches, without promising admission', () => {
    const r = check('Fixture University accepts 3.2 CGPA', data(min));
    expect(r.verdict).toBe('matches');
    expect(r.explanation).toContain('does not mean you will be admitted');
    expect(r.explanation).not.toMatch(/\d+\s?%/);
  });

  it("can't verify without a usable minimum", () => {
    expect(check('Fixture University accepts 2.5 CGPA', data()).verdict).toBe('cant_verify');
    expect(check('Fixture University accepts 2.5 CGPA', data({ min_gpa_rule: unverified({ scale: 'cgpa_4', min: 3 }) })).verdict).toBe('cant_verify');
  });

  it('a different grade scale with no sourced conversion is not decided', () => {
    const r = check('Fixture University accepts 2.5 CGPA', data({ min_gpa_rule: verified({ scale: 'german', min: 2.5 }) }));
    expect(r.verdict).toBe('cant_verify');
  });
});

describe('deadline claims', () => {
  const d = data({ deadline: verified('2027-03-15') });

  it('matches the usable deadline', () => {
    expect(check('Fixture University deadline is 15 March 2027', d).verdict).toBe('matches');
    expect(check('Fixture University deadline is 15 March', d).verdict).toBe('matches');
  });

  it('differs from the usable deadline', () => {
    const r = check('Fixture University deadline is 30 April 2027', d);
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('15 Mar 2027');
  });

  it('pressure to pay now is never confirmed', () => {
    const r = check('Fixture University: only 2 seats left, pay today', d, 'deadline');
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain('No official page we hold says how many seats are left');
  });

  it("can't verify without data", () => {
    expect(check('Fixture University deadline is 15 March 2027', data()).verdict).toBe('cant_verify');
  });
});

describe('promises: admission, visa, scholarship', () => {
  const everything: Partial<Program> = {
    language_req: verified({ ielts_overall: 6.5 }),
    min_gpa_rule: verified({ scale: 'cgpa_4', min: 2 }),
    tuition: verified(GBP_YEAR(10_000)),
    deadline: verified('2027-03-15'),
    scholarship_info: verified('Fixture scholarships are competitive and limited.'),
  };

  it('guaranteed admission is never "matches" without an explicit row', () => {
    for (const text of ['Guaranteed admission at Fixture University', '100% admission at Fixture University', 'Fixture University seat confirmed']) {
      const r = check(text, data(everything), 'guaranteed_admission');
      expect(r.verdict).toBe('cant_verify');
      expect(r.explanation.startsWith(NO_GUARANTEE_TEXT)).toBe(true);
      expect(r.questionsToAsk).toContain('Can you send me the official university page that says admission is guaranteed?');
    }
  });

  it('an Unverified "guaranteed" row is not enough', () => {
    const r = check('Guaranteed admission at Fixture University', data({ pathway_type: 'pre_masters', progression_guaranteed: unverified(true) }));
    expect(r.verdict).toBe('cant_verify');
  });

  it('only an explicit usable progression row can match, and it is explained as progression', () => {
    const yes = check('Guaranteed admission at Fixture University', data({ pathway_type: 'pre_masters', progression_guaranteed: verified(true) }));
    expect(yes.verdict).toBe('matches');
    expect(yes.explanation).toContain('progression');
    const no = check('Guaranteed admission at Fixture University', data({ pathway_type: 'pre_masters', progression_guaranteed: verified(false) }));
    expect(no.verdict).toBe('conflict');
    // A direct-entry programme never uses the progression row.
    const direct = check('Guaranteed admission at Fixture University', data({ pathway_type: 'direct', progression_guaranteed: verified(true) }));
    expect(direct.verdict).toBe('cant_verify');
  });

  it('a visa promise is never confirmed', () => {
    const r = check('100% visa guaranteed for the UK, Fixture University', data(everything), 'visa_guaranteed');
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain(NO_GUARANTEE_TEXT);
    expect(r.explanation).toContain(NOT_ADVICE_TEXT);
  });

  it('a scholarship promise is not confirmed by a general scholarship page', () => {
    const r = check('Full scholarship confirmed at Fixture University', data(everything), 'scholarship_guaranteed');
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain(NO_GUARANTEE_TEXT);
    expect(r.explanation).toContain('Fixture scholarships are competitive and limited.');
    expect(r.sources).toHaveLength(1);
  });

  it('a scholarship promise matches only an explicit usable row', () => {
    const r = check(
      'Full scholarship confirmed at Fixture University',
      data({ scholarship_info: verified('Every admitted Fixture student is automatically given the Fixture award.') }),
    );
    expect(r.verdict).toBe('matches');
  });
});

describe('recognition claims', () => {
  it('HEC status', () => {
    expect(check('Fixture University is HEC recognised', data({}, { hec_status: verified('Recognised') })).verdict).toBe('matches');
    expect(check('Fixture University is HEC recognised', data({}, { hec_status: verified('Not recognised') })).verdict).toBe('conflict');
    expect(check('Fixture University is HEC recognised', data()).verdict).toBe('cant_verify');
  });

  it('official recognition list', () => {
    expect(check('Fixture University is accredited', data({}, { recognition_list_status: verified('listed') })).verdict).toBe('matches');
    const r = check('Fixture University is accredited', data({}, { recognition_list_status: verified('not_listed') }));
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('does not include this university');
  });

  it('anabin marker', () => {
    expect(check('Fixture University is H+ on anabin', data({}, { anabin_status: verified('H+') })).verdict).toBe('matches');
    expect(check('Fixture University is H+ on anabin', data({}, { anabin_status: verified('H-') })).verdict).toBe('conflict');
  });

  it('rankings are never checked', () => {
    expect(check('Fixture University is ranked top 10', data()).verdict).toBe('cant_verify');
  });

  it('statusLooks reads plain-text list statuses', () => {
    expect(statusLooks('Recognised')).toBe('positive');
    expect(statusLooks('Not recognised')).toBe('negative');
    expect(statusLooks('H+')).toBe('positive');
    expect(statusLooks('H-')).toBe('negative');
    expect(statusLooks('H+/-')).toBe('unknown');
    expect(statusLooks('Pending')).toBe('unknown');
  });
});

describe('PR, citizenship and work rights (country facts)', () => {
  const ukPr = countryFact('UK', 'pr_route', verified({ text: 'Fixture settlement rule: 5 years.', sort_months: 60 }, 1, 'https://fixture.example.gov/pr'));
  const ukWork = countryFact('UK', 'post_study_work', likely({ text: 'Fixture graduate route: up to 2 years.', sort_months: 24 }));
  const d = data({}, {}, { countryFacts: [ukPr, ukWork] });

  it('PR sooner than the usable rule differs', () => {
    const r = check('PR in 2 years in the UK', d);
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('Fixture settlement rule');
    expect(r.explanation).toContain(NOT_ADVICE_TEXT);
    expect(r.sources[0]).toMatchObject({ confidence: 'Verified', source_url: 'https://fixture.example.gov/pr' });
  });

  it('PR at or after the usable rule is never "matches": a minimum wait is not a promise', () => {
    const r = check('PR in 6 years in the UK', d);
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain('The official minimum is about 5 years.');
    expect(r.explanation).toContain('A minimum time is not a promise');
    expect(r.sources[0]).toMatchObject({ confidence: 'Verified', source_url: 'https://fixture.example.gov/pr' });
  });

  it("can't verify without a country or without a fact", () => {
    expect(check('PR in 2 years', d).verdict).toBe('cant_verify');
    expect(check('Citizenship in 2 years in the UK', d).verdict).toBe('cant_verify');
    expect(check('PR in 2 years in Canada', d).verdict).toBe('cant_verify');
  });

  it('an Unverified country fact is never used', () => {
    const weak = data({}, {}, { countryFacts: [countryFact('UK', 'pr_route', unverified({ text: 'x', sort_months: 60 }))] });
    expect(check('PR in 2 years in the UK', weak).verdict).toBe('cant_verify');
  });

  it('work after study longer than the usable maximum differs', () => {
    expect(check('Post-study work 3 years in the UK', d).verdict).toBe('conflict');
    const ok = check('Post-study work 2 years in the UK', d);
    expect(ok.verdict).toBe('matches');
    expect(ok.explanation).toContain('Check the conditions');
  });

  it('work hours during study are not tracked', () => {
    expect(check('Unlimited work hours in the UK', d).verdict).toBe('cant_verify');
  });

  it('old Verified facts become Likely but stay usable', () => {
    const old = countryFact('UK', 'pr_route', { ...verified({ text: 'Fixture rule', sort_months: 60 }), fetched_at: daysAgo(90) });
    const r = check('PR in 2 years in the UK', data({}, {}, { countryFacts: [old] }));
    expect(r.verdict).toBe('conflict');
    expect(r.sources[0].confidence).toBe('Likely');
  });
});

describe('other claim types', () => {
  it('a ruled-out programme with a usable note differs', () => {
    const r = check('Apply to Fixture University', data({ status: 'ruled_out', status_note: verified('Fixture: not accepting Pakistan applicants.') }));
    expect(r.type).toBe('institution_mention');
    expect(r.verdict).toBe('conflict');
  });

  it('a plain mention is not a verdict', () => {
    const r = check('Apply to Fixture University', data());
    expect(r.verdict).toBe('cant_verify');
    expect(r.questionsToAsk[0]).toMatch(/Which exact programme/);
  });

  it('other', () => {
    const r = check('The agent said the city is very safe', data());
    expect(r.type).toBe('other');
    expect(r.verdict).toBe('cant_verify');
  });
});

describe('full run, summary and questions', () => {
  const d = data(
    { language_req: verified({ ielts_overall: 6.5 }), tuition: verified(GBP_YEAR(10_000)), living_cost: verified(GBP_YEAR(8_000)), duration_months: verified(12) },
    {},
    {
      fxRates: [fxRow('GBP', verified(300))],
      countryFacts: [countryFact('UK', 'pr_route', verified({ text: 'Fixture settlement rule', sort_months: 60 }))],
    },
  );
  const run = runCheck('Guaranteed admission at Fixture University, no IELTS needed, total cost 25 lakh, PR in 2 years', d, NOW);

  it('verdicts per claim', () => {
    expect(run.results.map((r) => [r.type, r.verdict])).toEqual([
      ['guaranteed_admission', 'cant_verify'],
      ['no_language_test', 'conflict'],
      ['total_cost', 'conflict'],
      ['pr_or_citizenship_time', 'conflict'],
    ]);
    expect(run.summary).toEqual({ total: 4, matches: 0, conflict: 3, cant_verify: 1 });
    expect(summarize([])).toEqual({ total: 0, matches: 0, conflict: 0, cant_verify: 0 });
  });

  it('every source is usable or a shown conflict, never Unverified', () => {
    for (const r of run.results) for (const s of r.sources) expect(['Verified', 'Likely', 'Conflict']).toContain(s.confidence);
  });

  it('collects questions: differences first, no duplicates, capped', () => {
    const qs = collectQuestions(run.results, 8);
    expect(qs.length).toBeLessThanOrEqual(8);
    expect(new Set(qs).size).toBe(qs.length);
    expect(qs[0]).toBe(questionsFor(extractClaims('no IELTS needed at Fixture University', d)[0])[0]);
    expect(collectQuestions(run.results, 2)).toHaveLength(2);
  });

  it('is deterministic for a fixed now', () => {
    expect(runCheck('Guaranteed admission at Fixture University, no IELTS needed', d, NOW)).toEqual(
      runCheck('Guaranteed admission at Fixture University, no IELTS needed', d, NOW),
    );
  });

  it('compareClaim works on a single claim', () => {
    const [claim] = extractClaims('no IELTS needed at Fixture University', d);
    expect(compareClaim(claim, d, NOW).verdict).toBe('conflict');
  });

  it('formatAmount', () => {
    expect(formatAmount(15000, 'GBP')).toBe('£15,000');
    expect(formatAmount(2_500_000, 'PKR')).toBe('PKR 2,500,000 (25 lakh)');
  });
});

describe('never accusatory, never a probability', () => {
  const scenarios: [string, CheckData][] = [
    ['Guaranteed admission at Fixture University, no IELTS needed, total cost 25 lakh, PR in 2 years in the UK', data()],
    [
      'Fixture University accepts 2.5 CGPA. Tuition is £4,000 per year. Deadline 30 April 2027. 100% visa. Full scholarship confirmed. HEC recognised. Ranked top 10. Only 2 seats left so pay today. Post-study work 5 years in the UK. Citizenship in 1 year in the UK. The agent is nice.',
      data(
        {
          min_gpa_rule: verified({ scale: 'cgpa_4', min: 3 }),
          tuition: verified(GBP_YEAR(10_000)),
          deadline: verified('2027-03-15'),
          status: 'ruled_out',
          status_note: verified('Fixture note'),
        },
        { hec_status: verified('Not recognised') },
        {
          countryFacts: [
            countryFact('UK', 'post_study_work', verified({ text: 'Fixture work rule', sort_months: 24 })),
            countryFact('UK', 'citizenship_rule', verified({ text: 'Fixture citizenship rule', sort_months: 72 })),
          ],
        },
      ),
    ],
    ...EXAMPLE_CLAIMS.map((e): [string, CheckData] => [e.text, loadEmptySeedDataset()]),
  ];

  it.each(scenarios.map(([t, d], i) => [i, t, d] as const))('scenario %i', (_i, text, d) => {
    const run = runCheck(text, d, NOW);
    expect(run.results.length).toBeGreaterThan(0);
    for (const r of run.results) {
      expect(allText(r)).not.toMatch(ACCUSING);
      expect(r.explanation).not.toMatch(/\bchances?\b|\bprobability\b|\blikelihood\b/i);
      expect(r.explanation).not.toMatch(/\bguaranteed (admission|visa)\b/i);
      expect(r.questionsToAsk.length).toBeGreaterThan(0);
      expect(r.questionsToAsk.length).toBeLessThanOrEqual(3);
    }
    const share = buildShareText(run.results);
    expect(share).not.toMatch(ACCUSING);
    expect(buildQuestionsText(collectQuestions(run.results))).not.toMatch(ACCUSING);
  });
});

describe('seed data (today: almost everything Unverified)', () => {
  const seed = loadEmptySeedDataset();

  it('the brief example: only "PR in 2 years" differs, from the Likely uk-pr-route fact (120 months)', () => {
    const run = runCheck('Guaranteed admission at Oxford Brookes, no IELTS needed, total cost 25 lakh, PR in 2 years', seed, NOW);
    expect(run.results.map((r) => [r.type, r.verdict])).toEqual([
      ['guaranteed_admission', 'cant_verify'],
      ['no_language_test', 'cant_verify'],
      ['total_cost', 'cant_verify'],
      ['pr_or_citizenship_time', 'conflict'],
    ]);
    const pr = run.results[3];
    const ukPr = seed.countryFacts.find((f) => f.id === 'uk-pr-route')!;
    expect(ukPr.value?.sort_months).toBe(120);
    expect(pr.sources).toHaveLength(1);
    expect(pr.sources[0]).toMatchObject({ confidence: 'Likely', source_url: ukPr.source_url, value: ukPr.value?.text });
    expect(pr.explanation).toContain('10 years');
    // Missing data is said honestly, with a link to the official website from the data row.
    expect(run.results[1].explanation).toContain(CANT_VERIFY_TEXT);
    expect(run.results[1].officialLinks[0]?.url).toBe('https://www.brookes.ac.uk/');
  });

  it('programme facts are all Unverified today, so every programme claim is cant_verify', () => {
    const text = [
      'TUM accepts 2.5 CGPA',
      'Tuition at Cardiff is £10,000 per year',
      'Imperial deadline is 31 May',
      'QMUL: no IELTS needed',
      'Full scholarship confirmed at USF',
      'Wurzburg is HEC recognised',
      'Visa guaranteed for Canada',
    ].join('. ');
    const run = runCheck(text, seed, NOW);
    expect(run.results).toHaveLength(7);
    for (const r of run.results) {
      expect(r.verdict).toBe('cant_verify');
      expect(r.sources).toEqual([]);
    }
  });

  it('Likely country facts are used: German citizenship in 3 years differs from the 5-year rule', () => {
    const r = runCheck('German passport in 3 years', seed, NOW).results[0];
    expect(r.verdict).toBe('conflict');
    expect(r.sources[0].confidence).toBe('Likely');
  });

  it('an Unverified country fact (US PR) gives cant_verify', () => {
    expect(runCheck('Green card in 2 years in the USA', seed, NOW).results[0].verdict).toBe('cant_verify');
  });
});

/* ------------------------------------------------------------------ */
/* Review regressions (24 Nov 2026)                                    */
/* ------------------------------------------------------------------ */

const CURLY = /[“”]/;

/** A Verified fixture row with a chosen verbatim snippet. */
function quotedRow<T>(value: T, snippet: string, url = 'https://fixture.example.gov/rule'): Fact<T> {
  return { ...verified(value, 1, url), evidence_snippet: snippet };
}

describe('review: residence promises that count study time are never "matches"', () => {
  const caRule = countryFact(
    'CA',
    'citizenship_rule',
    quotedRow(
      {
        text: 'Fixture: physically present for at least 1,095 days during the 5 years before you apply.',
        sort_months: 36,
        clock_note: 'Fixture: days as a temporary resident (for example as a student) count as half days, up to 365 days.',
      },
      'Fixture exact words: at least 1,095 days (3 years) during your 5-year eligibility period.',
    ),
  );
  const d = data({}, {}, { countryFacts: [caRule] });

  it("the reviewer's case: 'citizenship in 3 years after your masters' is can't verify, quotes the rule and asks about study time", () => {
    const run = runCheck('Canada PR and citizenship in 3 years after your masters, guaranteed.', d, NOW);
    const r = run.results.find((x) => x.type === 'pr_or_citizenship_time' && x.claim.includes('citizenship'))!;
    expect(r.verdict).toBe('cant_verify');
    expect(r.verdictLabel).toBe("Can't verify");
    expect(r.explanation).toContain('“Fixture exact words: at least 1,095 days (3 years) during your 5-year eligibility period.”');
    expect(r.explanation).toContain('The official minimum is about 3 years.');
    expect(r.explanation).toContain('Whether your time counts depends on this rule: Fixture: days as a temporary resident');
    expect(r.explanation).toMatch(/study time counts/);
    expect(run.results.every((x) => x.verdict !== 'matches')).toBe(true);
    expect(buildShareText(run.results)).not.toContain('Matches');
  });

  it("'citizenship after 3 years of study' and a plain 4-year claim are can't verify too", () => {
    expect(check('Canadian citizenship after 3 years of study in Canada.', d).verdict).toBe('cant_verify');
    const plainClaim = check('Canadian citizenship in 4 years', d);
    expect(plainClaim.verdict).toBe('cant_verify');
    expect(plainClaim.explanation).not.toMatch(/study time counts/);
    expect(plainClaim.explanation).toContain('The official minimum is about 3 years.');
  });

  it('a shorter time than the official minimum still differs', () => {
    const r = check('Citizenship in 2 years in Canada', d);
    expect(r.verdict).toBe('conflict');
    expect(r.verdictLabel).toBe('Differs from official page');
    expect(r.explanation).toContain('That is about 3 years, not 2 years.');
  });

  it('never says "about X, not Y" when the rule text itself names Y or less', () => {
    const both = countryFact('UK', 'pr_route', likely({ text: 'Fixture: the wait moves from 5 to 10 years for most people.', sort_months: 120 }));
    const r = check('PR in 6 years in the UK', data({}, {}, { countryFacts: [both] }));
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain('more than one length of time (5 years and 10 years)');
    expect(r.explanation).not.toContain('not 6 years');
    expect(check('PR in 2 years in the UK', data({}, {}, { countryFacts: [both] })).verdict).toBe('conflict');
  });

  it('a rule that mentions faster paths keeps "differs" for a much shorter claim, but asks which route', () => {
    const paths = countryFact(
      'UK',
      'pr_route',
      quotedRow(
        { text: 'Fixture: starting point 10 years, with faster and slower paths.', sort_months: 120 },
        'Fixture: the starting point will move to 10 years, with faster and slower paths available.',
      ),
    );
    const r = check('PR in 2 years in the UK', data({}, {}, { countryFacts: [paths] }));
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('ask which exact route gives 2 years');
  });

  it("today's data: the reviewer's Canada and UK examples", () => {
    const seed = loadSeedDataset();
    const ca = runCheck('Canada PR and citizenship in 3 years after your masters, guaranteed.', seed, NOW).results;
    expect(ca.map((x) => x.verdict)).not.toContain('matches');
    const caCit = ca.find((x) => x.claim.includes('citizenship'))!;
    expect(caCit.verdict).toBe('cant_verify');
    expect(caCit.explanation).toContain('1,095 days');
    expect(runCheck('Canadian citizenship after 3 years of study in Canada.', seed, NOW).results[0].verdict).toBe('cant_verify');
    expect(runCheck('UK PR in 10 years after study.', seed, NOW).results[0].verdict).toBe('cant_verify');
    expect(runCheck('German citizenship in 6 years', seed, NOW).results[0].verdict).toBe('cant_verify');
    expect(runCheck('German passport in 3 years', seed, NOW).results[0].verdict).toBe('conflict');
  });
});

describe('review: work after study uses the lengths the rule names, never the ranking number', () => {
  const ukText = 'Fixture graduate visa: 2 years if you apply by 31 December 2026; 18 months if you apply from 1 January 2027.';
  const uk = countryFact(
    'UK',
    'post_study_work',
    quotedRow(
      { text: ukText, sort_months: 18 },
      'Fixture: lasts for 2 years if you apply on or before 31 December 2026 18 months if you apply on or after 1 January 2027',
    ),
  );
  const d = data({}, {}, { countryFacts: [uk] });

  it("'UK graduate visa is 2 years' is not 'conflict' and never says 'up to about 18 months'", () => {
    for (const text of ['UK graduate visa is 2 years', 'UK post-study work visa is 2 years.']) {
      const r = check(text, d, 'work_rights');
      expect(r.verdict).toBe('cant_verify');
      expect(r.explanation).not.toContain('up to about');
      expect(r.explanation).toContain('more than one length (2 years and 18 months)');
      expect(r.explanation).toContain('2 years is one of the lengths in the rule');
    }
  });

  it('a length the rule does not name is asked about, not decided', () => {
    const r = check('Post-study work 5 years in the UK', d);
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain('The rule does not name 5 years');
  });

  it('one length with a date condition is not decided either', () => {
    const dated = countryFact('UK', 'post_study_work', likely({ text: 'Fixture route: 2 years if you apply before 1 January 2027.', sort_months: 24 }));
    const r = check('Post-study work 2 years in the UK', data({}, {}, { countryFacts: [dated] }));
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain('comes with a date condition');
  });

  it('one plain length is the maximum, read from the text (not sort_months)', () => {
    const odd = countryFact('UK', 'post_study_work', likely({ text: 'Fixture route: up to 2 years.', sort_months: 18 }));
    const dd = data({}, {}, { countryFacts: [odd] });
    expect(check('Post-study work 2 years in the UK', dd).verdict).toBe('matches');
    const long = check('Post-study work 3 years in the UK', dd);
    expect(long.verdict).toBe('conflict');
    expect(long.explanation).toContain('That is up to about 2 years, not 3 years.');
  });

  it("today's data: the UK row (sort_months 18) does not turn a true 2-year claim into a difference", () => {
    const seed = loadSeedDataset();
    for (const text of ['UK graduate visa is 2 years', 'UK post-study work visa is 2 years.']) {
      const r = runCheck(text, seed, NOW).results[0];
      expect(r.verdict).not.toBe('conflict');
      expect(r.explanation).not.toContain('up to about 18 months');
    }
    expect(runCheck('Post-study work 3 years in the USA', seed, NOW).results[0].verdict).toBe('cant_verify');
  });

  it('durationsIn reads every length a rule names', () => {
    expect(durationsIn(ukText)).toEqual([24, 18]);
    expect(durationsIn('up to 12 months, plus a 24-month extension')).toEqual([12, 24]);
    expect(durationsIn('at least 1,095 days (3 years) during your 5-year eligibility period')).toEqual([36, 60]);
    expect(durationsIn('after five years of legal residence')).toEqual([60]);
    expect(durationsIn('raises the wait from 5 to 10 years')).toEqual([60, 120]);
    expect(durationsIn('Fixture work rule')).toEqual([]);
  });
});

describe('review: "official page" and quotation marks only for rows with exact words', () => {
  it('a summary row (no snippet) differs from "our summary", never "the official page", and has no quotation marks', () => {
    const ukPr = countryFact('UK', 'pr_route', likely({ text: 'Fixture settlement summary: 10 years.', sort_months: 120 }));
    const r = check('PR in 2 years in the UK', data({}, {}, { countryFacts: [ukPr] }));
    expect(r.verdict).toBe('conflict');
    expect(r.verdictLabel).toBe(SUMMARY_VERDICT_LABEL.conflict);
    expect(r.verdictLabel).toBe('Differs from our summary of the official position');
    expect(r.explanation).toContain('This differs from our summary of the official position.');
    expect(r.explanation).toContain('(not a quote): Fixture settlement summary: 10 years.');
    expect(r.explanation).not.toMatch(/official page/i);
    expect(r.explanation).not.toMatch(CURLY);
    expect(r.sources[0].snippet).toBeNull();
    expect(buildShareText([r])).toContain('- Differs from our summary of the official position: "PR in 2 years in the UK"');
  });

  it('a row with a snippet differs from "the official page" and quotes the snippet, not our wording', () => {
    const ukPr = countryFact(
      'UK',
      'pr_route',
      quotedRow({ text: 'Fixture summary words', sort_months: 120 }, 'Fixture exact words: settlement after 10 years.'),
    );
    const r = check('PR in 2 years in the UK', data({}, {}, { countryFacts: [ukPr] }));
    expect(r.verdictLabel).toBe(VERDICT_LABEL.conflict);
    expect(r.explanation).toContain('The official page we hold says: “Fixture exact words: settlement after 10 years.”');
    expect(r.explanation).not.toContain('“Fixture summary words');
    expect(r.sources[0]).toMatchObject({ value: 'Fixture summary words', snippet: 'Fixture exact words: settlement after 10 years.' });
  });

  it('programme comparisons follow the same rule (language, matches)', () => {
    const summary = check('Fixture University: no IELTS needed', data({ language_req: likely({ ielts_overall: 6.5 }) }));
    expect(summary.verdictLabel).toBe('Differs from our summary of the official position');
    expect(summary.explanation).not.toMatch(/official page/i);
    const quotedWaiver = check(
      'Fixture University: no IELTS needed',
      data({ language_req: verified({ ielts_overall: 6.5, waiver: 'Fixture waiver' }) }),
    );
    expect(quotedWaiver.verdictLabel).toBe('Matches official page');
    expect(quotedWaiver.explanation).toContain('In short: Fixture waiver.');
    expect(quotedWaiver.explanation).not.toMatch(CURLY);
    expect(verdictLabel('matches', false)).toBe('Matches our summary of the official position');
    expect(verdictLabel('cant_verify', false)).toBe("Can't verify");
  });

  it('the frozen seed: UK PR (inferred, no snippet) is "Differs from our summary", shown without quotes', () => {
    const r = runCheck('PR in 2 years in the UK', loadEmptySeedDataset(), NOW).results[0];
    expect(r.verdict).toBe('conflict');
    expect(r.verdictLabel).toBe('Differs from our summary of the official position');
    expect(r.explanation).not.toMatch(CURLY);
    expect(r.explanation).not.toMatch(/official page/i);
  });

  it("today's data: UK PR in 2 years differs from the official gov.uk page, quoting its exact words", () => {
    const seed = loadSeedDataset();
    const row = seed.countryFacts.find((f) => f.id === 'uk-pr-route')!;
    const r = runCheck('PR in UK in 2 years', seed, NOW).results[0];
    expect(r.verdict).toBe('conflict');
    expect(r.verdictLabel).toBe('Differs from official page');
    expect(r.explanation).toContain(`“${row.evidence_snippet}”`);
    expect(r.sources[0]).toMatchObject({ confidence: 'Verified', snippet: row.evidence_snippet, source_url: row.source_url });
    expect(r.sources[0].source_url).not.toBe('https://www.gov.uk/government/organisations/home-office');
  });
});

describe('review: our wording of a rule is "In short:", never in quotation marks', () => {
  it('CGPA explanations label rule.text "In short:" and the source carries the exact words', () => {
    const rule = quotedRow({ scale: 'cgpa_4' as const, min: 3, text: 'Fixture paraphrase of the minimum' }, 'Fixture exact minimum words GPA 3.0');
    const r = check('Fixture University accepts 2.5 CGPA', data({ min_gpa_rule: rule }));
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('In short: Fixture paraphrase of the minimum.');
    expect(r.explanation).not.toMatch(CURLY);
    expect(r.sources[0]).toMatchObject({
      value: 'Fixture paraphrase of the minimum',
      snippet: 'Fixture exact minimum words GPA 3.0',
      confidence: 'Verified',
    });
  });

  it("today's data: Brookes minimum grade shows the snippet, its note, and no quoted paraphrase", () => {
    const seed = loadSeedDataset();
    const brookes = seed.programs.find((p) => p.id === 'brookes-msc-cs')!;
    const r = runCheck('Oxford Brookes accepts 2.5 CGPA', seed, NOW).results[0];
    const src = r.sources.find((s) => s.label.endsWith('minimum grade'))!;
    expect(src.snippet).toBe(brookes.min_gpa_rule.evidence_snippet);
    expect(src.note).toBe(brookes.min_gpa_rule.note);
    expect(src.confidence).toBe('Likely');
    expect(r.explanation).toContain(`In short: ${brookes.min_gpa_rule.value!.text}.`);
    expect(r.explanation).not.toContain(`“${brookes.min_gpa_rule.value!.text}`);
  });
});

describe('review: official programme notes are shown with any claim that names the programme', () => {
  it('a usable status_note and eligibility_note are added as sources without changing the verdict', () => {
    // A neutral notice (one that limits Pakistan applicants is quoted in the answer itself: see "Pakistan restriction").
    const p = {
      status_note: verified('Fixture notice for applicants: interviews are held online.', 1, 'https://fixture.example.edu/apply'),
      eligibility_note: verified('Fixture: for graduates of subjects other than computing.', 1, 'https://fixture.example.edu/entry'),
    };
    const r = check('Guaranteed admission at Fixture University', data(p), 'guaranteed_admission');
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation.startsWith(NO_GUARANTEE_TEXT)).toBe(true);
    expect(r.explanation).toContain('also has a notice for applicants to this programme');
    expect(r.explanation).toContain('also says who this course is for');
    expect(r.sources.map((s) => s.label)).toEqual([
      'Fixture University — MSc Fixture Computing: notice for applicants',
      'Fixture University — MSc Fixture Computing: who the course is for',
    ]);
    // "Not verified yet" with the official link still shows for the claim itself.
    expect(r.officialLinks[0]?.url).toBe('https://fixture.example.edu/program');
    // A decided comparison keeps its verdict; the notes are only added.
    const lang = check('Fixture University: no IELTS needed', data({ ...p, language_req: verified({ ielts_overall: 6.5 }) }));
    expect(lang.verdict).toBe('conflict');
    expect(lang.sources).toHaveLength(3);
  });

  it('Unverified notes are never shown, and country rules do not get programme notes', () => {
    const r = check('Guaranteed admission at Fixture University', data({ status_note: unverified('x'), eligibility_note: unverified('y') }));
    expect(r.sources).toEqual([]);
    const pr = runCheck(
      'Fixture University, PR in 2 years in the UK',
      data(
        { eligibility_note: verified('Fixture eligibility') },
        {},
        { countryFacts: [countryFact('UK', 'pr_route', verified({ text: 'Fixture', sort_months: 60 }))] },
      ),
      NOW,
    ).results.find((x) => x.type === 'pr_or_citizenship_time')!;
    expect(pr.sources.map((s) => s.label)).toEqual(['United Kingdom: PR / settlement route']);
  });

  it("today's data: Brookes shows its verified Pakistan notice, Imperial shows who MSc Computing is for", () => {
    const seed = loadSeedDataset();
    const g = runCheck('Guaranteed admission at Oxford Brookes', seed, NOW).results[0];
    expect(g.verdict).toBe('cant_verify');
    const notice = g.sources[0];
    expect(notice.label).toBe('Oxford Brookes University — MSc Advanced Computer Science: notice for applicants');
    expect(notice.confidence).toBe('Verified');
    expect(notice.snippet).toContain('No offers beyond 23 October 2026');

    for (const text of ['Imperial MSc Computing accepts 3.0 CGPA', 'Imperial deadline is 31 May', 'Guaranteed admission at Imperial']) {
      const r = runCheck(text, seed, NOW).results[0];
      const whoFor = r.sources.find((s) => s.label.endsWith('who the course is for'));
      expect(whoFor?.value, text).toContain('subjects other than computing');
      expect(r.verdict, text).toBe('cant_verify');
    }
  });
});
