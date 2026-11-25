/**
 * Plan B route card + shared time/cost blocks. Server components (no client JS except the research island).
 * Every value carries a computed confidence badge; missing values say "Not verified yet".
 */
import Link from 'next/link';
import { ConfidenceBadge, FitBadge, Pill, RankBadge } from '@/components/ui/badges';
import { Callout } from '@/components/ui/card';
import { FactInline, FactRow, NotVerified, SourceLink } from '@/components/ui/fact';
import { usableValue } from '@/lib/confidence';
import { countryName, formatDate, formatMonths, formatPkr } from '@/lib/format';
import {
  BUDGET_TEXT,
  CONDITIONAL_FIT_NOTE,
  NOT_RANKED_HELP,
  ROUTE_LABEL,
  deadlineText,
  formatAmount,
  statusNoteLabel,
  targetRouteNote,
  whyThisOrder,
  type BudgetStatus,
  type ConditionalCheck,
  type PlanRoute,
  type RouteCost,
  type RouteDeadline,
  type RouteTime,
} from '@/lib/planb';
import type { Institution, Program } from '@/lib/types';
import { ResearchHint } from './research-hint';

export function domId(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function MissingList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted">
      {items.map((m) => (
        <li key={m} className="break-words">
          {m}
        </li>
      ))}
    </ul>
  );
}

export function TimeValue({ time, officialUrl }: { time: RouteTime; officialUrl?: string | null }) {
  if (time.months == null) {
    return (
      <div>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <NotVerified officialUrl={officialUrl} compact />
          <ConfidenceBadge confidence={time.confidence} />
        </span>
        <MissingList items={time.missing} />
      </div>
    );
  }
  return (
    <div>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-base font-semibold text-ink">{formatMonths(time.months)}</span>
        <ConfidenceBadge confidence={time.confidence} />
      </span>
      {time.parts.length > 1 ? (
        <p className="mt-0.5 text-xs text-muted">
          {time.parts.map((p) => `${p.label}: ${formatMonths(p.months)}`).join(' + ')}
        </p>
      ) : null}
    </div>
  );
}

export function CostValue({ cost, officialUrl }: { cost: RouteCost; officialUrl?: string | null }) {
  if (cost.pkr == null && cost.native == null) {
    return (
      <div>
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <NotVerified officialUrl={officialUrl} compact />
          <ConfidenceBadge confidence={cost.confidence} />
        </span>
        <MissingList items={cost.missing} />
      </div>
    );
  }
  return (
    <div>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-base font-semibold text-ink break-words">
          {cost.pkr != null ? formatPkr(cost.pkr) : formatAmount(cost.native!.amount, cost.native!.currency)}
        </span>
        <ConfidenceBadge confidence={cost.confidence} />
      </span>
      {cost.pkr != null && cost.native ? (
        <p className="mt-0.5 text-xs text-muted">{formatAmount(cost.native.amount, cost.native.currency)} in total</p>
      ) : null}
      {cost.parts.length > 1 ? (
        <p className="mt-0.5 text-xs text-muted">Includes: {cost.parts.map((p) => p.label).join(' + ')}</p>
      ) : null}
      <MissingList items={cost.missing} />
    </div>
  );
}

function BudgetLine({ budget }: { budget: BudgetStatus }) {
  const text = BUDGET_TEXT[budget];
  if (!text) return null;
  const glyph = budget === 'within' ? '✓' : budget === 'over' ? '!' : '?';
  return (
    <p className={`mt-1 text-sm ${budget === 'over' ? 'font-semibold text-conflict-fg' : 'text-ink'}`}>
      <span aria-hidden="true">{glyph} </span>
      {text}
    </p>
  );
}

/** Total time and total cost, optionally compared with going direct. */
export function TimeCostGrid({
  time,
  cost,
  budget,
  officialUrl,
  timeCompare,
  costCompare,
}: {
  time: RouteTime;
  cost: RouteCost;
  budget: BudgetStatus;
  officialUrl?: string | null;
  timeCompare?: string;
  costCompare?: string;
}) {
  return (
    <dl className="mt-3 grid gap-2 sm:grid-cols-2">
      <div className="rounded-button bg-surface-tint p-3">
        <dt className="text-xs font-bold uppercase tracking-wide text-muted">Total time</dt>
        <dd className="mt-1">
          <TimeValue time={time} officialUrl={officialUrl} />
          {timeCompare ? <p className="mt-1 text-sm text-ink">{timeCompare}</p> : null}
        </dd>
      </div>
      <div className="rounded-button bg-surface-tint p-3">
        <dt className="text-xs font-bold uppercase tracking-wide text-muted">Total cost</dt>
        <dd className="mt-1">
          <CostValue cost={cost} officialUrl={officialUrl} />
          {costCompare ? <p className="mt-1 text-sm text-ink">{costCompare}</p> : null}
          <BudgetLine budget={budget} />
        </dd>
      </div>
    </dl>
  );
}

