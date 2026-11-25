/**
 * Email sign-in link target. Supabase redirects here with either
 *   ?code=...                      (PKCE magic link; the code verifier cookie was set when the link was requested)
 *   ?token_hash=...&type=email     (custom email template using {{ .TokenHash }})
 *   ?error=...&error_code=...      (expired or already-used link)
 * On success the session cookies are set and the user goes back to /account (or a safe relative ?next=).
 */
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { callbackErrorStatus, safeNextPath, type AuthStatusCode } from '@/lib/supabase/auth';
import { accountsEnabled } from '@/lib/supabase/env';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const EMAIL_OTP_TYPES: readonly EmailOtpType[] = ['email', 'magiclink', 'signup', 'invite', 'recovery', 'email_change'];

function redirectTo(request: NextRequest, path: string, status: AuthStatusCode): NextResponse {
  let target = new URL(path, request.nextUrl.origin);
  // Second guard after safeNextPath: never leave this site, whatever the path turned out to be.
  if (target.origin !== request.nextUrl.origin) target = new URL('/account', request.nextUrl.origin);
  target.searchParams.set('auth', status);
  const res = NextResponse.redirect(target, { status: 303 });
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get('next'));

  if (!accountsEnabled()) return redirectTo(request, '/account', 'not_enabled');

  if (params.get('error') || params.get('error_code')) {
    return redirectTo(request, '/account', callbackErrorStatus(params.get('error_code') ?? params.get('error')));
  }

  try {
    const supabase = await createSupabaseServerClient();
    const code = params.get('code');
    const tokenHash = params.get('token_hash');
    const type = params.get('type') as EmailOtpType | null;

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return redirectTo(request, next, 'signed_in');
      return redirectTo(request, '/account', callbackErrorStatus(error.code));
    }
    if (tokenHash && type && EMAIL_OTP_TYPES.includes(type)) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
      if (!error) return redirectTo(request, next, 'signed_in');
      return redirectTo(request, '/account', callbackErrorStatus(error.code));
    }
  } catch (err) {
    console.error('[auth/callback] sign-in failed:', err instanceof Error ? err.message : err);
  }
  return redirectTo(request, '/account', 'link_failed');
}
