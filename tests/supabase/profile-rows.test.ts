import { describe, expect, it } from 'vitest';
import {
  parseStrengths,
  profileToRow,
  rowToProfile,
  rowToStrengths,
  strengthsAreEmpty,
  strengthsToRow,
} from '@/lib/supabase/profile-rows';
import { PERSONA_A, PERSONA_B, PERSONA_B_STRENGTHS } from '@/lib/profile';
import type { Strengths } from '@/lib/types';

const USER = '0b9f2c1e-4a5d-4c3b-9e8f-1a2b3c4d5e6f';

describe('profile <-> profiles row', () => {
  it('round-trips a profile (the demo persona marker is not stored)', () => {
    const row = profileToRow(PERSONA_B, USER);
    expect(row).not.toBeNull();
    expect(row!.user_id).toBe(USER);
    expect('persona' in row!).toBe(false);
    const { persona: _persona, ...rest } = PERSONA_B;
    void _persona;
    expect(rowToProfile(row)).toEqual(expect.objectContaining(rest));
    expect(rowToProfile(row)?.persona ?? null).toBeNull();
  });

  it('stores only the documented columns (no ID numbers)', () => {
    const row = profileToRow({ ...PERSONA_A, passport_number: 'X', cnic: 'Y' }, USER)!;
    expect(Object.keys(row).sort()).toEqual(
      ['budget_pkr', 'cgpa', 'degree', 'field', 'min_pass', 'scale', 'target_countries', 'university_id', 'university_name', 'user_id'].sort(),
    );
    expect(JSON.stringify(row)).not.toMatch(/passport|cnic/i);
  });

  it('rejects invalid profiles and non-uuid user ids', () => {
    expect(profileToRow({ cgpa: 9, scale: 'cgpa_4' }, USER)).toBeNull();
    expect(profileToRow(PERSONA_A, 'not-a-uuid')).toBeNull();
    expect(profileToRow(null, USER)).toBeNull();
  });

  it('accepts numeric columns that arrive as strings', () => {
    const row = { ...profileToRow(PERSONA_A, USER)!, cgpa: String(PERSONA_A.cgpa), budget_pkr: PERSONA_A.budget_pkr == null ? null : String(PERSONA_A.budget_pkr) };
    expect(rowToProfile(row)?.cgpa).toBe(PERSONA_A.cgpa);
    expect(rowToProfile(row)?.budget_pkr ?? null).toBe(PERSONA_A.budget_pkr ?? null);
  });

  it('returns null for junk rows', () => {
    expect(rowToProfile(null)).toBeNull();
    expect(rowToProfile('x')).toBeNull();
    expect(rowToProfile({ cgpa: 'abc', scale: 'cgpa_4' })).toBeNull();
  });
});

describe('strengths <-> profile_strengths row', () => {
  it('round-trips the demo strengths', () => {
    const row = strengthsToRow(PERSONA_B_STRENGTHS, USER);
    expect(row).not.toBeNull();
    const back = rowToStrengths(JSON.parse(JSON.stringify(row)));
    expect(back?.publications).toEqual(PERSONA_B_STRENGTHS.publications);
    expect(back?.research).toEqual(PERSONA_B_STRENGTHS.research);
  });

  it('rejects oversized or malformed strengths', () => {
    const big: Strengths = { publications: [{ title: 'x'.repeat(301), status: 'preprint' }], research: [] };
    expect(parseStrengths(big)).toBeNull();
    expect(parseStrengths({ publications: [{ title: 'Fixture', status: 'famous' }], research: [] })).toBeNull();
    expect(strengthsToRow(PERSONA_B_STRENGTHS, 'nope')).toBeNull();
  });

  it('detects empty strengths', () => {
    expect(strengthsAreEmpty(null)).toBe(true);
    expect(strengthsAreEmpty({ publications: [], research: [], free_text: '   ' })).toBe(true);
    expect(strengthsAreEmpty(PERSONA_B_STRENGTHS)).toBe(false);
    expect(strengthsAreEmpty({ publications: [], research: [], other: ['Fixture award'] })).toBe(false);
  });
});
