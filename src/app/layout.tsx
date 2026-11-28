import type { Metadata, Viewport } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import './globals.css';
import { BottomNav, TopNav } from '@/components/nav/bottom-nav';
import { InstallPrompt } from '@/components/pwa/install-prompt';
import { OfflineBanner } from '@/components/pwa/offline-banner';
import { SwRegister } from '@/components/pwa/sw-register';
import { semantic } from '@/theme';

export const metadata: Metadata = {
  title: { default: 'MastersPath — evidence-first Masters guidance', template: '%s · MastersPath' },
  description:
    'Free, open-source, evidence-first guide for Pakistani students applying to Masters abroad. Every fact links to its official source. No admission percentages, no guesses.',
  applicationName: 'MastersPath',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'MastersPath', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: semantic.chrome,
};

function SiteHeader() {
  return (
    <header className="on-chrome sticky top-0 z-30 bg-chrome text-on-chrome">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <Link href="/" className="inline-flex min-h-tap items-center gap-2 text-lg font-semibold tracking-tight text-on-chrome no-underline">
          <Image src="/brand/logo-mark-light.png" alt="" width={227} height={160} priority className="h-8 w-auto" />
          MastersPath
        </Link>
        <TopNav />
        <Link href="/citizenship" className="inline-flex min-h-tap items-center text-sm font-semibold text-on-chrome md:hidden">
          Citizenship &amp; cost
        </Link>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface pb-24 md:pb-6">
      <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted">
        <p className="mb-3">
          MastersPath compares information with official pages. It is <strong>not legal or immigration advice</strong>. Always
          check the official site before you apply or pay anyone.
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          <li><Link href="/disclaimer" className="inline-flex min-h-tap items-center">Disclaimer</Link></li>
          <li><Link href="/privacy" className="inline-flex min-h-tap items-center">Privacy</Link></li>
          <li><Link href="/about" className="inline-flex min-h-tap items-center">How it works</Link></li>
          <li><Link href="/glossary" className="inline-flex min-h-tap items-center">Glossary</Link></li>
          <li><Link href="/account" className="inline-flex min-h-tap items-center">Your data</Link></li>
          <li><Link href="/roadmap" className="inline-flex min-h-tap items-center">Roadmap</Link></li>
        </ul>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-ui text-ink antialiased">
        <a href="#main" className="skip-link">Skip to content</a>
        <SiteHeader />
        <OfflineBanner />
        <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 md:pb-10">
          {children}
        </main>
        <SiteFooter />
        <BottomNav />
        <SwRegister />
        <InstallPrompt />
      </body>
    </html>
  );
}
