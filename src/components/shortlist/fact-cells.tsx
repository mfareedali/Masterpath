/**
 * Small evidence-first cells shared by the shortlist card and table. Server components.
 * Every value carries a computed confidence badge; missing values read "Not verified yet".
 */
import Link from 'next/link';
import { ConfidenceBadge } from '@/components/ui/badges';
import { FactInline, NotVerified, SourceLink } from '@/components/ui/fact';
import { computeConfidence } from '@/lib/confidence';
import type { CostResult } from '@/lib/cost';
import { formatDate, formatMoney, formatPkr, safeHref } from '@/lib/format';
import { citizenshipShortText, daysLeftLabel, totalCostCaveats } from '@/lib/shortlist';
import type { CountryFact, Fact, Institution, Program } from '@/lib/types';

/**
 * The fact's student-facing note ("Note: Applications close at 12:00 noon CET"), shown with its value, as on the
 * program page. Not for a missing value or a Conflict. The internal review_note is never shown.
 */
export function FactNote<T>({ fact, now }: { fact: Fact<T> | null | undefined; now: Date }) {
  const note = fact?.note?.trim();
  if (!fact || !note || fact.value == null || computeConfidence(fact, now) === 'Conflict') return null;
  return <span className="block w-full text-xs text-muted">Note: {note}</span>;
}

/**
 * Deadline + badge + "12 days left" / "Closes today" / "Date has passed". `daysLeft` comes from code
 * (ProgramView.deadlineDaysLeft): it exists only for a usable (Verified/Likely) date, so an Unverified or
 * conflicting date never gets a countdown.
 */
export function DeadlineCell({ program, now, daysLeft }: { program: Program; now: Date; daysLeft: number | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <FactInline fact={program.deadline} now={now} render={(v) => formatDate(v)} />
      {daysLeft !== null ? (
        <span className={`text-xs font-semibold ${daysLeft <= 0 ? 'text-conflict-fg' : 'text-ink'}`}>{daysLeftLabel(daysLeft)}</span>
      ) : null}
      <FactNote fact={program.deadline} now={now} />
    </span>
  );
}

export function TuitionCell({ program, now }: { program: Program; now: Date }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <FactInline fact={program.tuition} now={now} render={(v) => formatMoney(v)} />
      <FactNote fact={program.tuition} now={now} />
    </span>
  );
}

/** Total for the whole degree. PKR only through a usable exchange rate; never a guessed conversion. */
export function TotalCostCell({ cost, withinBudget }: { cost: CostResult; withinBudget: boolean | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {cost.pkr != null ? (
        <span className="text-ink">{formatPkr(cost.pkr)}</span>
      ) : cost.native ? (
        <span className="text-ink">{formatMoney({ ...cost.native, period: 'total' })}</span>
      ) : (
        <span className="text-muted">Not verified yet</span>
      )}
      <ConfidenceBadge confidence={cost.confidence} />
      {cost.pkr == null && cost.native ? <span className="text-xs text-muted">No verified PKR rate yet</span> : null}
      {withinBudget === true ? <span className="text-xs font-semibold text-ink">Within your budget</span> : null}
      {withinBudget === false ? <span className="text-xs font-semibold text-conflict-fg">Over your budget</span> : null}
      {totalCostCaveats(cost).map((c, i) => (
        <span key={`${i}-${c}`} className="block w-full text-xs text-muted" data-cost-caveat="">
          {c}
        </span>
      ))}
    </span>
  );
}

export function CitizenshipCell({ fact, now, showLink = true }: { fact: CountryFact | null; now: Date; showLink?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <FactInline fact={fact} now={now} render={(v) => citizenshipShortText(v)} />
      {showLink ? (
        <Link href="/citizenship" className="inline-flex min-h-tap items-center text-xs font-semibold md:min-h-0">
          Compare rules
        </Link>
      ) : null}
    </span>
  );
}

/** Official program page (from data) or "Not verified yet" + the university homepage from data. */
export function OfficialPageLinks({ program, institution }: { program: Program; institution: Institution | null }) {
  if (safeHref(program.official_url)) return <SourceLink url={program.official_url} label="Official program page" />;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 text-sm">
      <span>
        <span className="font-semibold text-muted">Program page: </span>
        <NotVerified compact />
      </span>
      {safeHref(institution?.website) ? <SourceLink url={institution?.website} label="University website" /> : null}
    </span>
  );
}
