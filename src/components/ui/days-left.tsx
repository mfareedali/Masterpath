'use client';

/**
 * "N days left" for a date, computed in the BROWSER (client leaf).
 *
 * Program pages are static and cached (ISR, stale-while-revalidate, service worker), so a countdown rendered on
 * the server would be frozen at build time and could say "6 days left" after a deadline has closed. The server
 * renders the date itself; this leaf adds the countdown after hydration. The server snapshot is null, so server
 * HTML and hydration always agree. The line height is reserved, so filling it in never shifts the layout.
 *
 * `pinnedNow` is the server's pinned demo clock (MASTERSPATH_NOW), the same value FitPanel receives.
 */
import { useSyncExternalStore } from 'react';
import { daysLeftText } from '@/lib/program/render';

/** The clock the leaf uses: the pinned demo time when set and valid, otherwise the device clock. */
export function clientNow(pinnedNow: string | null | undefined, clock: () => Date = () => new Date()): Date {
  if (pinnedNow) {
    const t = Date.parse(pinnedNow);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return clock();
}

/** Pure snapshot: the countdown text, or null for an invalid date. A string, so snapshots compare equal. */
export function daysLeftSnapshot(
  iso: string,
  pinnedNow: string | null | undefined,
  clock: () => Date = () => new Date(),
): string | null {
  return daysLeftText(iso, clientNow(pinnedNow, clock));
}

/** Re-read when the tab becomes visible again (a page left open overnight shows the new count). */
function subscribe(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  window.addEventListener('focus', onChange);
  return () => {
    document.removeEventListener('visibilitychange', onChange);
    window.removeEventListener('focus', onChange);
  };
}

const serverSnapshot = () => null;

export function DaysLeft({
  iso,
  pinnedNow = null,
  className = '',
}: {
  iso: string;
  pinnedNow?: string | null;
  className?: string;
}) {
  const text = useSyncExternalStore(subscribe, () => daysLeftSnapshot(iso, pinnedNow), serverSnapshot);
  // One reserved line (24px at text-base), empty until the browser fills it in: no layout shift.
  return (
    <span className={['block min-h-6 leading-6', className].filter(Boolean).join(' ')} data-days-left={iso}>
      {text ?? ''}
    </span>
  );
}
