import { describe, expect, it } from 'vitest';
import { PERSONA_A, PERSONA_B_STRENGTHS, parseProfile, profileFromSearchParams } from '../profile';
import type { Profile } from '../types';
import { EMPTY_STRENGTHS } from './strengths-form';
import {
  budgetHelperText,
  emptyOnboardingValues,
  normaliseCountries,
  normaliseName,
  parseAmount,
  parseDecimal,
  profileToValues,
  resolveUniversityId,
  shortlistHref,
  toggleCountry,
  validateOnboarding,
  validateQuickStart,
  type OnboardingValues,
} from './profile-form';

const UNIS = [
  { id: 'fixture-home-uni', name: 'Fixture Home University' },
  { id: 'fixture-tech', name: 'Fixture Institute of Technology' },
];

function values(over: Partial<OnboardingValues> = {}): OnboardingValues {
  return { ...emptyOnboardingValues(), cgpa: '3.1', ...over };
}

describe('parseDecimal', () => {
  it('parses plain and comma decimals', () => {
    expect(parseDecimal('2.5')).toBe(2.5);
    expect(parseDecimal(' 2,75 ')).toBe(2.75);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(parseDecimal('3.')).toBe(3);
  });
  it('returns null for empty and NaN for junk', () => {
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('   ')).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('-1')).toBeNaN();
    expect(parseDecimal('1e3')).toBeNaN();
    expect(parseDecimal('2.5.1')).toBeNaN();
  });
});

describe('parseAmount', () => {
  it('accepts separators and a PKR/Rs prefix', () => {
    expect(parseAmount('6000000')).toBe(6_000_000);
    expect(parseAmount('6,000,000')).toBe(6_000_000);
    expect(parseAmount('60 00 000')).toBe(6_000_000);
    expect(parseAmount('PKR 6,000,000')).toBe(6_000_000);
    expect(parseAmount('Rs. 500000')).toBe(500_000);
  });
  it('rejects junk', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('sixty lakh')).toBeNaN();
    expect(parseAmount('-5')).toBeNaN();
  });
});

describe('budgetHelperText', () => {
  it('shows lakh / crore through formatPkr', () => {
    expect(budgetHelperText('6000000')).toBe('= PKR 6,000,000 (60 lakh)');
    expect(budgetHelperText('25000000')).toBe('= PKR 25,000,000 (2.5 crore)');
  });
  it('shows nothing for empty, zero or invalid input', () => {
    expect(budgetHelperText('')).toBeNull();
    expect(budgetHelperText('0')).toBeNull();
    expect(budgetHelperText('abc')).toBeNull();
  });
});

describe('country toggling', () => {
  it('adds and removes, keeping the supported order', () => {
    expect(toggleCountry([], 'UK')).toEqual(['UK']);
    expect(toggleCountry(['UK'], 'DE')).toEqual(['DE', 'UK']);
    expect(toggleCountry(['DE', 'UK'], 'DE')).toEqual(['UK']);
    expect(toggleCountry(['UK'], 'de')).toEqual(['DE', 'UK']);
  });
  it('ignores unsupported codes and removes duplicates', () => {
    expect(toggleCountry(['UK'], 'XX')).toEqual(['UK']);
    expect(normaliseCountries(['US', 'uk', 'US', 'ZZ'])).toEqual(['UK', 'US']);
    expect(normaliseCountries(null)).toEqual([]);
  });
});

describe('university matching', () => {
  it('matches names ignoring case, spacing and accents', () => {
    expect(normaliseName('  Fixture   HOME University ')).toBe('fixture home university');
    expect(normaliseName('Würzburg')).toBe('wurzburg');
    expect(resolveUniversityId('fixture home university', UNIS)).toBe('fixture-home-uni');
    expect(resolveUniversityId('Fixture  Institute of technology', UNIS)).toBe('fixture-tech');
  });
  it('returns null when there is no exact match', () => {
    expect(resolveUniversityId('Fixture', UNIS)).toBeNull();
    expect(resolveUniversityId('', UNIS)).toBeNull();
    expect(resolveUniversityId(null, UNIS)).toBeNull();
  });
});

