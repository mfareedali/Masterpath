'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { buttonClass } from '@/components/ui/button';

/** Something failed while showing a page. Offers a retry and a way back; shows no technical detail. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Digest only (no message): it matches the server log without putting details on screen.
    if (error.digest) console.error('route error digest', error.digest);
  }, [error]);
  return (
    <div className="mx-auto max-w-xl rounded-card border border-line bg-surface p-5 shadow-card" role="alert">
      <h1 className="text-2xl font-bold">This page did not load</h1>
      <p className="mt-2 text-ink">Nothing you entered is lost. Try again, or go back to your shortlist.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={reset} className={buttonClass('primary')}>
          Try again
        </button>
        <Link href="/shortlist" className={buttonClass('secondary')}>
          Go to your shortlist
        </Link>
        <Link href="/" className="inline-flex min-h-tap items-center font-semibold">
          Home
        </Link>
      </div>
    </div>
  );
}
