import { describe, expect, it } from 'vitest';
import {
  CLEAR_FILTERS,
  DEFAULT_QUERY,
  activeFilterCount,
  parseShortlistQuery,
  profileQueryString,
  shortlistHref,
  toggleValue,
} from './query';

describe('parseShortlistQuery', () => {
  it('defaults', () => {
    expect(parseShortlistQuery({})).toEqual(DEFAULT_QUERY);
  });

  it('parses every param', () => {
    expect(
      parseShortlistQuery({
        rank: 'tuition',
        dir: 'desc',
        country: 'de,UK',
        fit: 'meets,below',
        intake: ['Fixture Autumn 2027', 'Fixture, with comma'],
        inbudget: '1',
        panel: 'filters',
      }),
    ).toEqual({
      rank: 'tuition',
      dir: 'desc',
      country: ['DE', 'UK'],
      fit: ['meets', 'below'],
      intake: ['Fixture Autumn 2027', 'Fixture, with comma'],
      budget: true,
      panel: true,
    });
  });

  it('invalid values fall back to defaults or are dropped', () => {
    const q = parseShortlistQuery({
      rank: 'chances',
      dir: 'sideways',
      country: 'DE,<script>,toolongcode',
      fit: 'meets,maybe',
      inbudget: 'nope',
      panel: 'other',
    });
    expect(q.rank).toBe('fit');
    expect(q.dir).toBe('asc');
    expect(q.country).toEqual(['DE']);
    expect(q.fit).toEqual(['meets']);
    expect(q.budget).toBe(false);
    expect(q.panel).toBe(false);
  });

  it('country=all and repeated params', () => {
    expect(parseShortlistQuery({ country: 'all' }).country).toBe('all');
    expect(parseShortlistQuery({ country: ['DE', 'UK', 'DE'] }).country).toEqual(['DE', 'UK']);
    expect(parseShortlistQuery({ rank: ['deadline', 'fit'] }).rank).toBe('deadline');
    expect(parseShortlistQuery({ country: ',' }).country).toBeNull();
  });

  it('does not treat the profile `budget` (PKR amount) as the "Within my budget" filter', () => {
    expect(parseShortlistQuery({ budget: '6000000' }).budget).toBe(false);
  });

  it('caps very long lists and long intake text', () => {
    const many = Array.from({ length: 50 }, (_, i) => `Intake ${i}`);
    expect(parseShortlistQuery({ intake: many }).intake).toHaveLength(20);
    expect(parseShortlistQuery({ intake: 'x'.repeat(200) }).intake).toEqual([]);
  });
});

describe('shortlistHref', () => {
  const profileLink = { cgpa: '2.5', scale: 'cgpa_4', field: 'cs', countries: 'DE,UK', budget: '6000000' };

  it('keeps the other params (profile of a shareable link) when changing one', () => {
    const href = shortlistHref({ ...profileLink, rank: 'tuition' }, { dir: 'desc' });
    const url = new URL(href, 'https://x.test');
    expect(url.pathname).toBe('/shortlist');
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...profileLink, rank: 'tuition', dir: 'desc' });
    expect(href).toContain('countries=DE,UK'); // commas stay readable
  });

  it('omits defaults', () => {
    expect(shortlistHref({ rank: 'tuition', dir: 'desc' }, { rank: 'fit', dir: 'asc' })).toBe('/shortlist');
    expect(shortlistHref({ rank: 'tuition' }, { rank: null })).toBe('/shortlist');
    expect(shortlistHref({}, {})).toBe('/shortlist');
  });

  it('writes lists: commas for codes, repeated params for intake', () => {
    const href = shortlistHref({}, { country: ['DE', 'UK'], fit: ['meets'], intake: ['A, B', 'C'], budget: true, panel: true });
    const url = new URL(href, 'https://x.test');
    expect(url.searchParams.get('country')).toBe('DE,UK');
    expect(url.searchParams.get('fit')).toBe('meets');
    expect(url.searchParams.getAll('intake')).toEqual(['A, B', 'C']);
    expect(url.searchParams.get('inbudget')).toBe('1');
    expect(url.searchParams.get('panel')).toBe('filters');
    // Round trip.
    const sp: Record<string, string | string[]> = {};
    for (const k of new Set(url.searchParams.keys())) {
      const all = url.searchParams.getAll(k);
      sp[k] = all.length > 1 ? all : all[0];
    }
    expect(parseShortlistQuery(sp)).toMatchObject({ country: ['DE', 'UK'], fit: ['meets'], intake: ['A, B', 'C'], budget: true });
  });

  it('country=all and clearing', () => {
    expect(shortlistHref({}, { country: 'all' })).toBe('/shortlist?country=all');
    expect(shortlistHref({ country: 'DE', fit: 'meets', intake: ['A'], inbudget: '1', rank: 'deadline' }, CLEAR_FILTERS)).toBe(
      '/shortlist?rank=deadline',
    );
  });

  it('replaces repeated params and supports another pathname', () => {
    expect(shortlistHref({ intake: ['A', 'B'] }, { intake: ['C'] }, '/x')).toBe('/x?intake=C');
  });
});

describe('small helpers', () => {
  it('activeFilterCount', () => {
    expect(activeFilterCount(DEFAULT_QUERY)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_QUERY, country: 'all', intake: ['A', 'B'] })).toBe(2);
  });

  it('toggleValue', () => {
    expect(toggleValue(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('profileQueryString keeps only profile params, and only for a complete profile link', () => {
    expect(profileQueryString({ cgpa: '2.5', scale: 'cgpa_4', countries: 'DE,UK', rank: 'tuition' })).toBe(
      '?cgpa=2.5&scale=cgpa_4&countries=DE,UK',
    );
    expect(profileQueryString({ cgpa: '2.5' })).toBe('');
    expect(profileQueryString({})).toBe('');
  });
});
