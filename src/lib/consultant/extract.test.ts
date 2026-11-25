import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '../data/seed-source';
import { makeInstitution, makeProgram } from '../test-fixtures';
import { buildAliasPatterns, derivedNames, findCountries, findInstitutions, normalizeText } from './aliases';
import {
  MAX_CLAIMS,
  MAX_INPUT_CHARS,
  cleanInput,
  detectTypes,
  extractClaims,
  parseDate,
  parseDurationMonths,
  parseGpa,
  parseMoney,
  redactPersonalNumbers,
  splitClauses,
  splitSentences,
  type Claim,
  type ClaimType,
  type ExtractData,
} from './extract';

const seed = loadSeedDataset();
const fixtureData = {
  institutions: [makeInstitution()],
  programs: [makeProgram()],
};

function types(text: string, data: ExtractData = seed): ClaimType[] {
  return extractClaims(text, data).map((c) => c.type);
}

function first(text: string, type: ClaimType, data: ExtractData = seed): Claim {
  const c = extractClaims(text, data).find((x) => x.type === type);
  if (!c) throw new Error(`No ${type} claim in: ${text}`);
  return c;
}

describe('claim types', () => {
  it.each([
    'Guaranteed admission at Oxford Brookes',
    '100% admission for you',
    'Sure admission, no problem',
    'Your seat is confirmed',
    'Unconditional offer guaranteed',
  ])('guaranteed_admission: %s', (text) => {
    expect(types(text)).toContain('guaranteed_admission');
  });

  it.each([
    ['no IELTS needed', 'IELTS'],
    ['You can apply without IELTS', 'IELTS'],
    ['IELTS waiver available', 'IELTS'],
    ['No English test required', 'an English test'],
    ['TOEFL is not required', 'TOEFL'],
    ["You don't need IELTS", 'IELTS'],
  ])('no_language_test: %s', (text, test) => {
    const c = first(text, 'no_language_test');
    expect(c.test).toBe(test);
  });

  it('gpa_requirement: "accepts 2.5 CGPA"', () => {
    const c = first('Cardiff accepts 2.5 CGPA', 'gpa_requirement');
    expect(c.gpa).toEqual({ value: 2.5, scale: 'cgpa_4' });
    expect(c.gpaMode).toBe('accepts');
  });

  it('gpa_requirement: "low CGPA ok"', () => {
    const c = first('Low CGPA ok for this university', 'gpa_requirement');
    expect(c.lowGpa).toBe(true);
    expect(c.gpa).toBeNull();
  });

  it('gpa_requirement: a stated minimum', () => {
    const c = first('Minimum CGPA required is 2.8/4', 'gpa_requirement');
    expect(c.gpa).toEqual({ value: 2.8, scale: 'cgpa_4' });
    expect(c.gpaMode).toBe('minimum');
  });

  it('a CGPA number alone is not a claim about requirements', () => {
    expect(types('My CGPA is 2.5')).not.toContain('gpa_requirement');
  });

  it('total_cost in lakh', () => {
    const c = first('Total cost 25 lakh', 'total_cost');
    expect(c.money).toMatchObject({ amount: 2_500_000, currency: 'PKR', period: 'total' });
  });

  it('total_cost in crore', () => {
    const c = first('Everything included, only 1.2 crore', 'total_cost');
    expect(c.money).toMatchObject({ amount: 12_000_000, currency: 'PKR', period: 'total' });
  });

  it.each([
    ['Tuition is £15,000 per year', { amount: 15_000, currency: 'GBP', period: 'year' }],
    ['Tuition fee 12k EUR a year', { amount: 12_000, currency: 'EUR', period: 'year' }],
    ['Tuition USD 30,000 per year', { amount: 30_000, currency: 'USD', period: 'year' }],
    ['Tuition CAD 25,000 per semester', { amount: 25_000, currency: 'CAD', period: 'semester' }],
    ['Tuition 18,000 euros', { amount: 18_000, currency: 'EUR', period: null }],
  ])('tuition: %s', (text, money) => {
    expect(first(text, 'tuition').money).toMatchObject(money);
  });

  it('tuition: "free"', () => {
    const c = first('Tuition is free in Germany', 'tuition');
    expect(c.money).toMatchObject({ amount: 0, currency: null });
  });

  it('agent fees and bank statements are not programme costs', () => {
    expect(types('Our service fee is 3 lakh')).not.toContain('total_cost');
    expect(types('Bank statement of 40 lakh needed')).not.toContain('total_cost');
  });

  it('deadline with a date', () => {
    const c = first('Deadline is 31 May', 'deadline');
    expect(c.date).toMatchObject({ day: 31, month: 5, year: null });
    expect(c.dateRole).toBe('deadline');
  });

  it('deadline: "apply by 15 March 2027"', () => {
    const c = first('Apply by 15 March 2027', 'deadline');
    expect(c.date).toMatchObject({ day: 15, month: 3, year: 2027 });
  });

  it('deadline: pressure to pay now', () => {
    const c = first('Only 2 seats left so pay today', 'deadline');
    expect(c.dateRole).toBe('urgency');
  });

  it('deadline: intake start', () => {
    const c = first('Classes start in September 2027', 'deadline');
    expect(c.dateRole).toBe('intake');
    expect(c.date).toMatchObject({ month: 9, year: 2027 });
  });

  it.each(['Full scholarship confirmed', 'Scholarship guaranteed for you', '100% scholarship'])('scholarship_guaranteed: %s', (text) => {
    expect(types(text)).toContain('scholarship_guaranteed');
  });

  it.each(['100% visa', 'Visa guaranteed', 'Visa is sure, no refusal'])('visa_guaranteed: %s', (text) => {
    expect(types(text)).toContain('visa_guaranteed');
  });

  it('pr_or_citizenship_time: PR in 2 years', () => {
    const c = first('PR in 2 years', 'pr_or_citizenship_time');
    expect(c.subject).toBe('pr');
    expect(c.months).toBe(24);
  });

  it('pr_or_citizenship_time: citizenship and passport', () => {
    expect(first('Citizenship in 3 years', 'pr_or_citizenship_time')).toMatchObject({ subject: 'citizenship', months: 36 });
    expect(first('German passport in 5 years', 'pr_or_citizenship_time')).toMatchObject({ subject: 'citizenship', months: 60 });
    expect(first('Permanent residency after 18 months', 'pr_or_citizenship_time')).toMatchObject({ subject: 'pr', months: 18 });
  });

  it('lower-case "pr" (Roman Urdu "par") is not PR unless a time phrase follows', () => {
    expect(types('Is pr baat karo')).not.toContain('pr_or_citizenship_time');
    expect(types('pr in 2 years')).toContain('pr_or_citizenship_time');
  });

  it('work_rights: post-study work N years', () => {
    expect(first('Post-study work 2 years', 'work_rights')).toMatchObject({ workKind: 'post_study', months: 24 });
    expect(first('Stay back of three years after graduation', 'work_rights')).toMatchObject({ workKind: 'post_study', months: 36 });
  });

  it('work_rights: unlimited work hours', () => {
    expect(first('Unlimited work hours while studying', 'work_rights')).toMatchObject({ workKind: 'during_study' });
  });

  it('a "graduate visa 2 years" claim is work rights, not a visa promise', () => {
    const t = types('Graduate visa 2 years');
    expect(t).toContain('work_rights');
    expect(t).not.toContain('visa_guaranteed');
  });

  it.each([
    ['Cardiff is HEC recognised', 'hec'],
    ['The degree is accredited', 'listed'],
    ['TUM is ranked top 50 in the world', 'ranked'],
    ['Wurzburg is H+ on anabin', 'anabin'],
  ])('recognition: %s', (text, kind) => {
    expect(first(text, 'recognition').recognitionKind).toBe(kind);
  });

  it('anabin marker is read', () => {
    expect(first('Wurzburg is H+ on anabin', 'recognition').anabinMarker).toBe('H+');
  });

  it('institution_mention when a sentence only names a university', () => {
    const claims = extractClaims('I want to apply to Cardiff University.', seed);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ type: 'institution_mention', institutionIds: ['cardiff'] });
  });

  it('other: a sentence with no known claim', () => {
    expect(types('The agent said the city is very safe for students')).toEqual(['other']);
  });

  it('very short fragments are ignored', () => {
    expect(extractClaims('ok thanks', seed)).toEqual([]);
    expect(extractClaims('', seed)).toEqual([]);
    expect(extractClaims('   ', seed)).toEqual([]);
  });
});

