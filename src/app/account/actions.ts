'use server';

/**
 * Server Functions for the optional account. Every function re-checks that accounts are enabled and, where it
 * touches personal data, verifies the session with Supabase Auth (getUser) — never trusting the client.
 * Row level security (auth.uid() = user_id) is the second line of defence.
 */
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AuthError } from '@supabase/supabase-js';
import { emailSchema, originFromHeaders, otpCodeSchema, verifyTurnstileToken } from '@/lib/supabase/auth';
import { accountsEnabled, turnstileSecretKey, turnstileSiteKey } from '@/lib/supabase/env';
import { getOwnProfile, getUserSession, replaceStrengths, upsertProfile } from '@/lib/queries';
import { parseStrengths, profileToRow, strengthsAreEmpty } from '@/lib/supabase/profile-rows';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { Profile, Strengths } from '@/lib/types';

export type SignInState =
  | { step: 'email'; email?: string; error?: string }
  | { step: 'code'; email: string; error?: string };

const NOT_ENABLED = 'Accounts are not turned on for this website.';

function sendErrorMessage(err: AuthError): string {
  if (err.status === 429 || /rate limit/i.test(err.message)) {
    return 'Too many emails were sent. Please wait a few minutes, then try again.';
  }
  if (/captcha/i.test(err.message)) return 'The safety check did not pass. Please try again.';
  return 'We could not send the email. Check the address and try again.';
}

function verifyErrorMessage(err: AuthError): string {
  if (err.code === 'otp_expired' || /expired/i.test(err.message)) {
    return 'That code has expired or was already used. Ask for a new email.';
  }
  return 'That code did not work. Check the numbers and try again.';
}

/** Two-step email sign-in: send a link + code, then (optionally) verify the typed code. */
export async function signInAction(prev: SignInState, formData: FormData): Promise<SignInState> {
  if (!accountsEnabled()) return { step: 'email', error: NOT_ENABLED };
  const intent = formData.get('intent');

  if (intent === 'restart') return { step: 'email' };

  if (intent === 'verify') {
    const email = emailSchema.safeParse(formData.get('email') ?? '');
    if (!email.success) return { step: 'email', error: 'Please enter your email again.' };
    const code = otpCodeSchema.safeParse(formData.get('code') ?? '');
    if (!code.success) return { step: 'code', email: email.data, error: 'Type the code from the email (numbers only).' };
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: 'email' });
    if (error) return { step: 'code', email: email.data, error: verifyErrorMessage(error) };
    redirect('/account?auth=signed_in');
  }

  // intent === 'send'
  const email = emailSchema.safeParse(formData.get('email') ?? '');
  if (!email.success) return { step: 'email', error: 'Please enter a valid email address.' };

  const siteKey = turnstileSiteKey();
  const secret = turnstileSecretKey();
  const turnstileToken = formData.get('cf-turnstile-response');
  let captchaToken: string | undefined;
  if (siteKey) {
    const token = typeof turnstileToken === 'string' ? turnstileToken : null;
    if (secret) {
      // We verify the token ourselves. Tokens are single-use, so it is not passed on to Supabase.
      if (!(await verifyTurnstileToken(token, secret))) {
        return { step: 'email', email: email.data, error: 'The safety check did not pass. Please try again.' };
      }
    } else if (token) {
      // No secret here: let Supabase verify it (if CAPTCHA protection is on in the Supabase project).
      captchaToken = token;
    }
  }

  const requestHeaders = await headers();
  const origin = originFromHeaders((name) => requestHeaders.get(name));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      shouldCreateUser: true,
      ...(origin ? { emailRedirectTo: `${origin}/auth/callback?next=/account` } : {}),
      ...(captchaToken ? { captchaToken } : {}),
    },
  });
  if (error) return { step: 'email', email: email.data, error: sendErrorMessage(error) };
  return { step: 'code', email: email.data };
}

export async function signOutAction(): Promise<void> {
  if (accountsEnabled()) {
    try {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.signOut({ scope: 'local' });
    } catch (err) {
      console.error('[account] sign out failed:', err instanceof Error ? err.message : err);
    }
  }
  redirect('/account?auth=signed_out');
}

export type SaveResult =
  | { ok: true; savedAt: string; strengths: 'saved' | 'none' | 'invalid' }
  | { ok: false; error: string };

/**
 * Copies the profile (and strengths, if any) from this device into the signed-in user's own rows.
 * Reads and writes go through src/lib/queries.ts with the user's session, so row level security applies.
 */
export async function saveProfileAction(input: { profile: unknown; strengths: unknown }): Promise<SaveResult> {
  if (!accountsEnabled()) return { ok: false, error: NOT_ENABLED };
  const session = await getUserSession();
  if (!session) return { ok: false, error: 'You are signed out. Please sign in again.' };

  if (!profileToRow(input?.profile, session.userId)) {
    return { ok: false, error: 'There is no complete profile on this device yet. Fill in your profile first.' };
  }
  const saved = await upsertProfile(input?.profile, session);
  if (!saved.ok) return saved;

  let strengths: 'saved' | 'none' | 'invalid' = 'none';
  const parsed = input?.strengths == null ? null : parseStrengths(input.strengths);
  if (input?.strengths != null && !parsed) {
    strengths = 'invalid';
  } else if (strengthsAreEmpty(parsed)) {
    // The device has no strengths: the account copy should not keep old ones.
    await replaceStrengths(null, session);
  } else {
    strengths = (await replaceStrengths(parsed, session)).ok ? 'saved' : 'invalid';
  }
  return { ok: true, savedAt: new Date().toISOString(), strengths };
}

export type LoadResult =
  | { ok: true; profile: Profile | null; strengths: Strengths | null }
  | { ok: false; error: string };

/** Reads the signed-in user's own saved profile (to copy it onto this device). */
export async function loadProfileAction(): Promise<LoadResult> {
  if (!accountsEnabled()) return { ok: false, error: NOT_ENABLED };
  return getOwnProfile();
}
