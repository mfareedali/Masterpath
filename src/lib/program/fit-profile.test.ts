import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERSONA_A } from '@/lib/profile';
import { loadProfile } from '@/lib/profile-client';
import type { Profile } from '@/lib/types';
import { planBHrefFor, profileFromQuery, profileParams, readFitProfileJson, resolveFitProfile, shortlistBackHref } from './fit-profile';

// The exact query the shortlist adds to program links (review finding: the program page ignored it).
const SHORTLIST_QUERY = '?cgpa=2.5&scale=cgpa_4&field=cs&budget=6000000&countries=DE,UK,CA,US';

const saved: Profile = { cgpa: 3.2, scale: 'cgpa_4', field: 'cs', target_countries: ['DE'] };

describe('profileFromQuery', () => {
  it('reads the profile that shortlist links pass', () => {
    const p = profileFromQuery(SHORTLIST_QUERY);
    expect(p).toMatchObject({ cgpa: 2.5, scale: 'cgpa_4', field: 'cs', budget_pkr: 6_000_000 });
    expect(p?.target_countries).toEqual(['DE', 'UK', 'CA', 'US']);
  });

  it('returns null without cgpa and scale, or with an invalid grade', () => {
    expect(profileFromQuery('')).toBeNull();
    expect(profileFromQuery('?cgpa=2.5')).toBeNull();
    expect(profileFromQuery('?cgpa=9&scale=cgpa_4')).toBeNull();
    expect(profileFromQuery('?cgpa=abc&scale=cgpa_4')).toBeNull();
  });
});

describe('resolveFitProfile', () => {
  it('regression (#19): a valid profile in the link wins over the device, as on /shortlist and /plan-b', () => {
    const r = resolveFitProfile(saved, SHORTLIST_QUERY);
    expect(r?.source).toBe('link');
    expect(r?.profile.cgpa).toBe(2.5);
  });

  it('uses the device profile when the link has no profile or an invalid one', () => {
    expect(resolveFitProfile(saved, '')).toEqual({ profile: saved, source: 'device' });
    expect(resolveFitProfile(saved, '?rank=tuition')).toEqual({ profile: saved, source: 'device' });
    expect(resolveFitProfile(saved, '?cgpa=9&scale=cgpa_4')).toEqual({ profile: saved, source: 'device' });
    expect(resolveFitProfile(saved, '?cgpa=2.5')).toEqual({ profile: saved, source: 'device' });
  });

  it('regression: falls back to the profile in the link when nothing is saved', () => {
    const r = resolveFitProfile(null, SHORTLIST_QUERY);
    expect(r?.source).toBe('link');
    expect(r?.profile.cgpa).toBe(2.5);
  });

  it('is null when there is no profile anywhere', () => {
    expect(resolveFitProfile(null, '')).toBeNull();
    expect(resolveFitProfile(null, '?fit=below')).toBeNull();
  });
});

/** Minimal browser storage stubs that record every write. */
function stubBrowser(stored: Profile | null) {
  const store = new Map<string, string>();
  if (stored) store.set('mp_profile', JSON.stringify(stored));
  const setItem = vi.fn();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem,
    removeItem: vi.fn(),
    key: () => null,
    length: store.size,
  });
  const cookieWrites: string[] = [];
  const doc = {};
  Object.defineProperty(doc, 'cookie', {
    get: () => '',
    set: (v: string) => {
      cookieWrites.push(v);
    },
  });
  vi.stubGlobal('document', doc);
  return { setItem, cookieWrites };
}

