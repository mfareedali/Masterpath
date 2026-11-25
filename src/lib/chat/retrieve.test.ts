import { describe, expect, it } from 'vitest';
import { computeConfidence } from '@/lib/confidence';
import { FIXED_NOW, conflicting, likely, verified, loadEmptySeedDataset } from '@/lib/test-fixtures';
import { toPublicRow } from './answer';
import { detectFields, normalizeQuestion } from './fields';
import { detectCountries, detectInstitutions, formatCountryValue, retrieve } from './retrieve';
import { countryFact, fixtureDataset } from './test-helpers';

const seed = loadEmptySeedDataset();

function fieldsOf(q: string) {
  return detectFields(normalizeQuestion(q)).fields;
}

describe('normalizeQuestion', () => {
  it('lower-cases, strips accents and punctuation, keeps %', () => {
    expect(normalizeQuestion('Würzburg’s  MSc? 70%!')).toBe(' wurzburgs msc 70% ');
    expect(normalizeQuestion('Straße')).toBe(' strasse ');
  });
});

describe('detectFields — keyword map from the brief', () => {
  it.each([
    ['What is the deadline?', 'deadline'],
    ['What is the last date to apply?', 'deadline'],
    ['When is the closing date?', 'deadline'],
    ['How much is the tuition fee?', 'tuition'],
    ['What are the fees?', 'tuition'],
    ['What is the cost of living?', 'living_cost'],
    ['How much does it cost?', 'living_cost'],
    ['What IELTS score do I need?', 'language_req'],
    ['Is TOEFL accepted?', 'language_req'],
    ['Do I need an English test?', 'language_req'],
    ['What GPA do I need?', 'min_gpa_rule'],
    ['Minimum CGPA?', 'min_gpa_rule'],
    ['What grade is required?', 'min_gpa_rule'],
    ['What is the minimum?', 'min_gpa_rule'],
    ['How many LORs?', 'lor_count'],
    ['How many recommendation letters?', 'lor_count'],
    ['What should my SOP say?', 'sop_requirements'],
    ['Is a personal statement needed?', 'sop_requirements'],
    ['Do they want a CV?', 'cv_requirements'],
    ['Resume format?', 'cv_requirements'],
    ['Is the GRE required?', 'tests_required'],
    ['Any entrance test?', 'tests_required'],
    ['How do I get citizenship?', 'citizenship_rule'],
    ['When can I get a passport there?', 'citizenship_rule'],
    ['What are the naturalisation rules?', 'citizenship_rule'],
    ['Can I work after my degree?', 'post_study_work'],
    ['How long is OPT?', 'post_study_work'],
    ['What is the graduate visa?', 'post_study_work'],
    ['PGWP length?', 'post_study_work'],
    ['Post-study work rights?', 'post_study_work'],
    ['How do I get PR?', 'pr_route'],
    ['What is the settlement route?', 'pr_route'],
    ['Permanent residence after study?', 'pr_route'],
    ['Is dual nationality allowed?', 'dual_nationality_destination'],
    ['Can I keep my Pakistani passport?', 'pakistan_dual_nationality'],
    ['Any scholarships?', 'scholarship_info'],
    ['What is the duration?', 'duration_months'],
    ['How long is the program?', 'duration_months'],
    ['When is the intake?', 'intake'],
  ])('%s -> includes %s', (q, field) => {
    expect(fieldsOf(q)).toContain(field);
  });

  it('a strong match drops weak ones ("minimum IELTS" is a language question, not a CGPA one)', () => {
    expect(fieldsOf('What is the minimum IELTS?')).toEqual(['language_req']);
    expect(fieldsOf('How long can I work in the UK after my Masters?')).toEqual(['post_study_work']);
  });

  it('"application fee" is not misread as tuition — it is a topic we have no data for', () => {
    expect(detectFields(normalizeQuestion('What is the application fee?'))).toEqual({ fields: [], unsupportedTopic: 'application fee' });
  });

  it('dual nationality maps to both the destination rule and Pakistan’s rule', () => {
    expect(fieldsOf('Can I have dual nationality?')).toEqual(['dual_nationality_destination', 'pakistan_dual_nationality']);
  });

  it('no field -> empty list (a general question)', () => {
    expect(fieldsOf('Tell me about TUM')).toEqual([]);
  });

  it.each([
    'How long can I stay in Germany after my Masters?',
    'How long can I stay in the UK after graduation?',
    'Can I stay in Canada after my studies?',
    'How many years can I remain in the UK after my degree?',
    'Can I live in Germany after I finish my course?',
    'What happens after graduation?',
  ])('"%s" asks about the work-after-study rule, never the programme length', (q) => {
    expect(fieldsOf(q)).toEqual(['post_study_work']);
  });

  it('"how long" / "how many years" next to an immigration rule is about that rule', () => {
    expect(fieldsOf('How many years until I can get UK citizenship?')).toEqual(['citizenship_rule', 'citizenship_update']);
    expect(fieldsOf('How long does PR take in Canada?')).toEqual(['pr_route']);
    expect(fieldsOf('How long is the programme?')).toEqual(['duration_months']); // still programme length
    expect(fieldsOf('Where will I live after the course starts?')).not.toContain('post_study_work');
    expect(fieldsOf('What is the living cost after my degree?')).toEqual(['living_cost']);
  });

  it.each([
    'Can I apply to Imperial MSc Computing with a BS Computer Science degree?',
    'Am I eligible for Imperial MSc Computing?',
    'Who can apply to the QMUL pre-masters?',
    'Who is this course for?',
    'Is Imperial MSc Computing a conversion course?',
    'I have a BSCS, can I apply to Imperial?',
  ])('"%s" includes who the course is for (eligibility_note)', (q) => {
    expect(fieldsOf(q)[0]).toBe('eligibility_note');
  });

  it('"eligible for a scholarship / PR" stays a scholarship / PR question', () => {
    expect(fieldsOf('Would I be eligible for scholarships at TUM?')).toEqual(['scholarship_info']);
    expect(fieldsOf('Will I be eligible for PR after 5 years?')).toEqual(['pr_route']);
  });

  it('the refusal demo question is NOT an eligibility question', () => {
    expect(fieldsOf('What is the deadline for Imperial MSc Computing?')).toEqual(['deadline']);
  });

  it('"100% scholarship" and "tuition waiver" are funding questions', () => {
    expect(fieldsOf('Does TUM offer a 100% scholarship?')).toEqual(['scholarship_info']);
    expect(fieldsOf('Is a 100 percent tuition waiver available at USF?')).toEqual(['scholarship_info']);
  });
});

