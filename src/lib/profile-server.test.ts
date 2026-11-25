/** getRequestProfileState: the link wins; a link that cannot be read is reported, never swapped silently. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERSONA_A, PROFILE_COOKIE, serializeProfile } from './profile';

const cookieJar = new Map<string, string>();
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined) }),
}));

const { getRequestProfile, getRequestProfileState } = await import('./profile-server');

afterEach(() => cookieJar.clear());

describe('getRequestProfileState', () => {
  it('uses a readable link and says so', async () => {
    cookieJar.set(PROFILE_COOKIE, serializeProfile({ ...PERSONA_A, cgpa: 3.6 }));
    const s = await getRequestProfileState({ cgpa: '2,5', scale: 'cgpa_4', countries: 'de,uk' });
    expect(s).toMatchObject({ source: 'link', linkRejected: false });
    expect(s.profile?.cgpa).toBe(2.5);
    expect(s.profile?.target_countries).toEqual(['DE', 'UK']);
  });

  it('falls back to the device profile and flags the rejected link', async () => {
    cookieJar.set(PROFILE_COOKIE, serializeProfile({ ...PERSONA_A, cgpa: 3.6 }));
    const s = await getRequestProfileState({ cgpa: '', scale: 'cgpa_4' });
    expect(s.source).toBe('device');
    expect(s.linkRejected).toBe(true);
    expect(s.profile?.cgpa).toBe(3.6);
  });

  it('no link and no cookie -> no profile', async () => {
    expect(await getRequestProfileState({})).toEqual({ profile: null, source: null, linkRejected: false });
    expect(await getRequestProfile()).toBeNull();
  });

  it('getRequestProfile keeps its old contract (profile only)', async () => {
    cookieJar.set(PROFILE_COOKIE, serializeProfile(PERSONA_A));
    expect(await getRequestProfile({ cgpa: 'abc', scale: 'cgpa_4' })).toEqual(PERSONA_A);
  });
});
