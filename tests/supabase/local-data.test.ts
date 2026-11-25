import { describe, expect, it } from 'vitest';
import {
  CHECKLIST_PREFIX,
  LOCAL_PREFIX,
  SAVED_KEY,
  describeLocalData,
  localDataSnapshot,
  parseLocalDataSnapshot,
} from '@/app/account/local-data';
import { PROFILE_COOKIE, PROFILE_STORAGE_KEY, STRENGTHS_STORAGE_KEY } from '@/lib/profile';
import { CHECKLIST_KEY_PREFIX } from '@/lib/program/checklist';
import { SAVED_STORAGE_KEY } from '@/lib/shortlist/saved';

describe('describeLocalData ("Your data on this device")', () => {
  it('uses the same keys as the modules that write them', () => {
    expect(SAVED_KEY).toBe(SAVED_STORAGE_KEY);
    expect(CHECKLIST_PREFIX).toBe(CHECKLIST_KEY_PREFIX);
    for (const k of [PROFILE_STORAGE_KEY, STRENGTHS_STORAGE_KEY, SAVED_STORAGE_KEY, CHECKLIST_KEY_PREFIX, PROFILE_COOKIE]) {
      expect(k.startsWith(LOCAL_PREFIX)).toBe(true); // so clearLocalData() deletes it
    }
  });

  it('names each kind of data once, counting checklists', () => {
    const items = describeLocalData(
      [PROFILE_STORAGE_KEY, STRENGTHS_STORAGE_KEY, SAVED_STORAGE_KEY, `${CHECKLIST_KEY_PREFIX}a`, `${CHECKLIST_KEY_PREFIX}b`, 'mp_other', 'not-ours'],
      [PROFILE_COOKIE],
    );
    expect(items.map((i) => i.id)).toEqual(['cookie-profile', 'checklists', 'other', 'profile', 'shortlist', 'strengths']);
    expect(items.find((i) => i.id === 'checklists')?.count).toBe(2);
    expect(items.find((i) => i.id === 'cookie-profile')?.where).toBe('Cookie');
    expect(items.some((i) => i.label.includes('not-ours'))).toBe(false);
  });

  it('is empty when nothing is stored', () => {
    expect(describeLocalData([], [])).toEqual([]);
    expect(describeLocalData(['other-app'], ['session'])).toEqual([]);
  });
});

describe('local data snapshot', () => {
  it('is stable and only lists our keys and cookies', () => {
    const a = localDataSnapshot(['mp_saved', 'x', 'mp_profile', 'mp_saved'], 'a=1; mp_profile=abc; sb-auth=zzz');
    const b = localDataSnapshot(['mp_profile', 'mp_saved'], 'mp_profile=def;a=2');
    expect(a).toBe(b);
    expect(parseLocalDataSnapshot(a)).toEqual({ keys: ['mp_profile', 'mp_saved'], cookies: ['mp_profile'] });
  });

  it('never exposes cookie values', () => {
    expect(localDataSnapshot([], 'mp_profile=SECRET-VALUE')).not.toMatch(/SECRET/);
  });

  it('survives junk', () => {
    expect(parseLocalDataSnapshot('not json')).toEqual({ keys: [], cookies: [] });
    expect(parseLocalDataSnapshot('{"keys":[1,"mp_x"],"cookies":null}')).toEqual({ keys: ['mp_x'], cookies: [] });
  });
});