describe('the brief example', () => {
  const text = 'Guaranteed admission at Oxford Brookes, no IELTS needed, total cost 25 lakh, PR in 2 years';
  const claims = extractClaims(text, seed);

  it('splits into four claims in order', () => {
    expect(claims.map((c) => c.type)).toEqual(['guaranteed_admission', 'no_language_test', 'total_cost', 'pr_or_citizenship_time']);
    expect(claims.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('attaches Oxford Brookes, its programme and the UK to every claim', () => {
    for (const c of claims) {
      expect(c.institutionIds).toEqual(['oxford-brookes']);
      expect(c.programIds).toEqual(['brookes-msc-cs']);
      expect(c.countries).toEqual(['UK']);
    }
    expect(claims[0].contextFrom).toBe('clause');
    expect(claims[1].contextFrom).toBe('sentence');
  });

  it('reads 25 lakh as PKR 2,500,000', () => {
    expect(claims[2].money?.amount).toBe(2_500_000);
  });
});

describe('context', () => {
  it('uses the same sentence first, else the whole text', () => {
    const claims = extractClaims('Cardiff is a good choice. No IELTS needed. TUM accepts 2.5 CGPA.', seed);
    const lang = claims.find((c) => c.type === 'no_language_test')!;
    const gpa = claims.find((c) => c.type === 'gpa_requirement')!;
    // "No IELTS needed" names no university: it falls back to every university in the text.
    expect(lang.contextFrom).toBe('text');
    expect(lang.institutionIds).toEqual(['cardiff', 'tum']);
    expect(gpa.contextFrom).toBe('clause');
    expect(gpa.institutionIds).toEqual(['tum']);
    expect(gpa.countries).toEqual(['DE']);
  });

  it('a country named in the clause wins over the university country', () => {
    const c = first('Study at Cardiff, PR in 2 years in Canada', 'pr_or_citizenship_time');
    expect(c.countries).toEqual(['CA']);
  });

  it('no context at all', () => {
    const c = first('PR in 2 years', 'pr_or_citizenship_time');
    expect(c.institutionIds).toEqual([]);
    expect(c.countries).toEqual([]);
    expect(c.contextFrom).toBe('none');
  });

  it('fixture data: the programme of a named fixture institution is attached', () => {
    const c = first('Fixture University: no IELTS needed', 'no_language_test', fixtureData);
    expect(c.institutionIds).toEqual(['fixture-uni']);
    expect(c.programIds).toEqual(['fixture-msc-cs']);
  });

  it('a bare $ is CAD for a claim about Canada', () => {
    const c = first('Tuition at UofT in Canada is $40,000 per year', 'tuition');
    expect(c.money?.currency).toBe('CAD');
    expect(first('Tuition at CMU is $40,000 per year', 'tuition').money?.currency).toBe('USD');
  });
});

describe('aliases', () => {
  const patterns = buildAliasPatterns(seed.institutions);
  const find = (t: string) => findInstitutions(t, patterns);

  it.each([
    ['Admission at TUM', 'tum'],
    ['TU Munich is good', 'tum'],
    ['Brookes offer', 'oxford-brookes'],
    ['QMUL pre-masters', 'qmul'],
    ['Queen Mary London', 'qmul'],
    ['UofT MScAC', 'utoronto'],
    ['Universität Würzburg', 'uni-wuerzburg'],
    ['Wuerzburg', 'uni-wuerzburg'],
    ['Carnegie Mellon', 'cmu'],
    ['ETH Zurich', 'ethz'],
    ['LJMU', 'ljmu'],
    ['Imperial College London', 'imperial'],
  ])('%s -> %s', (text, id) => {
    expect(find(text)).toEqual([id]);
  });

  it('acronyms are case-sensitive (Roman Urdu "tum" = "you")', () => {
    expect(find('tum ko admission mil jayega')).toEqual([]);
    expect(find('usf')).toEqual([]);
    expect(find('USF')).toEqual(['usf']);
  });

  it('longer names win over shorter overlapping ones', () => {
    expect(find('Liverpool John Moores University')).toEqual(['ljmu']);
  });

  it('keeps the order of first mention and removes duplicates', () => {
    expect(find('TUM or Cardiff, or TUM again')).toEqual(['tum', 'cardiff']);
  });

  it('derivedNames drops notes in brackets, "The" and a trailing "University"', () => {
    expect(derivedNames('Fixture University')).toEqual(['Fixture University', 'Fixture']);
    expect(derivedNames('Demo Private University (fictional, for the demo persona)')).toContain('Demo Private');
  });

  it('countries', () => {
    expect(findCountries('Study in the UK or Germany')).toEqual(['UK', 'DE']);
    expect(findCountries('Canada and USA')).toEqual(['CA', 'US']);
    expect(findCountries('PR in the US')).toEqual(['US']);
    expect(findCountries('tell us more')).toEqual([]);
    expect(findCountries('Switzerland')).toEqual(['CH']);
  });

  it('normalizeText strips accents and smart quotes', () => {
    expect(normalizeText('Würzburg “quoted” – dash')).toBe('wurzburg "quoted" - dash');
  });
});

describe('number parsing', () => {
  it.each([
    ['25 lakh', 2_500_000],
    ['25 lac', 2_500_000],
    ['2.5 lakhs', 250_000],
    ['1.2 crore', 12_000_000],
    ['1 cr', 10_000_000],
    ['Rs. 25,00,000', 2_500_000],
    ['PKR 3,000,000', 3_000_000],
  ])('PKR: %s', (text, amount) => {
    expect(parseMoney(text)).toMatchObject({ amount, currency: 'PKR' });
  });

  it.each([
    ['£15,000', 15_000, 'GBP'],
    ['€12k', 12_000, 'EUR'],
    ['12.000 €', 12_000, 'EUR'],
    ['USD 30,000', 30_000, 'USD'],
    ['$30,000', 30_000, 'USD'],
    ['CAD 25,000', 25_000, 'CAD'],
    ['CHF 1,500', 1_500, 'CHF'],
    ['20,000 pounds', 20_000, 'GBP'],
  ])('foreign: %s', (text, amount, currency) => {
    expect(parseMoney(text)).toMatchObject({ amount, currency });
  });

  it('a bare number is not money', () => {
    expect(parseMoney('2 years')).toBeNull();
    expect(parseMoney('15000')).toBeNull();
  });

  it('durations', () => {
    expect(parseDurationMonths('in 2 years')).toBe(24);
    expect(parseDurationMonths('18 months')).toBe(18);
    expect(parseDurationMonths('two years')).toBe(24);
    expect(parseDurationMonths('1.5 years')).toBe(18);
    expect(parseDurationMonths('3 saal')).toBe(36);
    expect(parseDurationMonths('soon')).toBeNull();
  });

  it('dates', () => {
    expect(parseDate('31 May')).toMatchObject({ day: 31, month: 5, year: null });
    expect(parseDate('March 15, 2027')).toMatchObject({ day: 15, month: 3, year: 2027 });
    expect(parseDate('2027-01-12')).toMatchObject({ day: 12, month: 1, year: 2027 });
    expect(parseDate('15/03/2027')).toMatchObject({ day: 15, month: 3, year: 2027 });
    expect(parseDate('June 2027')).toMatchObject({ day: null, month: 6, year: 2027 });
    expect(parseDate('nothing here')).toBeNull();
  });

  it('grades', () => {
    expect(parseGpa('2.5 CGPA')).toEqual({ value: 2.5, scale: 'cgpa_4' });
    expect(parseGpa('CGPA of 3.2/5')).toEqual({ value: 3.2, scale: 'cgpa_5' });
    expect(parseGpa('60% marks')).toEqual({ value: 60, scale: 'percent' });
    expect(parseGpa('CGPA 7')).toBeNull();
  });
});

describe('splitting', () => {
  it('keeps decimal points and Pakistani digit groups whole', () => {
    expect(splitSentences('Total 1.2 crore. Rs. 25,00,000 tuition!')).toEqual(['Total 1.2 crore', 'Rs. 25,00,000 tuition']);
    expect(splitClauses('Rs 25,00,000, no IELTS; PR in 2 years')).toEqual(['Rs 25,00,000', 'no IELTS', 'PR in 2 years']);
  });

  it('splits lines and bullets', () => {
    expect(splitSentences('- no IELTS\n- PR in 2 years\n• visa guaranteed')).toEqual(['no IELTS', 'PR in 2 years', 'visa guaranteed']);
  });

  it('splits on "and" only when both parts are claims', () => {
    const c = extractClaims('No IELTS and guaranteed admission', seed);
    expect(c.map((x) => [x.type, x.text])).toEqual([
      ['no_language_test', 'No IELTS'],
      ['guaranteed_admission', 'guaranteed admission'],
    ]);
    expect(detectTypes('tuition and living')).toEqual([]);
  });
});

describe('personal data and limits', () => {
  it('removes CNIC, passport and phone numbers and emails', () => {
    const out = redactPersonalNumbers('CNIC 35202-1234567-1, passport AB1234567, call 0300-1234567 or a@b.com');
    expect(out).not.toMatch(/\d{5}-\d{7}/);
    expect(out).not.toContain('AB1234567');
    expect(out).not.toContain('0300');
    expect(out).not.toContain('a@b.com');
    expect(out).toContain('[ID number removed]');
  });

  it('keeps money amounts', () => {
    expect(redactPersonalNumbers('Rs 25,00,000 and 1.2 crore')).toBe('Rs 25,00,000 and 1.2 crore');
  });

  it(`caps input at ${MAX_INPUT_CHARS} characters`, () => {
    expect(cleanInput('a'.repeat(5000))).toHaveLength(MAX_INPUT_CHARS);
    expect(cleanInput(null)).toBe('');
  });

  it(`returns at most ${MAX_CLAIMS} claims`, () => {
    const text = Array.from({ length: 40 }, (_, i) => `PR in ${i + 1} years`).join('. ');
    expect(extractClaims(text, seed)).toHaveLength(MAX_CLAIMS);
  });

  it('claim text never contains a removed number', () => {
    const claims = extractClaims('My passport AB1234567. No IELTS needed at Cardiff.', seed);
    for (const c of claims) expect(c.text + c.sentence).not.toContain('AB1234567');
  });
});

/* ------------------------------------------------------------------ */
/* Feasibility wave: money (#20), new claim types (#6), visa money     */
/* ------------------------------------------------------------------ */

describe('#20 Pakistani amounts: crore + lakh, hazar, short forms', () => {
  it.each([
    ['1 crore 20 lakh total', 12_000_000, 'PKR', '1 crore 20 lakh'],
    ['1 crore aur 20 lac sab kuch', 12_000_000, 'PKR', '1 crore aur 20 lac'],
    ['Rs 1 crore 20 lakh', 12_000_000, 'PKR', 'rs 1 crore 20 lakh'],
    ['1 crore 20 lakh 50 hazar', 12_050_000, 'PKR', '1 crore 20 lakh 50 hazar'],
    ['2 lakh 50 hazar', 250_000, 'PKR', '2 lakh 50 hazar'],
    ['2 lakh 50 thousand', 250_000, 'PKR', '2 lakh 50 thousand'],
    ['50 hazar per month', 50_000, 'PKR', '50 hazar'],
    ['50 hazaar', 50_000, 'PKR', '50 hazaar'],
    ['1.5cr', 15_000_000, 'PKR', '1.5cr'],
    ['25 lac', 2_500_000, 'PKR', '25 lac'],
    ['Rs 2500000', 2_500_000, 'PKR', 'rs 2500000'],
    ['$20k', 20_000, 'USD', '$20k'],
    ['€12,000', 12_000, 'EUR', '€12,000'],
    ['GBP 15,000', 15_000, 'GBP', 'gbp 15,000'],
  ])('%s', (text, amount, currency, raw) => {
    expect(parseMoney(text)).toMatchObject({ amount, currency, raw });
  });

  it('periods: "per month" and "sab kuch" (everything)', () => {
    expect(parseMoney('50 hazar per month')?.period).toBe('month');
    expect(parseMoney('1 crore 20 lakh sab kuch')?.period).toBe('total');
  });

  it('never adds a unit that is not smaller ("20 lakh 30 lakh" stays 20 lakh)', () => {
    expect(parseMoney('20 lakh 30 lakh')).toMatchObject({ amount: 2_000_000, raw: '20 lakh' });
    expect(parseMoney('50 hazar 2 lakh')).toMatchObject({ amount: 50_000 });
  });

  it('existing readings are unchanged', () => {
    expect(parseMoney('1.2 crore')).toMatchObject({ amount: 12_000_000, raw: '1.2 crore' });
    expect(parseMoney('25 lakh')).toMatchObject({ amount: 2_500_000, raw: '25 lakh' });
    expect(parseMoney('50 thousand')).toBeNull();
  });

  it('"1 crore aur 20 lakh" stays one claim, read as 12,000,000', () => {
    const text = 'Oxford Brookes: total 1 crore aur 20 lakh sab kuch';
    expect(extractClaims(text, seed).filter((c) => c.type === 'total_cost')).toHaveLength(1);
    expect(first(text, 'total_cost').money).toMatchObject({ amount: 12_000_000, period: 'total' });
  });
});

describe('#6 new claim types', () => {
  it.each([
    ['TUM MSc Informatics does not require GRE for Pakistani students', 'GRE'],
    ['No GRE needed', 'GRE'],
    ['GRE is not required', 'GRE'],
    ['GMAT is waived for you', 'GMAT'],
    ['GRE ki zaroorat nahi', 'GRE'],
    ['You can apply without GRE', 'GRE'],
  ])('tests: %s', (text, test) => {
    expect(first(text, 'tests').test).toBe(test);
  });

  it('a GRE score alone is not a "tests" claim', () => {
    expect(types('My GRE score is 320')).not.toContain('tests');
  });

  it.each([
    ['IELTS 5.5 is enough', 'IELTS', 5.5, 'accepts'],
    ['Oxford Brookes MSc requires IELTS 5.5 only', 'IELTS', 5.5, 'accepts'],
    ['Brookes requires IELTS 7', 'IELTS', 7, 'minimum'],
    ['6.5 bands in IELTS is fine', 'IELTS', 6.5, 'accepts'],
    ['TOEFL 80 chalega', 'TOEFL', 80, 'accepts'],
    ['Minimum TOEFL iBT score required is 4.0', 'TOEFL', 4, 'minimum'],
  ])('language_score: %s', (text, test, score, mode) => {
    expect(first(text, 'language_score')).toMatchObject({ test, score, scoreMode: mode });
  });

  it('no score claim: a "no IELTS" claim, a CGPA next to IELTS, an impossible band, or no claim word', () => {
    expect(types('No IELTS needed')).toEqual(['no_language_test']);
    expect(types('IELTS waiver with 2.5 CGPA')).not.toContain('language_score');
    expect(types('IELTS 9.5 is enough')).not.toContain('language_score');
    expect(types('IELTS 6.5 at Brookes')).not.toContain('language_score');
  });

  it.each([
    ['No bank statement needed', 'none', 'general'],
    ['Bank statement ki zaroorat nahi', 'none', 'general'],
    ['No blocked account for Germany', 'none', 'blocked_account'],
    ['You do not need to show funds', 'none', 'general'],
    ['Show only 10 lakh', 'amount', 'general'],
    ['Germany blocked account is only 5 lakh', 'amount', 'blocked_account'],
    ['Bank statement of 40 lakh needed', 'amount', 'general'],
  ])('visa_money: %s', (text, kind, item) => {
    const c = first(text, 'visa_money');
    expect(c.fundsKind).toBe(kind);
    expect(c.fundsItem).toBe(item);
    expect(types(text)).not.toContain('total_cost');
  });

  it('visa money amounts keep their reading', () => {
    expect(first('Show only 10 lakh', 'visa_money').money).toMatchObject({ amount: 1_000_000, currency: 'PKR' });
  });

  it('a tuition deposit, scholarship funds or "we will show you" is not visa money', () => {
    expect(types('Pay a deposit of 3 lakh to confirm your seat')).not.toContain('visa_money');
    expect(types('The scholarship funds 10 lakh of your fees')).not.toContain('visa_money');
    expect(types('Tuition is 10 lakh, we will show you the fee page')).not.toContain('visa_money');
    expect(types('Scholarship confirmed, no bank statement needed')).toContain('visa_money');
  });

  it.each(['You can apply to Oxford Brookes with 2.5 CGPA', 'With 2.5 CGPA you can apply', 'You can apply for Brookes with a 2.5 GPA'])(
    'gpa_requirement (accepts): %s',
    (text) => {
      const c = first(text, 'gpa_requirement');
      expect(c.gpaMode).toBe('accepts');
      expect(c.gpa).toEqual({ value: 2.5, scale: 'cgpa_4' });
    },
  );

  it('"will give you admission" is an admission promise', () => {
    expect(types('Oxford Brookes will give you admission for January 2027')).toContain('guaranteed_admission');
  });

  it('reads "percentage required is 60%"', () => {
    expect(parseGpa('Minimum percentage required is 60%')).toEqual({ value: 60, scale: 'percent' });
  });
});

describe('context from the whole text keeps only universities in a country the sentence names', () => {
  it('a German visa claim does not borrow a UK university from another sentence', () => {
    const c = first('Oxford Brookes is a good choice. Germany blocked account is only 5 lakh.', 'visa_money');
    expect(c.institutionIds).toEqual([]);
    expect(c.contextFrom).toBe('none');
    expect(c.countries).toEqual(['DE']);
  });

  it('a university in the named country is still used', () => {
    const c = first('TUM is a good choice. Tuition is free in Germany.', 'tuition');
    expect(c.institutionIds).toEqual(['tum']);
    expect(c.contextFrom).toBe('text');
  });
});
