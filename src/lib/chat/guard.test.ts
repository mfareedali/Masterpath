import { describe, expect, it } from 'vitest';
import { FIXED_NOW, conflicting, likely, verified, loadEmptySeedDataset } from '@/lib/test-fixtures';
import { NO_DATA_TEXT, conflictText, detectUnsafeIntent, guard, notVerifiedText } from './guard';
import { retrieve, type ChatDataset } from './retrieve';
import { fixtureDataset } from './test-helpers';
import type { ChatRow } from './types';

const seed = loadEmptySeedDataset();

function decide(question: string, dataset: ChatDataset = seed, scope = {}) {
  return guard(question, retrieve(question, scope, dataset, FIXED_NOW));
}

describe('detectUnsafeIntent', () => {
  it.each([
    ['Will I get a visa?', 'prediction'],
    ['Will I definitely get a UK visa?', 'prediction'],
    ['will my brother get a visa too', 'prediction'],
    ['Can I get admission at TUM with a 2.5 CGPA?', 'prediction'],
    ['Can I get into Imperial?', 'prediction'],
    ['What are my chances at CMU?', 'prediction'],
    ['What is the acceptance rate of UIUC?', 'prediction'],
    ['Is admission guaranteed?', 'prediction'],
    ['Do you guarantee a scholarship?', 'prediction'],
    ['What percentage of applicants get in?', 'prediction'],
    ['Am I going to be accepted?', 'prediction'],
    ['Will the embassy approve my file?', 'prediction'],
    ['Am I 100% sure to get the visa?', 'prediction'],
    ['Is it certain that I will get PR?', 'prediction'],
    ['Should I lie about my gap year?', 'dishonest'],
    ['Can I use fake documents?', 'dishonest'],
    ['Where can I buy an IELTS certificate?', 'dishonest'],
    ['Can I edit my bank statement?', 'dishonest'],
    ['How do I hide my previous visa refusal?', 'dishonest'],
    ['Is this legal?', 'legal'],
    ['Is it legal to work 30 hours?', 'legal'],
    ['Should I get a lawyer to appeal my visa refusal?', 'legal'],
    ['Can I stay without a visa after it expires?', 'legal'],
  ] as const)('%s -> %s', (q, intent) => {
    expect(detectUnsafeIntent(q)).toBe(intent);
  });

  it.each([
    'What is the application deadline for TUM MSc Informatics?',
    'How long can I work in the UK after my Masters?',
    'Can I get a scholarship at TUM?', // asks about scholarship info, which we answer from data
    'Can I get PR after studying in Canada?', // asks about the PR route
    'What percentage do I need for Cardiff?', // percentage = marks in Pakistan
    'I have 65% marks, is that enough for Brookes?',
    'Do I definitely need IELTS for Imperial?',
    'Is progression guaranteed on the QMUL pre-masters?', // a data field, not a promise
    'Is this consultant fake?', // an honest question
    'My agent asked me to pay extra money, is that normal?',
    'What is the minimum CGPA for ETH?',
    'How does the Canada citizenship clock work?',
    'Can I keep my Pakistani nationality?',
  ])('%s -> allowed', (q) => {
    expect(detectUnsafeIntent(q)).toBeNull();
  });
});

