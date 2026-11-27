/**
 * Country card (mobile, below md). Server component.
 * Shows the rank (or why it is not ranked), the exact citizenship rule with "How the clock starts",
 * then the secondary facts, typical costs and the money to show for the student visa (never ranked).
 * Every value carries a computed confidence badge.
 */
import {
  COST_FACT_KEYS,
  FACT_LABELS,
  SECONDARY_FACT_KEYS,
  buildCountryQuestion,
  conflictSources,
  conflictedFacts,
  type CountryRankKey,
  type CountryRow,
} from '@/lib/citizenship';
import type { FxRate } from '@/lib/types';
import { ConfidenceBadge, Pill, RankBadge } from '@/components/ui/badges';
import { CopyButton } from '@/components/ui/copy-button';
import { CountryFactRow, FactSummary } from './fact-parts';
import { VisaFundsBlock } from './visa-funds';

export interface CountryEntry {
  row: CountryRow;
  key: CountryRankKey;
  /** Set for ranked countries. */
  rank?: number;
  /** Set for "Not ranked" countries. */
  reason?: string;
}

export function RankedValue({ entry, rankLabel }: { entry: CountryEntry; rankLabel: string }) {
  if (entry.rank != null && entry.key.display) {
    return (
      <div>
        <p className="text-xs font-semibold text-muted">Ranked by {rankLabel.toLowerCase()}</p>
        <p className="flex flex-wrap items-center gap-2 font-semibold text-heading">
          <span className="break-words">{entry.key.display}</span>
          {/* A rule's months number is a code-made sort key: no badge, the rule text below carries the evidence. */}
          {entry.key.showBadge ? <ConfidenceBadge confidence={entry.key.confidence} /> : null}
        </p>
        {entry.key.detail ? <p className="text-xs break-words text-muted">{entry.key.detail}</p> : null}
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-semibold text-muted">Check on the official page</p>
      <p className="text-sm break-words text-ink">{entry.reason ?? entry.key.missingReason ?? 'Not on file yet'}</p>
    </div>
  );
}

/** "Copy a question" buttons for facts whose official sources disagree. */
export function ConflictQuestions({ row, now }: { row: CountryRow; now: Date }) {
  const conflicts = conflictedFacts(row, now);
  if (conflicts.length === 0) return null;
  return (
    <div className="mt-3 space-y-2 rounded-button bg-conflict-bg p-3">
      <p className="text-sm font-semibold text-conflict-fg">
        Official sources disagree. Ask the official office in writing before you rely on either value.
      </p>
      {conflicts.map((c) => (
        <CopyButton
          key={c.key}
          label={`Copy question: ${c.label.toLowerCase()}`}
          copiedLabel="Question copied"
          text={buildCountryQuestion({ countryName: row.name, topic: c.label, sources: conflictSources(c.fact) })}
        />
      ))}
    </div>
  );
}

export function CountryCard({
  entry,
  now,
  fx,
  rankLabel,
  isTarget = false,
}: {
  entry: CountryEntry;
  now: Date;
  /** Exchange rates: the visa-money PKR line uses only a Verified/Likely one. */
  fx: FxRate[];
  rankLabel: string;
  isTarget?: boolean;
}) {
  const { row } = entry;
  const headingId = `country-${row.country.toLowerCase()}-${entry.rank != null ? 'ranked' : 'not-ranked'}`;
  return (
    <article aria-labelledby={headingId} className="rounded-card border border-line bg-surface p-4 shadow-card">
      <header className="flex items-start gap-3">
        {entry.rank != null ? <RankBadge rank={entry.rank} /> : null}
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-lg font-bold">
            {row.name}
          </h3>
          {isTarget ? <Pill className="mt-1">In your plan</Pill> : null}
        </div>
      </header>

      <div className="mt-3 rounded-button bg-surface-tint px-3 py-2">
        <RankedValue entry={entry} rankLabel={rankLabel} />
      </div>

      <dl className="mt-2">
        <CountryFactRow label={FACT_LABELS.citizenship_rule} fact={row.facts.citizenship_rule} now={now} clock />
      </dl>

      <h4 className="mt-2 text-sm font-bold text-heading">Work, residence and nationality</h4>
      <dl className="mt-1 divide-y divide-line">
        {SECONDARY_FACT_KEYS.map((k) => (
          <div key={k} className="py-2">
            <dt className="text-sm font-semibold text-muted">{FACT_LABELS[k]}</dt>
            <dd className="mt-0.5 text-sm">
              <FactSummary fact={row.facts[k]} now={now} />
            </dd>
          </div>
        ))}
      </dl>

      <h4 className="mt-2 text-sm font-bold text-heading">Typical cost per year</h4>
      <dl className="mt-1 divide-y divide-line">
        {COST_FACT_KEYS.map((k) => (
          <div key={k} className="py-2">
            <dt className="text-sm font-semibold text-muted">{FACT_LABELS[k]}</dt>
            <dd className="mt-0.5 text-sm">
              <FactSummary fact={row.facts[k]} now={now} kind="money" />
            </dd>
          </div>
        ))}
      </dl>

      <h4 className="mt-2 text-sm font-bold text-heading">{FACT_LABELS.proof_of_funds}</h4>
      <div className="mt-1 py-2 text-sm">
        <VisaFundsBlock fact={row.facts.proof_of_funds} fx={fx} now={now} />
      </div>

      <ConflictQuestions row={row} now={now} />
    </article>
  );
}
