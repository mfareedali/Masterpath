/**
 * Screen 9 — Ask MastersPath. Static shell; the chat itself is a small client component that calls /api/chat.
 * The chat answers only from database rows and refuses (before any AI call) when the data cannot answer.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChatPanel } from '@/components/chat/chat-panel';
import { ASK_SUGGESTIONS } from './suggestions';

export const metadata: Metadata = {
  title: 'Ask',
  description:
    'Ask about Masters programs, costs and visa rules. Answers come only from sourced MastersPath data. If a fact is not verified, we say so and link the official page.',
};

export default function AskPage() {
  return (
    <div className="space-y-6">
      <ChatPanel title="Ask MastersPath" headingLevel={1} suggestions={ASK_SUGGESTIONS} />

      <section aria-labelledby="ask-how" className="rounded-card border border-line bg-surface p-4">
        <h2 id="ask-how" className="text-lg font-bold">
          How answers work
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
          <li>We first look up the facts in our database. Code decides if the data can answer your question.</li>
          <li>
            If a fact is missing or not verified, you get &ldquo;Not verified yet&rdquo; and a link to the official page. We
            never guess a date, fee or rule.
          </li>
          <li>If official sources disagree, we show both values and both links.</li>
          <li>We never give admission or visa chances, percentages or guarantees.</li>
          <li>
            Every answer lists its sources with a confidence label. See{' '}
            <Link href="/about" className="font-semibold underline">
              how MastersPath works
            </Link>
            .
          </li>
        </ul>
      </section>
    </div>
  );
}
