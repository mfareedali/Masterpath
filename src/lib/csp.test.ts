import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCsp, servesHttpsOnly } from './csp';

/** The production policy before this module existed (every directive except the conditional upgrade). */
const BASE_PRODUCTION = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
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
].join('; ');

describe('buildCsp', () => {
  it('plain-HTTP production build (laptop demo fallback): no upgrade-insecure-requests', () => {
    // Regression: `npm run build && npm start`, phone on http://<laptop-ip>:3000 loaded with no CSS or JS.
    const csp = buildCsp({ NODE_ENV: 'production' });
    expect(csp).not.toMatch(/upgrade-insecure-requests/);
    expect(csp).toBe(BASE_PRODUCTION);
  });

  it('Vercel (always HTTPS): upgrade-insecure-requests is the only addition', () => {
    expect(buildCsp({ NODE_ENV: 'production', VERCEL: '1' })).toBe(`${BASE_PRODUCTION}; upgrade-insecure-requests`);
  });

  it('other HTTPS hosts opt in with CSP_UPGRADE_INSECURE=1 (exactly "1")', () => {
    expect(buildCsp({ NODE_ENV: 'production', CSP_UPGRADE_INSECURE: '1' })).toBe(`${BASE_PRODUCTION}; upgrade-insecure-requests`);
    expect(servesHttpsOnly({ NODE_ENV: 'production', CSP_UPGRADE_INSECURE: 'true' })).toBe(false);
    expect(servesHttpsOnly({ NODE_ENV: 'production', CSP_UPGRADE_INSECURE: '0' })).toBe(false);
    expect(servesHttpsOnly({ NODE_ENV: 'production', CSP_UPGRADE_INSECURE: '' })).toBe(false);
  });

  it('an empty or "0" VERCEL does not count as HTTPS', () => {
    expect(servesHttpsOnly({ NODE_ENV: 'production', VERCEL: '' })).toBe(false);
    expect(servesHttpsOnly({ NODE_ENV: 'production', VERCEL: '0' })).toBe(false);
  });

  it('development: unsafe-eval for React Refresh, never the upgrade', () => {
    const csp = buildCsp({ NODE_ENV: 'development', VERCEL: '1', CSP_UPGRADE_INSECURE: '1' });
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com");
    expect(csp).not.toMatch(/upgrade-insecure-requests/);
    expect(buildCsp({})).toContain("'unsafe-eval'");
  });

  it('production never allows eval or third parties beyond Supabase and Turnstile', () => {
    const csp = buildCsp({ NODE_ENV: 'production', VERCEL: '1' });
    expect(csp).not.toContain('unsafe-eval');
    const hosts = [...csp.matchAll(/(?:https|wss):\/\/[^\s;]+/g)].map((m) => m[0]);
    expect(new Set(hosts)).toEqual(new Set(['https://challenges.cloudflare.com', 'https://*.supabase.co', 'wss://*.supabase.co']));
  });
});

describe('next.config.ts uses buildCsp', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function cspHeader(): Promise<string> {
    const { default: config } = await import('../../next.config');
    const rules = await config.headers!();
    const header = rules.find((r) => r.source === '/:path*')?.headers.find((h) => h.key === 'Content-Security-Policy');
    expect(header).toBeDefined();
    return header!.value;
  }

  it('production on plain HTTP: no upgrade-insecure-requests in the real header', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('CSP_UPGRADE_INSECURE', '');
    expect(await cspHeader()).toBe(BASE_PRODUCTION);
  });

  it('production on Vercel: upgrade-insecure-requests in the real header', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL', '1');
    expect(await cspHeader()).toBe(`${BASE_PRODUCTION}; upgrade-insecure-requests`);
  });
});