describe('detectUnsafeIntent — reviewer curl cases that used to reach the model', () => {
  it.each([
    'Will I get a UK visa?',
    'Will I get a German visa?',
    'Will I get a UK student visa?',
    'Will my UK visa be approved?',
    'Is my UK visa going to be refused?',
    'Will my application be accepted?',
    'Will Imperial accept me?',
    'Would TUM admit me?',
    'Will the University of Toronto reject me?',
    'Imperial will accept me, right?',
    'Will TUM give me a scholarship?',
    'Can I get a UK student visa?',
    'Can I get a German visa with a 2.5 CGPA?',
    'Kya mujhe UK ka visa mil jayega?',
    'Kya mera admission CMU mein ho jayega?',
    'Kya mera visa lag jayega?',
    'Mujhe scholarship milegi?',
    'Kya mujhe admission mil sakta hai?',
    'Will I 100% get the visa?',
    'Is a 100% visa approval possible for me?',
  ])('%s -> prediction', (q) => {
    expect(detectUnsafeIntent(q)).toBe('prediction');
  });

  it.each([
    'Does TUM offer a 100% scholarship?',
    'Is a 100 percent tuition waiver available at USF?',
    'Are there 100% funded scholarships in Germany?',
    'Is there a 50% scholarship at Brookes?',
    'I have 100% marks in maths, what is the minimum for ETH?',
    'Can I get a Graduate visa after my Masters in the UK?', // a rule we hold data on (work after study)
    'Can I get a work visa after studying in Germany?',
    'Can I get a scholarship in Germany?', // "in" after a gap is not "get in"
    'Will you give me the deadline for TUM?',
    'How long will it take me to get PR in Canada?',
    'Will TUM accept a 3-year degree?', // a rule about degrees, not about this student
    'Is the TOEFL accepted at Cardiff?',
    'TUM ka deadline kahan milega?',
    'Kya TUM mein scholarship milti hai?',
    'Kya TUM mein scholarship mil sakti hai?',
    'Would I be eligible for scholarships at TUM?',
    'Can I apply to Imperial MSc Computing with a BS Computer Science degree?',
    'How long can I stay in Germany after my Masters?',
  ])('%s -> allowed (an honest data question)', (q) => {
    expect(detectUnsafeIntent(q)).toBeNull();
  });
});

