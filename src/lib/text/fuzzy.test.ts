import { describe, expect, it } from 'vitest';
import { damerauLevenshtein, suggestName, type FuzzyCandidate } from './fuzzy';

const C: FuzzyCandidate[] = [
  { key: 'imperial', label: 'Imperial College London', words: ['imperial'] },
  { key: 'oxford-brookes', label: 'Oxford Brookes University', words: ['brookes'] },
  { key: 'utoronto', label: 'University of Toronto', words: ['toronto'] },
  { key: 'tum', label: 'Technical University of Munich', words: ['munich'] },
  { key: 'cardiff', label: 'Cardiff University', words: ['cardiff'] },
];

describe('fuzzy names', () => {
  it('distance counts transpositions as one edit', () => {
    expect(damerauLevenshtein('imprial', 'imperial')).toBe(1);
    expect(damerauLevenshtein('toranto', 'toronto')).toBe(1);
    expect(damerauLevenshtein('brooks', 'brookes')).toBe(1);
    expect(damerauLevenshtein('cadriff', 'cardiff')).toBe(1);
  });

  it.each([
    ['What is the deadline for Imprial?', 'imperial'],
    ['Oxford Brooks ki fees kitni hai?', 'oxford-brookes'],
    ['Toranto deadline', 'utoronto'],
  ])('suggests the one close name: %s', (q, key) => {
    expect(suggestName(q, C)?.key).toBe(key);
  });

  it('never fuzzy-matches short words or exact names, and returns null when nothing is close', () => {
    expect(suggestName('What about TUM and ETH?', C)).toBeNull();
    expect(suggestName('Imperial deadline', C)).toBeNull();
    expect(suggestName('Harvard deadline', C)).toBeNull();
  });
});
