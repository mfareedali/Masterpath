import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_STATUS_CODES,
  TURNSTILE_VERIFY_URL,
  callbackErrorStatus,
  emailSchema,
  isSameOrigin,
  originFromHeaders,
  otpCodeSchema,
  parseAuthStatus,
  safeNextPath,
  verifyTurnstileToken,
} from '@/lib/supabase/auth';
import {
  accountsEnabled,
  isSupabaseAdminConfigured,
  isSupabaseConfigured,
  turnstileSecretKey,
  turnstileSiteKey,
} from '@/lib/supabase/env';
import { AUTH_STATUS_MESSAGES } from '@/app/account/status';

const headers = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()] ?? null;

describe('safeNextPath (no open redirects after sign-in)', () => {
  it.each([
    ['/account', '/account'],
    ['/', '/'],
    ['/shortlist?cgpa=2.5', '/shortlist?cgpa=2.5'],
    ['/program/x#fees', '/program/x#fees'],
    ['/plan-b', '/plan-b'],
    ['/check?claims=PR%20in%202%20years', '/check?claims=PR%20in%202%20years'],
    ['/citizenship', '/citizenship'],
    ['/ask', '/ask'],
    ['/onboarding', '/onboarding'],
    ['/saved', '/saved'],
    // Harmless dot segments that stay inside an allowed page are normalised, not rejected.
    ['/account/../shortlist', '/shortlist'],
  ])('keeps %s', (input, out) => expect(safeNextPath(input)).toBe(out));

  it.each([
    null,
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    '/acc\nount',
    'account',
    // Review finding: dot segments normalise to the protocol-relative '//evil.com'.
    '/.//evil.com',
    '/..//evil.com',
    '/%2e//evil.com',
    '/%2E%2E//evil.com',
    '/a/..//evil.com',
    '/account/..//evil.com',
    '/\\evil.com',
    '/%5Cevil.com',
    '/account//evil.com',
    '/\t/evil.com',
    // Not an app page (allowlist).
    '/evil.com',
    '/accountx',
    '/program/',
    '/api/account/delete',
    '/auth/callback?next=//evil.com',
    `/account?${'x'.repeat(3000)}`,
  ])('rejects %j', (input) => expect(safeNextPath(input as string | null | undefined)).toBe('/account'));

  it('never returns anything that resolves off-site', () => {
    const tricky = ['/.//evil.com', '/..//evil.com', '/%2e//evil.com', '/a/..//evil.com', '/./\\evil.com', '/%2e%2e/%2e%2e//evil.com'];
    for (const input of tricky) {
      const out = safeNextPath(input);
      expect(new URL(out, 'https://app.example').origin, input).toBe('https://app.example');
    }
  });

  it('uses the given fallback', () => {
    expect(safeNextPath('//x', '/')).toBe('/');
    expect(safeNextPath('/.//evil.com', '/')).toBe('/');
  });
});

