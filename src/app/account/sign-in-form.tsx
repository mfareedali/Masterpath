'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { signInAction, type SignInState } from './actions';
import { TurnstileWidget } from './turnstile';

const INITIAL: SignInState = { step: 'email' };

export const inputClass =
  'mt-1 block w-full min-h-tap rounded-button border border-line-strong bg-surface px-3 py-2 text-base text-ink';

/** Email sign-in: one email with a link (and a code, if the project's email template includes it). No password. */
export function SignInForm({ turnstileSiteKey }: { turnstileSiteKey: string | null }) {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL);

  if (state.step === 'code') {
    return (
      <div className="space-y-4">
        <div role="status" aria-live="polite" className="rounded-card border-l-4 border-accent bg-accent-soft p-4 text-sm text-ink">
          <p className="font-bold text-heading">Check your email</p>
          <p className="mt-1 break-words">
            We sent an email to <strong>{state.email}</strong>. Open it on this phone and tap the sign-in link. If the
            email shows a code, you can type it below instead.
          </p>
        </div>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="intent" value="verify" />
          <input type="hidden" name="email" value={state.email} />
          <div>
            <label htmlFor="otp-code" className="text-sm font-semibold text-ink">
              Code from the email
            </label>
            <input
              id="otp-code"
              name="code"
              className={`${inputClass} tracking-widest`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]*"
              maxLength={12}
              required
              aria-describedby={state.error ? 'otp-error' : undefined}
            />
          </div>
          {state.error ? (
            <p id="otp-error" role="alert" className="text-sm font-semibold text-conflict-fg">
              {state.error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending} block>
            {pending ? 'Checking…' : 'Sign in with this code'}
          </Button>
        </form>
        <form action={formAction}>
          <input type="hidden" name="intent" value="restart" />
          <Button type="submit" variant="ghost" disabled={pending}>
            Send a new email or use another address
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="intent" value="send" />
      <div>
        <label htmlFor="signin-email" className="text-sm font-semibold text-ink">
          Your email
        </label>
        <input
          id="signin-email"
          name="email"
          type="email"
          className={inputClass}
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
          defaultValue={state.email ?? ''}
          aria-describedby={state.error ? 'signin-error signin-help' : 'signin-help'}
        />
        <p id="signin-help" className="mt-1 text-xs text-muted">
          No password. We email you a sign-in link. We only use your email to sign you in.
        </p>
      </div>
      {turnstileSiteKey ? <TurnstileWidget siteKey={turnstileSiteKey} resetSignal={state} /> : null}
      {state.error ? (
        <p id="signin-error" role="alert" className="text-sm font-semibold text-conflict-fg">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} block>
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
    </form>
  );
}
