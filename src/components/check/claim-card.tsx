/**
 * One Consultant Check result. Server component, plain text only (the claim is user input, sources are data rows;
 * React escapes both). Links come from data rows only, through SourceLink / NotVerified (safeHref inside).
 *
 * Evidence first: beside each confidence badge we show the EXACT words from the official page (evidence_snippet),
 * in quotation marks. Our own wording of the value is labelled "In short:" (or "Our summary (not a quote):" when we
 * hold no exact words) and is never put in quotation marks. The internal review_note is never part of a CheckSource.
 */
import { ConfidenceBadge } from '@/components/ui/badges';
import { Card } from '@/components/ui/card';
import { NotVerified, SourceLink } from '@/components/ui/fact';
import { evidenceLanguage } from '@/lib/citizenship';
import { resultLabel, type CheckResult, type CheckSource } from '@/lib/consultant/compare';
import { domainOf, safeHref } from '@/lib/format';
import { VERDICT_STRIPE, VerdictBadge } from './verdict-badge';

function SourceItem({ source }: { source: CheckSource }) {
  const snippet = source.snippet?.trim() ? source.snippet.trim() : null;
  const lang = snippet ? evidenceLanguage(source.source_url) : null;
  return (
    <li className="rounded-button border border-line bg-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-semibold text-muted">{source.label}</p>
        <ConfidenceBadge confidence={source.confidence} />
      </div>
      {snippet ? (
        <figure className="mt-2">
          <figcaption className="text-xs font-semibold text-muted">
            Exact words on the official page{lang ? ` (original ${lang.name})` : ''}:
          </figcaption>
          <blockquote className="evidence-quote mt-1" lang={lang?.code}>
            “{snippet}”
          </blockquote>
        </figure>
      ) : null}
      <p className="mt-2 break-words text-ink">
        <span className="font-semibold text-heading">{snippet ? 'In short: ' : 'Our summary (not a quote): '}</span>
        {source.value}
      </p>
      {lang ? (
        <p className="mt-1 text-xs text-muted">The official page is in {lang.name}. “In short” is our English wording of it.</p>
      ) : null}
      {source.clockNote ? (
        <p className="mt-1 break-words text-sm">
          <span className="font-semibold text-heading">How the clock works: </span>
          {source.clockNote}
        </p>
      ) : null}
      {source.note ? (
        <p className="mt-1 break-words text-sm">
          <span className="font-semibold text-heading">Note: </span>
          {source.note}
        </p>
      ) : null}
      {safeHref(source.source_url) ? (
        <SourceLink url={source.source_url} />
      ) : (
        <p className="mt-1 text-xs text-muted">No source link yet</p>
      )}
    </li>
  );
}

export function ClaimCard({ result, index }: { result: CheckResult; index: number }) {
  const titleId = `claim-${result.id}-title`;
  return (
    <Card className={VERDICT_STRIPE[result.verdict]}>
      <article aria-labelledby={titleId} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Claim {index + 1} · {result.typeLabel}
          </p>
          <VerdictBadge verdict={result.verdict} label={resultLabel(result)} />
        </div>

        <div>
          <h3 id={titleId} className="break-words text-lg font-bold">
            <span className="sr-only">You were told: </span>“{result.claim}”
          </h3>
          {result.about.length > 0 ? (
            <p className="mt-1 break-words text-sm text-muted">About: {result.about.join(' · ')}</p>
          ) : null}
          {result.reading ? <p className="mt-1 text-sm text-muted">{result.reading}</p> : null}
        </div>

        <p className="break-words text-ink">{result.explanation}</p>

        {result.sources.length > 0 ? (
          <div>
            <h4 className="mb-2 text-sm font-bold text-heading">What the official sources we hold say</h4>
            <ul className="space-y-2">
              {result.sources.map((s, i) => (
                <SourceItem key={`${s.label}-${i}`} source={s} />
              ))}
            </ul>
          </div>
        ) : null}

        {result.officialLinks.length > 0 ? (
          <div>
            <h4 className="mb-1 text-sm font-bold text-heading">Official data</h4>
            <ul className="space-y-1 text-sm">
              {result.officialLinks.map((l) => (
                <li key={l.url} className="break-words">
                  <NotVerified officialUrl={l.url} />
                  <span className="text-muted"> ({domainOf(l.url)})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {result.questionsToAsk.length > 0 ? (
          <div className="rounded-button bg-surface-tint p-3">
            <h4 className="mb-1 text-sm font-bold text-heading">Ask them in writing</h4>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {result.questionsToAsk.map((q) => (
                <li key={q} className="break-words">
                  {q}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </article>
    </Card>
  );
}
