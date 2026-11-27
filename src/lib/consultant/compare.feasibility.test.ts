/**
 * Feasibility wave (deep audit proposals #5, #6, #16, #20, #21 and the new data fields): passed deadlines, GRE/GMAT
 * claims, English test scores and waivers, routes below the minimum, grade alternatives, visa money, Pakistan notices
 * and "Did you mean …?". Fixture cases cover the edges; loadSeedDataset() covers today's live data.
 */
import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '../data/seed-source';
import { FIXED_NOW, conflicting, makeInstitution, makeProgram, unverified, verified } from '../test-fixtures';
import type { CountryFact, CountryFactValue, Fact, FxRate, Institution, Program } from '../types';
import { NOT_ADVICE_TEXT, runCheck, type CheckData, type CheckResult } from './compare';
import { suggestInstitution } from './suggest';

const NOW = FIXED_NOW; // 2026-11-24
const DEC_2 = new Date('2026-12-02T12:00:00Z');
const seed = loadSeedDataset();

function data(p: Partial<Program> = {}, extra: Partial<CheckData> = {}, i: Partial<Institution> = {}): CheckData {
  return { programs: [makeProgram(p)], institutions: [makeInstitution(i)], countryFacts: [], conversionRules: [], fxRates: [], ...extra };
}

function check(text: string, d: CheckData, type?: CheckResult['type'], now: Date = NOW): CheckResult {
  const run = runCheck(text, d, now);
  const r = type ? run.results.find((x) => x.type === type) : run.results[0];
  if (!r) throw new Error(`No ${type ?? ''} result for: ${text} (got ${run.results.map((x) => x.type).join(', ')})`);
  return r;
}

function fundsRow(country: string, fact: Fact<CountryFactValue>): CountryFact {
  return { id: `fixture-${country}-funds`, country, key: 'proof_of_funds', ...fact };
}

function fxRow(currency: string, fact: Fact<number>): FxRate {
  return { id: `fixture-${currency}`, currency, pkr_per_unit: fact };
}

const ACCUSING = /\b(lie|lies|lied|lying|liar|fraud\w*|scam\w*|cheat\w*|fake|dishonest\w*|mislead\w*)\b/i;
/**
 * Admission odds in our own words. (NYIT's route summary says "you may be given the chance to qualify": the
 * university's wording of a condition, not a probability we computed.)
 */
const PROBABILITY = /\b(your|admission|good|high|low|fair|best) chances?\b|\bchances? (of|for) (admission|getting|success|an? offer)\b|\bprobability\b|\blikelihood\b|\d\s*%\s*(chance|likely)/i;

/* ------------------------------------------------------------------ */
/* #16 Passed deadlines                                                */
/* ------------------------------------------------------------------ */

describe('#16 passed deadlines (now = 2 Dec 2026)', () => {
  const d = data({ deadline: verified('2026-11-30') });

  it('the same date still matches, and says it has passed', () => {
    const r = check('Fixture University deadline is 30 November 2026', d, 'deadline', DEC_2);
    expect(r.verdict).toBe('matches');
    expect(r.explanation).toContain('This date has passed.');
    expect(r.explanation).not.toContain('Plan for');
  });

  it("a later date is can't verify, with the exact wording, never 'plan for the official date'", () => {
    const r = check('Fixture University deadline is 30 November 2027', d, 'deadline', DEC_2);
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain(
      "The official deadline we hold, 30 Nov 2026, has passed. We don't hold the next deadline yet, so we can't check 30 November 2027. Ask which intake this date is for, in writing, and check the official page.",
    );
    expect(r.explanation).not.toContain('Plan for the official date');
  });

  it("a date with no year after the official date has passed is can't verify (it may be the next intake)", () => {
    const r = check('Fixture University ki last date 15 March hai', d, 'deadline', DEC_2);
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain("we can't check 15 March");
  });

  it('an earlier date still differs, and says both dates have passed', () => {
    const r = check('Fixture University deadline is 15 November 2026', d, 'deadline', DEC_2);
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('Both dates have passed.');
  });

  it('pressure to pay now mentions that the official date has passed', () => {
    const r = check('Fixture University: only 2 seats left, pay today', d, 'deadline', DEC_2);
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain('This date has passed.');
  });

  it('before the deadline nothing changes; the deadline day itself has not passed', () => {
    const later = check('Fixture University deadline is 30 November 2027', d, 'deadline', NOW);
    expect(later.verdict).toBe('conflict');
    expect(later.explanation).toContain('Plan for the official date.');
    const sameDay = check('Fixture University deadline is 30 November 2026', d, 'deadline', new Date('2026-11-30T20:00:00Z'));
    expect(sameDay.verdict).toBe('matches');
    expect(sameDay.explanation).not.toContain('has passed');
  });

  it('deadline questions ask which intake the date is for (not for seat pressure)', () => {
    expect(check('Fixture University deadline is 30 November 2027', d, 'deadline', DEC_2).questionsToAsk).toContain('Which intake is this deadline for?');
    expect(check('Fixture University: only 2 seats left, pay today', d, 'deadline', DEC_2).questionsToAsk).not.toContain(
      'Which intake is this deadline for?',
    );
  });

  it("today's data: the three ETH probe sentences", () => {
    const run = (t: string) => check(t, seed, 'deadline', DEC_2);
    const later = run('ETH deadline is 30 November 2027');
    expect(later.verdict).toBe('cant_verify');
    expect(later.explanation).toContain('The official deadline we hold, 30 Nov 2026, has passed.');
    const urdu = run('ETH ki last date 15 December hai');
    expect(urdu.verdict).toBe('cant_verify');
    expect(urdu.explanation).toContain("we can't check 15 December.");
    const same = run('ETH deadline is 30 November 2026, apply now');
    expect(same.verdict).toBe('matches');
    expect(same.explanation).toContain('This date has passed.');
  });
});

