/**
 * Shared profile links and saved profiles (proposals #18 and #24): every probe input from the audit.
 * A link is read the way the student meant it, or rejected; it is never read as a different profile.
 */
import { describe, expect, it } from 'vitest';
import { convertGrade } from './fit';
import { parseAmount, parseDecimal } from './parse';
import {
  PERSONA_A,
  deserializeProfile,
  normaliseCountryCodes,
  parseProfile,
  profileFromSearchParams,
  profileLinkStatus,
  serializeProfile,
  validMinPass,
} from './profile';
import type { ConversionRule } from './types';

const link = (query: string) => profileFromSearchParams(Object.fromEntries(new URLSearchParams(query)));
const BASE = 'scale=cgpa_4&field=cs';

describe('parse helpers (src/lib/parse.ts)', () => {
  it('parseDecimal accepts comma decimals and rejects junk', () => {
    expect(parseDecimal('2,5')).toBe(2.5);
    expect(parseDecimal(' 2.75 ')).toBe(2.75);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('0x10')).toBeNaN();
    expect(parseDecimal('1e3')).toBeNaN();
  });
  it('parseAmount accepts western and lakh grouping', () => {
    expect(parseAmount('6,000,000')).toBe(6_000_000);
    expect(parseAmount('60,00,000')).toBe(6_000_000);
    expect(parseAmount('PKR 6,000,000')).toBe(6_000_000);
    expect(parseAmount('sixty lakh')).toBeNaN();
  });
  it('the onboarding module re-exports the same functions (no copy to drift)', async () => {
    const form = await import('./onboarding/profile-form');
    expect(form.parseDecimal).toBe(parseDecimal);
    expect(form.parseAmount).toBe(parseAmount);
  });
});

describe('profileFromSearchParams: CGPA', () => {
  it('a blank CGPA is invalid, never 0', () => {
    expect(link(`cgpa=&${BASE}`)).toBeNull();
    expect(link(`cgpa=%20&${BASE}`)).toBeNull();
    expect(parseProfile({ cgpa: null, scale: 'cgpa_4' })).toBeNull();
    expect(parseProfile({ cgpa: '', scale: 'cgpa_4' })).toBeNull();
    expect(parseProfile({ scale: 'cgpa_4' })).toBeNull();
  });
  it('a real 0 is still a grade', () => {
    expect(link(`cgpa=0&${BASE}`)?.cgpa).toBe(0);
  });
  it('reads a comma decimal ("2,5")', () => {
    expect(link(`cgpa=2,5&${BASE}`)?.cgpa).toBe(2.5);
  });
  it('rejects junk and grades above the scale', () => {
    expect(link(`cgpa=abc&${BASE}`)).toBeNull();
    expect(link(`cgpa=0x3&${BASE}`)).toBeNull();
    expect(link(`cgpa=4.5&${BASE}`)).toBeNull();
    expect(link('cgpa=72&scale=percent')?.cgpa).toBe(72);
  });
  it('reads an upper-case scale', () => {
    expect(link('cgpa=2.5&scale=CGPA_4')?.scale).toBe('cgpa_4');
  });
});

describe('profileFromSearchParams: countries and field', () => {
  it('upper-cases country codes', () => {
    expect(link(`cgpa=2.5&${BASE}&countries=de,uk`)?.target_countries).toEqual(['DE', 'UK']);
    expect(link(`cgpa=2.5&${BASE}&countries=de,uk,ca,us`)?.target_countries).toEqual(['DE', 'UK', 'CA', 'US']);
    expect(link(`cgpa=2.5&${BASE}&countries=%20de%20,%20uk`)?.target_countries).toEqual(['DE', 'UK']);
  });
  it('maps GB to UK and removes duplicates', () => {
    expect(link(`cgpa=2.5&${BASE}&countries=GB,XX`)?.target_countries).toEqual(['UK', 'XX']);
    expect(link(`cgpa=2.5&${BASE}&countries=gb,UK`)?.target_countries).toEqual(['UK']);
    expect(normaliseCountryCodes(['us', 'GB', 'uk', 'De'])).toEqual(['US', 'UK', 'DE']);
  });
  it('lower-cases the field slug', () => {
    expect(link('cgpa=2.5&scale=cgpa_4&field=CS')?.field).toBe('cs');
    expect(link('cgpa=2.5&scale=cgpa_4&field=%20DS%20')?.field).toBe('ds');
    expect(link('cgpa=2.5&scale=cgpa_4')?.field).toBe('cs');
  });
});