describe('readFitProfileJson with browser storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('regression: nothing stored + shortlist link -> the link profile, kept in memory only (never saved)', () => {
    const { setItem, cookieWrites } = stubBrowser(null);
    const raw = readFitProfileJson(SHORTLIST_QUERY, loadProfile);
    expect(raw).not.toBeNull();
    const state = JSON.parse(raw as string);
    expect(state.source).toBe('link');
    expect(state.profile.cgpa).toBe(2.5);
    expect(setItem).not.toHaveBeenCalled();
    expect(cookieWrites).toEqual([]);
  });

  it('regression (#19): a valid link profile wins over a saved one, and nothing is written', () => {
    const { setItem, cookieWrites } = stubBrowser(PERSONA_A);
    const state = JSON.parse(readFitProfileJson('?cgpa=3.9&scale=cgpa_4', loadProfile) as string);
    expect(state.source).toBe('link');
    expect(state.profile.cgpa).toBe(3.9);
    expect(setItem).not.toHaveBeenCalled();
    expect(cookieWrites).toEqual([]);
  });

  it('a saved profile is used when the link carries none', () => {
    stubBrowser(PERSONA_A);
    const state = JSON.parse(readFitProfileJson('?utm_source=x', loadProfile) as string);
    expect(state.source).toBe('device');
    expect(state.profile.cgpa).toBe(PERSONA_A.cgpa);
  });

  it('a loader that throws (blocked storage) still falls back to the link', () => {
    const raw = readFitProfileJson(SHORTLIST_QUERY, () => {
      throw new Error('blocked');
    });
    expect(JSON.parse(raw as string).source).toBe('link');
  });

  it('returns a stable string, so useSyncExternalStore snapshots compare equal', () => {
    stubBrowser(null);
    expect(readFitProfileJson(SHORTLIST_QUERY, loadProfile)).toBe(readFitProfileJson(SHORTLIST_QUERY, loadProfile));
    expect(readFitProfileJson('', loadProfile)).toBeNull();
  });
});

describe('planBHrefFor / profileParams', () => {
  it('links to Plan B for this program with the profile params shortlist links use', () => {
    expect(planBHrefFor(PERSONA_A, 'brookes-msc-cs')).toBe(
      '/plan-b?cgpa=2.5&scale=cgpa_4&field=cs&budget=6000000&countries=DE,UK,CA,US&target=brookes-msc-cs',
    );
  });

  it('round-trips through profileFromQuery and never puts university, degree or persona in the URL', () => {
    const p: Profile = { ...PERSONA_A, min_pass: 1.5 };
    const q = profileParams(p);
    expect([...q.keys()].sort()).toEqual(['budget', 'cgpa', 'countries', 'field', 'min_pass', 'scale']);
    const back = profileFromQuery(`?${q.toString()}`);
    expect(back).toMatchObject({ cgpa: 2.5, scale: 'cgpa_4', min_pass: 1.5, field: 'cs', budget_pkr: 6_000_000 });
    expect(planBHrefFor(p, 'x')).not.toMatch(/university|degree|persona|Demo/i);
  });

  it('encodes the program id', () => {
    expect(planBHrefFor({ cgpa: 70, scale: 'percent', field: 'cs', target_countries: [] }, 'a&b')).toBe(
      '/plan-b?cgpa=70&scale=percent&field=cs&target=a%26b',
    );
  });
});

describe('shortlistBackHref', () => {
  it('regression: keeps the profile params of the link so the shortlist is not empty', () => {
    expect(shortlistBackHref(SHORTLIST_QUERY)).toBe(
      '/shortlist?cgpa=2.5&scale=cgpa_4&field=cs&budget=6000000&countries=DE,UK,CA,US',
    );
  });

  it('drops everything that is not a profile param', () => {
    expect(shortlistBackHref('?cgpa=2.5&scale=cgpa_4&utm_source=x&rank=tuition')).toBe('/shortlist?cgpa=2.5&scale=cgpa_4');
  });

  it('plain /shortlist when the link has no valid profile', () => {
    expect(shortlistBackHref('')).toBe('/shortlist');
    expect(shortlistBackHref('?rank=tuition')).toBe('/shortlist');
    expect(shortlistBackHref('?cgpa=9&scale=cgpa_4')).toBe('/shortlist');
  });
});