/* ------------------------------------------------------------------ */
/* #6 GRE / GMAT                                                       */
/* ------------------------------------------------------------------ */

describe('#6 GRE / GMAT claims against tests_required', () => {
  it('differs only when the usable row clearly says required, quoting the official words', () => {
    const r = check('Fixture University: no GRE needed', data({ tests_required: verified('GRE required for applicants with a degree from Pakistan.') }));
    expect(r.type).toBe('tests');
    expect(r.verdict).toBe('conflict');
    expect(r.verdictLabel).toBe('Differs from official page');
    expect(r.explanation).toContain('“Fixture snippet for "GRE required for applicants with a degree from Pakistan."”');
    expect(r.sources[0]).toMatchObject({ label: 'Fixture University — MSc Fixture Computing: GRE / GMAT', confidence: 'Verified' });
  });

  it.each([
    'GRE required unless you hold a fixture degree.',
    'GRE recommended but not required.',
    'GRE optional.',
    'GRE scores required if you are a graduate of a fixture university.',
  ])("can't verify, with the official words, when the row has conditions: %s", (row) => {
    const r = check('Fixture University does not require GRE', data({ tests_required: verified(row) }));
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain(row);
    expect(r.sources).toHaveLength(1);
  });

  it("can't verify when the row is Unverified, or names a different test", () => {
    const none = check('Fixture University: no GRE needed', data({ tests_required: unverified('GRE required.') }));
    expect(none.verdict).toBe('cant_verify');
    expect(none.sources).toEqual([]);
    const gmat = check('Fixture University: GMAT is waived', data({ tests_required: verified('GRE required.') }));
    expect(gmat.verdict).toBe('cant_verify');
    expect(gmat.explanation).toContain('does not mention the GMAT');
  });

  it("today's data: TUM differs (GRE required for Pakistan); USF, UIUC and CMU are not decided", () => {
    const tum = check('TUM MSc Informatics does not require GRE for Pakistani students', seed, 'tests');
    expect(tum.verdict).toBe('conflict');
    expect(tum.explanation).toContain('have to submit a GRE (General) Test');
    for (const t of ['USF: no GRE needed', 'UIUC GRE not required', 'CMU: GRE is optional', 'UCCS: no GRE needed']) {
      expect(check(t, seed, 'tests').verdict, t).toBe('cant_verify');
    }
  });
});

/* ------------------------------------------------------------------ */
/* #6 English test scores and waivers                                  */
/* ------------------------------------------------------------------ */

