'use client';

import { useState } from 'react';
import { buttonClass, type ButtonVariant } from './button';

/** Copies plain text to the clipboard. Falls back to a selectable textarea if the Clipboard API is blocked. */
export function CopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  variant = 'secondary',
  className = '',
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');

  async function onClick() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('manual');
    }
  }

  return (
    <div className={className}>
      <button type="button" onClick={onClick} className={buttonClass(variant)} aria-live="polite">
        {state === 'copied' ? copiedLabel : label}
      </button>
      {state === 'manual' ? (
        <textarea
          readOnly
          className="mt-2 w-full rounded-button border border-line bg-surface p-2 text-sm"
          rows={6}
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Text to copy"
        />
      ) : null}
    </div>
  );
}
