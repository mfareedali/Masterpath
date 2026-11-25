/**
 * "Deadlines in the next 30 days" strip above "Rank by". Server component.
 * Rows come from closingSoon (src/lib/shortlist): usable (Verified/Likely) dates only, among programs already
 * listed below. It re-shows them; it never filters, ranks or changes fit. Renders nothing when the list is empty.
 */
import Link from 'next/link';
import { ConfidenceBadge } from '@/components/ui/badges';
import { formatDate } from '@/lib/format';
import { CLOSING_SOON_DAYS, daysLeftLabel, type ClosingSoonRow } from '@/lib/shortlist';

export function ClosingSoon({
  rows,
  detailsHref,
  windowDays = CLOSING_SOON_DAYS,
}: {
  rows: ClosingSoonRow[];
  detailsHref: (id: string) => string;
  windowDays?: number;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="closing-soon-heading" className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h2 id="closing-soon-heading" className="text-base font-bold">
        Deadlines in the next {windowDays} days
      </h2>
      <ol className="mt-1 divide-y divide-line">
        {rows.map((r) => (
          <li key={r.program.id} className="py-2 text-sm" data-closing-soon={r.program.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <Link href={detailsHref(r.program.id)} className="inline-flex min-h-tap items-center font-semibold break-words md:min-h-0">
                {r.program.name}
              </Link>
              <span className={`font-semibold ${r.days === 0 ? 'text-conflict-fg' : 'text-ink'}`}>{daysLeftLabel(r.days)}</span>
            </div>
            <p className="text-muted break-words">{r.institutionName}</p>
            <p className="mt-0.5 inline-flex flex-wrap items-center gap-1.5">
              <span className="text-ink">{formatDate(r.iso)}</span>
              <ConfidenceBadge confidence={r.confidence} />
            </p>
            {r.note ? <p className="mt-0.5 text-xs text-muted break-words">Note: {r.note}</p> : null}
          </li>
        ))}
      </ol>
      <p className="mt-1 text-xs text-muted">
        Dates are the university&apos;s own. Check the cut-off time and time zone on the official page.
      </p>
    </section>
  );
}
