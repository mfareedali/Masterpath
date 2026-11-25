import { describe, expect, it } from 'vitest';
import { parseSavedIds, resolveSaved, toggleSavedId, type SavedProgramSummary } from './saved';

describe('saved programs (localStorage mp_saved)', () => {
  it('parses a JSON array of ids, dropping junk', () => {
    expect(parseSavedIds('["a-1","b_2"]')).toEqual(['a-1', 'b_2']);
    expect(parseSavedIds('["a","a",3,null,"<x>"," "]')).toEqual(['a']);
    expect(parseSavedIds(null)).toEqual([]);
    expect(parseSavedIds('')).toEqual([]);
    expect(parseSavedIds('not json')).toEqual([]);
    expect(parseSavedIds('{"a":1}')).toEqual([]);
  });

  it('caps the list', () => {
    const many = JSON.stringify(Array.from({ length: 500 }, (_, i) => `p${i}`));
    expect(parseSavedIds(many)).toHaveLength(200);
  });

  it('toggles (newest first)', () => {
    expect(toggleSavedId([], 'a')).toEqual(['a']);
    expect(toggleSavedId(['a'], 'b')).toEqual(['b', 'a']);
    expect(toggleSavedId(['b', 'a'], 'b')).toEqual(['a']);
  });

  it('resolves ids against the program list and counts unknown ids', () => {
    const programs: SavedProgramSummary[] = [
      { id: 'a', name: 'MSc Fixture A', institutionName: 'Fixture University', country: 'UK', status: 'active' },
      { id: 'b', name: 'MSc Fixture B', institutionName: 'Fixture University', country: 'DE', status: 'ruled_out' },
    ];
    const r = resolveSaved(['b', 'gone', 'a'], programs);
    expect(r.saved.map((p) => p.id)).toEqual(['b', 'a']);
    expect(r.missing).toBe(1);
  });
});