describe('validateOnboarding', () => {
  it('maps form values to a valid Profile', () => {
    const r = validateOnboarding(
      values({
        cgpa: '2,5',
        scale: 'cgpa_4',
        min_pass: '2.0',
        university_name: '  fixture home   university ',
        degree: ' BS Computer Science ',
        field: 'ds',
        budget_pkr: '6,000,000',
        target_countries: ['UK', 'DE', 'XX'],
      }),
      UNIS,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile).toEqual<Profile>({
      cgpa: 2.5,
      scale: 'cgpa_4',
      min_pass: 2,
      university_name: 'fixture home university',
      university_id: 'fixture-home-uni',
      degree: 'BS Computer Science',
      field: 'ds',
      budget_pkr: 6_000_000,
      target_countries: ['DE', 'UK'],
      persona: null,
    });
    // The result must round-trip through the shared schema.
    expect(parseProfile(r.profile)).toEqual(r.profile);
  });

  it('keeps optional fields null when blank', () => {
    const r = validateOnboarding(values({ cgpa: '72', scale: 'percent' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.min_pass).toBeNull();
    expect(r.profile.university_name).toBeNull();
    expect(r.profile.university_id).toBeNull();
    expect(r.profile.degree).toBeNull();
    expect(r.profile.budget_pkr).toBeNull();
    expect(r.profile.target_countries).toEqual([]);
  });

  it('keeps an unknown university name without an id', () => {
    const r = validateOnboarding(values({ university_name: 'Some Other University' }), UNIS);
    expect(r.ok && r.profile.university_id).toBeNull();
    expect(r.ok && r.profile.university_name).toBe('Some Other University');
  });

  it('requires a CGPA (empty is not zero)', () => {
    const r = validateOnboarding(values({ cgpa: '' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.cgpa).toMatch(/Enter your CGPA/);
  });

  it('checks the CGPA against the chosen scale', () => {
    const r = validateOnboarding(values({ cgpa: '4.5', scale: 'cgpa_4' }));
    expect(!r.ok && r.errors.cgpa).toBe('Enter a number from 0 to 4.');
    expect(validateOnboarding(values({ cgpa: '4.5', scale: 'cgpa_5' })).ok).toBe(true);
    const pct = validateOnboarding(values({ cgpa: '', scale: 'percent' }));
    expect(!pct.ok && pct.errors.cgpa).toBe('Enter your percentage.');
  });

  it('rejects an unknown scale or field', () => {
    const r = validateOnboarding(values({ scale: 'gpa_10', field: 'astrology' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.scale).toBeTruthy();
    expect(r.errors.field).toBe('Choose a field.');
  });

  it('validates the lowest passing grade', () => {
    const atMax = validateOnboarding(values({ cgpa: '3', min_pass: '4' }));
    expect(!atMax.ok && atMax.errors.min_pass).toMatch(/lower than 4/);
    const aboveCgpa = validateOnboarding(values({ cgpa: '2.2', min_pass: '2.5' }));
    expect(!aboveCgpa.ok && aboveCgpa.errors.min_pass).toMatch(/higher than your CGPA/);
    const junk = validateOnboarding(values({ min_pass: 'D' }));
    expect(!junk.ok && junk.errors.min_pass).toBeTruthy();
  });

  it('a budget of 0 is saved as "no budget" (null), like a blank budget', () => {
    const r = validateOnboarding(values({ budget_pkr: '0' }));
    expect(r.ok && r.profile.budget_pkr).toBeNull();
    const lakh = validateOnboarding(values({ budget_pkr: '60,00,000' }));
    expect(lakh.ok && lakh.profile.budget_pkr).toBe(6_000_000);
  });

  it('keeps a transcript minimum equal to the CGPA (a pass exactly at the minimum)', () => {
    const r = validateOnboarding(values({ cgpa: '2', min_pass: '2' }));
    expect(r.ok && r.profile.min_pass).toBe(2);
  });

  it('validates the budget', () => {
    const junk = validateOnboarding(values({ budget_pkr: 'a lot' }));
    expect(!junk.ok && junk.errors.budget_pkr).toBeTruthy();
    const huge = validateOnboarding(values({ budget_pkr: '5000000000' }));
    expect(!huge.ok && huge.errors.budget_pkr).toMatch(/crore/);
  });

  it('limits free-text lengths', () => {
    const r = validateOnboarding(values({ university_name: 'x'.repeat(121), degree: 'y'.repeat(81) }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.university_name).toBeTruthy();
    expect(r.errors.degree).toBeTruthy();
  });

  it('never returns passport or ID fields', () => {
    const r = validateOnboarding({ ...values(), passport: 'AB1234567' } as OnboardingValues);
    expect(r.ok && Object.keys(r.profile)).not.toContain('passport');
  });
});

describe('validateQuickStart (Home)', () => {
  const own: Profile = {
    cgpa: 3.2,
    scale: 'cgpa_4',
    min_pass: 2,
    university_name: 'Fixture Home University',
    university_id: 'fixture-home-uni',
    degree: 'BS',
    field: 'cs',
    budget_pkr: 5_000_000,
    target_countries: ['DE', 'UK'],
    persona: null,
  };

  it('builds a minimal profile when nothing is saved', () => {
    const r = validateQuickStart({ cgpa: '2.5', scale: 'cgpa_4', field: 'cs' }, null);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile).toMatchObject({ cgpa: 2.5, scale: 'cgpa_4', field: 'cs', target_countries: [], persona: null });
    expect(r.resetDemoStrengths).toBe(false);
  });

  it('keeps existing profile fields such as target countries', () => {
    const r = validateQuickStart({ cgpa: '2.9', scale: 'cgpa_4', field: 'ds' }, own);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile).toMatchObject({
      cgpa: 2.9,
      field: 'ds',
      target_countries: ['DE', 'UK'],
      budget_pkr: 5_000_000,
      university_id: 'fixture-home-uni',
      min_pass: 2,
    });
  });

  it('drops the transcript minimum when the scale changes or it exceeds the new grade', () => {
    const scaleChange = validateQuickStart({ cgpa: '70', scale: 'percent', field: 'cs' }, own);
    expect(scaleChange.ok && scaleChange.profile.min_pass).toBeNull();
    const lower = validateQuickStart({ cgpa: '1.5', scale: 'cgpa_4', field: 'cs' }, own);
    expect(lower.ok && lower.profile.min_pass).toBeNull();
  });

  it('does not merge fictional demo persona values into real input', () => {
    const r = validateQuickStart({ cgpa: '3.0', scale: 'cgpa_4', field: 'cs' }, PERSONA_A);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.profile.persona).toBeNull();
    expect(r.profile.university_name ?? null).toBeNull();
    expect(r.profile.target_countries).toEqual([]);
    expect(r.resetDemoStrengths).toBe(false);
    const fromB = validateQuickStart({ cgpa: '3.0', scale: 'cgpa_4', field: 'cs' }, { ...PERSONA_A, persona: 'B' });
    expect(fromB.resetDemoStrengths).toBe(true);
  });

  it('clears the fictional demo strengths even after the persona marker is gone', () => {
    const q = { cgpa: '3.0', scale: 'cgpa_4', field: 'cs' };
    const demo = JSON.parse(JSON.stringify(PERSONA_B_STRENGTHS));
    expect(validateQuickStart(q, own, demo).resetDemoStrengths).toBe(true);
    expect(validateQuickStart(q, own, { ...EMPTY_STRENGTHS, other: ['Fixture award'] }).resetDemoStrengths).toBe(false);
    expect(validateQuickStart(q, own, null).resetDemoStrengths).toBe(false);
  });

  it('returns field errors', () => {
    const r = validateQuickStart({ cgpa: '', scale: 'cgpa_4', field: '' }, null);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.cgpa).toBeTruthy();
    expect(r.errors.field).toBeTruthy();
  });
});

describe('profileToValues', () => {
  it('prefills from a saved profile and round-trips', () => {
    const v = profileToValues(PERSONA_A);
    expect(v).toMatchObject({ cgpa: '2.5', scale: 'cgpa_4', field: 'cs', budget_pkr: '6000000', min_pass: '' });
    expect(v.target_countries).toEqual(['DE', 'UK', 'CA', 'US']);
    const back = validateOnboarding(v, [{ id: PERSONA_A.university_id!, name: PERSONA_A.university_name! }]);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.profile).toEqual({ ...PERSONA_A, persona: null });
  });

  it('returns empty values without a profile', () => {
    expect(profileToValues(null)).toEqual(emptyOnboardingValues());
  });

  it('maps an unknown field slug to "other"', () => {
    expect(profileToValues({ ...PERSONA_A, field: 'mech' }).field).toBe('other');
  });
});

describe('shortlistHref', () => {
  const parse = (href: string) => {
    const [path, query] = href.split('?');
    expect(path).toBe('/shortlist');
    return profileFromSearchParams(Object.fromEntries(new URLSearchParams(query)));
  };

  it('round-trips through profileFromSearchParams', () => {
    expect(parse(shortlistHref(PERSONA_A))).toMatchObject({
      cgpa: PERSONA_A.cgpa,
      scale: PERSONA_A.scale,
      field: PERSONA_A.field,
      budget_pkr: PERSONA_A.budget_pkr,
      target_countries: PERSONA_A.target_countries,
      min_pass: null,
    });
  });

  it('keeps the transcript minimum and leaves out blank optional values', () => {
    const href = shortlistHref({ cgpa: 70, scale: 'percent', field: 'ds', min_pass: 40, target_countries: [] });
    expect(href).not.toMatch(/budget|countries/);
    expect(parse(href)).toMatchObject({ cgpa: 70, scale: 'percent', field: 'ds', min_pass: 40, target_countries: [] });
  });

  it('never puts the university or degree in the URL', () => {
    const href = shortlistHref({ ...PERSONA_A, university_name: 'Fixture Home University', degree: 'BS Fixture' });
    expect(href).not.toMatch(/university|degree|Fixture/i);
  });
});
