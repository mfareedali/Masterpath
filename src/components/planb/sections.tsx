/**
 * Plan B page sections. Server components.
 */
import Link from 'next/link';
import { BlockedBadge, ConfidenceBadge, FitBadge, Pill } from '@/components/ui/badges';
import { Callout, Card } from '@/components/ui/card';
import { ChipLink, ChipRow } from '@/components/ui/chip';
import { FactInline, SourceLink } from '@/components/ui/fact';
import { formatRange, SCALE_LABEL } from '@/lib/fit';
import { countryName, formatDate } from '@/lib/format';
import {
  IMPROVE_REAPPLY,
  INTEGRITY_NOTE,
  ROUTE_HELP,
  ROUTE_LABEL,
  directConditionalText,
  undecidedSummary,
  type DirectRoute,
  type ExcludedProgram,
  type NotForYourGrade,
  type PlanB,
  type PlanRoute,
  type TypeCoverage,
  type UndecidedProgram,
} from '@/lib/planb';
import type { FitLabel, FitResult } from '@/lib/types';
import { DeadlineRows, OfficialLinks, StatusNote, TimeCostGrid } from './route-card';

const FIT_LABELS: FitLabel[] = ['Meets minimum', 'Competitive range unknown', 'Below minimum'];

/** The integrity promise (the one accent call-out on the page). */
export function IntegrityNote() {
  return (
    <Callout title="Plan B warns. It does not push." className="mb-4">
      <p>{INTEGRITY_NOTE}</p>
      <p className="mt-1 text-muted">This is not legal or immigration advice. Always check the official page.</p>
    </Callout>
  );
}

/** Target selector: Below-minimum programs + "All my targets". Plain links, works without JS. */
export function TargetChips({
  plan,
  hrefFor,
}: {
  plan: PlanB;
  hrefFor: (target: string) => string;
}) {
  const directId = plan.direct?.program.id ?? null;
  const customDirect = plan.direct && !plan.belowMinimum.some((t) => t.program.id === directId) ? plan.direct : null;
  return (
    <section aria-labelledby="compare-h" className="mb-4">
      <h2 id="compare-h" className="mb-2 font-ui text-sm font-semibold text-muted">
        Compare with
      </h2>
      <ChipRow label="Compare with a target">
        {plan.belowMinimum.map((t) => (
          <ChipLink key={t.program.id} href={hrefFor(t.program.id)} active={t.program.id === directId} title={t.program.name}>
            {t.chipLabel}
          </ChipLink>
        ))}
        {customDirect ? (
          <ChipLink href={hrefFor(customDirect.program.id)} active>
            {customDirect.institution?.name ?? customDirect.program.name}
          </ChipLink>
        ) : null}
        <ChipLink href={hrefFor('all')} active={plan.mode === 'all'}>
          All my targets
        </ChipLink>
      </ChipRow>
      {plan.belowMinimum.length === 0 ? (
        <p className="mt-1 text-xs text-muted">Targets that are &quot;Below minimum&quot; on verified data will appear here.</p>
      ) : null}
    </section>
  );
}