describe('detectInstitutions — aliases from the brief', () => {
  it.each([
    ['TUM', 'tum'],
    ['tu munich', 'tum'],
    ['ETH', 'ethz'],
    ['Wurzburg', 'uni-wuerzburg'],
    ['Wuerzburg', 'uni-wuerzburg'],
    ['Würzburg', 'uni-wuerzburg'],
    ['Imperial', 'imperial'],
    ['Cardiff', 'cardiff'],
    ['Brookes', 'oxford-brookes'],
    ['QMUL', 'qmul'],
    ['Queen Mary', 'qmul'],
    ['LJMU', 'ljmu'],
    ['Toronto', 'utoronto'],
    ['MScAC', 'utoronto'],
    ['CMU', 'cmu'],
    ['Carnegie Mellon', 'cmu'],
    ['UIUC', 'uiuc'],
    ['Illinois', 'uiuc'],
    ['CSUDH', 'csudh'],
    ['Dominguez Hills', 'csudh'],
    ['NYIT', 'nyit'],
    ['USF', 'usf'],
    ['South Florida', 'usf'],
    ['UCCS', 'uccs'],
  ])('%s -> %s', (name, id) => {
    expect(detectInstitutions(normalizeQuestion(`What is the deadline at ${name}?`), seed.institutions)).toEqual([id]);
  });

  it('does not match inside other words', () => {
    expect(detectInstitutions(normalizeQuestion('What about ethics or customs?'), seed.institutions)).toEqual([]);
  });

  it('never matches the home (Pakistani) university', () => {
    expect(detectInstitutions(normalizeQuestion('Demo Private University'), seed.institutions)).toEqual([]);
  });
});

describe('detectCountries', () => {
  it('names and adjectives', () => {
    expect(detectCountries('Study in Germany or the UK?', normalizeQuestion('Study in Germany or the UK?')).sort()).toEqual(['DE', 'UK']);
    expect(detectCountries('Canadian PR', normalizeQuestion('Canadian PR'))).toEqual(['CA']);
  });

  it('"US" only in capitals, so the pronoun "us" never matches', () => {
    expect(detectCountries('Tell us about OPT', normalizeQuestion('Tell us about OPT'))).toEqual([]);
    expect(detectCountries('OPT in the US', normalizeQuestion('OPT in the US'))).toEqual(['US']);
    expect(detectCountries('OPT in the U.S.', normalizeQuestion('OPT in the U.S.'))).toEqual(['US']);
  });
});

