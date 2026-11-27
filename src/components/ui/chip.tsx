import Link from 'next/link';
import type { ComponentProps } from 'react';

/**
 * Chips for "Rank by" and filters. Rendered as plain links (server-side, no client JS):
 * the active state comes from the URL. Wrap a row in <div className="chip-row"> for horizontal scrolling.
 */
export function chipClass(active: boolean, extra = ''): string {
  return [
    'inline-flex min-h-tap items-center gap-1 rounded-chip border px-4 text-sm font-semibold no-underline whitespace-nowrap transition-colors',
    active
      ? 'border-primary bg-primary text-on-primary shadow-button-soft'
      : 'border-line bg-surface text-ink shadow-button-soft hover:border-primary hover:text-primary-ink',
    extra,
  ].join(' ');
}

type ChipLinkProps = ComponentProps<typeof Link> & { active?: boolean };

export function ChipLink({ active = false, className = '', children, ...rest }: ChipLinkProps) {
  return (
    <Link className={chipClass(active, className)} aria-current={active ? 'true' : undefined} {...rest}>
      {children}
    </Link>
  );
}

/** A row of chips. `wrap` lets the chips flow onto more lines (filters) instead of scrolling sideways. */
export function ChipRow({ label, children, wrap = false }: { label: string; children: React.ReactNode; wrap?: boolean }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={wrap ? 'flex flex-wrap gap-2' : 'chip-row -mx-4 px-4 md:mx-0 md:px-0'}
    >
      {children}
    </div>
  );
}