function FitNumbers({ fit }: { fit: FitResult }) {
  if (!fit.converted && !fit.required) return null;
  return (
    <dl className="mt-2 space-y-1 text-sm">
      {fit.converted ? (
        <div className="flex flex-wrap gap-x-1">
          <dt className="font-semibold text-muted">Your grade, converted:</dt>
          <dd className="text-ink">
            {formatRange(fit.converted)} on the {SCALE_LABEL[fit.converted.scale]}
            {fit.converted.rule_source_url ? (
              <>
                {' '}
                <SourceLink url={fit.converted.rule_source_url} label="Conversion rule source" />
              </>
            ) : null}
          </dd>
        </div>
      ) : null}
      {fit.required ? (
        <div className="flex flex-wrap items-center gap-x-1.5">
          <dt className="font-semibold text-muted">Minimum:</dt>
          <dd className="inline-flex flex-wrap items-center gap-1.5 text-ink">
            <span>
              {fit.required.min}
              {fit.required.scale === 'german' ? ' or better' : ''} on the {SCALE_LABEL[fit.required.scale]}
            </span>
            <ConfidenceBadge confidence={fit.required.confidence} />
            <SourceLink url={fit.required.source_url} label="Source of the minimum" />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** "Going direct": the target summary card, or a summary of all targets. */
export function DirectSection({
  plan,
  programHref,
  now,
}: {
  plan: PlanB;
  programHref: (id: string) => string;
  now: Date;
}) {
  return (
    <section aria-labelledby="direct-h" className="mb-6">
      <h2 id="direct-h" className="mb-2 text-xl font-bold">
        Going direct
      </h2>
      {plan.direct ? (
        <DirectCard direct={plan.direct} href={programHref(plan.direct.program.id)} now={now} />
      ) : (
        <AllTargetsCard plan={plan} />
      )}
    </section>
  );
}

function DirectCard({ direct, href, now }: { direct: DirectRoute; href: string; now: Date }) {
  const { program, institution, fit } = direct;
  const conditionalText = directConditionalText(direct);
  return (
    <Card>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">Your target</p>
      <h3 className="mt-0.5 text-lg font-bold break-words">{program.name}</h3>
      <p className="text-sm text-muted break-words">
        {institution?.name ?? 'Institution not in our data yet'} · {countryName(program.country)}
      </p>
      <div className="mt-3">
        <FitBadge label={fit.label} />
        <p className="mt-1 text-sm text-ink">{fit.reason.message}</p>
        <FitNumbers fit={fit} />
      </div>
      {conditionalText ? (
        <p className="mt-2 text-sm text-ink break-words" data-direct-conditional={direct.conditional?.status}>
          {conditionalText}
        </p>
      ) : null}
      <StatusNote program={program} now={now} />
      <DeadlineRows deadlines={[direct.deadline]} now={now} />
      <TimeCostGrid time={direct.time} cost={direct.cost} budget={direct.budget} officialUrl={program.official_url} />
      {fit.label === 'Below minimum' ? (
        <p className="mt-3 text-sm text-ink">
          Being below a minimum is not the end. Below are other honest routes, with their time, cost and risks.
        </p>
      ) : (
        <p className="mt-3 text-sm text-ink">
          This target is not &quot;Below minimum&quot; on verified data. The routes below are still here if you want a back-up.
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 border-t border-line pt-2">
        <Link href={href} className="inline-flex min-h-tap items-center text-sm font-semibold">
          See program details<span aria-hidden="true">&nbsp;→</span>
        </Link>
        <OfficialLinks program={program} institution={institution} />
      </div>
    </Card>
  );
}

function AllTargetsCard({ plan }: { plan: PlanB }) {
  return (
    <Card>
      <p className="text-sm text-ink">
        {plan.explanation ?? 'You are looking at routes for all your targets. Pick one target above to compare time and cost side by side.'}
      </p>
      {plan.targets.length > 0 ? (
        <>
          <p className="mt-3 text-xs font-bold uppercase tracking-wide text-muted">
            Your {plan.targets.length} target{plan.targets.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
            {FIT_LABELS.map((label) => {
              const n = plan.targets.filter((t) => t.fit.label === label).length;
              return (
                <li key={label} className="flex items-center gap-2">
                  <FitBadge label={label} />
                  <span className="text-sm font-semibold text-ink">{n}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </Card>
  );
}

/** "Improve and reapply" — always shown, clearly visible. Generic advice, no invented numbers. */
export function ImproveCard() {
  const r = IMPROVE_REAPPLY;
  return (
    <section aria-labelledby="improve-h" className="mb-6">
      <div className="rounded-card border border-line border-l-4 border-l-primary bg-surface p-4 shadow-card">
        <p className="text-xs font-bold uppercase tracking-wide text-muted">Always an option</p>
        <h2 id="improve-h" className="mt-0.5 text-xl font-bold">
          {r.label}
        </h2>
        <p className="mt-1 text-sm text-ink">{r.help}</p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-ink">
          {r.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-button bg-surface-tint p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-muted">Time</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">{r.timeText}</dd>
          </div>
          <div className="rounded-button bg-surface-tint p-3">
            <dt className="text-xs font-bold uppercase tracking-wide text-muted">Cost</dt>
            <dd className="mt-1 text-sm font-semibold text-ink">{r.costText}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted">This route depends on you, not on a program&apos;s data, so it has no score.</p>
      </div>
    </section>
  );
}

function coverageEmpty(c: TypeCoverage): boolean {
  return c.shown === 0 && c.blocked === 0 && !c.notDecided && !c.notForYourGrade;
}

export function coverageText(c: TypeCoverage): string {
  if (coverageEmpty(c)) return 'None yet';
  const parts: string[] = [];
  if (c.shown > 0) parts.push(`${c.shown} shown`);
  if (c.blocked > 0) parts.push(`${c.blocked} blocked`);
  if (c.notDecided > 0) parts.push(`${c.notDecided} not decided yet`);
  if (c.notForYourGrade > 0) parts.push(`${c.notForYourGrade} not for your grade`);
  return parts.join(', ');
}

/** Every route type with a plain explanation, including the ones with nothing to show yet. */
export function RouteTypesSection({ coverage }: { coverage: TypeCoverage[] }) {
  const withResults = coverage.filter((c) => !coverageEmpty(c));
  const comingSoon = coverage.filter((c) => coverageEmpty(c)).map((c) => ROUTE_LABEL[c.type]);
  return (
    <>
      {withResults.length > 0 ? <RouteTypesList coverage={withResults} /> : null}
      {comingSoon.length > 0 ? (
        <p className="mb-6 text-sm text-muted" data-routes-coming="">
          More routes we&apos;re adding: {comingSoon.join(', ')}.
        </p>
      ) : null}
    </>
  );
}

function RouteTypesList({ coverage }: { coverage: TypeCoverage[] }) {
  return (
    <section aria-labelledby="types-h" className="mb-6">
      <h2 id="types-h" className="text-xl font-bold">
        Routes with results
      </h2>
      <p className="mt-1 text-sm text-muted">What each route means, and what we found in your field and countries.</p>
      <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-surface">
        {coverage.map((c) => (
          <li key={c.type} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-heading">{ROUTE_LABEL[c.type]}</p>
              <Pill>{coverageText(c)}</Pill>
            </div>
            <p className="mt-0.5 text-sm text-ink">{ROUTE_HELP[c.type]}</p>
          </li>
        ))}
        <li className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-heading">{ROUTE_LABEL.improve_reapply}</p>
            <Pill>Always shown</Pill>
          </div>
          <p className="mt-0.5 text-sm text-ink">{ROUTE_HELP.improve_reapply}</p>
        </li>
      </ul>
    </section>
  );
}

/** Blocked routes: never ranked, shown last, collapsed. */
export function BlockedSection({ blocked }: { blocked: PlanRoute[] }) {
  if (blocked.length === 0) return null;
  return (
    <section aria-labelledby="blocked-h" className="mb-6">
      <h2 id="blocked-h" className="text-xl font-bold">
        Blocked routes
      </h2>
      <details className="mt-2 rounded-card border border-dashed border-blocked-fg bg-surface p-4">
        <summary className="flex min-h-tap cursor-pointer flex-wrap items-center gap-2 font-semibold text-ink">
          <BlockedBadge />
          Show {blocked.length} blocked route{blocked.length === 1 ? '' : 's'}
        </summary>
        <p className="mt-2 text-sm text-muted">These failed the integrity gate. We do not rank them or suggest them.</p>
        <ul className="mt-2 space-y-3">
          {blocked.map((r) => (
            <li key={r.id} className="border-t border-line pt-3">
              <p className="font-semibold text-ink break-words">{r.program.name}</p>
              <p className="text-sm text-muted break-words">
                {r.institution?.name ?? 'Institution not in our data yet'} · {ROUTE_LABEL[r.type]}
              </p>
              {r.gate.block ? (
                <>
                  <p className="mt-1 text-sm text-ink">{r.gate.block.reason}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <ConfidenceBadge confidence={r.gate.block.confidence} />
                    {r.gate.block.checkedAt ? <span>Checked {formatDate(r.gate.block.checkedAt)}</span> : null}
                    <SourceLink url={r.gate.block.sourceUrl} label="Recognition list source" />
                  </div>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Ruled-out programs: excluded from routes, with the reason and the (badged) note from the data. */
export function ExcludedSection({ excluded, now }: { excluded: ExcludedProgram[]; now: Date }) {
  if (excluded.length === 0) return null;
  return (
    <section aria-labelledby="excluded-h" className="mb-6">
      <h2 id="excluded-h" className="text-xl font-bold">
        Not shown: ruled out
      </h2>
      <details className="mt-2 rounded-card border border-line bg-surface p-4">
        <summary className="flex min-h-tap cursor-pointer items-center font-semibold text-ink">
          Show {excluded.length} ruled-out program{excluded.length === 1 ? '' : 's'}
        </summary>
        <ul className="mt-2 space-y-3">
          {excluded.map((e) => (
            <li key={e.program.id} className="border-t border-line pt-3">
              <p className="font-semibold text-ink break-words">{e.program.name}</p>
              <p className="text-sm text-muted break-words">
                {e.institution?.name ?? 'Institution not in our data yet'} · {countryName(e.program.country)}
              </p>
              <p className="mt-1 text-sm text-ink">{e.reason}</p>
              <p className="mt-1 text-sm text-ink">
                <span className="font-semibold text-muted">Note: </span>
                <FactInline fact={e.program.status_note} now={now} />
              </p>
              <OfficialLinks program={e.program} institution={e.institution} />
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function ProgramHeading({
  program,
  institution,
  href,
}: Pick<UndecidedProgram, 'program' | 'institution'> & { href: string }) {
  return (
    <>
      <p className="font-semibold break-words">
        <Link href={href} className="inline-flex min-h-tap items-center">
          {program.name}
        </Link>
      </p>
      <p className="text-sm text-muted break-words">
        {institution?.name ?? 'Institution not in our data yet'} · {countryName(program.country)}
      </p>
    </>
  );
}

/**
 * "Not decided yet": direct Masters in the student's field and countries whose fit (or conditional route) we
 * cannot decide. Each reason is worded separately. Listed, never ranked or scored; links to the shortlist.
 */
export function NotDecidedSection({
  undecided,
  shortlistHref,
  programHref,
}: {
  undecided: UndecidedProgram[];
  shortlistHref: string;
  programHref: (id: string) => string;
}) {
  if (undecided.length === 0) return null;
  const n = undecided.length;
  return (
    <section aria-labelledby="undecided-h" className="mb-6">
      <h2 id="undecided-h" className="text-xl font-bold">
        Programs to check
      </h2>
      <p className="mt-1 text-sm text-ink">{undecidedSummary(n)}</p>
      <Link href={shortlistHref} className="inline-flex min-h-tap items-center text-sm font-semibold">
        See them on your shortlist<span aria-hidden="true">&nbsp;→</span>
      </Link>
      <details className="mt-2 rounded-card border border-line bg-surface p-4">
        <summary className="flex min-h-tap cursor-pointer items-center font-semibold text-ink">
          Show {n} program{n === 1 ? '' : 's'} and why
        </summary>
        <ul className="mt-2 space-y-3">
          {undecided.map((u) => (
            <li key={u.program.id} className="border-t border-line pt-3" data-undecided={u.program.id}>
              <ProgramHeading program={u.program} institution={u.institution} href={programHref(u.program.id)} />
              {u.isTarget || u.routeAbove ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  {u.isTarget ? <Pill>Your target</Pill> : null}
                  {u.routeAbove ? <Pill>Also shown above as a route</Pill> : null}
                </div>
              ) : null}
              <ul className="mt-1 space-y-1 text-sm text-ink">
                {u.minimumReason ? <li className="break-words">{u.minimumReason}</li> : null}
                {u.conditional ? (
                  <li className="break-words">
                    <span className="font-semibold text-muted">Conditional route: </span>
                    {u.conditional.reason}
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <ConfidenceBadge confidence={u.conditional.confidence} />
                      <SourceLink url={u.conditional.sourceUrl} label="Source of the conditional route" />
                    </span>
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

/** Official conditional routes whose own lower limit the student's grade is below, with the reason and source. */
export function NotForYourGradeSection({
  rows,
  programHref,
}: {
  rows: NotForYourGrade[];
  programHref: (id: string) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="notforgrade-h" className="mb-6">
      <h2 id="notforgrade-h" className="text-xl font-bold">
        Conditional routes: not for your grade
      </h2>
      <p className="mt-1 text-sm text-muted">
        The official page names a lower limit for these routes, and your grade is below it. We show them so nothing is
        hidden.
      </p>
      <ul className="mt-2 space-y-3 rounded-card border border-line bg-surface p-4">
        {rows.map((r, i) => (
          <li
            key={r.program.id}
            className={i > 0 ? 'border-t border-line pt-3' : undefined}
            data-not-for-grade={r.program.id}
          >
            <ProgramHeading program={r.program} institution={r.institution} href={programHref(r.program.id)} />
            <p className="mt-1 text-sm text-ink break-words">{r.check.reason}</p>
            {r.check.quote ? (
              <blockquote className="evidence-quote mt-1 text-sm break-words">{r.check.quote}</blockquote>
            ) : (
              <p className="mt-1 text-sm text-ink break-words">
                <span className="font-semibold text-muted">In short: </span>
                {r.check.text}
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <ConfidenceBadge confidence={r.check.confidence} />
              <SourceLink url={r.check.sourceUrl} label="Source of the conditional route" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
