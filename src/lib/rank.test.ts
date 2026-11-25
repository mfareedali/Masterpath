import { describe, expect, it } from 'vitest';
import { rankItems, weakestConfidence, type RankKey } from './rank';

type Row = { name: string; key: RankKey };
const rows: Row[] = [
  { name: 'A', key: { value: 300, confidence: 'Verified' } },
  { name: 'B', key: { value: null, confidence: 'Unverified', missingReason: 'Tuition not verified yet' } },
  { name: 'C', key: { value: 100, confidence: 'Likely' } },
  { name: 'D', key: { value: 0, confidence: 'Unverified' } }, // has a number but no evidence
  { name: 'E', key: { value: 50, confidence: 'Conflict' } },
  { name: 'F', key: { value: 100, confidence: 'Verified' } },
];

describe('rankItems — only Verified/Likely values are ranked', () => {
  it('ascending', () => {
    const r = rankItems(rows, (x) => x.key, 'asc', (a, b) => a.name.localeCompare(b.name));
    expect(r.ranked.map((x) => x.item.name)).toEqual(['C', 'F', 'A']);
    expect(r.ranked.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it('descending', () => {
    const r = rankItems(rows, (x) => x.key, 'desc', (a, b) => a.name.localeCompare(b.name));
    expect(r.ranked.map((x) => x.item.name)).toEqual(['A', 'C', 'F']);
  });

  it('missing, Unverified and Conflict values go to "Not ranked", never treated as zero', () => {
    const r = rankItems(rows, (x) => x.key, 'asc');
    expect(r.notRanked.map((x) => x.item.name)).toEqual(['B', 'D', 'E']);
    expect(r.notRanked[0].reason).toBe('Tuition not verified yet');
    expect(r.notRanked[2].reason).toBe('Sources conflict');
    expect(r.ranked[0].item.name).not.toBe('D'); // D's 0 must not win "cheapest"
  });

  it('weakestConfidence', () => {
    expect(weakestConfidence('Verified', 'Likely')).toBe('Likely');
    expect(weakestConfidence('Verified', 'Unverified', 'Likely')).toBe('Unverified');
    expect(weakestConfidence('Verified', 'Conflict')).toBe('Conflict');
    expect(weakestConfidence('Verified')).toBe('Verified');
  });
});
