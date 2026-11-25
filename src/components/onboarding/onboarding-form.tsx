'use client';

/**
 * Onboarding form (screen 2). Finishable in under a minute: only the grade is required.
 *
 * - Prefills from the profile/strengths saved on this device (loadProfile / loadStrengths).
 * - Validates with profileSchema (via validateOnboarding) and shows inline, accessible errors.
 * - Saves with saveProfile (+ saveStrengths), then opens /shortlist.
 * - Without JS it still works as a GET form to /shortlist (cgpa, scale, min_pass, field, budget, countries).
 * No passport or ID fields — ever.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Field, FieldError, INPUT_CLASS } from './field';
import { StrengthsSection } from './strengths-section';
import { buttonClass } from '@/components/ui/button';
import { Callout } from '@/components/ui/card';
import { chipClass } from '@/components/ui/chip';
import { countryName } from '@/lib/format';
import {
  MAX_DEGREE,
  MAX_UNIVERSITY_NAME,
  SCALE_OPTIONS,
  budgetHelperText,
  emptyOnboardingValues,
  profileToValues,
  resolveUniversityId,
  toggleCountry,
  validateOnboarding,
  type FieldErrors,
  type OnboardingField,
  type OnboardingValues,
  type UniversityOption,
} from '@/lib/onboarding/profile-form';
import {
  hasAnyStrengths,
  sanitizeStoredStrengths,
  sanitizeStrengths,
  strengthsToValues,
  validateStrengths,
  type StrengthsValues,
} from '@/lib/onboarding/strengths-form';
import { FIELDS, SUPPORTED_COUNTRIES } from '@/lib/profile';
import { loadProfile, loadStrengths, saveProfile, saveStrengths } from '@/lib/profile-client';
import type { Profile, Strengths } from '@/lib/types';

/* ---------- Saved data on this device (read without setState-in-effect) ---------- */

interface Saved {
  p: Profile | null;
  s: Strengths | null;
}

const EMPTY_SNAPSHOT = JSON.stringify({ p: null, s: null } satisfies Saved);

