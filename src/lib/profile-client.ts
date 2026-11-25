/**
 * Browser-side profile persistence: first-party cookie (so server components can read it)
 * + localStorage (offline). Import only from client components.
 */
import {
  PROFILE_COOKIE,
  PROFILE_COOKIE_MAX_AGE,
  PROFILE_STORAGE_KEY,
  STRENGTHS_STORAGE_KEY,
  deserializeProfile,
  parseProfile,
  serializeProfile,
} from './profile';
import type { Profile, Strengths } from './types';

export function saveProfile(p: Profile): void {
  const valid = parseProfile(p);
  if (!valid) throw new Error('Invalid profile');
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${PROFILE_COOKIE}=${serializeProfile(valid)}; Path=/; Max-Age=${PROFILE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(valid));
  } catch {
    /* storage may be unavailable (private mode) */
  }
}

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const p = parseProfile(JSON.parse(raw));
      if (p) return p;
    }
  } catch {
    /* ignore */
  }
  const m = document.cookie.match(new RegExp(`(?:^|; )${PROFILE_COOKIE}=([^;]*)`));
  return m ? deserializeProfile(m[1]) : null;
}

export function saveStrengths(s: Strengths): void {
  try {
    localStorage.setItem(STRENGTHS_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function loadStrengths(): Strengths | null {
  try {
    const raw = localStorage.getItem(STRENGTHS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Strengths) : null;
  } catch {
    return null;
  }
}

/** Deletes everything this device stored for MastersPath (profile, strengths, saved shortlist, checklists). */
export function clearLocalData(): void {
  document.cookie = `${PROFILE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mp_')) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  // Offline copies of pages kept by the service worker can include shortlist URLs with grades in them.
  try {
    if (typeof caches !== 'undefined') {
      caches
        .keys()
        .then((ks) => Promise.all(ks.filter((k) => k.startsWith('masterspath-')).map((k) => caches.delete(k))))
        .catch(() => {});
    }
  } catch {
    /* ignore */
  }
}
