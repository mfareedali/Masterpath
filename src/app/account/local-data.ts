/**
 * Describes, in plain words, what MastersPath keeps in this browser. Pure (the client widget passes in the
 * storage keys and cookie names it can see), so it is unit-tested.
 */
import { PROFILE_COOKIE, PROFILE_STORAGE_KEY, STRENGTHS_STORAGE_KEY } from '@/lib/profile';

export interface LocalDataItem {
  id: string;
  label: string;
  detail: string;
  where: 'Cookie' | 'Browser storage';
  count: number;
}

/** Our keys all start with this prefix (see clearLocalData in src/lib/profile-client.ts). */
export const LOCAL_PREFIX = 'mp_';

/**
 * Keys written by other modules. Kept as literals (no import) so this client file stays tiny; a unit test checks
 * they still match SAVED_STORAGE_KEY (src/lib/shortlist/saved.ts) and CHECKLIST_KEY_PREFIX (src/lib/program/checklist.ts).
 */
export const SAVED_KEY = 'mp_saved';
export const CHECKLIST_PREFIX = 'mp_checklist_';

function isSavedKey(key: string): boolean {
  return key === SAVED_KEY || key.startsWith(`${SAVED_KEY}_`) || key.includes('shortlist');
}

function isChecklistKey(key: string): boolean {
  return key.startsWith(CHECKLIST_PREFIX) || key.includes('checklist');
}

export function describeLocalData(storageKeys: readonly string[], cookieNames: readonly string[]): LocalDataItem[] {
  const items = new Map<string, LocalDataItem>();
  const add = (id: string, label: string, detail: string, where: LocalDataItem['where']) => {
    const existing = items.get(id);
    if (existing) existing.count += 1;
    else items.set(id, { id, label, detail, where, count: 1 });
  };

  if (cookieNames.includes(PROFILE_COOKIE)) {
    add('cookie-profile', 'Your profile (cookie)', 'Grade, field, budget and countries, so pages can show your shortlist.', 'Cookie');
  }

  for (const key of [...new Set(storageKeys)].sort()) {
    if (!key.startsWith(LOCAL_PREFIX)) continue;
    if (key === PROFILE_STORAGE_KEY) {
      add('profile', 'Your profile', 'Grade, grade scale, field, budget and target countries.', 'Browser storage');
    } else if (key === STRENGTHS_STORAGE_KEY) {
      add('strengths', 'Your strengths', 'Publications and research you added.', 'Browser storage');
    } else if (isSavedKey(key)) {
      add('shortlist', 'Saved shortlist', 'Programs you saved.', 'Browser storage');
    } else if (isChecklistKey(key)) {
      add('checklists', 'Checklists', 'What you ticked off for each program.', 'Browser storage');
    } else {
      add('other', 'Other MastersPath settings', 'Small settings, such as choices you made on a page.', 'Browser storage');
    }
  }
  return [...items.values()];
}

/** Stable string snapshot of what is stored (for useSyncExternalStore: strings compare by value). */
export function localDataSnapshot(storageKeys: readonly string[], cookieHeader: string): string {
  const cookies = cookieHeader
    .split(';')
    .map((c) => c.trim().split('=')[0])
    .filter((n) => n.startsWith(LOCAL_PREFIX));
  const keys = storageKeys.filter((k) => k.startsWith(LOCAL_PREFIX));
  return JSON.stringify({ keys: [...new Set(keys)].sort(), cookies: [...new Set(cookies)].sort() });
}

export function parseLocalDataSnapshot(snapshot: string): { keys: string[]; cookies: string[] } {
  try {
    const v = JSON.parse(snapshot) as { keys?: unknown; cookies?: unknown };
    const strings = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []);
    return { keys: strings(v.keys), cookies: strings(v.cookies) };
  } catch {
    return { keys: [], cookies: [] };
  }
}
