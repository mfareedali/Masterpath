/**
 * Pure helpers for sign-in, the auth callback and the delete-account route. No Next or Supabase imports,
 * so everything here is unit-tested directly.
 */
import { z } from '@/lib/zod';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

/** Supabase email OTP codes are 6 digits by default (up to 10 if the project is configured that way). */
export const otpCodeSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6,10}$/));

/**
 * The only places sign-in may send the user back to. '/' matches the home page only; '/program/' needs an id;
 * every other entry matches itself and anything below it ('/account', '/account/x', not '/accountx').
 */
export const SAFE_NEXT_PREFIXES = [
  '/',
  '/account',
  '/shortlist',
  '/program/',
  '/plan-b',
  '/check',
  '/citizenship',
  '/ask',
  '/onboarding',
  '/saved',
] as const;

const NEXT_BASE = 'https://masterspath.invalid';
const NEXT_MAX_LENGTH = 2048;

function isAllowedNextPathname(pathname: string): boolean {
  return SAFE_NEXT_PREFIXES.some((p) => {
    if (p === '/') return pathname === '/';
    if (p.endsWith('/')) return pathname.startsWith(p) && pathname.length > p.length;
    return pathname === p || pathname.startsWith(`${p}/`);
  });
}

/**
 * Only same-site relative paths into the app may be used after sign-in (no open redirects).
 * Rejects absolute URLs, protocol-relative "//evil.example", backslash tricks and control characters, then checks
 * the NORMALISED result again: URL parsing resolves dot segments, so '/.//evil.example', '/..//evil.example' or
 * '/%2e//evil.example' come out as '//evil.example', which new URL(path, origin) and browsers read as another
 * host. Finally the path must start with one of SAFE_NEXT_PREFIXES.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/account'): string {
  if (!next || typeof next !== 'string' || next.length > NEXT_MAX_LENGTH) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const u = new URL(next, NEXT_BASE);
    if (u.origin !== NEXT_BASE) return fallback;
    const out = u.pathname + u.search + u.hash;
    if (out.startsWith('//') || out.startsWith('/\\') || u.pathname.includes('//') || u.pathname.includes('\\')) {
      return fallback;
    }
    if (!isAllowedNextPathname(u.pathname)) return fallback;
    // Belt and braces: the value must resolve to the same origin exactly the way the callback will use it.
    if (new URL(out, NEXT_BASE).origin !== NEXT_BASE) return fallback;
    return out;
  } catch {
    return fallback;
  }
}

type HeaderGetter = (name: string) => string | null | undefined;

function firstValue(v: string | null | undefined): string | null {
  if (!v) return null;
  const first = v.split(',')[0]?.trim();
  return first || null;
}

/**
 * The site's own origin for links in emails (emailRedirectTo). Prefers the Origin header (Next checks it against
 * Host for Server Functions), then X-Forwarded-Host/Host. Returns null if nothing usable is present.
 */
export function originFromHeaders(get: HeaderGetter): string | null {
  const origin = get('origin');
  if (origin && /^https?:\/\/[^/\s]+$/i.test(origin)) return origin.replace(/\/$/, '');
  const host = firstValue(get('x-forwarded-host')) ?? firstValue(get('host'));
  if (!host || !/^[a-z0-9.:[\]-]+$/i.test(host)) return null;
  const proto = firstValue(get('x-forwarded-proto')) ?? (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host) ? 'http' : 'https');
  if (proto !== 'http' && proto !== 'https') return null;
  return `${proto}://${host}`;
}

/**
 * CSRF guard for state-changing API routes: the browser's Origin header must match the host the request was sent
 * to. Missing Origin is rejected (every modern browser sends it on POST).
 */
export function isSameOrigin(get: HeaderGetter): boolean {
  const origin = get('origin');
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const hosts = [firstValue(get('x-forwarded-host')), firstValue(get('host'))]
    .filter((h): h is string => Boolean(h))
    .map((h) => h.toLowerCase());
  return hosts.includes(originHost);
}

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Server-side Turnstile check. Never sends the user's IP (the optional `remoteip` field is left out on purpose).
 * Returns false on any error or timeout.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  secret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (!token || token.length > 2048) return false;
  try {
    const res = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: unknown };
    return json.success === true;
  } catch {
    return false;
  }
}

/** Status codes passed to /account?auth=... (codes only, never free text, so the URL cannot inject messages). */
export const AUTH_STATUS_CODES = [
  'signed_in',
  'signed_out',
  'deleted',
  'link_failed',
  'link_expired',
  'not_enabled',
] as const;
export type AuthStatusCode = (typeof AUTH_STATUS_CODES)[number];

export function parseAuthStatus(v: string | string[] | undefined): AuthStatusCode | null {
  const s = Array.isArray(v) ? v[0] : v;
  return (AUTH_STATUS_CODES as readonly string[]).includes(s ?? '') ? (s as AuthStatusCode) : null;
}

/** Maps a Supabase error from the email link (?error_code=otp_expired ...) to our status code. */
export function callbackErrorStatus(errorCode: string | null | undefined): AuthStatusCode {
  return errorCode && /expired/i.test(errorCode) ? 'link_expired' : 'link_failed';
}
