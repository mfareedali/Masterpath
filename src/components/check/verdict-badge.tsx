/**
 * Consultant Check verdict badge. Status is shown by glyph + label + border style, never by colour alone.
 * Reuses the status colours: conflict = "Differs", unverified = "Can't verify", verified = "Matches".
 */
import { VERDICT_LABEL, type Verdict } from '@/lib/consultant/compare';

export const VERDICT_GLYPH: Record<Verdict, string> = {
  conflict: '!',
  cant_verify: '?',
  matches: '✓',
};

/** Badge + tile colours. Solid border = differs, dashed = can't verify, none = matches. */
export const VERDICT_TONE: Record<Verdict, string> = {
  conflict: 'bg-conflict-bg text-conflict-fg border border-conflict-fg',
  cant_verify: 'bg-unverified-bg text-unverified-fg border border-dashed border-unverified-fg',
  matches: 'bg-verified-bg text-verified-fg border border-verified-bg',
};

/** Left stripe on result cards. */
export const VERDICT_STRIPE: Record<Verdict, string> = {
  conflict: 'border-l-4 border-l-conflict-fg',
  cant_verify: 'border-l-4 border-l-unverified-fg',
  matches: 'border-l-4 border-l-verified-fg',
};

/**
 * `label` overrides the default text, e.g. "Differs from our summary of the official position" when the deciding
 * row holds no exact words from the official page (CheckResult.verdictLabel).
 */
export function VerdictBadge({ verdict, label, className = '' }: { verdict: Verdict; label?: string; className?: string }) {
  return (
    <span
      // Long labels ("… our summary of the official position") may wrap, so the badge never overflows a phone screen.
      className={`inline-flex max-w-full items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-bold leading-5 ${
        label && label.length > 30 ? 'whitespace-normal' : 'whitespace-nowrap'
      } ${VERDICT_TONE[verdict]} ${className}`}
    >
      <span aria-hidden="true">{VERDICT_GLYPH[verdict]}</span>
      {label || VERDICT_LABEL[verdict]}
    </span>
  );
}
