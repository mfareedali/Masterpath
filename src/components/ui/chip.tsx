import Link from 'next/link';
import type { ComponentProps } from 'react';

/**
 * Chips for "Rank by" and filters. Rendered as plain links (server-side, no client JS):
 * the active state comes from the URL. Wrap a row in <div className="chip-row"> for horizontal scrolling.
 */
export function chipClass(active: boolean, extra = ''): string {
  return [
    'inline-flex min-h-tap items-center gap-1 rounded-chip border px-4 text-sm font-semibold no-underline whitespace-nowrap',
    active
      ? 'border-primary bg-primary text-on-primary'
      : 'border-line bg-surface text-ink hover:border-primary',
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

export function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="chip-row -mx-4 px-4 md:mx-0 md:px-0">
      {children}
    </div>
  );
}
