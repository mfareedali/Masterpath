/**
 * Accessible form field: label, optional hint, inline error (not colour alone: "!" glyph + text).
 * The child receives the id / aria props so every input is labelled and linked to its hint and error.
 * No 'use client' needed: it is a plain component, rendered inside the client forms.
 */
import type { ReactNode } from 'react';

export const INPUT_CLASS =
  'block w-full min-h-tap rounded-button border border-line-strong bg-surface px-3 py-2 text-base text-ink placeholder:text-muted focus:border-primary aria-[invalid=true]:border-2 aria-[invalid=true]:border-conflict-fg';

export const TEXTAREA_CLASS = `${INPUT_CLASS} min-h-24`;

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-sm font-semibold text-conflict-fg">
      <span aria-hidden="true">! </span>
      {children}
    </p>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  optional = false,
  extraDescribedBy,
  className = '',
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  /** Extra element ids to announce (e.g. a live helper line). */
  extraDescribedBy?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId, extraDescribedBy].filter(Boolean).join(' ') || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block font-semibold text-heading">
        {label}
        {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="mt-0.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <div className="mt-1">
        {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}
