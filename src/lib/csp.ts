/**
 * Content Security Policy, built from the environment. Pure (no Next imports, no path aliases) because
 * next.config.ts imports it with a relative path and the unit test calls it with a fake env.
 *
 * - Next.js inline bootstrap scripts need 'unsafe-inline' unless every page is rendered with a nonce
 *   (which forces dynamic rendering and costs speed). See DECISIONS.md #18.
 * - Supabase (REST + realtime) and Cloudflare Turnstile are the only third parties.
 * - 'unsafe-eval' only in development (React Refresh / dev overlay).
 * - 'upgrade-insecure-requests' only when the site is served over HTTPS. On plain HTTP (the documented demo
 *   fallback: `npm start` on a laptop, phone on http://<laptop-ip>:3000) it makes the browser rewrite every
 *   same-origin script, stylesheet and link to https://<laptop-ip>:3000, where nothing listens, so the page
 *   loads with no CSS and no JavaScript. HTTPS is known when Vercel builds the app (VERCEL is set) or when the
 *   host opts in with CSP_UPGRADE_INSECURE=1. Next evaluates headers() at build time, so set the flag for the
 *   build, not only at runtime.
 */

export interface CspEnv {
  readonly NODE_ENV?: string;
  readonly VERCEL?: string;
  readonly CSP_UPGRADE_INSECURE?: string;
}

function isSet(v: string | undefined): boolean {
  const s = v?.trim();
  return Boolean(s) && s !== '0' && s?.toLowerCase() !== 'false';
}

/** True when the CSP should carry 'upgrade-insecure-requests' (production on a known HTTPS deployment). */
export function servesHttpsOnly(env: CspEnv): boolean {
  if (env.NODE_ENV !== 'production') return false;
  return isSet(env.VERCEL) || env.CSP_UPGRADE_INSECURE?.trim() === '1';
}

export function buildCsp(env: CspEnv): string {
  const isDev = env.NODE_ENV !== 'production';
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com",
    'frame-src https://challenges.cloudflare.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
    ...(servesHttpsOnly(env) ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}
