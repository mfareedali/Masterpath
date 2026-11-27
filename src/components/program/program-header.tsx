import { Pill } from '@/components/ui/badges';
import { NotVerified, SourceLink } from '@/components/ui/fact';
import { JourneyCue } from '@/components/ui/journey';
import { BadgeLegend } from '@/components/ui/legend';
import { ScrollSpy } from '@/components/ui/scroll-spy';
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
      <JourneyCue current="check" />
      <BackToShortlistLink />
      <div className="rounded-panel border border-line bg-surface p-5 shadow-card md:p-6">
        <ul className="flex flex-wrap gap-2" aria-label="Program summary">
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
        <h1 className="mt-3 break-words text-2xl font-bold md:text-4xl">{program.name}</h1>
        <p className="mt-1 break-words text-base text-ink md:text-lg">{institution?.name ?? 'University not listed yet'}</p>

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="relative rounded-button border border-line bg-page p-3 pl-4 before:absolute before:inset-y-3 before:left-0 before:w-1 before:rounded-r-chip before:bg-evidence-bar before:content-[''] sm:col-span-1">
            <dt className="text-xs font-semibold text-muted">Coverage</dt>
            <dd>
              <p className="text-sm font-semibold text-heading">{coverageLine(coverage)}</p>
              <div aria-hidden="true" className="mt-2 flex h-2 overflow-hidden rounded-chip bg-surface-tint">
                <div className="h-2 bg-evidence-bar" style={{ width: `${verifiedPct}%` }} />
                <div className="h-2 bg-likely-fg" style={{ width: `${likelyPct}%` }} />
              </div>
              {detail ? <p className="mt-2 text-xs text-muted">{detail}</p> : null}
            </dd>
          </div>
          <div className="rounded-button border border-line bg-page p-3">
            <dt className="text-xs font-semibold text-muted">Official program page</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-x-3 text-sm">
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
          <div className="rounded-button border border-line bg-page p-3">
            <dt className="text-xs font-semibold text-muted">Last checked</dt>
            <dd className="mt-1 text-sm font-semibold text-heading">
              {program.last_checked ? formatDate(program.last_checked) : 'Not checked yet'}
            </dd>
          </div>
        </dl>

        <details className="mt-2">
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

/**
 * In-page jump links: a sticky scroll-spy bar (src/components/ui/scroll-spy.tsx). The server renders plain anchors,
 * so it works without JS; the page wrapper needs `has-scroll-spy` for the scroll margin.
 */
export function JumpLinks({ links }: { links: readonly { id: string; label: string }[] }) {
  return <ScrollSpy sections={links} className="mb-4" />;
}