describe('#6 English test score claims against language_req', () => {
  const d = data({ language_req: verified({ ielts_overall: 6, toefl_ibt: 79 }) });

  it('a lower score differs and gives the official number', () => {
    const r = check('Fixture University requires IELTS 5.5 only', d);
    expect(r.type).toBe('language_score');
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('IELTS 6.0 overall');
    expect(r.reading).toBe('We read this as IELTS 5.5 overall.');
    const toefl = check('TOEFL 70 is enough for Fixture University', d);
    expect(toefl.verdict).toBe('conflict');
    expect(toefl.explanation).toContain('TOEFL 79 overall');
  });

  it('the same score matches; a higher score matches only as "enough", never as a different minimum', () => {
    expect(check('Fixture University requires IELTS 6', d).verdict).toBe('matches');
    const enough = check('IELTS 7 is enough for Fixture University', d);
    expect(enough.verdict).toBe('matches');
    expect(enough.explanation).toContain('does not mean you will be admitted');
    expect(check('Fixture University requires IELTS 7', d).verdict).toBe('cant_verify');
  });

  it("can't verify: new TOEFL scale, no number, or no usable row", () => {
    expect(check('TOEFL 4.0 is enough for Fixture University', d).verdict).toBe('cant_verify');
    expect(check('IELTS 5.5 is enough for Fixture University', data({ language_req: verified({ text: 'Fixture: English level C1' }) })).verdict).toBe(
      'cant_verify',
    );
    expect(check('IELTS 5.5 is enough for Fixture University', data({ language_req: unverified({ ielts_overall: 6 }) })).verdict).toBe('cant_verify');
  });

  it("today's data: 'Oxford Brookes MSc requires IELTS 5.5 only' differs from the official 6.0", () => {
    const r = check('Oxford Brookes MSc requires IELTS 5.5 only', seed, 'language_score');
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('IELTS 6.0 overall');
    expect(check('IELTS 6.5 is enough for Imperial', seed, 'language_score').verdict).toBe('conflict');
  });
});

