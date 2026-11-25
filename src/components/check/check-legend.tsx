/** What the Consultant Check labels mean. Server component, collapsed by default. */
import { ConfidenceBadge } from '@/components/ui/badges';
import { CONFIDENCE_HELP } from '@/lib/confidence';
import { SUMMARY_VERDICT_HELP, SUMMARY_VERDICT_LABEL, VERDICT_HELP, VERDICT_ORDER } from '@/lib/consultant/compare';
import type { Confidence } from '@/lib/types';
import { VerdictBadge } from './verdict-badge';

const CONFS: Confidence[] = ['Verified', 'Likely', 'Unverified', 'Conflict'];

export function CheckLegend() {
  return (
    <details className="rounded-card border border-line bg-surface p-4">
      <summary className="min-h-tap cursor-pointer py-2 font-semibold text-primary-ink">What the labels mean</summary>
      <div className="mt-2 space-y-4 text-sm">
        <ul className="space-y-2">
          {VERDICT_ORDER.map((v) => (
            <li key={v} className="flex flex-wrap items-start gap-2">
              <VerdictBadge verdict={v} className="mt-0.5 shrink-0" />
              <span className="min-w-0 text-muted">{VERDICT_HELP[v]}</span>
            </li>
          ))}
          {(['conflict', 'matches'] as const).map((v) => (
            <li key={`summary-${v}`} className="flex flex-wrap items-start gap-2">
              <VerdictBadge verdict={v} label={SUMMARY_VERDICT_LABEL[v]} className="mt-0.5" />
              <span className="min-w-0 text-muted">{SUMMARY_VERDICT_HELP}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          In our answers, quotation marks are used only for words copied exactly from an official page. Text after “In short:” is our own wording.
        </p>
        <div className="border-t border-line pt-3">
          <p className="mb-2 font-semibold text-heading">How sure we are about each official value</p>
          <ul className="space-y-2">
            {CONFS.map((c) => (
              <li key={c} className="flex items-start gap-2">
                <ConfidenceBadge confidence={c} className="mt-0.5 shrink-0" />
                <span className="text-muted">{CONFIDENCE_HELP[c]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Only Verified and Likely values are used to compare. Unverified values are never used.</p>
        </div>
      </div>
    </details>
  );
}
