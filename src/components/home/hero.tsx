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
 * Forest-950 hero panel: eyebrow, thin wordmark, subtitle and live dataset numbers on the left; the quick-start
 * form card on the right from md (below and overlapping the panel on phones).
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
    <section aria-labelledby="home-title" className={`${display.variable} md:grid md:grid-cols-[1.1fr_1fr] md:items-stretch md:gap-0`}>
      <div className="on-chrome relative overflow-hidden rounded-panel bg-chrome px-5 pb-14 pt-6 text-on-chrome shadow-card md:rounded-r-none md:px-8 md:pb-10 md:pt-8">
        {/* Decorative, aria-hidden: slow olive glows, route lines that draw in, and a dot travelling the path. */}
        <div aria-hidden="true" className="hero-glow pointer-events-none absolute inset-0" />
        <svg
          aria-hidden="true"
          viewBox="0 0 400 300"
          preserveAspectRatio="xMaxYMax slice"
          className="pointer-events-none absolute inset-0 h-full w-full"
          fill="none"
          strokeLinecap="round"
        >
          <path id="hero-route" className="hero-path text-on-chrome-muted" pathLength="1" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.4" d="M-20 260 C 80 240, 120 160, 220 150 S 360 80, 430 20" />
          <path className="hero-path hero-path-2 text-accent-soft" pathLength="1" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.2" d="M-20 290 C 100 270, 160 200, 260 190 S 380 130, 430 90" />
          <circle className="hero-node text-accent-soft" cx="220" cy="150" r="4" fill="currentColor" />
          <circle className="hero-node hero-node-2 text-accent-soft" cx="260" cy="190" r="3" fill="currentColor" />
          {/* Travelling dot. SMIL follows the path at any size; globals.css hides it under reduced motion. */}
          <g className="hero-traveller text-accent-soft">
            <circle r="9" fill="currentColor" opacity="0.18" />
            <circle r="3.5" fill="currentColor" />
            <animateMotion dur="9s" begin="1.6s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.55 1">
              <mpath href="#hero-route" />
            </animateMotion>
          </g>
        </svg>
        <div className="relative">
          <p className="hero-rise inline-flex items-center gap-2 rounded-chip border border-on-chrome-muted/40 bg-chrome/60 px-3 py-1 text-[0.8125rem] font-semibold text-on-chrome-muted backdrop-blur-sm">
            <span aria-hidden="true" className="hero-pulse relative inline-block h-1.5 w-1.5 rounded-full bg-accent-soft" />
            {eyebrow}
          </p>
          <h1 id="home-title" className="hero-rise hero-rise-2 hero-wordmark wordmark mt-5 text-[3.25rem] md:text-7xl">
            MastersPath
          </h1>
          <p className="hero-rise hero-rise-3 mt-3 max-w-md text-base text-on-chrome md:text-lg">{subtitle}</p>

          <dl aria-label="What is in the dataset today" className="hero-rise hero-rise-4 mt-7 grid grid-cols-3 gap-3 md:mt-10">
            <HeroStat value={stats.programs} label={stats.programs === 1 ? 'program' : 'programs'} />
            <HeroStat value={stats.countries} label={stats.countries === 1 ? 'country' : 'countries'} />
            <HeroStat value={stats.facts.verified} label="facts verified from official pages" evidence />
          </dl>
        </div>
      </div>

      <div className="hero-rise hero-rise-3 relative z-10 mx-3 -mt-8 rounded-card border border-line bg-surface p-5 shadow-card md:m-0 md:flex md:flex-col md:justify-center md:rounded-l-none md:rounded-r-panel md:border-l-0 md:p-8">
        {children}
      </div>
    </section>
  );
}
