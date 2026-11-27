/** "X of N programs verified" meter. Server component; counts come from computeCoverage (code, not copy). */
import { VERIFIED_MAX_AGE_DAYS } from '@/lib/confidence';
import type { Coverage } from '@/lib/shortlist';

export function CoverageMeter({ coverage, fieldLabel }: { coverage: Coverage; fieldLabel: string }) {
  const { verified, total } = coverage;
  const others = coverage.byField.filter((f) => f.total > 0);
  const factPct = coverage.facts.total ? Math.round((coverage.facts.verified / coverage.facts.total) * 100) : 0;
  const likelyPct = coverage.facts.total ? Math.round((coverage.facts.likely / coverage.facts.total) * 100) : 0;
  return (
    <section aria-labelledby="coverage-heading" className="rounded-card border border-line bg-surface p-4 shadow-card md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="coverage-heading" className="text-base font-bold">
          How much is verified
        </h2>
        <p className="text-xs text-muted">Verified = copied from the official page in the last {VERIFIED_MAX_AGE_DAYS} days</p>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="relative rounded-button border border-line bg-page p-3 pl-4 before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-chip before:bg-evidence-bar before:content-['']">
          <p className="text-sm text-ink">
            <strong className="text-2xl font-bold tabular-nums text-heading">
              {verified} of {total}
            </strong>{' '}
            <span className="block sm:inline">{fieldLabel} programs fully verified</span>
          </p>
          <progress
            value={verified}
            max={Math.max(total, 1)}
            aria-label={`${verified} of ${total} ${fieldLabel} programs fully verified`}
            className="mt-2 block h-2 w-full appearance-none overflow-hidden rounded-chip bg-surface-tint [&::-moz-progress-bar]:bg-evidence-bar [&::-webkit-progress-bar]:bg-surface-tint [&::-webkit-progress-value]:bg-evidence-bar"
          />
        </div>
        <div className="rounded-button border border-line bg-page p-3 pl-4">
          <p className="text-sm text-ink">
            <strong className="text-2xl font-bold tabular-nums text-heading">{coverage.facts.verified}</strong> of{' '}
            {coverage.facts.total} individual facts verified
            {coverage.facts.likely ? `, ${coverage.facts.likely} likely` : ''}.
          </p>
          <div aria-hidden="true" className="mt-2 flex h-2 overflow-hidden rounded-chip bg-surface-tint">
            <div className="h-2 bg-evidence-bar" style={{ width: `${factPct}%` }} />
            <div className="h-2 bg-likely-fg" style={{ width: `${likelyPct}%` }} />
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted">
        Fully verified means the minimum grade, deadline, tuition and English test were copied from the official page in
        the last {VERIFIED_MAX_AGE_DAYS} days.
      </p>
      {others.length > 1 ? (
        <details className="mt-1 text-sm">
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