/** Official program page, else the institution's homepage. Links from data only (SourceLink uses safeHref). */
export function OfficialLinks({ program, institution }: { program: Program; institution: Institution | null }) {
  if (program.official_url) return <SourceLink url={program.official_url} label="Official program page" />;
  if (institution?.website) return <SourceLink url={institution.website} label="University website" />;
  return null;
}

/**
 * A usable (Verified/Likely) status note from the program's official page, e.g. extra measures for Pakistan
 * applicants, shown as an evidence row (value, badge, source, checked date, quote). Nothing when not usable.
 */
export function StatusNote({ program, now }: { program: Program; now: Date }) {
  const fact = program.status_note;
  const value = usableValue(fact, now);
  if (typeof value !== 'string' || value.trim() === '') return null;
  return (
    <dl className="mt-3 rounded-button border border-line border-l-4 border-l-primary bg-surface-tint px-3">
      <FactRow label={statusNoteLabel(value)} fact={fact} now={now} officialUrl={program.official_url} />
    </dl>
  );
}

/**
 * Deadline rows (program, then follow-on Masters on staged routes): the date with days left when it is usable,
 * its computed badge, source, evidence and student note. A missing date says "Not verified yet".
 */
export function DeadlineRows({ deadlines, now }: { deadlines: RouteDeadline[]; now: Date }) {
  if (deadlines.length === 0) return null;
  return (
    <dl className="mt-3 rounded-button border border-line bg-surface px-3" data-deadlines="">
      {deadlines.map((d) => (
        <FactRow
          key={`${d.programId}-${d.label}`}
          label={d.label}
          fact={d.fact}
          now={now}
          officialUrl={d.officialUrl}
          render={(v: string) => deadlineText(v, d)}
        />
      ))}
    </dl>
  );
}

/**
 * The official conditional route: the verbatim words from the official page (or our short summary when no quote
 * is held), its badge, source and checked date, then how the student's grade compares with its own lower limit.
 */
