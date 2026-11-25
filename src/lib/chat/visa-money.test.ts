/**
 * Proposal #3 (chat part): "How much money do I need to show?" is answered from the country's proof_of_funds row,
 * never from tuition rows. No country named -> every country with a usable row. A country without a usable row
 * (Switzerland) still gets the code-built refusal. Live seed + the frozen empty seed, `now` pinned.
 */
import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { FIXED_NOW, loadEmptySeedDataset, verified } from '@/lib/test-fixtures';
import { collectAnswer, type AnswerDeps } from './answer';
import { NOT_ADVICE_LINE } from './fallback';
import { detectFields, normalizeQuestion } from './fields';
import { detectUnsafeIntent, guard } from './guard';
import { retrieve } from './retrieve';
import { countryFact, fixtureDataset, mockModel } from './test-helpers';

const seed = loadSeedDataset();
const now = new Date('2026-11-24T12:00:00Z');
const fieldsOf = (q: string) => detectFields(normalizeQuestion(q));
const idsOf = (q: string, scope = {}) => retrieve(q, scope, seed, now).rows.map((r) => r.id);
const deps = (over: Partial<AnswerDeps> = {}): AnswerDeps => ({ dataset: seed, now, model: null, ...over });

describe('detectFields: visa money is proof_of_funds, never tuition or living cost', () => {
  it.each([
    'How much money do I need to show for a UK student visa?',
    'How much money to show for Germany?',
    'What is the proof of funds for Canada?',
    'How much bank statement is required for the UK?',
    'How much should be in my bank balance for the visa?',
    'Germany blocked account amount?',
    'Sperrkonto kitna hai?',
    'UK visa ke liye kitne paise dikhane parte hain?',
    'Canada ke liye kitni raqam dikhani hogi?',
    'Funds for visa Canada',
    'How much money do I need for a US student visa?',
    'What are the funds required for a study permit?',
    'Financial requirement for the UK student visa?',
  ])('"%s" -> proof_of_funds only', (q) => {
    expect(fieldsOf(q)).toEqual({ fields: ['proof_of_funds'], unsupportedTopic: null });
  });

  it('"bank statement" is never read as a statement of purpose', () => {
    expect(fieldsOf('Do I need a bank statement for the UK?').fields).not.toContain('sop_requirements');
  });

  it('ordinary cost questions are unchanged', () => {
    expect(fieldsOf('How much is the tuition at Cardiff?').fields).toEqual(['tuition']);
    expect(fieldsOf('How much does it cost to study in Germany?').fields).toEqual(['tuition', 'living_cost']);
    expect(fieldsOf('How much money can I earn on a work visa?').fields).not.toContain('proof_of_funds');
    expect(fieldsOf('Show me the tuition amount for Cardiff').fields).toEqual(['tuition']);
  });

  it('blocked account / proof of funds are no longer "topics we have no data for"; the others still are', () => {
    expect(fieldsOf('What about the blocked account?').unsupportedTopic).toBeNull();
    expect(fieldsOf('Proof of funds?').unsupportedTopic).toBeNull();
    expect(fieldsOf('What is the visa fee?')).toEqual({ fields: [], unsupportedTopic: 'visa fee' });
    expect(fieldsOf('What is the health surcharge?')).toEqual({ fields: [], unsupportedTopic: 'health surcharge' });
  });

  it('dishonesty about bank statements is still refused before any lookup', () => {
    expect(detectUnsafeIntent('Can I edit my bank statement?')).toBe('dishonest');
    expect(detectUnsafeIntent('Where can I buy a bank statement?')).toBe('dishonest');
    expect(detectUnsafeIntent('How much money do I need to show for a UK student visa?')).toBeNull();
  });
});