describe('#6 "no IELTS / MOI is enough" against the language_waiver row', () => {
  const noWaiver = 'No waiver for a Pakistani degree: fixture list of countries only.';
  const conditions = 'Exempt only if the whole bachelor degree was taught in English, confirmed by the registrar.';

  it('a waiver row saying a Pakistani degree is not exempt differs, quoting it', () => {
    const r = check('Fixture University: no IELTS needed', data({ language_waiver: verified(noWaiver), language_req: verified({ ielts_overall: 6.5 }) }));
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain(`In short: ${noWaiver}`);
    expect(r.explanation).toContain(`“Fixture snippet for "${noWaiver}"”`);
    expect(r.sources.map((s) => s.label)).toEqual([
      'Fixture University — MSc Fixture Computing: English test waiver',
      'Fixture University — MSc Fixture Computing: English test',
    ]);
  });

  it("a waiver with conditions is can't verify with the conditions, even when the programme lists a score", () => {
    for (const text of ['Fixture University: no IELTS needed', 'MOI is enough for Fixture University']) {
      const r = check(text, data({ language_waiver: verified(conditions), language_req: verified({ ielts_overall: 6.5 }) }), 'no_language_test');
      expect(r.verdict, text).toBe('cant_verify');
      expect(r.explanation, text).toContain(conditions);
    }
    expect(check('Fixture University: no IELTS needed', data({ language_waiver: verified('No waiver unless your degree is from a fixture country.') })).verdict).toBe(
      'cant_verify',
    );
  });

  it('an Unverified waiver row is never used (the language_req rule still decides)', () => {
    const r = check('Fixture University: no IELTS needed', data({ language_waiver: unverified(noWaiver), language_req: verified({ ielts_overall: 6.5 }) }));
    expect(r.verdict).toBe('conflict');
    expect(r.sources.map((s) => s.label)).toEqual(['Fixture University — MSc Fixture Computing: English test']);
  });

  it("conflicting waiver rows are shown and decide nothing", () => {
    const r = check('Fixture University: no IELTS needed', data({ language_waiver: conflicting(noWaiver, conditions) }));
    expect(r.verdict).toBe('cant_verify');
    expect(r.sources.map((s) => s.confidence)).toEqual(['Conflict', 'Conflict']);
  });

  it("today's data: Imperial, UIUC, NYIT and CMU differ; Würzburg, Toronto and ETH show their conditions", () => {
    for (const t of ['Imperial: no IELTS needed', 'UIUC: no TOEFL required', 'NYIT: no IELTS needed', 'CMU: MOI is enough']) {
      const r = check(t, seed, 'no_language_test');
      expect(r.verdict, t).toBe('conflict');
      expect(r.sources[0].label, t).toMatch(/English test waiver$/);
    }
    for (const t of ['Wurzburg: no IELTS needed', 'UofT: no IELTS needed', 'ETH Zurich: no IELTS needed']) {
      const r = check(t, seed, 'no_language_test');
      expect(r.verdict, t).toBe('cant_verify');
      expect(r.sources[0].label, t).toMatch(/English test waiver$/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Routes below the minimum, grade alternatives                       */
/* ------------------------------------------------------------------ */

describe('CGPA claims and an official route below the minimum (conditional_admission)', () => {
  const min = verified({ scale: 'cgpa_4' as const, min: 3, text: 'Fixture minimum CGPA 3.0' });
  const route = verified({ scale: 'cgpa_4' as const, min: 2.5, text: 'Fixture route: GPA 2.5 to 2.99 may be admitted conditionally.' });

  it("below the minimum but inside the route: can't verify, with the route as an official source", () => {
    for (const text of ['Fixture University accepts 2.5 CGPA', 'You can apply to Fixture University with 2.5 CGPA']) {
      const r = check(text, data({ min_gpa_rule: min, conditional_admission: route }), 'gpa_requirement');
      expect(r.verdict, text).toBe('cant_verify');
      expect(r.explanation, text).toContain('This programme publishes a route below its minimum: Fixture route: GPA 2.5 to 2.99 may be admitted conditionally.');
      const src = r.sources.find((s) => s.label.endsWith('route below the minimum'));
      expect(src?.confidence, text).toBe('Verified');
      expect(src?.snippet, text).toContain('Fixture route');
    }
  });

  it("below the route's own lowest grade differs", () => {
    const r = check('Fixture University accepts 2.2 CGPA', data({ min_gpa_rule: min, conditional_admission: route }));
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('A CGPA of 2.2 is also below 2.5');
  });

  it('meeting the regular minimum is unchanged, and the route is not shown', () => {
    const r = check('Fixture University accepts 3.2 CGPA', data({ min_gpa_rule: min, conditional_admission: route }));
    expect(r.verdict).toBe('matches');
    expect(r.sources.some((s) => s.label.endsWith('route below the minimum'))).toBe(false);
  });

  it("a route with no floor, a 'low CGPA ok' claim, and a route on another scale are can't verify", () => {
    const noFloor = verified({ scale: 'cgpa_4' as const, min: null, text: 'Fixture provisional admission below 3.0.' });
    expect(check('Fixture University accepts 1.8 CGPA', data({ min_gpa_rule: min, conditional_admission: noFloor })).verdict).toBe('cant_verify');
    expect(check('Low CGPA ok at Fixture University', data({ conditional_admission: route })).verdict).toBe('cant_verify');
    const german = verified({ scale: 'german' as const, min: 4, text: 'Fixture aptitude test for grades worse than 2.5.' });
    const r = check('Fixture University accepts 2.5 CGPA', data({ conditional_admission: german }));
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain('This route is on the German grade');
  });

  it('an Unverified route is never used; a conflicting route decides nothing', () => {
    expect(check('Fixture University accepts 2.5 CGPA', data({ min_gpa_rule: min, conditional_admission: unverified(route.value) })).verdict).toBe('conflict');
    const r = check('Fixture University accepts 2.5 CGPA', data({ min_gpa_rule: min, conditional_admission: conflicting(route.value!, { ...route.value!, min: 2 }) }));
    expect(r.verdict).toBe('cant_verify');
  });

  it("today's data: NYIT 2.5 and UCCS 2.5 (persona A) show the route; NYIT 2.2 differs; Brookes 2.5 still differs", () => {
    const nyit = check('You can apply to NYIT with 2.5 CGPA', seed, 'gpa_requirement');
    expect(nyit.verdict).toBe('cant_verify');
    expect(nyit.explanation).toContain('publishes a route below its minimum');
    expect(nyit.sources.find((s) => s.label.endsWith('route below the minimum'))?.snippet).toContain('between 2.5 and 2.84');
    expect(check('UCCS accepts 2.5 CGPA', seed, 'gpa_requirement').verdict).toBe('cant_verify');
    expect(check('NYIT accepts 2.2 CGPA', seed, 'gpa_requirement').verdict).toBe('conflict');
    expect(check('You can apply to Oxford Brookes with 2.5 CGPA', seed, 'gpa_requirement').verdict).toBe('conflict');
    expect(check('Wurzburg accepts 2.5 CGPA', seed, 'gpa_requirement').verdict).toBe('cant_verify');
  });
});

describe('percentage claims use a minimum printed on the same scale (GpaRule.alternatives)', () => {
  const rule = verified({ scale: 'cgpa_4' as const, min: 2.7, text: 'Fixture: 60% or GPA 2.7', alternatives: [{ scale: 'percent' as const, min: 60 }] });

  it('below / meeting the percentage minimum', () => {
    const below = check('Fixture University accepts 55% marks', data({ min_gpa_rule: rule }));
    expect(below.verdict).toBe('conflict');
    expect(below.explanation).toContain('55% is below the 60% minimum');
    expect(below.questionsToAsk[0]).toBe('Which official page says 55% is accepted for this programme?');
    expect(check('Fixture University accepts 62% marks', data({ min_gpa_rule: rule })).verdict).toBe('matches');
    expect(check('Minimum percentage required is 60% at Fixture University', data({ min_gpa_rule: rule })).verdict).toBe('matches');
  });

  it('without an alternative, a percentage is not compared with a CGPA minimum', () => {
    const plain = verified({ scale: 'cgpa_4' as const, min: 2.7 });
    expect(check('Fixture University accepts 55% marks', data({ min_gpa_rule: plain })).verdict).toBe('cant_verify');
  });

  it("today's data: Brookes 55% differs, 62% meets the 60% minimum", () => {
    expect(check('Brookes accepts 55% marks', seed, 'gpa_requirement').verdict).toBe('conflict');
    expect(check('Brookes accepts 62% marks', seed, 'gpa_requirement').verdict).toBe('matches');
  });
});

/* ------------------------------------------------------------------ */
/* Visa money                                                          */
/* ------------------------------------------------------------------ */

describe('visa money claims against proof_of_funds', () => {
  const de = fundsRow(
    'DE',
    verified({ text: 'Fixture: you must pay €992 a month into a blocked account.', money: { amount: 11_904, currency: 'EUR', period: 'year' as const } }),
  );
  const ca = fundsRow('CA', verified({ text: 'Fixture: you must prove you can pay tuition and living expenses.' }));
  const d = data({}, { countryFacts: [de, ca] });

  it('"no blocked account" differs from a rule that says the money must be paid into one, quoting it', () => {
    const r = check('No blocked account needed for Germany', d);
    expect(r.type).toBe('visa_money');
    expect(r.verdict).toBe('conflict');
    expect(r.explanation).toContain('“Fixture snippet for');
    expect(r.explanation).toContain(NOT_ADVICE_TEXT);
    expect(r.about).toEqual(['Germany']);
    // A country rule: never the programme notes.
    expect(r.sources.map((s) => s.label)).toEqual(['Germany: money to show for a student visa']);
  });

  it('"no blocked account" is not decided for a country whose rule names none; "no bank statement" differs from "must prove"', () => {
    expect(check('No blocked account needed for Canada', d).verdict).toBe('cant_verify');
    expect(check('No bank statement needed for Canada', d).verdict).toBe('conflict');
  });

  it('an amount in the rule currency: lower differs; the same amount is never "matches"', () => {
    const low = check('Germany blocked account is only €5,000', d);
    expect(low.verdict).toBe('conflict');
    expect(low.explanation).toContain('€11,904 per year');
    expect(check('Blocked account €992 per month for Germany', d).verdict).toBe('cant_verify');
    expect(check('Blocked account €11,904 per year for Germany', d).verdict).toBe('cant_verify');
  });

  it('an amount in PKR is compared only through a usable exchange rate', () => {
    const noFx = check('Germany blocked account is only 5 lakh', d);
    expect(noFx.verdict).toBe('cant_verify');
    expect(noFx.explanation).toContain('no verified exchange rate');
    const withFx = check('Germany blocked account is only 5 lakh', data({}, { countryFacts: [de], fxRates: [fxRow('EUR', verified(300))] }));
    expect(withFx.verdict).toBe('conflict');
    expect(withFx.sources.map((s) => s.label)).toContain('Exchange rate EUR to PKR');
    const unusableFx = check('Germany blocked account is only 5 lakh', data({}, { countryFacts: [de], fxRates: [fxRow('EUR', unverified(300))] }));
    expect(unusableFx.verdict).toBe('cant_verify');
  });

  it("can't verify without a usable row or without a country", () => {
    const none = check('No bank statement needed for Germany', data({}, { countryFacts: [fundsRow('DE', unverified({ text: 'x' }))] }));
    expect(none.verdict).toBe('cant_verify');
    expect(none.sources).toEqual([]);
    const noCountry = runCheck('No bank statement needed', data({}, { countryFacts: [de] }), NOW).results[0];
    expect(noCountry.verdict).toBe('cant_verify');
    expect(noCountry.explanation).toContain("We couldn't tell which country");
  });

  it("today's data: UK and Germany differ, Germany in PKR is checked against the SBP rate, Switzerland is not decided", () => {
    const uk = check('No bank statement needed for UK', seed, 'visa_money');
    expect(uk.verdict).toBe('conflict');
    expect(uk.sources[0].source_url).toBe('https://www.gov.uk/student-visa/money');
    expect(check('No blocked account for Germany', seed, 'visa_money').verdict).toBe('conflict');
    // Germany now has a dated State Bank of Pakistan EUR rate, so 5 lakh can be compared with EUR 11,904 and is refuted.
    expect(check('Germany blocked account is only 5 lakh', seed, 'visa_money').verdict).toBe('conflict');
    expect(check('No bank statement needed for Switzerland', seed, 'visa_money').verdict).toBe('cant_verify');
    // "Show only 10 lakh" for a UK university: the UK rule gives no single amount, so it is not decided.
    const show = check('Show only 10 lakh, Oxford Brookes', seed, 'visa_money');
    expect(show.verdict).toBe('cant_verify');
    expect(show.about).toEqual(['United Kingdom']);
  });

  it("today's data: a German visa claim never borrows a UK university named in another sentence", () => {
    const r = check('Oxford Brookes is a good choice. Germany blocked account is only 5 lakh.', seed, 'visa_money');
    expect(r.about).toEqual(['Germany']);
    expect(r.sources.every((s) => !s.label.includes('Brookes'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* #5 Pakistan notices                                                 */
/* ------------------------------------------------------------------ */

describe('#5 a programme notice that limits Pakistan applicants', () => {
  const notice = verified('Fixture notice for Pakistan applicants: no offers beyond a fixture date.', 1, 'https://fixture.example.edu/apply');
  const p = { intake: verified('January 2027, September 2027'), deadline: verified('2027-03-15'), status_note: notice };

  it("an intake or deadline that would match is can't verify, with the notice quoted", () => {
    for (const text of ['Fixture University January 2027 intake is open', 'Fixture University deadline is 15 March 2027']) {
      const r = check(text, data(p), 'deadline');
      expect(r.verdict, text).toBe('cant_verify');
      expect(r.explanation, text).toContain('“Fixture snippet for "Fixture notice for Pakistan applicants: no offers beyond a fixture date."”');
      expect(r.sources.map((s) => s.label), text).toContain('Fixture University — MSc Fixture Computing: notice for applicants');
    }
  });

  it('without the notice the same claims match; a neutral notice changes nothing', () => {
    expect(check('Fixture University January 2027 intake is open', data({ ...p, status_note: unverified() }), 'deadline').verdict).toBe('matches');
    expect(check('Fixture University January 2027 intake is open', data({ ...p, status_note: verified('Fixture: interviews are online.') }), 'deadline').verdict).toBe(
      'matches',
    );
  });

  it('a difference stays a difference; a ruled-out programme never matches an intake', () => {
    expect(check('Fixture University deadline is 30 April 2027', data(p), 'deadline').verdict).toBe('conflict');
    expect(check('Fixture University January 2027 intake is open', data({ ...p, status_note: unverified(), status: 'ruled_out' }), 'deadline').verdict).toBe(
      'cant_verify',
    );
  });

  it('an admission promise quotes the notice in the answer', () => {
    const r = check('Guaranteed admission at Fixture University', data(p), 'guaranteed_admission');
    expect(r.verdict).toBe('cant_verify');
    expect(r.explanation).toContain('no offers beyond a fixture date');
    expect(r.sources[0].label).toBe('Fixture University — MSc Fixture Computing: notice for applicants');
  });

  it("today's data: no green 'Matches' for Brookes January 2027, with the 23 October notice quoted", () => {
    const run = runCheck('Guaranteed admission at Oxford Brookes for January 2027 intake', seed, NOW);
    expect(run.results.map((r) => r.verdict)).not.toContain('matches');
    const intake = run.results.find((r) => r.type === 'deadline')!;
    expect(intake.verdict).toBe('cant_verify');
    expect(intake.explanation).toContain('No offers beyond 23 October 2026');
    const promise = run.results.find((r) => r.type === 'guaranteed_admission')!;
    expect(promise.explanation).toContain('No offers beyond 23 October 2026');
    // "will give you admission" is an admission promise too.
    expect(runCheck('Oxford Brookes will give you admission for January 2027 with 2.5 CGPA', seed, NOW).results.map((r) => r.type)).toContain(
      'guaranteed_admission',
    );
  });
});

/* ------------------------------------------------------------------ */
/* #21 Did you mean …?                                                 */
/* ------------------------------------------------------------------ */

describe('#21 "Did you mean …?" for a misspelled university', () => {
  it.each([
    ['Brooks mein admission pakka hai, 2.5 CGPA chal jayega, total kharcha sirf 25 lac', 'Brooks', 'Oxford Brookes University', 'Brookes mein admission'],
    ['Imprial ka fee sirf £20k per year hai', 'Imprial', 'Imperial College London', 'Imperial ka fee'],
    ['Toranto deadline', 'Toranto', 'University of Toronto', 'Toronto University deadline'],
    ['Oxford Brooks fees', 'Brooks', 'Oxford Brookes University', 'Oxford Brookes fees'],
    ['Carnagie Mellon accepts 3.0 CGPA', 'Carnagie', 'Carnegie Mellon University', 'Carnegie Mellon accepts'],
  ])('%s', (text, typed, label, corrected) => {
    const s = suggestInstitution(text, seed.institutions)!;
    expect(s).toMatchObject({ typed, label });
    expect(s.correctedText).toContain(corrected);
    // The corrected text now matches the university exactly.
    const rerun = runCheck(s.correctedText, seed, NOW);
    expect(rerun.claims.some((c) => c.institutionIds.includes(s.institutionId))).toBe(true);
    expect(rerun.suggestion).toBeNull();
  });

  it.each(['tum ki fees', 'Spring intake at UCCS', 'Urban planning in Germany', 'Zürich deadline', 'Imperial and Imprial', 'Oxford Brookes fees', 'PR in 2 years'])(
    'no suggestion: %s',
    (text) => {
      expect(suggestInstitution(text, seed.institutions)).toBeNull();
    },
  );

  it('never checks against the guessed university', () => {
    const run = runCheck('Brooks mein admission pakka hai, 2.5 CGPA chal jayega', seed, NOW);
    expect(run.suggestion?.label).toBe('Oxford Brookes University');
    for (const r of run.results) expect(r.about).toEqual([]);
  });

  it('two equally close names give no suggestion', () => {
    const institutions = [makeInstitution({ id: 'a', name: 'Merton Institute' }), makeInstitution({ id: 'b', name: 'Morton Institute' })];
    expect(suggestInstitution('Marton fees', institutions)).toBeNull();
    expect(suggestInstitution('Mertn fees', institutions)?.institutionId).toBe('a');
  });
});

/* ------------------------------------------------------------------ */
/* Safety                                                              */
/* ------------------------------------------------------------------ */

describe('new claim types stay safe', () => {
  const texts = [
    'TUM does not require GRE. Brookes requires IELTS 5.5 only. Imperial: no IELTS needed. You can apply to NYIT with 2.5 CGPA.',
    'No bank statement needed for UK. Germany blocked account is only 5 lakh. Guaranteed admission at Oxford Brookes for January 2027 intake.',
    'ETH deadline is 30 November 2027. Brooks mein admission pakka hai.',
  ];
  it.each(texts)('%s', (text) => {
    const run = runCheck(text, seed, DEC_2);
    for (const r of run.results) {
      expect(r.explanation).not.toMatch(ACCUSING);
      expect(r.explanation).not.toMatch(PROBABILITY);
      expect(r.questionsToAsk.length).toBeGreaterThan(0);
      expect(r.questionsToAsk.length).toBeLessThanOrEqual(3);
      for (const s of r.sources) expect(['Verified', 'Likely', 'Conflict']).toContain(s.confidence);
      expect(JSON.stringify(r)).not.toContain('Proposed from the official page');
    }
  });
});