describe('profileFromSearchParams: transcript minimum', () => {
  it('drops an impossible minimum to null but keeps the profile', () => {
    const p = link(`cgpa=2.5&${BASE}&min_pass=3.5`);
    expect(p).not.toBeNull();
    expect(p?.cgpa).toBe(2.5);
    expect(p?.min_pass).toBeNull();
    expect(link(`cgpa=3.5&${BASE}&min_pass=4`)?.min_pass).toBeNull(); // not below the scale maximum
    expect(link(`cgpa=3.5&${BASE}&min_pass=-1`)?.min_pass).toBeNull();
    expect(link(`cgpa=3.5&${BASE}&min_pass=D`)?.min_pass).toBeNull();
    expect(link(`cgpa=3.5&${BASE}&min_pass=`)?.min_pass).toBeNull();
  });
  it('keeps a possible minimum, including a comma decimal and a pass exactly at the minimum', () => {
    expect(link(`cgpa=2.5&${BASE}&min_pass=2,0`)?.min_pass).toBe(2);
    expect(link(`cgpa=2&${BASE}&min_pass=2`)?.min_pass).toBe(2);
    expect(link('cgpa=70&scale=percent&min_pass=40')?.min_pass).toBe(40);
    expect(link('cgpa=70&scale=percent&min_pass=99')?.min_pass).toBeNull(); // above the grade
  });
  it('validMinPass encodes 0 <= min_pass <= cgpa and min_pass < scale max', () => {
    expect(validMinPass({ cgpa: 2.5, scale: 'cgpa_4', min_pass: 2 })).toBe(2);
    expect(validMinPass({ cgpa: 2.5, scale: 'cgpa_4', min_pass: 2.6 })).toBeNull();
    expect(validMinPass({ cgpa: 4, scale: 'cgpa_4', min_pass: 4 })).toBeNull();
    expect(validMinPass({ cgpa: 3, scale: 'cgpa_4', min_pass: 0 })).toBe(0);
    expect(validMinPass({ cgpa: 3, scale: 'cgpa_4', min_pass: null })).toBeNull();
  });
  it('the audit probe: an impossible minimum no longer converts 2.5/4 to a German 10.0', () => {
    const rule: ConversionRule = {
      id: 'fixture-bavarian',
      scope: 'PK->*',
      from_scale: 'cgpa_4',
      to_scale: 'german',
      formula: 'modified_bavarian',
      params: { nmax: 4, nmin: [1, 2] },
      source_url: 'https://fixture.example.edu/conversion',
    };
    const p = link(`cgpa=2.5&${BASE}&min_pass=3.5`)!;
    const conv = convertGrade(p, 'german', 'DE', [rule]);
    expect(conv.ok && [conv.range.low, conv.range.high]).toEqual([2.5, 3.25]);
  });
});

describe('profileFromSearchParams: budget', () => {
  it('reads thousands and lakh separators', () => {
    expect(link(`cgpa=2.5&${BASE}&budget=6,000,000`)?.budget_pkr).toBe(6_000_000);
    expect(link(`cgpa=2.5&${BASE}&budget=60,00,000`)?.budget_pkr).toBe(6_000_000);
    expect(link(`cgpa=2.5&${BASE}&budget=6000000`)?.budget_pkr).toBe(6_000_000);
  });
  it('a budget of 0 means no budget (null), the same in every engine', () => {
    expect(link(`cgpa=2.5&${BASE}&budget=0`)?.budget_pkr).toBeNull();
    expect(parseProfile({ ...PERSONA_A, budget_pkr: 0 })?.budget_pkr).toBeNull();
    expect(link(`cgpa=2.5&${BASE}&budget=`)?.budget_pkr).toBeNull();
  });
  it('a junk or negative budget rejects the link (it is not silently dropped)', () => {
    expect(link(`cgpa=2.5&${BASE}&budget=a%20lot`)).toBeNull();
    expect(link(`cgpa=2.5&${BASE}&budget=-5`)).toBeNull();
  });
});

describe('profileLinkStatus', () => {
  const sp = (q: string) => Object.fromEntries(new URLSearchParams(q));
  it('none when the link carries no profile', () => {
    expect(profileLinkStatus(sp(''))).toBe('none');
    expect(profileLinkStatus(sp('cgpa=2.5'))).toBe('none');
    expect(profileLinkStatus(sp('rank=fit'))).toBe('none');
  });
  it('ok for a readable profile, rejected for one that cannot be read', () => {
    expect(profileLinkStatus(sp(`cgpa=2,5&${BASE}&budget=6,000,000&countries=de,gb`))).toBe('ok');
    expect(profileLinkStatus(sp(`cgpa=&${BASE}`))).toBe('rejected');
    expect(profileLinkStatus(sp('cgpa=2.5&scale=gpa_10'))).toBe('rejected');
  });
});

describe('saved profiles still round-trip', () => {
  it('persona A through the cookie format', () => {
    expect(deserializeProfile(serializeProfile(PERSONA_A))).toEqual(PERSONA_A);
  });
  it('absent optional keys stay absent', () => {
    const p = parseProfile({ cgpa: 3, scale: 'cgpa_4', field: 'cs', target_countries: [] });
    expect(p).toEqual({ cgpa: 3, scale: 'cgpa_4', field: 'cs', target_countries: [] });
    expect(p && 'min_pass' in p).toBe(false);
    expect(p && 'budget_pkr' in p).toBe(false);
  });
});
