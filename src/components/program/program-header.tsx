import { Pill } from '@/components/ui/badges';
import { NotVerified, SourceLink } from '@/components/ui/fact';
import { BadgeLegend } from '@/components/ui/legend';
import { chipClass } from '@/components/ui/chip';
import { countryName, formatDate, safeHref } from '@/lib/format';
import { coverageDetail, coverageLine, type Coverage } from '@/lib/program/fields';
import { PATHWAY_LABEL } from '@/lib/program/render';
import type { Institution, Program } from '@/lib/types';
import { BackToShortlistLink } from './back-link';

/** Program page header: name (the page's only h1), institution, pills, official page, last checked, coverage. */
export function ProgramHeader({
  program,
  institution,
  coverage,
}: {
  program: Program;
  institution: Institution | null;
  coverage: Coverage;
}) {
  const officialHref = safeHref(program.official_url);
  const verifiedPct = coverage.total ? Math.round((coverage.verified / coverage.total) * 100) : 0;
  const likelyPct = coverage.total ? Math.round((coverage.likely / coverage.total) * 100) : 0;
  const detail = coverageDetail(coverage);

  return (
    <header className="mb-4">
      <BackToShortlistLink />
      <h1 className="break-words text-2xl font-bold md:text-3xl">{program.name}</h1>
      <p className="mt-1 break-words text-base text-ink">{institution?.name ?? 'University not listed yet'}</p>

      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Program summary">
        <li>
          <Pill>{countryName(program.country)}</Pill>
        </li>
        <li>
          <Pill>{program.degree}</Pill>
        </li>
        <li>
          <Pill>{PATHWAY_LABEL[program.pathway_type] ?? program.pathway_type}</Pill>
        </li>
      </ul>

      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex flex-wrap items-center gap-x-2">
          <dt className="text-muted">Official program page:</dt>
          <dd className="flex flex-wrap items-center gap-x-3">
            {officialHref ? (
              <SourceLink url={officialHref} label="Open the official page" />
            ) : (
              <>
                <NotVerified compact />
                {institution?.website ? <SourceLink url={institution.website} label="University website" /> : null}
              </>
            )}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-2">
          <dt className="text-muted">Last checked:</dt>
          <dd>{program.last_checked ? formatDate(program.last_checked) : 'Not checked yet'}</dd>
        </div>
      </dl>

      <div className="mt-3 rounded-card border border-line bg-surface p-3">
        <p className="text-sm font-semibold text-heading">{coverageLine(coverage)}</p>
        <div aria-hidden="true" className="mt-2 flex h-2 overflow-hidden rounded-chip bg-surface-tint">
          <div className="h-2 bg-evidence-bar" style={{ width: `${verifiedPct}%` }} />
          <div className="h-2 bg-likely-fg" style={{ width: `${likelyPct}%` }} />
        </div>
        {detail ? <p className="mt-2 text-xs text-muted">{detail}</p> : null}
        <details className="mt-1">
          <summary className="min-h-tap cursor-pointer py-2 text-sm font-semibold text-primary-ink">
            What do the badges mean?
          </summary>
          <div className="pt-1">
            <BadgeLegend />
          </div>
        </details>
      </div>
    </header>
  );
}

/** In-page jump links (plain anchors, no JS). */
export function JumpLinks({ links }: { links: readonly { id: string; label: string }[] }) {
  return (
    <nav aria-label="On this page" className="mb-4">
      <div className="chip-row -mx-4 px-4 md:mx-0 md:px-0">
        {links.map((l) => (
          <a key={l.id} href={`#${l.id}`} className={chipClass(false)}>
            {l.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
