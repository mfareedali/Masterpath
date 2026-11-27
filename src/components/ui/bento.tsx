/**
 * Bento grid of link tiles. Ported from the 21st.dev "Bento Grid" block (karaui), without motion/react or
 * lucide-react: layout, spans, the stretched-link CTA and the cursor spotlight are kept; animation is plain CSS.
 *
 * - Server component. The grid reads its own container width (@container), not the viewport.
 * - The CTA is the only link and stretches over the whole tile (one tab stop, never an <a> inside an <a>).
 * - The spotlight is decorative: `.bento-card` paints it from --spot-x/--spot-y, which <SpotlightTracker> sets on
 *   hover-capable devices. Without JS (or on touch) tiles get a plain border highlight instead.
 * - Tiles fade up once on load (`.bento-in`, staggered by --i); reduced motion turns that off in globals.css.
 * Colours come from theme tokens only (src/theme.ts).
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SpotlightTracker } from './spotlight-tracker';

export type BentoSpan = 1 | 2 | 3;

// Static class maps: Tailwind only ships classes it can see written out.
const GRID_COLS: Record<2 | 3, string> = { 2: '@lg:grid-cols-2', 3: '@lg:grid-cols-3' };
const COL_SPAN: Record<BentoSpan, string> = { 1: '', 2: '@lg:col-span-2', 3: '@lg:col-span-3' };
const ROW_SPAN: Record<BentoSpan, string> = { 1: '', 2: '@lg:row-span-2', 3: '@lg:row-span-3' };

export function BentoGrid({
  children,
  columns = 3,
  className = '',
  as: Tag = 'ul',
}: {
  children: ReactNode;
  columns?: 2 | 3;
  className?: string;
  /** ul by default (tiles are <li>); use 'div' when the tiles are not a list. */
  as?: 'ul' | 'div';
}) {
  return (
    <div className={`@container w-full ${className}`}>
      <SpotlightTracker selector=".bento-card">
        <Tag className={`grid auto-rows-[minmax(9rem,auto)] grid-cols-1 gap-3 ${GRID_COLS[columns]}`}>{children}</Tag>
      </SpotlightTracker>
    </div>
  );
}

export function BentoCard({
  title,
  description,
  icon,
  visual,
  href,
  cta = 'Open',
  srLabel,
  colSpan = 1,
  rowSpan = 1,
  index = 0,
  as: Tag = 'li',
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Small decorative icon shown in a tile above the title. */
  icon?: ReactNode;
  /** Decorative visual (mini illustration). aria-hidden; must not carry information. */
  visual?: ReactNode;
  /** Makes the whole tile a link via the CTA. */
  href?: string;
  cta?: ReactNode;
  /** Extra screen-reader text appended to the CTA, e.g. the tile title. */
  srLabel?: string;
  colSpan?: BentoSpan;
  rowSpan?: BentoSpan;
  /** Position in the grid, for the load-in stagger. */
  index?: number;
  as?: 'li' | 'div';
  className?: string;
}) {
  return (
    <Tag
      className={`bento-card bento-in group/bento relative isolate flex flex-col overflow-hidden rounded-card border border-line bg-surface p-4 text-ink shadow-card ${COL_SPAN[colSpan]} ${ROW_SPAN[rowSpan]} ${className}`}
      style={{ ['--i' as string]: index }}
    >
      {visual ? (
        <div
          aria-hidden="true"
          className="relative mb-3 flex min-h-0 flex-1 items-center justify-center transition-transform duration-500 ease-out motion-safe:group-hover/bento:-translate-y-0.5"
        >
          {visual}
        </div>
      ) : null}

      <div className={`flex flex-col ${visual ? '' : 'mt-auto'}`}>
        <div className="flex items-center gap-2">
          {icon ? (
            <span
              aria-hidden="true"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-badge border border-line bg-page text-primary-ink [&_svg]:h-4 [&_svg]:w-4"
            >
              {icon}
            </span>
          ) : null}
          <h3 className="text-lg font-bold leading-snug text-heading">{title}</h3>
        </div>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        {href ? (
          <Link
            href={href}
            className="mt-3 inline-flex min-h-tap w-fit items-center gap-1 text-sm font-semibold text-primary-ink no-underline after:absolute after:inset-0 after:z-30 after:rounded-[inherit] after:content-[''] hover:underline md:min-h-0"
          >
            {cta}
            {srLabel ? <span className="sr-only">: {srLabel}</span> : null}
            <span aria-hidden="true" className="transition-transform duration-200 group-hover/bento:translate-x-0.5">
              →
            </span>
          </Link>
        ) : null}
      </div>
    </Tag>
  );
}
