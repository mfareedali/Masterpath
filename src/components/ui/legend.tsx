import { CONFIDENCE_HELP } from '@/lib/confidence';
import type { Confidence, FitLabel } from '@/lib/types';
import { BlockedBadge, ConfidenceBadge, FitBadge } from './badges';

const CONFS: Confidence[] = ['Verified', 'Likely', 'Unverified', 'Conflict'];
const FITS: { label: FitLabel; help: string }[] = [
  { label: 'Meets minimum', help: 'Your converted grade is at or above the verified minimum.' },
  { label: 'Competitive range unknown', help: 'No confirmed minimum yet, or your grade range crosses it. Check the official page.' },
  { label: 'Below minimum', help: 'Your converted grade is below the verified minimum. See Plan B.' },
];

/** Badge legend: what each label means. No admission percentages anywhere. */
export function BadgeLegend({ showFit = true }: { showFit?: boolean }) {
  return (
    <div className="space-y-3 text-sm">
      <ul className="space-y-2">
        {CONFS.map((c) => (
          <li key={c} className="flex items-start gap-2">
            <ConfidenceBadge confidence={c} className="mt-0.5 shrink-0" />
            <span className="text-muted">{CONFIDENCE_HELP[c]}</span>
          </li>
        ))}
        <li className="flex items-start gap-2">
          <BlockedBadge className="mt-0.5 shrink-0" />
          <span className="text-muted">Not on the destination&apos;s official recognition list. Hard-blocked in Plan B.</span>
        </li>
      </ul>
      {showFit ? (
        <ul className="space-y-2 border-t border-line pt-3">
          {FITS.map((f) => (
            <li key={f.label} className="flex items-start gap-2">
              <FitBadge label={f.label} className="mt-0.5 shrink-0" />
              <span className="text-muted">{f.help}</span>
            </li>
          ))}
          <li className="text-xs text-muted">We never show admission chances as percentages.</li>
        </ul>
      ) : null}
    </div>
  );
}
