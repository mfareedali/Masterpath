'use client';

/**
 * "Try the demo" buttons. Each loads a FICTIONAL demo persona onto this device (cookie + localStorage)
 * and opens the shortlist. Persona B also saves a fictional preprint + supervisor (research-led route).
 * Props contract (used by other screens' empty states): { compact?: boolean }.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { personaPlan, PERSONAS, type PersonaId } from '@/lib/onboarding/persona';
import { shortlistHref } from '@/lib/onboarding/profile-form';
import { PERSONA_A } from '@/lib/profile';
import { loadStrengths, saveProfile, saveStrengths } from '@/lib/profile-client';
import { buttonClass } from '@/components/ui/button';

/** Without JavaScript nothing can be saved, but persona A's grade/budget/countries still work as a link. */
const PERSONA_A_LINK = shortlistHref(PERSONA_A);

/** Two-line persona button (title + summary). Hand-rolled because buttonClass centres one line. */
const CARD_BUTTON =
  'btn-secondary-type flex min-h-tap w-full flex-col items-start gap-0.5 rounded-button border border-primary bg-surface px-4 py-3 text-left text-primary-ink transition-colors hover:bg-surface-tint disabled:cursor-not-allowed disabled:opacity-60';

export interface LoadPersonaButtonsProps {
  compact?: boolean;
}

export function LoadPersonaButtons({ compact = false }: LoadPersonaButtonsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<PersonaId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();

  function load(id: PersonaId) {
    setError(null);
    setBusy(id);
    try {
      const plan = personaPlan(id, loadStrengths());
      saveProfile(plan.profile);
      if (plan.strengths) saveStrengths(plan.strengths);
      router.push('/shortlist');
    } catch {
      setBusy(null);
      setError('Could not save the demo on this device. Check that cookies are allowed, then try again.');
    }
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className={compact ? 'flex flex-wrap gap-2' : 'grid gap-3 sm:grid-cols-2'}>
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => load(p.id)}
            disabled={busy !== null}
            aria-describedby={noteId}
            className={compact ? buttonClass('secondary') : CARD_BUTTON}
          >
            <span className="font-bold">
              {busy === p.id ? 'Loading…' : compact ? `Load demo persona ${p.id}` : `Load ${p.title}`}
            </span>
            {compact ? null : <span className="text-sm font-normal text-muted">{p.summary}</span>}
          </button>
        ))}
      </div>
      <p id={noteId} className="text-xs text-muted">
        Demo personas are fictional. Loading one replaces the profile saved on this device.
      </p>
      <noscript>
        <Link href={PERSONA_A_LINK} className="inline-flex min-h-tap items-center text-sm font-semibold">
          JavaScript is off: open the shortlist for persona A
        </Link>
      </noscript>
      {/* Last child, so an empty live region adds no gap. */}
      <div aria-live="polite">
        {error ? (
          <p className="text-sm font-semibold text-conflict-fg">
            <span aria-hidden="true">! </span>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
