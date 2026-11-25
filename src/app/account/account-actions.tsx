'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import { loadProfile, loadStrengths, saveProfile, saveStrengths } from '@/lib/profile-client';
import { loadProfileAction, saveProfileAction } from './actions';

type Note = { tone: 'ok' | 'error'; text: string } | null;

/** Save the profile on this device to the account, or copy the saved one back to this device. */
export function AccountActions({ savedAt }: { savedAt: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<Note>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(savedAt);

  function onSave() {
    setNote(null);
    startTransition(async () => {
      const profile = loadProfile();
      if (!profile) {
        setNote({ tone: 'error', text: 'There is no profile on this device yet. Fill in your profile first.' });
        return;
      }
      const res = await saveProfileAction({ profile, strengths: loadStrengths() });
      if (!res.ok) {
        setNote({ tone: 'error', text: res.error });
        return;
      }
      setLastSaved(res.savedAt);
      setNote({
        tone: 'ok',
        text:
          res.strengths === 'invalid'
            ? 'Profile saved. Your strengths were not saved: some entries are too long.'
            : 'Saved to your account.',
      });
    });
  }

  function onRestore() {
    setNote(null);
    startTransition(async () => {
      const res = await loadProfileAction();
      if (!res.ok) {
        setNote({ tone: 'error', text: res.error });
        return;
      }
      if (!res.profile) {
        setNote({ tone: 'error', text: 'Nothing is saved in your account yet.' });
        return;
      }
      try {
        saveProfile(res.profile);
        if (res.strengths) saveStrengths(res.strengths);
      } catch {
        setNote({ tone: 'error', text: 'We could not copy it to this device.' });
        return;
      }
      setNote({ tone: 'ok', text: 'Copied your saved profile to this device.' });
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {lastSaved ? <>Last saved to your account: {formatDate(lastSaved)}.</> : 'Nothing saved to your account yet.'}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button onClick={onSave} disabled={pending}>
          {pending ? 'Working…' : 'Save my profile to my account'}
        </Button>
        <Button variant="secondary" onClick={onRestore} disabled={pending}>
          Copy my saved profile to this device
        </Button>
      </div>
      <p
        aria-live="polite"
        role="status"
        className={`text-sm font-semibold ${note?.tone === 'error' ? 'text-conflict-fg' : 'text-primary-ink'}`}
      >
        {note?.text ?? ''}
      </p>
    </div>
  );
}
