import { describe, expect, it } from 'vitest';
import { FALLBACK_OUTRO, NOT_ADVICE_LINE, formatFallbackAnswer } from './fallback';
import type { ChatRow } from './types';
import { numberTokens } from './verify';

const base: ChatRow = {
  id: 'r1',
  entity: 'program',
  entity_id: 'fixture-msc-cs',
  entity_name: 'MSc Fixture Computing at Fixture University',
  field: 'tuition',
  label: 'Tuition fee',
  value: '£1,500 per year',
  confidence: 'Verified',
  source_url: 'https://fixture.example.edu/fees',
  evidence_snippet: 'Fixture snippet',
  fetched_at: '2026-11-20',
  official_url: 'https://fixture.example.edu/program',
};

const rows: ChatRow[] = [
  base,
  { ...base, id: 'r2', field: 'deadline', label: 'Application deadline', value: null, confidence: 'Unverified', source_url: null },
  {
    ...base,
    id: 'r3',
    field: 'lor_count',
    label: 'Recommendation letters',
    value: '2 letters',
    confidence: 'Conflict',
    sources: [
      { value: '2 letters', source_url: 'https://fixture.example.edu/a', evidence_snippet: null, fetched_at: null },
      { value: '3 letters', source_url: 'https://fixture.example.edu/b', evidence_snippet: null, fetched_at: null },
    ],
  },
  { ...base, id: 'r4', field: 'living_cost', label: 'Living cost', value: 'an unverified number 999', confidence: 'Unverified' },
];

describe('formatFallbackAnswer', () => {
  const text = formatFallbackAnswer(rows);

  it('one line per row: label, value, confidence, source', () => {
    expect(text.split('\n')).toEqual([
      'Here are the facts from MastersPath:',
      '- Tuition fee (MSc Fixture Computing at Fixture University): £1,500 per year — Verified — Source: https://fixture.example.edu/fees',
      '- Application deadline (MSc Fixture Computing at Fixture University): Not verified yet — Official page: https://fixture.example.edu/program',
      '- Recommendation letters (MSc Fixture Computing at Fixture University): Sources disagree: source 1 says 2 letters (https://fixture.example.edu/a); source 2 says 3 letters (https://fixture.example.edu/b) — Conflict',
      '- Living cost (MSc Fixture Computing at Fixture University): Not verified yet — Official page: https://fixture.example.edu/program',
      FALLBACK_OUTRO,
    ]);
  });

  it('adds nothing beyond the rows: every number and link in the text comes from a row', () => {
    const corpus = JSON.stringify(rows);
    for (const n of numberTokens(text)) expect(numberTokens(corpus)).toContain(n);
    for (const url of text.match(/https?:\/\/\S+?(?=\)|;|\s|$)/g) ?? []) expect(corpus).toContain(url);
  });

  it('never shows an Unverified value, even when the row has one', () => {
    expect(text).not.toContain('999');
  });

  it('no rows -> the no-data sentence', () => {
    expect(formatFallbackAnswer([])).toBe("I can only answer from verified data in MastersPath, and I don't have data on that yet.");
  });

  it('says why the AI summary is missing, and adds the not-advice line for immigration rows', () => {
    const visa: ChatRow = { ...base, entity: 'country', entity_id: 'UK', entity_name: 'United Kingdom', field: 'post_study_work', label: 'Work after study', value: 'Fixture rule' };
    const t = formatFallbackAnswer([visa], 'budget');
    expect(t.startsWith('AI summaries are paused for today')).toBe(true);
    expect(t.endsWith(NOT_ADVICE_LINE)).toBe(true);
    expect(formatFallbackAnswer([base], 'model_error')).toMatch(/^The AI summary is not available right now/);
    expect(formatFallbackAnswer([base])).not.toContain(NOT_ADVICE_LINE);
  });
});
