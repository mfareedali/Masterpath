/**
 * Evidence-first rendering of a Fact. Server component.
 *
 * Every value shows: the value (or "Not verified yet"), a confidence badge, the source link, the checked date,
 * and the verbatim evidence snippet. Conflicts show BOTH values with BOTH links and a "Copy email to admissions"
 * button. Scraped text is rendered as plain text only (React escapes it) — never as HTML.
 */
import { allSources, computeConfidence } from '@/lib/confidence';
import { buildConflictEmail } from '@/lib/email';
import { domainOf, formatDate, safeHref } from '@/lib/format';
import type { Fact, SourcedValue } from '@/lib/types';
import { ConfidenceBadge } from './badges';
import { CopyButton } from './copy-button';

export function SourceLink({ url, label }: { url: string | null | undefined; label?: string }) {
  const href = safeHref(url);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-h-tap items-center text-sm font-semibold text-link underline md:min-h-0">
      {label ?? `Source: ${domainOf(href)}`}
      <span aria-hidden="true">&nbsp;↗</span>
      <span className="sr-only"> (opens official page in a new tab)</span>
    </a>
  );
}

/** "Not verified yet" + a link to the official page. The ONLY thing shown when data is missing. */
export function NotVerified({ officialUrl, compact = false }: { officialUrl?: string | null; compact?: boolean }) {
  const href = safeHref(officialUrl);
  return (
    <span className="text-muted">
      Not verified yet
      {href && !compact ? (
        <>
          {' — '}
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold underline">
            check the official page<span aria-hidden="true">&nbsp;↗</span>
          </a>
        </>
      ) : null}
    </span>
  );
}

function SourceMeta({ s }: { s: SourcedValue<unknown> }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
      <SourceLink url={s.source_url} />
      {s.fetched_at ? <span>Checked {formatDate(s.fetched_at)}</span> : null}
      {s.basis === 'summary' ? <span>Summary of the source, not a direct quote</span> : null}
      {s.basis === 'inferred' ? <span>Inferred / secondary source</span> : null}
    </div>
  );
}

function Evidence({ snippet }: { snippet: string | null | undefined }) {
  if (!snippet) return null;
  return (
    <details className="mt-2">
      <summary className="min-h-tap cursor-pointer py-2 text-sm font-semibold text-link md:min-h-0 md:py-0">
        Evidence from the official page
      </summary>
      <blockquote className="evidence-quote mt-1">{snippet}</blockquote>
    </details>
  );
}

export interface FactRowProps<T> {
  label: string;
  fact: Fact<T> | null | undefined;
  now: Date;
  /** How to display a value. Must return plain text or simple elements. */
  render?: (value: T) => React.ReactNode;
  /** Plain-text formatter used inside the conflict email. Defaults to String(value). */
  formatText?: (value: T) => string;
  officialUrl?: string | null;
  /** Needed for the "Copy email to admissions" button on Conflicts. */
  conflictContext?: { programName: string; institutionName: string; admissionsEmail?: string | null };
}

export function FactRow<T>({ label, fact, now, render, formatText, officialUrl, conflictContext }: FactRowProps<T>) {
  const conf = computeConfidence(fact, now);
  const show = (v: T) => (render ? render(v) : String(v));
  const asText = (v: unknown) => (formatText ? formatText(v as T) : typeof v === 'object' ? JSON.stringify(v) : String(v));

  return (
    <div className="border-b border-line py-3 last:border-b-0">
      <dt className="flex items-start justify-between gap-3 text-sm font-semibold text-muted">
        <span>{label}</span>
        <ConfidenceBadge confidence={conf} />
      </dt>
      <dd className="mt-1">
        {!fact || fact.value === null || fact.value === undefined ? (
          <NotVerified officialUrl={officialUrl} />
        ) : conf === 'Conflict' ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-conflict-fg">Official sources disagree. Both are shown below.</p>
            {allSources(fact).map((s, i) => (
              <div key={i} className="rounded-button border border-conflict-bg bg-surface p-3">
                <p className="text-base text-ink">
                  <span className="mr-2 text-xs font-bold text-muted">Source {i + 1}</span>
                  {show(s.value as T)}
                </p>
                <SourceMeta s={s} />
                <Evidence snippet={s.evidence_snippet} />
              </div>
            ))}
            {conflictContext ? (
              <CopyButton
                label="Copy email to admissions"
                copiedLabel="Email copied"
                text={buildConflictEmail({
                  programName: conflictContext.programName,
                  institutionName: conflictContext.institutionName,
                  fieldLabel: label,
                  sources: allSources(fact),
                  formatValue: asText,
                  to: conflictContext.admissionsEmail,
                })}
              />
            ) : null}
          </div>
        ) : (
          <>
            <p className="text-base text-ink">{show(fact.value as T)}</p>
            <SourceMeta s={fact} />
            <Evidence snippet={fact.evidence_snippet} />
            {fact.note ? <p className="mt-1 text-xs text-muted">Note: {fact.note}</p> : null}
          </>
        )}
      </dd>
    </div>
  );
}

/** Compact value + badge for cards. Missing = "Not verified yet". Conflict = "Sources disagree". */
export function FactInline<T>({
  fact,
  now,
  render,
}: {
  fact: Fact<T> | null | undefined;
  now: Date;
  render?: (value: T) => React.ReactNode;
}) {
  const conf = computeConfidence(fact, now);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {!fact || fact.value == null ? (
        <span className="text-muted">Not verified yet</span>
      ) : conf === 'Conflict' ? (
        <span className="font-semibold text-conflict-fg">Sources disagree</span>
      ) : (
        <span className="text-ink">{render ? render(fact.value) : String(fact.value)}</span>
      )}
      <ConfidenceBadge confidence={conf} />
    </span>
  );
}
