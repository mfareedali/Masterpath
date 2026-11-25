/** "X of N programs verified" meter. Server component; counts come from computeCoverage (code, not copy). */
import { VERIFIED_MAX_AGE_DAYS } from '@/lib/confidence';
import type { Coverage } from '@/lib/shortlist';

export function CoverageMeter({ coverage, fieldLabel }: { coverage: Coverage; fieldLabel: string }) {
  const { verified, total } = coverage;
  const others = coverage.byField.filter((f) => f.total > 0);
  return (
    <section aria-labelledby="coverage-heading" className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h2 id="coverage-heading" className="text-base font-bold">
        How much is verified
      </h2>
      <p className="mt-1 text-sm text-ink">
        <strong>
          {verified} of {total}
        </strong>{' '}
        {fieldLabel} programs fully verified
      </p>
      <progress
        value={verified}
        max={Math.max(total, 1)}
        aria-label={`${verified} of ${total} ${fieldLabel} programs fully verified`}
        className="mt-2 block h-2 w-full appearance-none overflow-hidden rounded-chip bg-surface-tint [&::-moz-progress-bar]:bg-evidence-bar [&::-webkit-progress-bar]:bg-surface-tint [&::-webkit-progress-value]:bg-evidence-bar"
      />
      <p className="mt-2 text-sm text-ink">
        <strong>{coverage.facts.verified}</strong> of {coverage.facts.total} individual facts verified
        {coverage.facts.likely ? `, ${coverage.facts.likely} likely` : ''}.
      </p>
      <p className="mt-2 text-xs text-muted">
        Fully verified means the minimum grade, deadline, tuition and English test were copied from the official page in
        the last {VERIFIED_MAX_AGE_DAYS} days.
      </p>
      {others.length > 1 ? (
        <details className="mt-2 text-sm">
          <summary className="inline-flex min-h-tap cursor-pointer items-center font-semibold text-primary-ink">By field</summary>
          <ul className="mt-1 space-y-1">
            {others.map((f) => (
              <li key={f.field} className="flex justify-between gap-3">
                <span>{f.label}</span>
                <span className="text-muted">
                  {f.verified} of {f.total}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
