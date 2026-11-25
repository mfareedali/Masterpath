/**
 * GET /auth/callback end to end with Supabase mocked: the reviewer's open-redirect case
 * (a real token_hash link with next=/.//evil.com) must land on this site, never on evil.com.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyOtp = vi.fn(async () => ({ error: null }));
const exchangeCodeForSession = vi.fn(async () => ({ error: null }));

vi.mock('@/lib/supabase/env', () => ({ accountsEnabled: () => true }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp, exchangeCodeForSession } }),
}));

const { GET } = await import('@/app/auth/callback/route');

const SITE = 'https://app.example';

async function callback(query: string): Promise<URL> {
  const res = await GET(new NextRequest(`${SITE}/auth/callback?${query}`));
  expect(res.status).toBe(303);
  const location = res.headers.get('location');
  expect(location).toBeTruthy();
  return new URL(location!, SITE);
}

describe('auth callback never redirects off-site', () => {
  beforeEach(() => {
    verifyOtp.mockClear();
    exchangeCodeForSession.mockClear();
  });

  it.each(['/.//evil.com', '/..//evil.com', '/%2e//evil.com', '/a/..//evil.com', '/\\evil.com', '//evil.com', 'https://evil.com'])(
    'token_hash link with next=%s signs in and stays on the site',
    async (next) => {
      const target = await callback(`token_hash=abc&type=email&next=${encodeURIComponent(next)}`);
      expect(verifyOtp).toHaveBeenCalledOnce();
      expect(target.origin).toBe(SITE);
      expect(target.pathname).toBe('/account');
      expect(target.searchParams.get('auth')).toBe('signed_in');
    },
  );

  it('PKCE code link with a dot-segment next stays on the site', async () => {
    const target = await callback(`code=xyz&next=${encodeURIComponent('/.//evil.com')}`);
    expect(exchangeCodeForSession).toHaveBeenCalledOnce();
    expect(target.origin).toBe(SITE);
    expect(target.pathname).toBe('/account');
  });

  it('a safe next is kept', async () => {
    const target = await callback(`token_hash=abc&type=email&next=${encodeURIComponent('/shortlist?cgpa=2.5')}`);
    expect(target.origin).toBe(SITE);
    expect(target.pathname).toBe('/shortlist');
    expect(target.searchParams.get('cgpa')).toBe('2.5');
    expect(target.searchParams.get('auth')).toBe('signed_in');
  });
});
