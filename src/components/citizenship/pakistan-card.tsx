/**
 * Pakistan's own rules on holding another nationality (from the PK `pakistan_dual_nationality` fact).
 * Today the row is Unverified, so it reads "Not verified yet". No link is shown unless the data has one.
 */
import { computeConfidence } from '@/lib/confidence';
import { FACT_LABELS } from '@/lib/citizenship';
import type { CountryFact } from '@/lib/types';
import { CountryFactRow } from './fact-parts';

export function PakistanNationalityCard({ fact, now }: { fact: CountryFact; now: Date }) {
  const conf = computeConfidence(fact, now);
  return (
    <section aria-labelledby="pk-nationality-heading" className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h2 id="pk-nationality-heading" className="text-xl font-bold">
        Pakistan&apos;s rules on holding another nationality
      </h2>
      <p className="mt-1 text-sm text-muted">
        Whether you can hold two nationalities depends on Pakistan&apos;s rules as well as the other country&apos;s.
      </p>
      <dl className="mt-2">
        <CountryFactRow label={FACT_LABELS.pakistan_dual_nationality} fact={fact} now={now} />
      </dl>
      <p className="mt-2 rounded-button border-l-4 border-primary bg-surface-tint p-3 text-sm text-ink">
        {conf === 'Verified'
          ? 'Check the official Government of Pakistan source again before you apply for another citizenship.'
          : 'We have not verified this yet. Check the official Government of Pakistan source before you apply for another citizenship.'}{' '}
        This is not legal advice.
      </p>
    </section>
  );
}
