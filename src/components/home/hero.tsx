import { Outfit } from 'next/font/google';
import Link from 'next/link';
import { buttonClass } from '@/components/ui/button';
import type { HomeStats } from '@/lib/home/stats';
import { TextCycle } from './text-cycle';

/**
 * Display face for the hero headline ONLY (>= 40px; thin weights are never used below 28px).
 * Self-hosted by next/font at build time (no third-party request, CSP font-src 'self'), Latin subset,
 * font-display: swap, size-adjusted fallback (no layout shift). Loaded on the Home route only.
 * To change the font: swap the import here and the --font-display stack in src/theme.ts.
 */
const display = Outfit({
  subsets: ['latin'],
  weight: '300',
  display: 'swap',
  variable: '--font-outfit',
  adjustFontFallback: true,
});

/** Rotating end of the headline. Short, so the line fits a 360px phone at display size. All true of the product. */
export const HERO_PHRASES = ['honestly.', 'for free.', 'with sources.', 'no guessing.'] as const;

/**
 * Home hero, typography only (after the 21st.dev "Animated Hero" pattern): a pill badge, a large centred headline
 * whose last line cycles through phrases with a per-letter blur, one paragraph, two buttons and a line of live
 * dataset numbers. Background: soft olive light and a fading grid (decorative). Motion is CSS, off under
 * prefers-reduced-motion; without JS the headline shows its first phrase.
 */
export function Hero({ stats }: { stats: HomeStats }) {
  const plain = `Plan your Masters abroad ${HERO_PHRASES[0].replace(/\.$/, '')}`;
  return (
    <section
      aria-labelledby="home-title"
      className={`${display.variable} relative -mx-4 -mt-4 overflow-hidden px-4 pb-16 pt-14 text-center md:pb-24 md:pt-24`}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <span className="hero-glow-light absolute inset-0" />
        <span className="hero-grid-light absolute inset-0" />
      </div>

      <Link
        href="/about"
        className="hero-rise group inline-flex min-h-tap items-center gap-2 whitespace-nowrap rounded-chip border border-line bg-surface/80 px-3 py-1.5 text-[0.8125rem] font-semibold sm:px-4 sm:text-sm text-ink no-underline shadow-button-soft backdrop-blur transition-colors hover:border-primary"
      >
        <span aria-hidden="true" className="hero-pulse relative inline-block h-2 w-2 rounded-full bg-primary" />
        Free and open source, for students in Pakistan
        <span aria-hidden="true" className="text-primary-ink transition-transform group-hover:translate-x-0.5">
          →
        </span>
      </Link>

      <h1
        id="home-title"
        aria-label={plain}
        className="hero-rise hero-rise-2 mx-auto mt-8 max-w-5xl font-display text-[2.75rem] font-light leading-[1.05] tracking-tight text-heading sm:text-6xl md:text-7xl lg:text-[5rem]"
      >
        <span aria-hidden="true" className="block">
          Plan your Masters abroad
        </span>
        <span aria-hidden="true" className="relative mt-1 block text-primary-ink">
          <TextCycle phrases={HERO_PHRASES} />
          <svg
            viewBox="0 0 300 12"
            preserveAspectRatio="none"
            className="hero-underline absolute -bottom-2 left-1/2 h-3 w-[min(70%,22rem)] -translate-x-1/2 text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          >
            <path pathLength="1" d="M2 9 C 80 2, 220 2, 298 7" />
          </svg>
        </span>
      </h1>

      <p className="hero-rise hero-rise-3 mx-auto mt-8 max-w-2xl text-lg text-ink md:text-xl">
        See which programs your grade meets, what they really cost and how long citizenship takes. Every fact links to the
        official page. If we cannot verify something, we say so.
      </p>

      <div className="hero-rise hero-rise-4 mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a href="#start" className={buttonClass('primary', 'w-full px-8 sm:w-auto')}>
          Check my grade
        </a>
        <Link href="/check" className={buttonClass('secondary', 'w-full min-h-button px-7 sm:w-auto')}>
          Check a consultant’s claim
        </Link>
      </div>

      <dl aria-label="What is in the dataset today" className="hero-rise hero-rise-4 mx-auto mt-12 flex max-w-xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted">
        <div className="flex flex-row-reverse items-baseline gap-1.5">
          <dt>{stats.programs === 1 ? 'program' : 'programs'}</dt>
          <dd className="text-2xl font-semibold tabular-nums text-heading">{stats.programs}</dd>
        </div>
        <span aria-hidden="true" className="hidden h-5 w-px bg-line sm:block" />
        <div className="flex flex-row-reverse items-baseline gap-1.5">
          <dt>{stats.countries === 1 ? 'country' : 'countries'}</dt>
          <dd className="text-2xl font-semibold tabular-nums text-heading">{stats.countries}</dd>
        </div>
        <span aria-hidden="true" className="hidden h-5 w-px bg-line sm:block" />
        <div className="flex flex-row-reverse items-baseline gap-1.5">
          <dt>facts verified from official pages</dt>
          <dd className="text-2xl font-semibold tabular-nums text-link">{stats.facts.verified}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Slowly scrolling strip of university names from the dataset (pauses on hover; static under reduced motion). */
export function UniversityMarquee({ names }: { names: readonly string[] }) {
  if (names.length === 0) return null;
  const items = (copy: boolean) =>
    names.map((n) => (
      <li key={`${copy ? 'b' : 'a'}-${n}`} aria-hidden={copy || undefined} className="flex shrink-0 items-center gap-6 pr-6">
        <span className="whitespace-nowrap text-base font-semibold text-muted">{n}</span>
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-line-strong" />
      </li>
    ));
  return (
    <section aria-labelledby="home-unis" className="space-y-3">
      <h2 id="home-unis" className="text-center text-xs font-semibold uppercase tracking-wide text-muted">
        Programs from universities including
      </h2>
      <div className="marquee relative overflow-hidden">
        <ul className="marquee-track flex w-max">
          {items(false)}
          {items(true)}
        </ul>
      </div>
    </section>
  );
}
