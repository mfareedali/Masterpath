/**
 * "How this ranking works" (screen 6). Server component, static copy.
 * It never says a ranked months number is a legal minimum or maximum: it is only the number we sort by,
 * taken from each rule (see DECISIONS.md). The exact rule text is what counts.
 */
import Link from 'next/link';
import { FACT_LABELS, VISA_FUNDS_NOT_COMPARABLE } from '@/lib/citizenship';

export function HowRankingWorks() {
  return (
    <section aria-labelledby="how-heading" className="space-y-2 text-sm text-muted">
      <h2 id="how-heading" className="text-base font-bold">
        How this ranking works
      </h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          <strong className="text-ink">Citizenship rule and post-study work:</strong> each country is ranked by one
          number of months that we took from its rule. It is only the number we rank by. It is not a legal minimum or
          maximum, and it is not a promise for your case.
        </li>
        <li>
          Some rules give more than one length, or count time in a special way (for example, depending on the date you
          apply, your degree subject or the kind of stay). We use one number per rule for sorting only. The exact rule
          text shown for each country, with its official link and evidence, is what counts.
        </li>
        <li>
          <strong className="text-ink">Tuition and total cost:</strong> typical yearly amounts for the country, not for
          one university. They are compared in PKR only when we have a Verified or Likely exchange rate.
        </li>
        <li>
          <strong className="text-ink">{FACT_LABELS.proof_of_funds}:</strong> never used to rank or filter.{' '}
          {VISA_FUNDS_NOT_COMPARABLE} A PKR amount is shown only with a Verified or Likely exchange rate.
        </li>
        <li>
          Countries are put in order by Verified or Likely values. The rest are listed under &ldquo;More countries to
          explore&rdquo;, each with what to check on the official page.
        </li>
        <li>
          This is not legal or immigration advice. Read the{' '}
          <Link href="/disclaimer" className="font-semibold underline">
            disclaimer
          </Link>
          .
        </li>
      </ul>
    </section>
  );
}
