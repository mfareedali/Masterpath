/**
 * Which profile the program page's FitPanel uses, and where "Back to shortlist" goes.
 * Pure (no DOM access): the client islands pass in `location.search` and the stored-profile loader.
 *
 * Shortlist and Plan B links carry the profile in the query (?cgpa=…&scale=…), and the program page is static,
 * so the browser reads that query. A VALID profile in the link wins over the one saved on this device, exactly as
 * on /shortlist and /plan-b (getRequestProfile prefers the query), so the same link never shows two different fit
 * labels on two pages. The link profile is kept in memory for this page view: it is never saved to the device here.
 */
import { profileFromSearchParams } from '@/lib/profile';
import { profileQueryString } from '@/lib/shortlist/query';
import type { Profile } from '@/lib/types';

export type FitProfileSource = 'device' | 'link';

export interface FitProfileState {
  profile: Profile;
  /** 'device' = saved on this device; 'link' = read from the page's link and not saved. */
  source: FitProfileSource;
}

function queryRecord(search: string): Record<string, string> {
  try {
    return Object.fromEntries(new URLSearchParams(search));
  } catch {
    return {};
  }
}

/** A valid profile from a query string ("?cgpa=2.5&scale=cgpa_4&…"), or null when absent or invalid. */
export function profileFromQuery(search: string): Profile | null {
  return profileFromSearchParams(queryRecord(search));
}

/** A valid profile in the link first (never saved); otherwise the device profile. Null when neither exists. */
export function resolveFitProfile(stored: Profile | null, search: string): FitProfileState | null {
  const fromLink = profileFromQuery(search);
  if (fromLink) return { profile: fromLink, source: 'link' };
  return stored ? { profile: stored, source: 'device' } : null;
}

/**
 * Snapshot for useSyncExternalStore: a JSON string (so snapshots compare equal), or null.
 * `loadStored` is only READ; nothing is written to storage or cookies here.
 */
export function readFitProfileJson(search: string, loadStored: () => Profile | null): string | null {
  let stored: Profile | null = null;
  try {
    stored = loadStored();
  } catch {
    stored = null;
  }
  const state = resolveFitProfile(stored, search);
  return state ? JSON.stringify(state) : null;
}

/**
 * Profile query params for a profile, in the format profileFromSearchParams reads (the same keys as shortlist links:
 * cgpa, scale, min_pass, field, budget, countries). University, degree and persona are never put in a URL.
 */
export function profileParams(p: Profile): URLSearchParams {
  const q = new URLSearchParams({ cgpa: String(p.cgpa), scale: p.scale });
  if (p.min_pass != null && Number.isFinite(p.min_pass)) q.set('min_pass', String(p.min_pass));
  if (p.field) q.set('field', p.field);
  if (p.budget_pkr != null && Number.isFinite(p.budget_pkr)) q.set('budget', String(Math.round(p.budget_pkr)));
  const countries = (p.target_countries ?? []).filter((c) => /^[A-Za-z]{2,3}$/.test(c));
  if (countries.length) q.set('countries', countries.join(','));
  return q;
}

/** "/plan-b?<profile params>&target=<program id>": Plan B compared with this program, for this profile. */
export function planBHrefFor(p: Profile, programId: string): string {
  const q = profileParams(p);
  q.set('target', programId);
  return `/plan-b?${q.toString().replace(/%2C/gi, ',')}`;
}

/** "/shortlist?cgpa=…&scale=…" keeping only the profile params of the current link, or "/shortlist". */
export function shortlistBackHref(search: string): string {
  if (!profileFromQuery(search)) return '/shortlist';
  return `/shortlist${profileQueryString(queryRecord(search))}`;
}
