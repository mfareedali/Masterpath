/**
 * Stat tiles: one key number with a label and an optional caption (after the 21st.dev "Data Card" pattern,
 * built on theme tokens). Server components. Numbers passed in must come from code over data rows, never copy.
 *
 * Tones:
 *  - neutral:  stone surface (counts, dates)
 *  - evidence: blue bar = "verified by an official source". Use ONLY for verified counts.
 *  - accent:   olive tint, for the one number a screen is about
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

export type StatTone = 'neutral' | 'evidence' | 'accent';

const TONE: Record<StatTone, string> = {
  neutral: 'border-line bg-surface',
  evidence: 'border-line bg-surface before:bg-evidence-bar',
  accent: 'border-accent-soft bg-accent-soft before:bg-accent',
};

export function StatTile({
  label,
  value,
  caption,
  tone = 'neutral',
  href,
  className = '',
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  tone?: StatTone;
  /** Makes the tile a link (e.g. to the section it counts). */
  href?: string;
  className?: string;
  /** Extra content under the caption, e.g. a progress bar. */
  children?: ReactNode;
}) {
  const bar = tone === 'neutral' ? '' : "before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-chip before:content-['']";
  const body = (
    <>
      <span className="block text-xs font-semibold text-muted">{label}</span>
      <span className="mt-1 block text-2xl font-bold leading-tight tabular-nums text-heading">{value}</span>
      {caption ? <span className="mt-1 block text-xs text-muted">{caption}</span> : null}
      {children}
    </>
  );
  const cls = `relative block min-w-0 rounded-card border p-3 pl-4 ${TONE[tone]} ${bar} ${className}`;
  return href ? (
    <Link href={href} className={`${cls} text-ink no-underline transition-colors hover:border-primary`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Responsive row of StatTiles (2 columns on phones, up to `cols` from md). */
export function StatGrid({ children, cols = 4, label }: { children: ReactNode; cols?: 2 | 3 | 4; label?: string }) {
  const md = cols === 4 ? 'md:grid-cols-4' : cols === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2';
  return (
    <div role={label ? 'group' : undefined} aria-label={label} className={`grid grid-cols-2 gap-2 ${md}`}>
      {children}
    </div>
  );
}