describe('live seed: the right country row', () => {
  it.each([
    ['How much money do I need to show for a UK student visa?', 'uk-proof-of-funds'],
    ['UK visa ke liye kitne paise dikhane parte hain?', 'uk-proof-of-funds'],
    ['Germany blocked account amount?', 'de-proof-of-funds'],
    ['Sperrkonto kitna hai?', 'de-proof-of-funds'], // a German-only term names the country
    ['Funds for visa Canada', 'ca-proof-of-funds'],
    ['How much is the GIC?', 'ca-proof-of-funds'],
    ['Proof of funds for the US?', 'us-proof-of-funds'],
    ['How much bank balance do I need to show for TUM?', 'de-proof-of-funds'], // the program's country
  ])('"%s" -> %s only (no program rows)', (q, id) => {
    expect(idsOf(q)).toEqual([id]);
  });

  it('the program page scope gives that program’s country', () => {
    expect(idsOf('How much money do I need to show?', { programId: 'utoronto-mscac' })).toEqual(['ca-proof-of-funds']);
  });

  it('the values are the official amounts, copied from the rows (Germany €11,904 a year, Canada CAN$23,448)', () => {
    const de = retrieve('Sperrkonto kitna hai?', {}, seed, now).rows[0];
    expect(de).toMatchObject({ confidence: 'Verified', source_url: 'https://pakistan.diplo.de/pk-en/service/1995528-1995528' });
    expect(de.value).toContain('€11,904 a year');
    const ca = retrieve('Funds for visa Canada', {}, seed, now).rows[0];
    expect(ca.value).toContain('CAN$23,448');
  });

  it('no country named -> the four countries with a usable row (UK, DE, CA, US), never Switzerland’s empty row', () => {
    const rows = retrieve('How much money do I need to show for a student visa?', {}, seed, now).rows;
    expect(rows.map((r) => r.entity_id).sort()).toEqual(['CA', 'DE', 'UK', 'US']);
    expect(rows.every((r) => r.field === 'proof_of_funds' && r.confidence === 'Verified')).toBe(true);
  });

  it('never a tuition or living-cost row for any visa-money phrasing', () => {
    for (const q of [
      'How much money do I need to show for a UK student visa?',
      'UK visa ke liye kitne paise dikhane parte hain?',
      'How much money do I need to show for a student visa?',
      'kitne paise dikhane honge Germany ke liye',
    ]) {
      const fields = retrieve(q, {}, seed, now).rows.map((r) => r.field);
      expect(fields, q).not.toContain('tuition');
      expect(fields, q).not.toContain('living_cost');
      expect(fields, q).not.toContain('tuition_typical');
    }
  });

  it('the fallback answer lists the row with its source and says it is not legal or immigration advice', async () => {
    const r = await collectAnswer({ question: 'How much money do I need to show for a UK student visa?' }, deps());
    expect(r.mode).toBe('fallback');
    expect(r.text).toContain('Money to show for the student visa (United Kingdom)');
    expect(r.text).toContain('https://www.gov.uk/student-visa/money');
    expect(r.text).toContain(NOT_ADVICE_LINE);
  });
});

describe('no usable row -> the code-built refusal, never the model', () => {
  it('Switzerland (Not verified yet in the data): refusal with no value and no number', async () => {
    const model = mockModel(['You need CHF 21,000.']);
    const r = await collectAnswer({ question: 'How much money do I need to show for a Swiss student visa?' }, deps({ model }));
    expect(model.calls).toHaveLength(0);
    expect(r.mode).toBe('refusal');
    expect(r.reason).toBe('not_verified');
    expect(r.rows.map((x) => [x.id, x.value])).toEqual([['ch-proof-of-funds', null]]);
    expect(r.text).toMatch(/money you must show for the student visa for Switzerland is not verified yet/);
    expect(r.text).not.toMatch(/\d/);
  });

  it('frozen empty seed (no proof_of_funds rows anywhere): every country stays listed in the refusal', () => {
    const empty = loadEmptySeedDataset();
    const q = 'How much money do I need to show for a student visa?';
    const d = guard(q, retrieve(q, {}, empty, FIXED_NOW));
    expect(d.mode).toBe('refusal');
    if (d.mode !== 'refusal') return;
    expect(d.reason).toBe('not_verified');
    expect(d.rows.length).toBeGreaterThanOrEqual(4);
    expect(d.rows.every((r) => r.field === 'proof_of_funds' && r.value === null)).toBe(true);
  });

  it('fixture: a Conflict row is kept in a list (both values shown), an Unverified one is dropped', () => {
    const dataset = fixtureDataset({}, [
      countryFact('UK', 'proof_of_funds', verified({ text: 'Fixture UK amount.' })),
      countryFact('CA', 'proof_of_funds', {
        ...verified({ text: 'Fixture CA amount A.' }, 1, 'https://fixture.example.edu/page-a'),
        conflicts: [verified({ text: 'Fixture CA amount B.' }, 1, 'https://fixture.example.edu/page-b')],
      }),
      countryFact('DE', 'proof_of_funds', { value: { text: 'Fixture DE amount.' }, source_url: null, evidence_snippet: null, fetched_at: null }),
    ]);
    const rows = retrieve('How much money do I need to show?', {}, dataset, FIXED_NOW).rows;
    expect(rows.map((r) => [r.entity_id, r.confidence])).toEqual([
      ['UK', 'Verified'],
      ['CA', 'Conflict'],
    ]);
  });
});
