import { Outfit } from 'next/font/google';
import type { ReactNode } from 'react';

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

/** Forest-950 hero panel: large thin wordmark + one-line subtitle, then the form card below. */
export function Hero({ eyebrow, subtitle, children }: { eyebrow: string; subtitle: string; children: ReactNode }) {
  return (
    <section aria-labelledby="home-title" className={`${display.variable} space-y-4`}>
      <div className="on-chrome rounded-panel bg-chrome px-5 pb-7 pt-6 text-on-chrome shadow-card md:px-8 md:pb-10 md:pt-8">
        <p className="text-[0.8125rem] font-semibold text-on-chrome-muted">{eyebrow}</p>
        <h1 id="home-title" className="wordmark mt-5 text-[3.25rem] text-on-chrome md:text-7xl">
          MastersPath
        </h1>
        <p className="mt-3 text-base text-on-chrome md:text-lg">{subtitle}</p>
      </div>
      <div className="rounded-card border border-line bg-surface p-5 shadow-card md:max-w-xl md:p-6">{children}</div>
    </section>
  );
}
