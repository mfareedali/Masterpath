/**
 * Screen 8 — Consultant Check. Server component (dynamic: reads searchParams).
 *
 * A student pastes what an agent/consultant told them. Plain code (no AI) splits it into claims and compares each one
 * with Verified/Likely rows only: "Matches official page", "Differs from official page" or "Can't verify".
 * GET form (?claims=), so it works without JavaScript and the result can be reloaded. See DECISIONS.md.
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { CheckForm } from '@/components/check/check-form';
import { CheckLegend } from '@/components/check/check-legend';
import { CheckResults } from '@/components/check/check-results';
import { NameSuggestionNote } from '@/components/check/name-suggestion';
import { Callout, Card, PageHeader } from '@/components/ui/card';
import { runCheck } from '@/lib/consultant/compare';
import { MAX_INPUT_CHARS } from '@/lib/consultant/extract';
import { checkPageUrl, parseCheckQuery, type SearchParams } from '@/lib/consultant/query';
import { getDataset } from '@/lib/data';
import { getNow } from '@/lib/profile-server';

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const sp = await searchParams;
  return {
    title: 'Consultant Check',
    description:
      'Paste what an education agent or consultant told you. MastersPath compares each claim with official pages and gives you questions to ask in writing. Free, no AI guesses.',
    // Pages with a pasted message are personal: keep them out of search engines.
    robots: sp.claims != null ? { index: false, follow: false } : undefined,
  };
}

function HowItWorks() {
  return (
    <Card>
      <h2 className="text-lg font-bold">How it works</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
        <li>We split the message into separate claims.</li>
        <li>We compare each claim with the official pages we hold. Only Verified or Likely values count.</li>
        <li>You get questions to ask in writing, and a message you can share on WhatsApp.</li>
      </ol>
    </Card>
  );
}

function PageFooterNote() {
  return (
    <Callout tone="neutral" title="Please note">
      <ul className="list-disc space-y-1 pl-5">
        <li>This is not legal or immigration advice.</li>
        <li>We don&apos;t judge anyone. We only compare what you were told with the official pages we hold.</li>
        <li>Where we hold no official data, we say so. A missing value is never treated as a yes or a no.</li>
        <li>Always check the official page yourself before you apply or pay anyone.</li>
      </ul>
    </Callout>
  );
}

export default async function CheckPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = parseCheckQuery(await searchParams);
  const run = query.submitted && query.text ? runCheck(query.text, await getDataset(), getNow()) : null;

  let shareUrl: string | null = null;
  if (run) {
    const h = await headers();
    shareUrl = checkPageUrl(h.get('x-forwarded-host') ?? h.get('host'), h.get('x-forwarded-proto'));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compare what you were told with official pages."
        subtitle="Consultant Check: paste what an agent or consultant told you. We check each claim against the official pages we hold, and give you questions to ask in writing."
      />

      {query.submitted ? (
        <div className="space-y-6">
          {query.truncated || query.redacted ? (
            <Callout tone="neutral">
              {query.truncated ? <p>We checked the first {MAX_INPUT_CHARS.toLocaleString('en-GB')} characters only.</p> : null}
              {query.redacted ? <p>We removed numbers that looked like ID, passport or phone numbers, and email addresses.</p> : null}
            </Callout>
          ) : null}

          {run?.suggestion ? <NameSuggestionNote suggestion={run.suggestion} /> : null}

          {!query.text ? (
            <Callout tone="neutral" title="Nothing to check yet">
              <p>Paste what you were told in the box below, then tap “Check these claims”.</p>
            </Callout>
          ) : run && run.results.length === 0 ? (
            <Callout tone="neutral" title="We could not find a claim to check">
              <p>Try writing each promise as its own sentence, and include the university or country it is about.</p>
            </Callout>
          ) : run ? (
            <CheckResults run={run} shareUrl={shareUrl} />
          ) : null}

          <CheckForm
            heading="Check something else"
            headingId="form-heading"
            defaultText={query.text}
            activeExample={null}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <CheckForm
            heading="Paste what you were told"
            headingId="form-heading"
            defaultText={query.text}
            activeExample={query.exampleId}
          />
          <HowItWorks />
        </div>
      )}

      <CheckLegend />
      <PageFooterNote />
    </div>
  );
}