describe('guard decisions', () => {
  it('specific field, value null -> refusal (not_verified) with the official link', () => {
    const d = decide('What is the application deadline for TUM MSc Informatics?');
    expect(d.mode).toBe('refusal');
    if (d.mode !== 'refusal') return;
    expect(d.reason).toBe('not_verified');
    expect(d.text).toBe(
      "The application deadline for MSc Informatics at Technical University of Munich is not verified yet in MastersPath, so I won't guess. Please check the official page: https://www.tum.de",
    );
  });

  it('a value with no evidence (Unverified) is refused exactly like a null value', () => {
    const dataset = fixtureDataset({ deadline: { value: '2027-01-15', source_url: null, evidence_snippet: null, fetched_at: null } });
    const d = decide('Deadline at Fixture University?', dataset);
    expect(d.mode).toBe('refusal');
    if (d.mode === 'refusal') expect(d.text).not.toMatch(/2027|15 Jan/);
  });

  it('no rows -> no_data refusal with pointers', () => {
    const d = decide('What is the best biryani in Karachi?');
    expect(d.mode).toBe('refusal');
    if (d.mode !== 'refusal') return;
    expect(d.reason).toBe('no_data');
    expect(d.text.startsWith(NO_DATA_TEXT)).toBe(true);
    expect(d.pointers.map((p) => p.href)).toEqual(['/check', '/shortlist']);
  });

  it('a topic we have no column for is named in the no-data refusal', () => {
    const d = decide('What is the application fee at Cardiff?');
    expect(d.mode).toBe('refusal');
    if (d.mode === 'refusal') expect(d.text).toMatch(/don't have data on application fee yet/);
  });

  it('Verified or Likely rows -> answer', () => {
    const dataset = fixtureDataset({ tuition: likely({ amount: 1000, currency: 'GBP', period: 'year' }) });
    const d = decide('What is the tuition at Fixture University?', dataset);
    expect(d.mode).toBe('answer');
    if (d.mode === 'answer') expect(d.rows[0]).toMatchObject({ field: 'tuition', confidence: 'Likely' });
  });

  it('specific question with one usable and one missing field -> answer that includes the missing row (model says "not verified yet")', () => {
    const dataset = fixtureDataset({ tuition: verified({ amount: 1000, currency: 'GBP', period: 'year' }) });
    const d = decide('What are the tuition and living costs at Fixture University?', dataset);
    expect(d.mode).toBe('answer');
    if (d.mode === 'answer') {
      expect(d.rows.map((r) => [r.field, r.confidence])).toEqual([
        ['tuition', 'Verified'],
        ['living_cost', 'Unverified'],
      ]);
    }
  });

  it('general question ("tell me about X") with nothing verified -> refusal naming the entity', () => {
    const d = decide('Tell me about Cardiff');
    expect(d.mode).toBe('refusal');
    if (d.mode === 'refusal') expect(d.text).toMatch(/no verified details for MSc Computer Science at Cardiff University yet/);
  });

  it('general question with some verified rows -> answer with ONLY the usable rows', () => {
    const dataset = fixtureDataset({ deadline: verified('2027-01-15') });
    const d = decide('Tell me about Fixture University', dataset);
    expect(d.mode).toBe('answer');
    if (d.mode === 'answer') expect(d.rows.map((r) => r.field)).toEqual(['deadline']);
  });

  it('conflict only -> refusal listing both values and links', () => {
    const dataset = fixtureDataset({ lor_count: conflicting(2, 3) });
    const d = decide('How many recommendation letters for Fixture University?', dataset);
    expect(d.mode).toBe('refusal');
    if (d.mode !== 'refusal') return;
    expect(d.reason).toBe('conflict');
    expect(d.text).toContain('2 letters');
    expect(d.text).toContain('3 letters');
    expect(d.text).toContain('page-a');
    expect(d.text).toContain('page-b');
  });

  it('prediction beats data: even with a verified row the guard refuses', () => {
    const dataset = fixtureDataset({ deadline: verified('2027-01-15') });
    const d = decide('Will I get admission at Fixture University before the deadline?', dataset);
    expect(d.mode).toBe('refusal');
    if (d.mode === 'refusal') {
      expect(d.reason).toBe('prediction');
      expect(d.rows).toEqual([]);
    }
  });

  it('a field asked for many programs at once summarises instead of listing all of them', () => {
    const d = decide('What is the application deadline?');
    expect(d.mode).toBe('refusal');
    if (d.mode === 'refusal') {
      expect(d.text).toMatch(/not verified yet for any of the 14 programs/);
      expect(d.rows.length).toBeLessThanOrEqual(12);
    }
  });

  it('"100% scholarship" gets the scholarship answer (not verified yet + official link), not a prediction refusal', () => {
    const d = decide('Does TUM offer a 100% scholarship?');
    expect(d.mode).toBe('refusal');
    if (d.mode !== 'refusal') return;
    expect(d.reason).toBe('not_verified');
    expect(d.rows.map((r) => r.field)).toEqual(['scholarship_info']);
    expect(d.text).toContain('https://www.tum.de');
  });

  it('"100 percent tuition waiver" asks about funding (scholarship_info), not the tuition amount', () => {
    const d = decide('Is a 100 percent tuition waiver available at USF?');
    expect(d.mode).toBe('refusal');
    if (d.mode === 'refusal') {
      expect(d.reason).toBe('not_verified');
      expect(d.rows.map((r) => r.field)).toEqual(['scholarship_info']);
    }
  });

  it.each([
    ['How long can I stay in Germany after my Masters?', 'DE'],
    ['Can I stay in Canada after my studies?', 'CA'],
  ])('"%s" refuses on the Unverified work-after-study rule instead of quoting programme length', (q, country) => {
    const d = decide(q);
    expect(d.mode).toBe('refusal');
    if (d.mode !== 'refusal') return;
    expect(d.reason).toBe('not_verified');
    expect(d.rows.map((r) => [r.entity_id, r.field])).toEqual([[country, 'post_study_work']]);
    expect(d.text).toMatch(/work-after-study rule/);
    expect(d.text).not.toMatch(/programme length/i);
  });

  it('"How many years until I can get UK citizenship?" asks about the citizenship rule, not programme length', () => {
    const d = decide('How many years until I can get UK citizenship?');
    expect(d.mode).toBe('refusal');
    if (d.mode === 'refusal') expect(d.rows.map((r) => r.field)).toEqual(['citizenship_rule']);
  });

  it('a ruled-out program always shows its status', () => {
    const d = decide('What is the deadline for LJMU?');
    expect(d.mode).toBe('refusal');
    if (d.mode === 'refusal') expect(d.rows.map((r) => r.field)).toEqual(['status_note', 'deadline']);
  });
});

describe('text helpers', () => {
  const row = (over: Partial<ChatRow>): ChatRow => ({
    id: 'r',
    entity: 'program',
    entity_id: 'p',
    entity_name: 'MSc X at Y',
    field: 'deadline',
    label: 'Application deadline',
    value: null,
    confidence: 'Unverified',
    source_url: null,
    evidence_snippet: null,
    fetched_at: null,
    official_url: null,
    ...over,
  });

  it('notVerifiedText without an official link points to the university website in words, not a made-up URL', () => {
    expect(notVerifiedText([row({})])).toBe(
      "The application deadline for MSc X at Y is not verified yet in MastersPath, so I won't guess. Please check the university's official website.",
    );
  });

  it('uses "the" for the United Kingdom and plural verbs where needed', () => {
    const t = notVerifiedText([row({ entity: 'country', entity_name: 'United Kingdom', field: 'post_study_work', label: 'Work after study' })]);
    expect(t).toMatch(/^The work-after-study rule for the United Kingdom is not verified yet/);
    expect(notVerifiedText([row({ field: 'cv_requirements', label: 'CV requirements' })])).toMatch(/CV requirements for MSc X at Y are not verified/);
  });

  it('groups several missing fields of one program', () => {
    const t = notVerifiedText([row({ id: 'a' }), row({ id: 'b', field: 'tuition', label: 'Tuition fee' })]);
    expect(t).toContain('These details for MSc X at Y are not verified yet');
    expect(t).toContain('- Application deadline');
    expect(t).toContain('- Tuition fee');
  });

  it('conflictText shows every source', () => {
    const t = conflictText([
      row({
        confidence: 'Conflict',
        sources: [
          { value: 'A', source_url: 'https://a.example', evidence_snippet: null, fetched_at: null },
          { value: 'B', source_url: 'https://b.example', evidence_snippet: null, fetched_at: null },
        ],
      }),
    ]);
    expect(t).toContain('Source 1: A — https://a.example');
    expect(t).toContain('Source 2: B — https://b.example');
  });
});

describe('getting started (greetings and general "how do I apply")', () => {
  it.each([
    'hi',
    'Hello!',
    'hi iw ant to apply from pakistan',
    'hi i want to apply from pakistan',
    'Assalam o alaikum',
    'AoA',
    'How do I apply?',
    'I want to study abroad',
    'apply kaise karun',
  ])('%s -> friendly guide, no AI, no rows', (q) => {
    const d = decide(q);
    expect(d.mode).toBe('refusal');
    if (d.mode !== 'refusal') return;
    expect(d.reason).toBe('getting_started');
    expect(d.rows).toEqual([]);
    expect(d.pointers.map((p) => p.href)).toEqual(['/shortlist', '/citizenship', '/check']);
  });

  it('a greeting never overrides a safety refusal', () => {
    const d = decide('hi, will I definitely get a UK visa?');
    expect(d.mode === 'refusal' && d.reason).toBe('prediction');
  });

  it('words that only look like a greeting do not trigger it', () => {
    for (const q of ['history masters deadline', 'What is the hiring rate?', 'thinking about costs']) {
      const d = decide(q);
      expect(d.mode === 'refusal' && d.reason).not.toBe('getting_started');
    }
  });
});