function readSaved(): string {
  try {
    return JSON.stringify({ p: loadProfile(), s: sanitizeStoredStrengths(loadStrengths()) } satisfies Saved);
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

/*
 * The snapshot is cached: saving from this form must NOT remount it (that would drop the "Saved" status),
 * so it is re-read only when the form mounts (subscribe) or another tab changes storage.
 */
let cachedSaved: string | null = null;

function subscribe(onChange: () => void) {
  cachedSaved = readSaved(); // fresh on every mount (client-side navigation back to this page)
  const onStorage = () => {
    cachedSaved = readSaved();
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

function getSnapshot(): string {
  if (cachedSaved === null) cachedSaved = readSaved();
  return cachedSaved;
}

function getServerSnapshot(): string {
  return EMPTY_SNAPSHOT;
}

/** Reads what is saved on this device and (re)mounts the form with it as initial values. */
export function Onboarding({ universities }: { universities: UniversityOption[] }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const saved = useMemo(() => JSON.parse(snapshot) as Saved, [snapshot]);
  return <OnboardingForm key={snapshot} universities={universities} savedProfile={saved.p} savedStrengths={saved.s} />;
}

/* ---------- The form ---------- */

const FIELD_ORDER: OnboardingField[] = [
  'cgpa',
  'scale',
  'min_pass',
  'university_name',
  'degree',
  'field',
  'budget_pkr',
  'target_countries',
];

function countLabel(n: number) {
  return n === 1 ? '1 field' : `${n} fields`;
}

export function OnboardingForm({
  universities,
  savedProfile,
  savedStrengths,
}: {
  universities: UniversityOption[];
  savedProfile: Profile | null;
  savedStrengths: Strengths | null;
}) {
  const router = useRouter();
  const uid = useId();
  const id = (k: string) => `${uid}-${k.replace(/\./g, '-')}`;
  const formRef = useRef<HTMLFormElement>(null);
  const cgpaRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const [values, setValues] = useState<OnboardingValues>(() => profileToValues(savedProfile));
  const [strengths, setStrengths] = useState<StrengthsValues>(() => strengthsToValues(savedStrengths));
  const [errors, setErrors] = useState<FieldErrors<OnboardingField>>({});
  const [strengthErrors, setStrengthErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const isDemo = Boolean(savedProfile?.persona);

  useEffect(() => {
    // JS is running: show our inline errors instead of the browser's validation bubbles.
    if (formRef.current) formRef.current.noValidate = true;
  }, []);

  function set<K extends keyof OnboardingValues>(key: K, v: OnboardingValues[K]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function clearForm() {
    setValues(emptyOnboardingValues());
    setStrengths(strengthsToValues(null));
    setErrors({});
    setStrengthErrors({});
    setStatus('Form cleared. Nothing is saved until you press Save.');
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const result = validateOnboarding(values, universities);
    const sErrors = validateStrengths(strengths);
    const pErrors = result.ok ? {} : { ...result.errors };
    if (pErrors.cgpa && cgpaRef.current?.validity.badInput) pErrors.cgpa = 'Use digits only, for example 2.75.';
    setErrors(pErrors);
    setStrengthErrors(sErrors);

    const total = Object.keys(pErrors).length + Object.keys(sErrors).length;
    if (!result.ok || total > 0) {
      setStatus(`Please fix ${countLabel(total)} marked below.`);
      const firstProfileKey = FIELD_ORDER.find((k) => pErrors[k]);
      const firstStrengthKey = Object.keys(sErrors)[0];
      if (firstProfileKey) {
        document.getElementById(id(firstProfileKey))?.focus();
      } else if (firstStrengthKey) {
        if (detailsRef.current) detailsRef.current.open = true;
        document.getElementById(id(`strengths-${firstStrengthKey}`))?.focus();
      }
      return;
    }

    try {
      saveProfile(result.profile);
      const cleanStrengths = sanitizeStrengths(strengths, savedStrengths);
      if (hasAnyStrengths(cleanStrengths) || hasAnyStrengths(savedStrengths)) saveStrengths(cleanStrengths);
    } catch {
      setStatus('Could not save on this device. Check that cookies are allowed, then try again.');
      return;
    }
    setBusy(true);
    setStatus('Saved. Opening your shortlist…');
    router.push('/shortlist');
  }

  const budgetHelper = budgetHelperText(values.budget_pkr);
  const matchedUniversity = resolveUniversityId(values.university_name, universities);
  const countriesHintId = id('countries-hint');

  return (
    <form ref={formRef} action="/shortlist" method="get" onSubmit={onSubmit} className="space-y-6">
      {isDemo ? (
        <Callout tone="neutral" title="You are editing a demo persona">
          <p>These details are fictional demo data. Saving makes them your own profile on this device.</p>
          <button type="button" onClick={clearForm} className={buttonClass('secondary', 'mt-2')}>
            Clear the form and start fresh
          </button>
        </Callout>
      ) : null}

      <p role="status" aria-live="polite" className="font-semibold text-heading empty:sr-only">
        {status}
      </p>

      {/* Grades */}
      <fieldset className="space-y-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <legend className="float-left mb-1 w-full text-lg font-bold text-heading">Your grades</legend>
        <div className="clear-both grid grid-cols-2 gap-3">
          <Field id={id('cgpa')} label="Your grade" error={errors.cgpa}>
            {(c) => (
              <input
                {...c}
                ref={cgpaRef}
                name="cgpa"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                required
                autoComplete="off"
                placeholder={values.scale === 'percent' ? 'e.g. 68' : 'e.g. 2.75'}
                value={values.cgpa}
                onChange={(e) => set('cgpa', e.target.value)}
                className={INPUT_CLASS}
              />
            )}
          </Field>
          <Field id={id('scale')} label="Scale" error={errors.scale}>
            {(c) => (
              <select
                {...c}
                name="scale"
                value={values.scale}
                onChange={(e) => set('scale', e.target.value)}
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
        <Field
          id={id('min_pass')}
          label="Lowest passing grade on your transcript"
          optional
          hint="It narrows the German grade conversion. Leave blank if unsure."
          error={errors.min_pass}
        >
          {(c) => (
            <input
              {...c}
              name="min_pass"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              autoComplete="off"
              value={values.min_pass}
              onChange={(e) => set('min_pass', e.target.value)}
              className={`${INPUT_CLASS} max-w-40`}
            />
          )}
        </Field>
      </fieldset>

      {/* Bachelor's */}
      <fieldset className="space-y-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <legend className="float-left mb-1 w-full text-lg font-bold text-heading">Your bachelor&apos;s</legend>
        <Field
          id={id('university_name')}
          label="University"
          optional
          hint="Start typing and pick it from the list if it appears. If not, type the full name."
          error={errors.university_name}
          className="clear-both"
        >
          {(c) => (
            <>
              <input
                {...c}
                type="text"
                list={id('universities')}
                autoComplete="off"
                maxLength={MAX_UNIVERSITY_NAME + 20}
                value={values.university_name}
                onChange={(e) => set('university_name', e.target.value)}
                className={INPUT_CLASS}
              />
              <datalist id={id('universities')}>
                {universities.map((u) => (
                  <option key={u.id} value={u.name} />
                ))}
              </datalist>
              {matchedUniversity ? (
                <p className="mt-1 text-sm text-muted">
                  <span aria-hidden="true">✓ </span>Found in our list. We will show what official lists say about it.
                </p>
              ) : null}
            </>
          )}
        </Field>
        <Field id={id('degree')} label="Degree" optional error={errors.degree}>
          {(c) => (
            <input
              {...c}
              type="text"
              autoComplete="off"
              maxLength={MAX_DEGREE + 20}
              placeholder="e.g. BS Computer Science"
              value={values.degree}
              onChange={(e) => set('degree', e.target.value)}
              className={INPUT_CLASS}
            />
          )}
        </Field>
      </fieldset>

      {/* Plan */}
      <fieldset className="space-y-4 rounded-card border border-line bg-surface p-4 shadow-card">
        <legend className="float-left mb-1 w-full text-lg font-bold text-heading">Your plan</legend>
        <Field id={id('field')} label="Field you want to study" error={errors.field} className="clear-both">
          {(c) => (
            <select
              {...c}
              name="field"
              value={values.field}
              onChange={(e) => set('field', e.target.value)}
              className={INPUT_CLASS}
            >
              {FIELDS.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          id={id('budget_pkr')}
          label="Total budget for the whole degree (PKR)"
          optional
          hint="Tuition plus living costs for the full program. Leave blank if unsure."
          error={errors.budget_pkr}
          extraDescribedBy={id('budget-helper')}
        >
          {(c) => (
            <>
              <input
                {...c}
                name="budget"
                type="number"
                inputMode="numeric"
                min="0"
                step="any"
                autoComplete="off"
                placeholder="e.g. 6000000"
                value={values.budget_pkr}
                onChange={(e) => set('budget_pkr', e.target.value)}
                className={INPUT_CLASS}
              />
              <p id={id('budget-helper')} aria-live="polite" className="mt-1 min-h-6 text-sm font-semibold text-primary-ink">
                {budgetHelper}
              </p>
            </>
          )}
        </Field>

        <div role="group" aria-labelledby={id('countries-label')} aria-describedby={countriesHintId}>
          <p id={id('countries-label')} className="font-semibold text-heading">
            Where do you want to study?<span className="font-normal text-muted"> (optional)</span>
          </p>
          <p id={countriesHintId} className="mt-0.5 text-sm text-muted">
            Tap to choose one or more. Choose none to see every country.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SUPPORTED_COUNTRIES.map((code) => {
              const on = values.target_countries.includes(code);
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set('target_countries', toggleCountry(values.target_countries, code))}
                  className={chipClass(on)}
                >
                  <span aria-hidden="true">{on ? '✓' : '+'}</span>
                  {countryName(code)}
                </button>
              );
            })}
          </div>
          <input type="hidden" name="countries" value={values.target_countries.join(',')} />
          {errors.target_countries ? <FieldError>{errors.target_countries}</FieldError> : null}
        </div>
      </fieldset>

      <StrengthsSection
        ref={detailsRef}
        idPrefix={id('strengths')}
        values={strengths}
        errors={strengthErrors}
        defaultOpen={hasAnyStrengths(savedStrengths)}
        onChange={setStrengths}
      />

      <div className="space-y-3">
        <button type="submit" disabled={busy} className={buttonClass('primary', '', true)}>
          {busy ? 'Saving…' : 'Save and see my options'}
        </button>
        <p className="text-sm text-muted">
          Saved only on this device. We never ask for passport or ID numbers.{' '}
          <Link href="/account" className="font-semibold">
            Delete my data on this device
          </Link>
        </p>
      </div>
    </form>
  );
}
