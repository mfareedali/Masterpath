import { Outfit } from 'next/font/google';
import type { ReactNode } from 'react';
import type { HomeStats } from '@/lib/home/stats';

/**
 * Display face for the hero wordmark ONLY (>= 40px; thin weights are never used below 28px).
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

/** One number on the dark hero panel. Values come from homeStats (code over data rows). */
function HeroStat({ value, label, evidence = false }: { value: ReactNode; label: string; evidence?: boolean }) {
  return (
    // dt before dd in the DOM (valid <dl>); flex-col-reverse puts the number on top.
    <div className={`flex min-w-0 flex-col-reverse border-l-2 pl-3 ${evidence ? 'border-evidence-bar' : 'border-on-chrome-muted/40'}`}>
      <dt className="text-xs text-on-chrome-muted">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums text-on-chrome md:text-3xl">{value}</dd>
    </div>
  );
}

/**
 * Floating example badges around the form (desktop only, decorative). They show what the labels LOOK like, not
 * facts about any program, so they carry no values.
 */
function FloatingBadges() {
  const card = 'hero-float absolute z-20 hidden items-center gap-2 rounded-card border px-3 py-2 text-sm font-semibold shadow-lift lg:inline-flex';
  return (
    <div aria-hidden="true">
      <span className={`${card} -left-10 -top-5 border-verified-bg bg-verified-bg text-verified-fg`}>
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3.5 8.5l3 3 6-7" />
        </svg>
        Verified from the official page
      </span>
      <span className={`${card} hero-float-2 -right-8 bottom-12 border-fit-meets-bg bg-fit-meets-bg text-fit-meets-fg`}>
        <span>●</span> Meets minimum
      </span>
      <span className={`${card} hero-float-3 -bottom-5 -left-8 border-line bg-unverified-bg text-unverified-fg`}>
        <span className="font-bold">?</span> Not verified yet: we say so
      </span>
    </div>
  );
}

/**
 * Home hero: a forest-950 stage with drifting olive light, a faint grid, route lines that draw in and a dot that
 * travels them. Left: eyebrow, gradient wordmark, subtitle and live dataset numbers. Right: the quick-start form
 * floating on the stage, with example badges bobbing around it (desktop). All motion is CSS/SMIL, decorative, and
 * off under prefers-reduced-motion (globals.css).
 */
export function Hero({
  eyebrow,
  subtitle,
  stats,
  children,
}: {
  eyebrow: string;
  subtitle: string;
  stats: HomeStats;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="home-title"
      className={`${display.variable} on-chrome relative -mx-4 -mt-4 overflow-hidden bg-chrome text-on-chrome md:mx-0 md:mt-0 md:rounded-panel md:shadow-lift`}
    >
      {/* Light, grid and routes: decorative layers. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <span className="hero-blob hero-blob-1" />
        <span className="hero-blob hero-blob-2" />
        <span className="hero-blob hero-blob-3" />
        <span className="hero-grid absolute inset-0" />
      </div>
      <svg
        aria-hidden="true"
        viewBox="0 0 800 500"
        preserveAspectRatio="xMidYMax slice"
        className="pointer-events-none absolute inset-0 h-full w-full"
        fill="none"
        strokeLinecap="round"
      >
        <path id="hero-route" className="hero-path text-accent-soft" pathLength="1" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.6" d="M-40 450 C 140 430, 220 300, 400 290 S 680 170, 860 60" />
        <path className="hero-path hero-path-2 text-on-chrome-muted" pathLength="1" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.2" d="M-40 490 C 180 470, 300 380, 470 360 S 720 260, 860 200" />
        <circle className="hero-node text-accent-soft" cx="400" cy="290" r="5" fill="currentColor" />
        <circle className="hero-node hero-node-2 text-accent-soft" cx="470" cy="360" r="4" fill="currentColor" />
        {/* Travelling dot: SMIL follows the path at any size; hidden under reduced motion. */}
        <g className="hero-traveller text-accent-soft">
          <circle r="12" fill="currentColor" opacity="0.18" />
          <circle r="4.5" fill="currentColor" />
          <animateMotion dur="8s" begin="1.8s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.55 1">
            <mpath href="#hero-route" />
          </animateMotion>
        </g>
      </svg>

      <div className="relative grid gap-8 px-5 pb-8 pt-8 md:grid-cols-[1.05fr_1fr] md:items-center md:gap-10 md:px-10 md:py-14 lg:px-12 lg:py-16">
        <div>
          <p className="hero-rise inline-flex items-center gap-2 rounded-chip border border-on-chrome-muted/40 bg-chrome/60 px-3 py-1 text-[0.8125rem] font-semibold text-on-chrome-muted backdrop-blur-sm">
            <span aria-hidden="true" className="hero-pulse relative inline-block h-1.5 w-1.5 rounded-full bg-accent-soft" />
            {eyebrow}
          </p>
          <h1 id="home-title" className="hero-rise hero-rise-2 hero-wordmark wordmark mt-6 text-[3.4rem] md:text-7xl lg:text-[5.5rem]">
            MastersPath
          </h1>
          <p className="hero-rise hero-rise-3 mt-4 max-w-md text-lg text-on-chrome md:text-xl">{subtitle}</p>

          <dl aria-label="What is in the dataset today" className="hero-rise hero-rise-4 mt-8 grid max-w-md grid-cols-3 gap-3 md:mt-12">
            <HeroStat value={stats.programs} label={stats.programs === 1 ? 'program' : 'programs'} />
            <HeroStat value={stats.countries} label={stats.countries === 1 ? 'country' : 'countries'} />
            <HeroStat value={stats.facts.verified} label="facts verified from official pages" evidence />
          </dl>
        </div>

        <div className="hero-rise hero-rise-3 relative">
          <FloatingBadges />
          <div className="relative z-10 rounded-panel border border-on-chrome-muted/30 bg-surface p-5 text-ink shadow-lift md:p-7">
            {children}
          </div>
        </div>
      </div>
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
