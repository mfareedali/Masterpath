/**
 * Evidence-first building blocks for country facts (server components).
 * Every value shows a computed confidence badge, its source link and checked date, the verbatim evidence from
 * the official page (collapsible) and the student-facing note. Data text is rendered as plain text only.
 * The internal reviewer note is never rendered.
 */
import { allSources, computeConfidence } from '@/lib/confidence';
import { evidenceLanguage, moneyFactText, studentNote } from '@/lib/citizenship';
import { formatDate, safeHref } from '@/lib/format';
import type { Confidence, CountryFact, CountryFactValue, SourcedValue } from '@/lib/types';
import { ConfidenceBadge } from '@/components/ui/badges';
import { FactInline, NotVerified, SourceLink } from '@/components/ui/fact';

export type FactKind = 'text' | 'money';

function valueText(v: CountryFactValue, kind: FactKind): string {
  return kind === 'money' ? moneyFactText(v) : v.text;
}

const LIKELY_NOTE = 'Likely: re-verify on the official page before relying on it.';
const UNVERIFIED_NOTE = 'Not from an official page yet. Do not rely on it.';

/** Source link, checked date and (for summaries) how the value relates to the page. */
function SourceMeta({ s }: { s: SourcedValue<unknown> }) {
  const hasLink = Boolean(safeHref(s.source_url));
  const basis =
    s.basis === 'summary'
      ? 'Summary of the source, not a direct quote'
      : s.basis === 'inferred'
        ? 'Inferred / secondary source'
        : null;
  if (!hasLink && !s.fetched_at && !basis) return null;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
      <SourceLink url={s.source_url} />
      {s.fetched_at ? <span>Checked {formatDate(s.fetched_at)}</span> : null}
      {basis ? <span>{basis}</span> : null}
    </span>
  );
}

/**
 * "Evidence from the official page": the verbatim snippet, collapsible, plain text (.evidence-quote).
 * A snippet from a German-language page is labelled "(original German)" and carries lang="de".
 * `compact` shortens the toggle label for table cells.
 */
export function CountryEvidence({ s, compact = false }: { s: SourcedValue<unknown>; compact?: boolean }) {
  const snippet = s.evidence_snippet;
  if (!snippet || snippet.trim() === '') return null;
  const lang = evidenceLanguage(s.source_url);
  return (
    <details className={compact ? 'mt-1' : 'mt-2'}>
      <summary
        className={`min-h-tap cursor-pointer py-2 font-semibold text-link md:min-h-0 md:py-0 ${compact ? 'text-xs' : 'text-sm'}`}
      >
        {compact ? 'Evidence' : 'Evidence from the official page'}
        {lang ? ` (original ${lang.name})` : ''}
      </summary>
      <blockquote className="evidence-quote mt-1" lang={lang?.code}>
        {snippet}
      </blockquote>
      {lang ? (
        <span className="mt-1 block text-xs text-muted">
          The official page is in {lang.name}. The value shown is our English wording of it.
        </span>
      ) : null}
    </details>
  );
}

/** The fact's student-facing note ("Note: …"), plain text. Never the reviewer note. */
export function NoteLine({ fact, compact = false }: { fact: CountryFact | null; compact?: boolean }) {
  const note = studentNote(fact);
  if (!note) return null;
  return (
    <span className={`mt-1 block break-words ${compact ? 'text-xs' : 'text-sm'}`}>
      <span className="font-semibold text-heading">Note: </span>
      {note}
    </span>
  );
}

/**
 * "How the clock starts" (always, when `clock`) or `label` (default "Details") when the row has a clock note.
 */
function ClockLine({ v, clock, label = 'Details' }: { v: CountryFactValue; clock: boolean; label?: string }) {
  if (clock) {
    return (
      <span className="mt-1 block text-sm break-words">
        <span className="font-semibold text-heading">How the clock starts: </span>
        {v.clock_note ? v.clock_note : <span className="text-muted">Not verified yet</span>}
      </span>
    );
  }
  if (!v.clock_note) return null;
  return (
    <span className="mt-1 block text-sm break-words">
      <span className="font-semibold text-heading">{`${label}: `}</span>
      {v.clock_note}
    </span>
  );
}

