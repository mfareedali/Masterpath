import { describe, expect, it } from 'vitest';
import { allSources, computeConfidence, hasConflict, usableValue } from './confidence';
import { FIXED_NOW, conflicting, daysAgo, likely, unverified, verified } from './test-fixtures';

describe('computeConfidence (computed in code, never stored)', () => {
  it('Verified = snippet + source + fetched within 30 days', () => {
    expect(computeConfidence(verified(3.0, 1), FIXED_NOW)).toBe('Verified');
    expect(computeConfidence(verified(3.0, 30), FIXED_NOW)).toBe('Verified');
  });

  it('Likely = older than 30 days', () => {
    expect(computeConfidence(verified(3.0, 31), FIXED_NOW)).toBe('Likely');
  });

  it('Likely = summary/inferred basis with a source URL', () => {
    expect(computeConfidence(likely('x'), FIXED_NOW)).toBe('Likely');
    expect(computeConfidence({ ...likely('x'), basis: 'inferred' }, FIXED_NOW)).toBe('Likely');
  });

  it('Unverified = no snippet, no value, or summary without a URL', () => {
    expect(computeConfidence(unverified(), FIXED_NOW)).toBe('Unverified');
    expect(computeConfidence(unverified(3.0), FIXED_NOW)).toBe('Unverified');
    expect(computeConfidence({ ...likely('x'), source_url: null }, FIXED_NOW)).toBe('Unverified');
    expect(computeConfidence({ value: 3, source_url: 'https://a.edu', evidence_snippet: '', fetched_at: daysAgo(1) }, FIXED_NOW)).toBe('Unverified');
    expect(computeConfidence(null, FIXED_NOW)).toBe('Unverified');
  });

  it('a snippet without a fetched date is not Verified', () => {
    expect(computeConfidence({ ...verified(1), fetched_at: null }, FIXED_NOW)).toBe('Likely');
  });

  it('Conflict when another source has a different value', () => {
    const f = conflicting('2027-01-15', '2027-02-01');
    expect(hasConflict(f)).toBe(true);
    expect(computeConfidence(f, FIXED_NOW)).toBe('Conflict');
  });

  it('agreeing sources are not a conflict (object key order ignored)', () => {
    const f = { ...verified({ a: 1, b: 2 }), conflicts: [verified({ b: 2, a: 1 })] };
    expect(computeConfidence(f, FIXED_NOW)).toBe('Verified');
  });

  it('usableValue only returns Verified/Likely values', () => {
    expect(usableValue(verified(5), FIXED_NOW)).toBe(5);
    expect(usableValue(unverified(5), FIXED_NOW)).toBeNull();
    expect(usableValue(conflicting(5, 6), FIXED_NOW)).toBeNull();
  });
});

describe('an unsourced alternative is not a second source (proposal #28)', () => {
  const fee = { amount: 20_800, currency: 'GBP', period: 'year' as const };
  const claim = { amount: 9_999, currency: 'GBP', period: 'year' as const };

  it('the audit probe: Verified £20,800 with an unsourced £9,999 stays Verified and usable', () => {
    const f = { ...verified(fee), conflicts: [{ value: claim, source_url: null, evidence_snippet: null, fetched_at: null }] };
    expect(hasConflict(f)).toBe(false);
    expect(computeConfidence(f, FIXED_NOW)).toBe('Verified');
    expect(usableValue(f, FIXED_NOW)).toEqual(fee);
    // It is still listed for display (as an unsourced claim).
    expect(allSources(f).map((s) => s.value)).toEqual([fee, claim]);
  });

  it('a blank source_url is unsourced too, even with a snippet', () => {
    const f = { ...verified(fee), conflicts: [{ value: claim, source_url: '   ', evidence_snippet: 'Fixture snippet text', fetched_at: daysAgo(1) }] };
    expect(computeConfidence(f, FIXED_NOW)).toBe('Verified');
  });

  it('a sourced alternative with a different value is still a Conflict, even without a snippet', () => {
    expect(computeConfidence({ ...verified(fee), conflicts: [verified(claim, 1, 'https://fixture.example.edu/b')] }, FIXED_NOW)).toBe('Conflict');
    expect(computeConfidence({ ...verified(fee), conflicts: [likely(claim)] }, FIXED_NOW)).toBe('Conflict');
  });

  it('an unsourced alternative next to a sourced one: only the sourced one counts', () => {
    const unsourced = { value: claim, source_url: null, evidence_snippet: null, fetched_at: null };
    expect(computeConfidence({ ...verified(fee), conflicts: [unsourced, verified(fee, 2, 'https://fixture.example.edu/b')] }, FIXED_NOW)).toBe('Verified');
    expect(computeConfidence({ ...verified(fee), conflicts: [unsourced, verified(claim, 2, 'https://fixture.example.edu/b')] }, FIXED_NOW)).toBe('Conflict');
  });
});
