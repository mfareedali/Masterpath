'use client';

/**
 * "Back to shortlist" (client island). The program page is static, so the server always renders a plain
 * /shortlist link. In the browser, when this page was opened from a link that carries a profile
 * (?cgpa=…&scale=…), the link keeps those profile params so the shortlist shows the same results.
 */
import Link from 'next/link';
import { shortlistBackHref } from '@/lib/program/fit-profile';
import { useBrowserSnapshot } from './use-local-store';

function readBackHref(): string {
  try {
    return shortlistBackHref(location.search);
  } catch {
    return '/shortlist';
  }
}

export function BackToShortlistLink() {
  const href = useBrowserSnapshot(readBackHref) ?? '/shortlist';
  return (
    <Link href={href} className="inline-flex min-h-tap items-center text-sm font-semibold">
      <span aria-hidden="true">←&nbsp;</span>Back to shortlist
    </Link>
  );
}