/** Conflict: every source's value with its own link, date and evidence (never one silently picked). */
export function ConflictSources({ fact, kind, compact }: { fact: CountryFact; kind: FactKind; compact: boolean }) {
  return (
    <ul className="space-y-2">
      {allSources(fact).map((s, i) => (
        <li key={i} className="rounded-button border border-conflict-bg bg-surface p-2">
          <span className="block break-words text-ink">
            <span className="mr-1 text-xs font-bold text-muted">Source {i + 1}</span>
            {s.value ? valueText(s.value, kind) : null}
          </span>
          <SourceMeta s={s} />
          <CountryEvidence s={s} compact={compact} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Everything under a usable/unverified value: clock, note, warnings, source, evidence.
 * `clockLabel` renames the "Details" line (e.g. "How it is checked" for visa money).
 */
export function ValueDetails({
  fact,
  v,
  conf,
  clock,
  compact,
  clockLabel,
}: {
  fact: CountryFact;
  v: CountryFactValue;
  conf: Confidence;
  clock: boolean;
  compact: boolean;
  clockLabel?: string;
}) {
  return (
    <>
      <ClockLine v={v} clock={clock} label={clockLabel} />
      <NoteLine fact={fact} compact={compact} />
      {conf === 'Unverified' ? <span className="mt-1 block text-xs text-muted">{UNVERIFIED_NOTE}</span> : null}
      <SourceMeta s={fact} />
      <CountryEvidence s={fact} compact={compact} />
      {conf === 'Likely' ? <span className="mt-1 block text-xs text-muted">{LIKELY_NOTE}</span> : null}
    </>
  );
}

/**
 * Full fact row (inside a <dl>): label + badge, value, clock, note, source link, checked date, evidence.
 * `clock` adds "How the clock starts" (always shown; "Not verified yet" when the source does not say).
 */
export function CountryFactRow({
  label,
  fact,
  now,
  kind = 'text',
  clock = false,
}: {
  label: string;
  fact: CountryFact | null;
  now: Date;
  kind?: FactKind;
  clock?: boolean;
}) {
  const conf = computeConfidence(fact, now);
  const v = fact?.value ?? null;
  return (
    <div className="border-b border-line py-3 last:border-b-0">
      <dt className="flex items-start justify-between gap-3 text-sm font-semibold text-muted">
        <span>{label}</span>
        <ConfidenceBadge confidence={conf} />
      </dt>
      <dd className="mt-1">
        {!fact || v == null ? (
          <>
            <NotVerified officialUrl={fact?.source_url} />
            <NoteLine fact={fact} />
          </>
        ) : conf === 'Conflict' ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-conflict-fg">Official sources disagree. Both are shown below.</p>
            <ConflictSources fact={fact} kind={kind} compact={false} />
          </div>
        ) : (
          <div className="break-words">
            <span className="block text-base text-ink">{valueText(v, kind)}</span>
            <ValueDetails fact={fact} v={v} conf={conf} clock={clock} compact={false} />
          </div>
        )}
      </dd>
    </div>
  );
}

/** Under a fact with no value: its student note (if any) and a link to the official page (if any). */
export function EmptyFactDetails({ fact, compact = false }: { fact: CountryFact | null; compact?: boolean }) {
  return (
    <>
      <NoteLine fact={fact} compact={compact} />
      {safeHref(fact?.source_url) ? (
        <span className="mt-0.5 block text-xs">
          <SourceLink url={fact?.source_url} label="Check the official page" />
        </span>
      ) : null}
    </>
  );
}

/**
 * Compact value for cards and table cells: value + badge, clock/details, note, source link, checked date,
 * evidence, Likely note. Conflict: both values with both links. `compact` = table cell (short evidence label).
 */
export function FactSummary({
  fact,
  now,
  kind = 'text',
  clock = false,
  compact = false,
}: {
  fact: CountryFact | null;
  now: Date;
  kind?: FactKind;
  clock?: boolean;
  compact?: boolean;
}) {
  const conf = computeConfidence(fact, now);

  if (fact && conf === 'Conflict') {
    return (
      <div className="space-y-2">
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-conflict-fg">Official sources disagree</span>
          <ConfidenceBadge confidence="Conflict" />
        </span>
        <ConflictSources fact={fact} kind={kind} compact={compact} />
      </div>
    );
  }

  const v = fact?.value ?? null;
  return (
    <div className="break-words">
      <FactInline<CountryFactValue> fact={fact} now={now} render={(x) => valueText(x, kind)} />
      {fact && v != null ? (
        <ValueDetails fact={fact} v={v} conf={conf} clock={clock} compact={compact} />
      ) : (
        <EmptyFactDetails fact={fact} compact={compact} />
      )}
    </div>
  );
}
