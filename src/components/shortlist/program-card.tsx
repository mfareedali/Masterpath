/**
 * Mobile shortlist cards. Server components; only SaveButton is a client leaf.
 * The title links to /program/[id]; other links sit beside it (never an <a> inside an <a>).
 */
import Link from 'next/link';
import { ConfidenceBadge, FitBadge, Pill, RankBadge } from '@/components/ui/badges';
import { ButtonLink } from '@/components/ui/button';
import { FactInline } from '@/components/ui/fact';
import { countryName, formatMonths } from '@/lib/format';
import type { RankKey } from '@/lib/rank';
import { planBSuggested, rankValueText, type ProgramView, type ShortlistRankKey } from '@/lib/shortlist';
import { CitizenshipCell, DeadlineCell, FactNote, OfficialPageLinks, TotalCostCell, TuitionCell } from './fact-cells';
import { ConditionalRouteItem, EligibilityWarning, StatusNoteItem } from './program-notes';
import { SaveButton } from './save-button';

export const PLAN_B_LINK_TEXT = 'See other routes (Plan B)';

/**
 * "See other routes (Plan B) →" under the fit result of a direct program that is Below minimum or whose range
 * crosses the minimum (planBSuggested decides). Navigation only: it never changes the fit label.
 */
export function PlanBLink({ row, href, compact = false }: { row: Pick<ProgramView, 'program' | 'fit'>; href?: string; compact?: boolean }) {
  if (!href || !planBSuggested(row)) return null;
  const cls = compact ? 'mt-1 flex text-xs font-semibold' : 'inline-flex min-h-tap items-center text-sm font-semibold md:min-h-0';
  return (
    <Link href={href} prefetch={false} className={cls} data-plan-b-link="">
      {PLAN_B_LINK_TEXT}
      <span aria-hidden="true">&nbsp;→</span>
      <span className="sr-only"> for {row.program.name}</span>
    </Link>
  );
}

/** Rank keys whose ranked value is not already visible as its own card row. */
const SHOW_RANKED_ON: readonly ShortlistRankKey[] = ['tuition', 'citizenship'];

/** "Ranked on: PKR … tuition for the whole programme" + the key's computed confidence. */
export function RankedOn({ rankBy, rankKey }: { rankBy: ShortlistRankKey; rankKey: RankKey }) {
  const text = rankValueText(rankBy, rankKey.value);
  if (!text) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="text-ink">{text}</span>
      <ConfidenceBadge confidence={rankKey.confidence} />
    </span>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
      <dt className="font-semibold text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function ProgramCard({
  row,
  now,
  rank,
  rankKey,
  rankBy,
  detailsHref,
  planBHref,
  note,
}: {
  row: ProgramView;
  now: Date;
  rank?: number;
  /** The key this row was ranked by (ranked rows only). */
  rankKey?: RankKey;
  rankBy: ShortlistRankKey;
  detailsHref: string;
  /** /plan-b?…&target=<id>. The link shows only when planBSuggested(row). */
  planBHref?: string;
  /** Extra line, e.g. why the program is not ranked. */
  note?: React.ReactNode;
}) {
  const p = row.program;
  const titleId = `program-${p.id}`;
  return (
    <article aria-labelledby={titleId} className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        {rank != null ? <RankBadge rank={rank} /> : null}
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-lg font-bold leading-snug break-words">
            <Link href={detailsHref} className="text-heading">
              {p.name}
            </Link>
          </h3>
          <p className="text-sm text-muted break-words">{row.institutionName}</p>
        </div>
        <Pill className="shrink-0">{countryName(p.country)}</Pill>
      </div>

      <div className="mt-3">
        <FitBadge label={row.fit.label} />
        <p className="mt-1 text-sm text-muted">{row.fit.reason.message}</p>
        <PlanBLink row={row} href={planBHref} />
      </div>

      {/* Read-only notes from the official pages: never change fit or rank. */}
      <EligibilityWarning program={p} now={now} />

      <dl className="mt-3 divide-y divide-line border-y border-line text-sm">
        {rank != null && rankKey && SHOW_RANKED_ON.includes(rankBy) ? (
          <Item label="Ranked on">
            <RankedOn rankBy={rankBy} rankKey={rankKey} />
          </Item>
        ) : null}
        <StatusNoteItem program={p} now={now} />
        <ConditionalRouteItem program={p} fit={row.fit} now={now} />
        <Item label="Deadline">
          <DeadlineCell program={p} now={now} daysLeft={row.deadlineDaysLeft} />
        </Item>
        <Item label="Tuition">
          <TuitionCell program={p} now={now} />
        </Item>
        <Item label="Total cost">
          <TotalCostCell cost={row.totalCost} withinBudget={row.withinBudget} />
        </Item>
        {rankBy === 'study' ? (
          <Item label="Study time">
            <FactInline fact={p.duration_months} now={now} render={(v) => formatMonths(v)} />
            <FactNote fact={p.duration_months} now={now} />
          </Item>
        ) : null}
        <Item label="Citizenship rule">
          <CitizenshipCell fact={row.citizenship} now={now} />
        </Item>
      </dl>

      {note ? <div className="mt-3">{note}</div> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ButtonLink href={detailsHref} variant="secondary" className="px-3">
          Details<span className="sr-only"> for {p.name}</span>
        </ButtonLink>
        <SaveButton programId={p.id} programName={p.name} />
      </div>
      <div className="mt-2">
        <OfficialPageLinks program={p} institution={row.institution} />
      </div>
    </article>
  );
}

/** Ruled-out program: shown with its status note, never ranked. */
export function RuledOutCard({ row, now, detailsHref }: { row: ProgramView; now: Date; detailsHref: string }) {
  const p = row.program;
  const titleId = `ruled-out-${p.id}`;
  return (
    <article aria-labelledby={titleId} className="rounded-card border border-dashed border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-lg font-bold leading-snug break-words">
            <Link href={detailsHref} className="text-heading">
              {p.name}
            </Link>
          </h3>
          <p className="text-sm text-muted break-words">{row.institutionName}</p>
        </div>
        <Pill className="shrink-0">{countryName(p.country)}</Pill>
      </div>
      <p className="mt-3">
        <Pill>
          <span aria-hidden="true">✕</span> Ruled out
        </Pill>
      </p>
      <div className="mt-2 text-sm">
        <span className="font-semibold text-muted">Why: </span>
        <FactInline fact={p.status_note} now={now} />
      </div>
      {p.status_note.note ? <p className="mt-1 text-xs text-muted">Note: {p.status_note.note}</p> : null}
      <div className="mt-3">
        <OfficialPageLinks program={p} institution={row.institution} />
      </div>
    </article>
  );
}

/** "Not ranked" / "Can't check" reason line for a card. */
export function ReasonNote({ title, reasons }: { title: string; reasons: string[] }) {
  return (
    <div className="rounded-button bg-surface-tint px-3 py-2 text-sm">
      <p className="font-semibold text-heading">{title}</p>
      <ul className="mt-0.5 list-disc pl-5 text-ink">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