describe('retrieve — rows straight from the data, confidence computed', () => {
  it('TUM deadline in the seed: one row, value null, Unverified, official page = TUM homepage', () => {
    const r = retrieve('What is the application deadline for TUM MSc Informatics?', {}, seed, FIXED_NOW);
    expect(r.fields).toEqual(['deadline']);
    expect(r.programIds).toEqual(['tum-msc-informatics']);
    expect(r.rows).toEqual([
      {
        id: 'tum-msc-informatics:deadline',
        entity: 'program',
        entity_id: 'tum-msc-informatics',
        entity_name: 'MSc Informatics at Technical University of Munich',
        field: 'deadline',
        label: 'Application deadline',
        value: null,
        confidence: 'Unverified',
        source_url: null,
        evidence_snippet: null,
        fetched_at: null,
        official_url: 'https://www.tum.de',
      },
    ]);
  });

  it('never invents a program value: every program row in the seed is null', () => {
    const r = retrieve('Tell me about CMU', {}, seed, FIXED_NOW);
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.every((row) => row.value === null && row.confidence === 'Unverified')).toBe(true);
  });

  it('country rows keep the computed confidence of the seed (summary basis -> Likely)', () => {
    const r = retrieve('How long can I work in the UK after my Masters?', {}, seed, FIXED_NOW);
    const fact = seed.countryFacts.find((f) => f.id === 'uk-post-study-work')!;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      id: 'uk-post-study-work',
      entity: 'country',
      entity_name: 'United Kingdom',
      confidence: computeConfidence(fact, FIXED_NOW),
      value: formatCountryValue(fact.value, fact.note),
      source_url: fact.source_url,
    });
    expect(r.rows[0].value!.startsWith(fact.value!.text)).toBe(true);
  });

  it('a secondary fact (recent citizenship change) is only added when the database has it', () => {
    const de = retrieve('German citizenship rules?', {}, seed, FIXED_NOW).rows.map((x) => x.id);
    expect(de).toEqual(['de-citizenship-rule', 'de-citizenship-update']);
    const ca = retrieve('Canada citizenship rules?', {}, seed, FIXED_NOW).rows.map((x) => x.id);
    expect(ca).toEqual(['ca-citizenship-rule']);
  });

  it('Pakistan’s own dual-nationality rule is looked up for PK, the destination rule for the named country', () => {
    const r = retrieve('Can I keep my Pakistani nationality if I become German?', {}, seed, FIXED_NOW);
    expect(r.rows.map((x) => x.id)).toEqual(['de-dual-nationality-destination', 'pk-pakistan-dual-nationality']);
  });

  it('scope: programId is the default program, but a named university wins', () => {
    expect(retrieve('Deadline?', { programId: 'cardiff-msc-cs' }, seed, FIXED_NOW).programIds).toEqual(['cardiff-msc-cs']);
    expect(retrieve('Deadline at Imperial?', { programId: 'cardiff-msc-cs' }, seed, FIXED_NOW).programIds).toEqual(['imperial-msc-computing']);
  });

  it('scope: country is the default country when the question names none', () => {
    const r = retrieve('How long can I work after study?', { country: 'us' }, seed, FIXED_NOW);
    expect(r.rows.map((x) => x.id)).toEqual(['us-post-study-work']);
  });

  it('a field with a country but no program -> that country’s active programs (+ typical cost for cost questions)', () => {
    const r = retrieve('What is the tuition in Germany?', {}, seed, FIXED_NOW);
    expect(r.rows.map((x) => x.id)).toEqual(['tum-msc-informatics:tuition', 'wuerzburg-msc-cs:tuition', 'de-tuition-typical']);
  });

  it('ruled-out programs are only included when named, with their status first', () => {
    const all = retrieve('What is the deadline in the UK?', {}, seed, FIXED_NOW).programIds;
    expect(all).toEqual([]);
    const rows = retrieve('What is the deadline in the UK?', {}, seed, FIXED_NOW).rows.map((x) => x.entity_id);
    expect(rows).not.toContain('ljmu-msc-cs');
    expect(retrieve('LJMU deadline', {}, seed, FIXED_NOW).rows.map((x) => x.field)).toEqual(['status_note', 'deadline']);
  });

  it('formats verified values as plain text from the data only', () => {
    const dataset = fixtureDataset({
      deadline: verified('2027-01-15'),
      tuition: verified({ amount: 1500, currency: 'GBP', period: 'year' }),
      duration_months: likely(24),
      lor_count: verified(2),
      min_gpa_rule: verified({ scale: 'cgpa_4', min: 3, text: 'Fixture minimum' }),
      language_req: verified({ ielts_overall: 6.5, toefl_ibt: null }),
    });
    const r = retrieve('Tell me about Fixture University: deadline, tuition, duration, LOR, GPA, IELTS', {}, dataset, FIXED_NOW);
    const byField = Object.fromEntries(r.rows.map((x) => [x.field, x.value]));
    expect(byField.deadline).toBe('15 Jan 2027 (52 days left)'); // status computed in code, FIXED_NOW = 24 Nov 2026
    expect(byField.tuition).toBe('£1,500 per year');
    expect(byField.duration_months).toBe('2 years (24 months)');
    expect(byField.lor_count).toBe('2 letters');
    expect(byField.min_gpa_rule).toBe('Fixture minimum — Minimum 3 (CGPA (out of 4.0))');
    expect(byField.language_req).toBe('IELTS overall 6.5');
  });

  it('conflict rows carry every source and a ready-made admissions email', () => {
    const dataset = fixtureDataset({ deadline: conflicting('2027-01-15', '2027-02-01') });
    const [row] = retrieve('Deadline at Fixture University?', {}, dataset, FIXED_NOW).rows;
    expect(row.confidence).toBe('Conflict');
    expect(row.sources?.map((s) => [s.value, s.source_url])).toEqual([
      ['15 Jan 2027', 'https://fixture.example.edu/page-a'],
      ['1 Feb 2027', 'https://fixture.example.edu/page-b'],
    ]);
    expect(row.email_draft).toContain('15 Jan 2027');
    expect(row.email_draft).toContain('1 Feb 2027');
  });

  it('drops non-http links from data (javascript: URLs never reach the browser)', () => {
    const dataset = fixtureDataset({
      official_url: 'javascript:alert(1)',
      deadline: { ...verified('2027-01-15'), source_url: 'javascript:alert(2)' },
    });
    const [row] = retrieve('Deadline at Fixture University?', {}, dataset, FIXED_NOW).rows;
    expect(row.source_url).toBeNull();
    expect(row.official_url).toBe('https://fixture.example.edu'); // falls back to the institution website
  });

  it("a fact's student-facing note is part of the value; review_note never is", () => {
    const dataset = fixtureDataset(
      {
        deadline: { ...verified('2027-01-15'), note: 'Closes at 12:00 noon.', review_note: 'INTERNAL reviewer caveat' },
        tuition: { ...verified({ amount: 1500, currency: 'GBP', period: 'year' }), review_note: 'INTERNAL fee caveat' },
      },
      [
        countryFact('UK', 'post_study_work', {
          ...verified({ text: 'Fixture rule.', clock_note: 'Fixture clock.' }),
          note: 'Fixture note.',
          review_note: 'INTERNAL country caveat',
        }),
      ],
    );
    const rows = retrieve('Deadline and tuition at Fixture University?', {}, dataset, FIXED_NOW).rows;
    expect(rows.find((x) => x.field === 'deadline')?.value).toBe('15 Jan 2027 (52 days left) Note: Closes at 12:00 noon.');
    expect(rows.find((x) => x.field === 'tuition')?.value).toBe('£1,500 per year');
    const [uk] = retrieve('Work after study in the UK?', {}, dataset, FIXED_NOW).rows;
    expect(uk.value).toBe('Fixture rule. Note: Fixture clock. Fixture note.');
    expect(JSON.stringify([rows, uk])).not.toContain('INTERNAL');
  });

  it('an Unverified value with a note still shows nothing (the note never leaks a value)', () => {
    const dataset = fixtureDataset({ deadline: { value: '2027-01-15', source_url: null, evidence_snippet: null, fetched_at: null, note: 'Fixture' } });
    const [row] = retrieve('Deadline at Fixture University?', {}, dataset, FIXED_NOW).rows;
    expect(row.confidence).toBe('Unverified');
    expect(toPublicRow(row).value).toBeNull();
  });

  it('country fact fixture with a conflict', () => {
    const fact = countryFact('UK', 'post_study_work', conflicting({ text: 'Fixture rule A' }, { text: 'Fixture rule B' }));
    const dataset = fixtureDataset({}, [fact]);
    const [row] = retrieve('Work after study in the UK?', {}, dataset, FIXED_NOW).rows;
    expect(row.confidence).toBe('Conflict');
    expect(row.sources?.map((s) => s.value)).toEqual(['Fixture rule A', 'Fixture rule B']);
  });
});
