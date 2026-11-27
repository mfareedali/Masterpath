'use client';

import './globals.css';

/** Last-resort boundary: replaces the whole layout, so it brings its own html and body. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-ui text-ink antialiased">
        <main className="mx-auto max-w-xl px-4 pt-10">
          <div className="rounded-card border border-line bg-surface p-5 shadow-card" role="alert">
            <h1 className="text-2xl font-bold">MastersPath could not load</h1>
            <p className="mt-2 text-ink">Please try again. If it keeps happening, come back in a few minutes.</p>
            <button
              type="button"
              onClick={reset}
              className="mt-4 inline-flex min-h-button items-center justify-center rounded-chip border border-chrome bg-chrome px-6 font-semibold text-on-chrome"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
