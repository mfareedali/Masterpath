/** Server-side profile resolution: query params override the cookie. */
import 'server-only';
import { cookies } from 'next/headers';
import { PROFILE_COOKIE, deserializeProfile, profileFromSearchParams, profileLinkStatus } from './profile';
import type { Profile } from './types';

type SearchParamsRecord = Record<string, string | string[] | undefined>;

export async function getRequestProfile(searchParams?: SearchParamsRecord): Promise<Profile | null> {
  return (await getRequestProfileState(searchParams)).profile;
}

export interface RequestProfileState {
  profile: Profile | null;
  /** 'link' = read from the page's query; 'device' = the cookie saved on this device; null = no profile. */
  source: 'link' | 'device' | null;
  /**
   * True when the link carried cgpa and scale that could not be read. If `source` is then 'device', the page must say
   * "We could not read the profile in this link, so we show the profile saved on this device."
   */
  linkRejected: boolean;
}

/** Like getRequestProfile, but also says where the profile came from and whether the link's profile was rejected. */
export async function getRequestProfileState(searchParams?: SearchParamsRecord): Promise<RequestProfileState> {
  let linkRejected = false;
  if (searchParams) {
    const fromQuery = profileFromSearchParams(searchParams);
    if (fromQuery) return { profile: fromQuery, source: 'link', linkRejected: false };
    linkRejected = profileLinkStatus(searchParams) === 'rejected';
  }
  const store = await cookies();
  const fromCookie = deserializeProfile(store.get(PROFILE_COOKIE)?.value);
  return { profile: fromCookie, source: fromCookie ? 'device' : null, linkRejected };
}

/** The clock used for confidence ages. MASTERSPATH_NOW (ISO date) pins it for demos and screenshots. */
export function getNow(): Date {
  const pinned = process.env.MASTERSPATH_NOW;
  if (pinned) {
    const t = Date.parse(pinned);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return new Date();
}
