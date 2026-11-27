/**
 * Small evidence-first cells shared by the shortlist card and table. Server components.
 * Every value carries a computed confidence badge; missing values read "Not verified yet".
 */
import Link from 'next/link';
import { ConfidenceBadge } from '@/components/ui/badges';
import { FactInline, SourceLink } from '@/components/ui/fact';
import { computeConfidence } from '@/lib/confidence';
import type { CostResult } from '@/lib/cost';
import { domainOf, formatDate, formatMoney, formatPkr, safeHref } from '@/lib/format';
import { citizenshipShortText, daysLeftLabel, noteHeadline, officialFallbackUrl, totalCostCaveats } from '@/lib/shortlist';
import type { CountryFact, Fact, Institution, Program } from '@/lib/types';

/**
 * The fact's student-facing note ("Note: Applications close at 12:00 noon CET"), shown with its value, as on the
 * program page. Not for a missing value or a Conflict. The internal review_note is never shown.
 */
export function FactNote<T>({ fact, now }: { fact: Fact<T> | null | undefined; now: Date }) {
  const note = fact?.note?.trim();
  if (!fact || !note || fact.value == null || computeConfidence(fact, now) === 'Conflict') return null;
  return <NoteLine text={note} />;
}

/** "Note: <one headline line>" with a "Read more" expander when the note is long. Plain text only. */
export function NoteLine({ text, attr }: { text: string; attr?: Record<string, string> }) {
  const { head, full } = noteHeadline(text);
  return (
    <span className="block w-full text-xs text-muted" {...attr}>
      Note: {head}
      {full ? (
        <details className="inline">
          <summary className="inline-flex min-h-tap cursor-pointer items-center px-1 font-semibold text-link md:min-h-0">Read more</summary>
          <span className="block">{full}</span>
        </details>
      ) : null}
    </span>
  );
}

/** "Source: domain · checked 12 Oct 2026", linking to the official page. Shown under a value that has a source. */
export function SourceStamp({ fact }: { fact: Fact<unknown> | null | undefined }) {
  const href = safeHref(fact?.source_url);
  if (!fact || fact.value == null || !href) return null;
  const checked = fact.fetched_at ? ` · checked ${formatDate(fact.fetched_at)}` : '';
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="inline-flex min-h-tap w-full items-center text-xs text-link underline md:min-h-0"
      data-source-stamp=""
    >
      Source: {domainOf(href)}
      {checked}
      <span aria-hidden="true">&nbsp;↗</span>
      <span className="sr-only"> (opens official page in a new tab)</span>
    </a>
  );
}

/** Em dash for a table cell whose value is not on file (the row says so once, see MissingDetails). */
export function NotOnFile() {
  return (
    <span className="text-muted">
      <span aria-hidden="true">–</span>
      <span className="sr-only">Not on file yet</span>
    </span>
  );
}

/** One quiet line per row for everything not on file, with the official page to check. Renders nothing when complete. */
export function MissingDetails({
  count,
  program,
  institution,
}: {
  count: number;
  program: Program;
  institution: Institution | null;
}) {
  if (count <= 0) return null;
  const url = officialFallbackUrl(program, institution);
  return (
    <p className="text-xs text-muted" data-missing-details="">
      {count} detail{count === 1 ? '' : 's'} not on file yet
      {url ? (
        <>
          {', '}
          <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-tap items-center font-semibold text-link underline md:min-h-0">
            see official page<span aria-hidden="true">&nbsp;↗</span>
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </>
      ) : null}
    </p>
  );
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
      <SourceStamp fact={program.deadline} />
    </span>
  );
}

export function TuitionCell({ program, now }: { program: Program; now: Date }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <FactInline fact={program.tuition} now={now} render={(v) => formatMoney(v)} />
      <FactNote fact={program.tuition} now={now} />
      <SourceStamp fact={program.tuition} />
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
        <NoteLine key={`${i}-${c}`} text={c} attr={{ 'data-cost-caveat': '' }} />
      ))}
    </span>
  );
}

export function CitizenshipCell({ fact, now, showLink = true }: { fact: CountryFact | null; now: Date; showLink?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <FactInline fact={fact} now={now} render={(v) => citizenshipShortText(v)} />
      <SourceStamp fact={fact} />
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
  if (safeHref(institution?.website)) return <SourceLink url={institution?.website} label="University website" />;
  return null;
}
