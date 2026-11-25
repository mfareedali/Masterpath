/**
 * "Who this course is for" warning at the top of the program page (server component).
 * Shown only when eligibility_note is usable (Verified or Likely). It is a warning to read, never an input to
 * the fit label. Values are plain text (React escapes them); the internal review_note is never read here.
 */
import { ConfidenceBadge } from '@/components/ui/badges';
import { Callout } from '@/components/ui/card';
import { SourceLink } from '@/components/ui/fact';
import { computeConfidence, isUsable } from '@/lib/confidence';
import { FACT_LABEL, FACT_SECTIONS } from '@/lib/program/fields';
import { factLines } from '@/lib/program/render';
import type { Fact } from '@/lib/types';
import { Lines } from './fact-section';

export function EligibilityCallout({ fact, now }: { fact: Fact<string> | null | undefined; now: Date }) {
  const confidence = computeConfidence(fact, now);
  const value = fact?.value?.trim() ?? '';
  if (!fact || !isUsable(confidence) || !value) return null;
  const note = fact.note?.trim() ?? '';

  return (
    <section aria-label={FACT_LABEL.eligibility_note} className="mb-4">
      <Callout tone="warning" title={FACT_LABEL.eligibility_note}>
        <p className="text-base text-ink">
          <Lines lines={factLines('eligibility_note', value)} />
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <ConfidenceBadge confidence={confidence} />
          <SourceLink url={fact.source_url} />
          <a
            href={`#${FACT_SECTIONS.entry.id}`}
            className="inline-flex min-h-tap items-center text-sm font-semibold md:min-h-0"
          >
            See the evidence
          </a>
        </div>
        {note ? <p className="mt-1 text-xs text-muted">Note: {note}</p> : null}
        <p className="mt-2 text-sm text-ink">
          Check that your own degree matches before you apply. Your fit label below only compares grades, so it does
          not check this.
        </p>
      </Callout>
    </section>
  );
}
