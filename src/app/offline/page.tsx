import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui/button';
import { Callout, Card, PageHeader } from '@/components/ui/card';

/**
 * Shown by the service worker (public/sw.js) when a page is not in the cache and there is no network.
 * Static on purpose: it is precached when the app is installed.
 */
export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'You are offline',
  description: 'No internet connection. Your saved programs and checklists still work on this phone.',
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="You are offline" subtitle="No internet connection right now. That is OK." />

      <Card className="space-y-3">
        <p>
          Your <strong>saved shortlist</strong> and <strong>checklists</strong> are stored on this phone, so they still work
          without internet.
        </p>
        <ButtonLink href="/saved" variant="primary" block>
          Open saved programs
        </ButtonLink>
        <p className="text-sm text-muted">Pages you opened before may also load from this phone.</p>
      </Card>

      <Callout tone="neutral" title="When you are back online" className="mt-4">
        <p className="mb-3">Facts can change. Check the official page and the date next to each fact before you apply or pay.</p>
        <ButtonLink href="/" variant="secondary">
          Try again
        </ButtonLink>
      </Callout>
    </div>
  );
}
