/**
 * Proposal #29: common Roman Urdu questions reach their field (they used to fall through to a general summary).
 * Keyword routing only: the guard still runs first, and the Roman Urdu prediction rules are unchanged.
 */
import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { detectFields, normalizeQuestion } from './fields';
import { detectUnsafeIntent } from './guard';
import { retrieve } from './retrieve';

const seed = loadSeedDataset();
const now = new Date('2026-11-24T12:00:00Z');
const fieldsOf = (q: string) => detectFields(normalizeQuestion(q)).fields;

describe('Roman Urdu field patterns', () => {
  it.each([
    ['ETH mein apply karne ki aakhri tareekh kya hai?', ['deadline']],
    ['TUM ki akhri tarikh?', ['deadline']],
    ['CMU kab tak apply kar sakte hain', ['deadline']],
    ['Documents kab tak jama karwane hain?', ['deadline']],
    ['Toronto ka kharcha kitna hai', ['tuition', 'living_cost']],
    ['Germany mein kitne paise lagte hain?', ['tuition', 'living_cost']],
    ['Würzburg mein rehne ka kharcha', ['living_cost']],
    ['UK mein rihaish kitne ki hai?', ['living_cost']],
    ['UK mein parhai ke baad kitna kaam kar sakte hain', ['post_study_work']],
    ['Canada mein padhai ke baad naukri mil sakti hai?', ['post_study_work']],
    ['Parhai ke baad Germany mein kitne saal reh sakte hain?', ['post_study_work']],
  ] as const)('"%s" -> %j', (q, fields) => {
    expect(fieldsOf(q)).toEqual(fields);
  });

  it('"kitne paise dikhane" is the visa money, not the cost', () => {
    expect(fieldsOf('Kitne paise dikhane parte hain UK ke liye?')).toEqual(['proof_of_funds']);
  });

  it('these are data questions, not predictions', () => {
    for (const q of [
      'ETH mein apply karne ki aakhri tareekh kya hai?',
      'CMU kab tak apply kar sakte hain',
      'UK mein parhai ke baad kitna kaam kar sakte hain',
      'Toronto ka kharcha kitna hai',
    ]) {
      expect(detectUnsafeIntent(q), q).toBeNull();
    }
  });

  it('the Roman Urdu prediction rules are unchanged', () => {
    expect(detectUnsafeIntent('Kya mujhe UK ka visa mil jayega?')).toBe('prediction');
    expect(detectUnsafeIntent('Kya mujhe admission mil sakta hai?')).toBe('prediction');
    expect(detectUnsafeIntent('TUM ka deadline kahan milega?')).toBeNull();
  });
});

describe('Roman Urdu on the live seed', () => {
  it('"ETH mein apply karne ki aakhri tareekh kya hai?" -> the ETH deadline row (with its computed status)', () => {
    const rows = retrieve('ETH mein apply karne ki aakhri tareekh kya hai?', {}, seed, now).rows;
    expect(rows.map((r) => r.id)).toEqual(['ethz-msc-cs:deadline']);
    expect(rows[0].value).toMatch(/^30 Nov 2026 \(6 days left\)/);
  });

  it('"Würzburg mein rehne ka kharcha" -> the Würzburg living-cost row only', () => {
    expect(retrieve('Würzburg mein rehne ka kharcha', {}, seed, now).rows.map((r) => r.id)).toEqual(['wuerzburg-msc-cs:living_cost']);
  });

  it('"UK mein parhai ke baad kitna kaam kar sakte hain" -> the UK Graduate visa row, never programme lengths', () => {
    const rows = retrieve('UK mein parhai ke baad kitna kaam kar sakte hain', {}, seed, now).rows;
    expect(rows.map((r) => r.id)).toEqual(['uk-post-study-work']);
  });
});
