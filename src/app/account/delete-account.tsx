'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { inputClass } from './sign-in-form';

const CONFIRM_WORD = 'DELETE';

const ERRORS: Record<string, string> = {
  not_enabled: 'Account deletion is not turned on for this website.',
  not_signed_in: 'You are signed out. Sign in again, then delete your account.',
  bad_origin: 'Please reload the page and try again.',
  bad_request: `Please type ${CONFIRM_WORD} to confirm.`,
  delete_failed: 'We could not delete your account right now. Please try again in a minute.',
};

/** Hard delete with a typed confirmation. Calls POST /api/account/delete. */
export function DeleteAccount() {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = typed.trim() === CONFIRM_WORD;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: CONFIRM_WORD }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (res.ok) {
        router.replace('/account?auth=deleted');
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(ERRORS[body?.error ?? ''] ?? ERRORS.delete_failed);
    } catch {
      setError('No internet connection. Please try again.');
    }
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label htmlFor="confirm-delete" className="text-sm font-semibold text-ink">
          Type {CONFIRM_WORD} to confirm
        </label>
        <input
          id="confirm-delete"
          name="confirm"
          className={inputClass}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={error ? 'delete-error' : undefined}
        />
      </div>
      <Button type="submit" variant="danger" disabled={!ready || busy} block>
        {busy ? 'Deleting…' : 'Delete my account permanently'}
      </Button>
      <p id="delete-error" role="alert" aria-live="assertive" className="text-sm font-semibold text-conflict-fg">
        {error}
      </p>
    </form>
  );
}