export function ConditionalDetails({ check, isTarget = false }: { check: ConditionalCheck; isTarget?: boolean }) {
  return (
    <div
      className="mt-3 rounded-button border border-line border-l-4 border-l-primary bg-surface-tint p-3 text-sm"
      data-conditional={check.status}
    >
      <p className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-muted">
          {check.quote ? 'Conditional route: the official page says' : 'Conditional route, in short'}
        </span>
        <ConfidenceBadge confidence={check.confidence} />
      </p>
      {check.quote ? (
        <blockquote className="evidence-quote mt-1 break-words">{check.quote}</blockquote>
      ) : (
        <p className="mt-1 text-ink break-words">{check.text}</p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <SourceLink url={check.sourceUrl} />
        {check.checkedAt ? <span>Checked {formatDate(check.checkedAt)}</span> : null}
      </div>
      {check.note ? <p className="mt-1 text-xs text-muted break-words">Note: {check.note}</p> : null}
      <p className="mt-2 text-ink break-words">
        <span className="font-semibold">Your grade and this route: </span>
        {check.reason}
      </p>
      <p className="mt-1 text-xs text-muted">{CONDITIONAL_FIT_NOTE}</p>
      {isTarget ? <p className="mt-1 font-semibold text-ink">{targetRouteNote('conditional')}</p> : null}
    </div>
  );
}

function ResearchNote({ route, now }: { route: PlanRoute; now: Date }) {
  const fact = route.program.research_considered;
  return (
    <div className="mt-3 rounded-button border border-primary bg-surface-tint p-3 text-sm">
      <p className="font-bold text-heading">Your research may matter here</p>
      {fact?.value != null ? (
        <p className="mt-1">
          The official page says: <FactInline fact={fact} now={now} />
        </p>
      ) : (
        <p className="mt-1">This route is research-led in our data.</p>
      )}
      <p className="mt-1 text-muted">Your research does not change your fit label.</p>
    </div>
  );
}

export function RouteCard({
  route,
  now,
  programHref,
  followOnHref,
  compare = true,
}: {
  route: PlanRoute;
  now: Date;
  programHref: string;
  /** Link to the Masters a pre-master's / pathway leads to, when it is in our data. */
  followOnHref?: string;
  /** Show "vs going direct" lines (false when there is no single target to compare with). */
  compare?: boolean;
}) {
  const { program, institution, gate, score } = route;
  const headingId = domId('route', route.id);
  const staged = route.type === 'pre_masters' || route.type === 'pathway';
  const warnings = gate.warnings;

  return (
    <article aria-labelledby={headingId} className="rounded-card border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3">
        {route.rank != null ? <RankBadge rank={route.rank} /> : null}
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
            {ROUTE_LABEL[route.type]}
            {route.isTarget ? <Pill className="normal-case tracking-normal">Your target</Pill> : null}
          </p>
          <h3 id={headingId} className="mt-0.5 text-lg font-bold break-words">
            {program.name}
          </h3>
          <p className="text-sm text-muted break-words">
            {institution?.name ?? 'Institution not in our data yet'} · {countryName(program.country)}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          {route.conditional && program.pathway_type === 'direct' ? (
            <span className="text-xs font-semibold text-muted">Regular entry:</span>
          ) : null}
          <FitBadge label={route.fit.label} />
          {route.researchConsidered ? <Pill>Research considered</Pill> : null}
        </div>
        <p className="mt-1 text-sm text-muted">{route.fit.reason.message}</p>
      </div>

      {route.conditional ? <ConditionalDetails check={route.conditional} isTarget={route.isTarget} /> : null}
      {route.isTarget && !route.conditional ? (
        <p className="mt-2 text-sm font-semibold text-ink">{targetRouteNote(route.type)}</p>
      ) : null}

      {staged ? (
        <p className="mt-2 text-sm text-ink break-words">
          {route.followOn ? (
            <>
              Leads to:{' '}
              {followOnHref ? (
                <Link href={followOnHref} className="font-semibold">
                  {route.followOn.name}
                </Link>
              ) : (
                <span className="font-semibold">{route.followOn.name}</span>
              )}
            </>
          ) : (
            'Leads to a Masters that is not in our data yet.'
          )}
        </p>
      ) : null}

      <StatusNote program={program} now={now} />
      <DeadlineRows deadlines={route.deadlines} now={now} />

      <TimeCostGrid
        time={route.time}
        cost={route.cost}
        budget={route.budget}
        officialUrl={program.official_url}
        timeCompare={compare ? route.vsDirect.timeText : undefined}
        costCompare={compare ? route.vsDirect.costText : undefined}
      />

      {warnings.length > 0 ? (
        <Callout
          tone="warning"
          className="mt-3"
          title={`Check before you choose this: ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
        >
          <ul className="space-y-2">
            {warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} data-warning={w.code}>
                <p className="font-semibold text-ink break-words">
                  <span aria-hidden="true">⚠ </span>
                  {w.message}
                </p>
                {w.detail ? <p className="text-ink break-words">{w.detail}</p> : null}
                {w.confidence || w.sourceUrl ? (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {w.confidence ? <ConfidenceBadge confidence={w.confidence} /> : null}
                    {w.sourceUrl ? <SourceLink url={w.sourceUrl} /> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Callout>
      ) : (
        <p className="mt-3 text-sm text-ink">
          <span aria-hidden="true">✓ </span>No warnings from the integrity gate.
        </p>
      )}

      {route.researchConsidered ? (
        route.researchMayMatter ? (
          <ResearchNote route={route} now={now} />
        ) : (
          <ResearchHint>
            <ResearchNote route={route} now={now} />
          </ResearchHint>
        )
      ) : null}

      {route.notRankedReason ? (
        <p className="mt-3 text-sm text-ink">
          <span className="font-semibold">{route.notRankedReason}.</span> {NOT_RANKED_HELP}
        </p>
      ) : null}

      {score && route.rank != null ? (
        <details className="mt-2">
          <summary className="flex min-h-tap cursor-pointer items-center text-sm font-semibold text-primary-ink">
            Why this order (score {score.total} out of {score.max})
          </summary>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink">
            {whyThisOrder(score).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 border-t border-line pt-2">
        <Link href={programHref} className="inline-flex min-h-tap items-center text-sm font-semibold">
          See program details<span aria-hidden="true">&nbsp;→</span>
        </Link>
        <OfficialLinks program={program} institution={institution} />
      </div>
    </article>
  );
}
