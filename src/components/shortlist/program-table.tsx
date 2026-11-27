/**
 * Desktop (md and up) shortlist table. Server component. Mobile uses ProgramCard instead.
 * The wrapper scrolls sideways on its own if needed, so the page itself never scrolls horizontally.
 */
import Link from 'next/link';
import { FitBadge, RankBadge } from '@/components/ui/badges';
import { countryName } from '@/lib/format';
import type { RankKey } from '@/lib/rank';
import type { ProgramView, ShortlistRankKey } from '@/lib/shortlist';
import { CitizenshipCell, DeadlineCell, TotalCostCell, TuitionCell } from './fact-cells';
import { PlanBLink, RankedOn } from './program-card';
import { ConditionalRouteMarker, NoteMarkers } from './program-notes';
import { SaveButton } from './save-button';

export type TableRow = ProgramView & { rank?: number; key?: RankKey; reasons?: string[] };

/** Rank keys whose value has no column of its own, so ranked tables add a "Ranked on" column. */
const RANKED_ON_COLUMN: readonly ShortlistRankKey[] = ['tuition', 'citizenship', 'study'];

export function ProgramTable({
  rows,
  now,
  caption,
  rankBy,
  reasonHeader,
  detailsHref,
  planBHref,
}: {
  rows: TableRow[];
  now: Date;
  caption: string;
  rankBy: ShortlistRankKey;
  /** When set, adds a last column with each row's reasons (e.g. "Why not ranked"). */
  reasonHeader?: string;
  detailsHref: (id: string) => string;
  /** /plan-b?…&target=<id>. The link shows only when planBSuggested(row). */
  planBHref?: (id: string) => string;
}) {
  const showRank = rows.some((r) => r.rank != null);
  const showRankedOn = showRank && RANKED_ON_COLUMN.includes(rankBy);
  const th = 'px-3 py-2 font-semibold';
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-card md:block">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-page text-xs uppercase tracking-wide text-muted">
          <tr>
            {showRank ? (
              <th scope="col" className={th}>
                Rank
              </th>
            ) : null}
            <th scope="col" className={th}>Program</th>
            <th scope="col" className={th}>Country</th>
            <th scope="col" className={th}>Fit</th>
            <th scope="col" className={th}>Deadline</th>
            <th scope="col" className={th}>Tuition</th>
            <th scope="col" className={th}>Total cost</th>
            <th scope="col" className={th}>Citizenship rule</th>
            {showRankedOn ? (
              <th scope="col" className={th}>
                Ranked on
              </th>
            ) : null}
            {reasonHeader ? (
              <th scope="col" className={th}>
                {reasonHeader}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const p = row.program;
            return (
              <tr key={p.id} className="border-t border-line align-top transition-colors hover:bg-page/60">
                {showRank ? <td className="px-3 py-3">{row.rank != null ? <RankBadge rank={row.rank} /> : null}</td> : null}
                <th scope="row" className="min-w-48 px-3 py-3 font-normal">
                  <Link href={detailsHref(p.id)} className="font-bold text-heading break-words">
                    {p.name}
                  </Link>
                  <p className="text-xs text-muted break-words">{row.institutionName}</p>
                  <NoteMarkers program={p} now={now} />
                  <div className="mt-2">
                    <SaveButton programId={p.id} programName={p.name} />
                  </div>
                </th>
                <td className="px-3 py-3">{countryName(p.country)}</td>
                <td className="px-3 py-3">
                  <FitBadge label={row.fit.label} />
                  <PlanBLink row={row} href={planBHref?.(p.id)} compact />
                  <ConditionalRouteMarker program={p} fit={row.fit} now={now} />
                </td>
                <td className="px-3 py-3">
                  <DeadlineCell program={p} now={now} daysLeft={row.deadlineDaysLeft} />
                </td>
                <td className="px-3 py-3">
                  <TuitionCell program={p} now={now} />
                </td>
                <td className="px-3 py-3">
                  <TotalCostCell cost={row.totalCost} withinBudget={row.withinBudget} />
                </td>
                <td className="min-w-40 px-3 py-3">
                  <CitizenshipCell fact={row.citizenship} now={now} showLink={false} />
                </td>
                {showRankedOn ? (
                  <td className="min-w-32 px-3 py-3">{row.key ? <RankedOn rankBy={rankBy} rankKey={row.key} /> : null}</td>
                ) : null}
                {reasonHeader ? (
                  <td className="min-w-40 px-3 py-3">
                    <ul className="space-y-1">
                      {(row.reasons ?? []).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
