/**
 * "Money to show for the student visa" (the country's proof_of_funds row). Server component, shown for every
 * country, always: "Not verified yet" when there is no row or no value.
 *
 * What it shows is decided in code (visaFundsView): the rule text with its computed badge, the amount in its own
 * currency when the source gives one, a PKR line only through a Verified/Likely exchange rate ("No verified PKR
 * rate yet" otherwise), how the money is checked, the student note, the source link and the verbatim evidence.
 * It is never ranked: countries count this money differently. Data is plain text only; review_note is never read.
 */
import { VISA_FUNDS_NOT_RANKED, visaFundsView, type VisaFundsView } from '@/lib/citizenship';
import type { CountryFact, CountryFactValue, FxRate } from '@/lib/types';
import { ConfidenceBadge } from '@/components/ui/badges';
import { FactInline } from '@/components/ui/fact';
import { ConflictSources, EmptyFactDetails, ValueDetails } from './fact-parts';

/** "Label: value" line, styled like the other detail lines (one text node for the label). */
function DetailLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="mt-1 block text-sm break-words">
      <span className="font-semibold text-heading">{`${label}: `}</span>
      {children}
    </span>
  );
}

function PkrLine({ pkr }: { pkr: NonNullable<VisaFundsView['pkr']> }) {
  if (!pkr.ok) {
    return (
      <DetailLine label="In Pakistani rupees">
        <span className="text-muted">{pkr.text}</span>
      </DetailLine>
    );
  }
  return (
    <DetailLine label="In Pakistani rupees">
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span className="text-ink">{pkr.text}</span>
        <ConfidenceBadge confidence={pkr.confidence} />
      </span>
      <span className="mt-0.5 block text-xs text-muted">{pkr.detail}</span>
    </DetailLine>
  );
}

export function VisaFundsBlock({
  fact,
  fx,
  now,
  compact = false,
}: {
  fact: CountryFact | null;
  fx: FxRate[];
  now: Date;
  /** Table cell: short evidence toggle label and smaller note. */
  compact?: boolean;
}) {
  const view = visaFundsView(fact, fx, now);
  return (
    <div className="break-words" data-block="visa-funds">
      {view.state === 'conflict' && fact ? (
        <div className="space-y-2">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-conflict-fg">Official sources disagree</span>
            <ConfidenceBadge confidence="Conflict" />
          </span>
          <ConflictSources fact={fact} kind="money" compact={compact} />
        </div>
      ) : (
        <>
          <FactInline<CountryFactValue> fact={fact} now={now} render={(x) => x.text} />
          {view.amount ? <DetailLine label="Amount">{view.amount}</DetailLine> : null}
          {view.pkr ? <PkrLine pkr={view.pkr} /> : null}
          {fact && fact.value != null ? (
            <ValueDetails
              fact={fact}
              v={fact.value}
              conf={view.confidence}
              clock={false}
              clockLabel="How it is checked"
              compact={compact}
            />
          ) : (
            <EmptyFactDetails fact={fact} compact={compact} />
          )}
        </>
      )}
      <span className="mt-1 block text-xs text-muted">{VISA_FUNDS_NOT_RANKED}</span>
    </div>
  );
}