describe('originFromHeaders', () => {
  it('prefers a well-formed Origin header', () => {
    expect(originFromHeaders(headers({ origin: 'https://masterspath.example', host: 'other.example' }))).toBe('https://masterspath.example');
  });
  it('falls back to forwarded host + proto, then host', () => {
    expect(originFromHeaders(headers({ 'x-forwarded-host': 'app.example, proxy', 'x-forwarded-proto': 'https' }))).toBe('https://app.example');
    expect(originFromHeaders(headers({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
    expect(originFromHeaders(headers({ host: 'app.example' }))).toBe('https://app.example');
  });
  it('returns null for junk', () => {
    expect(originFromHeaders(headers({}))).toBeNull();
    expect(originFromHeaders(headers({ origin: 'null', host: 'bad host/' }))).toBeNull();
    expect(originFromHeaders(headers({ host: 'app.example', 'x-forwarded-proto': 'ftp' }))).toBeNull();
  });
});

describe('isSameOrigin (CSRF guard for POST /api/account/delete)', () => {
  it('accepts a matching Origin', () => {
    expect(isSameOrigin(headers({ origin: 'https://app.example', host: 'app.example' }))).toBe(true);
    expect(isSameOrigin(headers({ origin: 'https://app.example', host: 'internal:3000', 'x-forwarded-host': 'app.example' }))).toBe(true);
  });
  it('rejects missing, foreign or malformed Origins', () => {
    expect(isSameOrigin(headers({ host: 'app.example' }))).toBe(false);
    expect(isSameOrigin(headers({ origin: 'https://evil.example', host: 'app.example' }))).toBe(false);
    expect(isSameOrigin(headers({ origin: 'not a url', host: 'app.example' }))).toBe(false);
    expect(isSameOrigin(headers({ origin: 'https://app.example.evil.example', host: 'app.example' }))).toBe(false);
  });
});

describe('verifyTurnstileToken', () => {
  const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('posts secret + token to Cloudflare and never sends the user IP', async () => {
    const f = ok({ success: true });
    expect(await verifyTurnstileToken('tok', 'sec', f as unknown as typeof fetch)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_VERIFY_URL);
    const body = new URLSearchParams(String(init.body));
    expect(body.get('secret')).toBe('sec');
    expect(body.get('response')).toBe('tok');
    expect(body.has('remoteip')).toBe(false);
  });

  it('fails closed', async () => {
    expect(await verifyTurnstileToken('tok', 'sec', ok({ success: false }) as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstileToken('tok', 'sec', ok({ success: 'yes' }) as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstileToken('tok', 'sec', ok({}, 500) as unknown as typeof fetch)).toBe(false);
    const boom = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await verifyTurnstileToken('tok', 'sec', boom as unknown as typeof fetch)).toBe(false);
    const never = vi.fn();
    expect(await verifyTurnstileToken(null, 'sec', never as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstileToken('x'.repeat(3000), 'sec', never as unknown as typeof fetch)).toBe(false);
    expect(never).not.toHaveBeenCalled();
  });
});

describe('email and code input', () => {
  it('normalises emails and rejects junk', () => {
    expect(emailSchema.parse('  Student@Example.COM ')).toBe('student@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse(`${'a'.repeat(250)}@x.com`).success).toBe(false);
  });
  it('accepts 6-10 digit codes, ignoring spaces', () => {
    expect(otpCodeSchema.parse('123 456')).toBe('123456');
    expect(otpCodeSchema.safeParse('12345').success).toBe(false);
    expect(otpCodeSchema.safeParse('12345a').success).toBe(false);
  });
});

describe('auth status codes in the URL', () => {
  it('only known codes are accepted (the URL never carries free text)', () => {
    expect(parseAuthStatus('signed_in')).toBe('signed_in');
    expect(parseAuthStatus(['deleted', 'x'])).toBe('deleted');
    expect(parseAuthStatus('<script>')).toBeNull();
    expect(parseAuthStatus(undefined)).toBeNull();
  });
  it('every code has a fixed message', () => {
    for (const code of AUTH_STATUS_CODES) {
      expect(AUTH_STATUS_MESSAGES[code].title.length).toBeGreaterThan(0);
      expect(AUTH_STATUS_MESSAGES[code].text.length).toBeGreaterThan(0);
    }
  });
  it('maps Supabase link errors', () => {
    expect(callbackErrorStatus('otp_expired')).toBe('link_expired');
    expect(callbackErrorStatus('access_denied')).toBe('link_failed');
    expect(callbackErrorStatus(null)).toBe('link_failed');
  });
});

describe('env switches (everything degrades when keys are missing)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('nothing configured', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '  ');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    expect(isSupabaseConfigured()).toBe(false);
    expect(isSupabaseAdminConfigured()).toBe(false);
    expect(accountsEnabled()).toBe(false);
    expect(turnstileSiteKey()).toBeNull();
    expect(turnstileSecretKey()).toBeNull();
  });

  it('public keys only: data can be read, but accounts stay off (no way to hard-delete them)', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    expect(isSupabaseConfigured()).toBe(true);
    expect(accountsEnabled()).toBe(false);
  });

  it('all keys: accounts on', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'site');
    expect(accountsEnabled()).toBe(true);
    expect(turnstileSiteKey()).toBe('site');
  });
});
