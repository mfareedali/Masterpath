'use client';

/**
 * Home hero form: CGPA + scale + field -> /shortlist.
 *
 * Progressive enhancement: without JS it is a plain GET form to /shortlist?cgpa=…&scale=…&field=…
 * (parsed by profileFromSearchParams). With JS it validates with profileSchema (via validateQuickStart),
 * saves the profile on this device (keeping saved target countries, budget…) and opens /shortlist.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Field, INPUT_CLASS } from '@/components/onboarding/field';
import { buttonClass } from '@/components/ui/button';
import {
  DEFAULT_FIELD,
  DEFAULT_SCALE,
  SCALE_OPTIONS,
  scaleMax,
  shortlistHref,
  validateQuickStart,
  type FieldErrors,
  type QuickStartField,
} from '@/lib/onboarding/profile-form';
import { EMPTY_STRENGTHS } from '@/lib/onboarding/strengths-form';
import { FIELDS, fieldOptionLabel } from '@/lib/profile';
import { loadProfile, loadStrengths, saveProfile, saveStrengths } from '@/lib/profile-client';
import type { Profile, Strengths } from '@/lib/types';

const ORDER: QuickStartField[] = ['cgpa', 'scale', 'field'];

function placeholderFor(scale: string): string {
  return scale === 'percent' ? 'e.g. 68' : 'e.g. 2.75';
}

function safeLoadProfile(): Profile | null {
  try {
    return loadProfile();
  } catch {
    return null;
  }
}

export function QuickStartForm({ fieldsWithPrograms }: { fieldsWithPrograms?: readonly string[] } = {}) {
  const router = useRouter();
  const uid = useId();
  const id = (k: string) => `${uid}-${k}`;
  const formRef = useRef<HTMLFormElement>(null);
  const cgpaRef = useRef<HTMLInputElement>(null);
  const scaleRef = useRef<HTMLSelectElement>(null);
  const fieldRef = useRef<HTMLSelectElement>(null);
  const [errors, setErrors] = useState<FieldErrors<QuickStartField>>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  function syncScale(scale: string) {
    const input = cgpaRef.current;
    if (!input) return;
    input.max = String(scaleMax(scale));
    input.placeholder = placeholderFor(scale);
  }

  useEffect(() => {
    // JS is running: show our inline errors instead of the browser's validation bubbles.
    if (formRef.current) formRef.current.noValidate = true;
    // Prefill from a profile the student saved earlier (never from a fictional demo persona).
    const saved = safeLoadProfile();
    if (saved && !saved.persona) {
      if (cgpaRef.current && cgpaRef.current.value === '') cgpaRef.current.value = String(saved.cgpa);
      if (scaleRef.current) scaleRef.current.value = saved.scale;
      if (fieldRef.current && FIELDS.some((f) => f.slug === saved.field)) fieldRef.current.value = saved.field;
    }
    // The server HTML has no max (so "Percentage" works with JS off); set it for the chosen scale now.
    syncScale(scaleRef.current?.value ?? DEFAULT_SCALE);
  }, []);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const values = {
      cgpa: String(fd.get('cgpa') ?? ''),
      scale: String(fd.get('scale') ?? ''),
      field: String(fd.get('field') ?? ''),
    };
    let stored: Strengths | null = null;
    try {
      stored = loadStrengths();
    } catch {
      /* storage blocked */
    }
    const result = validateQuickStart(values, safeLoadProfile(), stored);
    if (!result.ok) {
      const errs = { ...result.errors };
      // type="number" empties the value when the text is not a number (e.g. "2,5" on some phones).
      if (errs.cgpa && cgpaRef.current?.validity.badInput) errs.cgpa = 'Use digits only, for example 2.75.';
      setErrors(errs);
      setStatus('Please check the field marked below.');
      const first = ORDER.find((k) => errs[k]);
      if (first) document.getElementById(id(first))?.focus();
      return;
    }
    setErrors({});
    setBusy(true);
    setStatus('Opening your options…');
    try {
      saveProfile(result.profile);
      if (result.resetDemoStrengths) saveStrengths(EMPTY_STRENGTHS);
      router.push('/shortlist');
    } catch {
      // Cookies/storage blocked: the shareable URL still works, it just is not remembered.
      router.push(shortlistHref(result.profile));
    }
  }

  return (
    <form
      ref={formRef}
      action="/shortlist"
      method="get"
      onSubmit={onSubmit}
      className="mt-5 space-y-4"
      aria-describedby={id('privacy')}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field id={id('cgpa')} label="Your grade" error={errors.cgpa}>
          {(control) => (
            <input
              {...control}
              ref={cgpaRef}
              name="cgpa"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              required
              autoComplete="off"
              placeholder={placeholderFor(DEFAULT_SCALE)}
              className={INPUT_CLASS}
            />
          )}
        </Field>
        <Field id={id('scale')} label="Scale" error={errors.scale}>
          {(control) => (
            <select
              {...control}
              ref={scaleRef}
              name="scale"
              defaultValue={DEFAULT_SCALE}
              onChange={(e) => syncScale(e.currentTarget.value)}
              className={INPUT_CLASS}
            >
              {SCALE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <Field id={id('field')} label="Field you want to study" error={errors.field}>
        {(control) => (
          <select {...control} ref={fieldRef} name="field" defaultValue={DEFAULT_FIELD} className={INPUT_CLASS}>
            {FIELDS.map((f) => (
              <option key={f.slug} value={f.slug}>
                {fieldOptionLabel(f, fieldsWithPrograms)}
              </option>
            ))}
          </select>
        )}
      </Field>

      <button type="submit" disabled={busy} className={buttonClass('primary', '', true)}>
        {busy ? 'Opening…' : 'See my options'}
      </button>

      <p role="status" className="sr-only">
        {status}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <p id={id('privacy')} className="text-muted">
          Saved only on this device. No sign-up.
        </p>
        <Link href="/onboarding" className="inline-flex min-h-tap items-center font-semibold">
          Add more details (1 minute)<span aria-hidden="true">&nbsp;→</span>
        </Link>
      </div>
    </form>
  );
}
