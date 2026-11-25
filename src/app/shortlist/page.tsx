/**
 * Screen 3: Shortlist. Server component, rendered per request (profile from cookie or query, filters in the URL).
 * Code decides everything here: fit, ranking, filters and cost come from src/lib/shortlist over data rows.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { LoadPersonaButtons } from '@/components/demo/load-persona';
import { ClosingSoon } from '@/components/shortlist/closing-soon';
import { Filters, RankChips } from '@/components/shortlist/controls';
import { CoverageMeter } from '@/components/shortlist/coverage-meter';
import { EmptyFieldCard } from '@/components/shortlist/empty-field';
import { ProgramCard, ReasonNote, RuledOutCard } from '@/components/shortlist/program-card';
import { ProgramTable } from '@/components/shortlist/program-table';
import { ShareShortlist } from '@/components/shortlist/share-shortlist';
import { UniversityContextCard } from '@/components/university/context-card';
import { ButtonLink } from '@/components/ui/button';
import { Callout, Card, PageHeader } from '@/components/ui/card';
import { BadgeLegend } from '@/components/ui/legend';
import { getDataset } from '@/lib/data';
import { getNow, getRequestProfileState } from '@/lib/profile-server';
import {
  CLEAR_FILTERS,
  RANK_LABEL,
  buildShortlist,
  closingSoon,
  emptyRankedMessage,
  hiddenSummary,
  listedCount,
  parseShortlistQuery,
  planBTargetHref,
  profileQueryString,
  profileShortlistPath,
  profileSummaryParts,
  shortlistHref,
  type RawSearchParams,
  type Shortlist,
} from '@/lib/shortlist';

export const metadata: Metadata = {
  title: 'Your shortlist',
  description: 'Masters programs ranked by plain code over verified data. Missing data is shown, never guessed.',
};

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div>
        <h2 id={id} className="text-xl font-bold">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function NoProfile() {
  return (
    <div>
      <PageHeader title="Your shortlist" subtitle="Programs that match your grade, field and budget, checked against official pages." />
      <Card>
        <h2 className="text-lg font-bold">Start with your profile</h2>
        <p className="mt-1 text-sm text-muted">
          Tell us your grade, field, budget and countries. It takes about a minute. No passport or ID number needed.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ButtonLink href="/onboarding">Add my profile</ButtonLink>
          <LoadPersonaButtons compact />
        </div>
      </Card>
    </div>
  );
}

/** "Hidden by your filters" line with the right way back: clear the filters, or show every country. */
function HiddenNote({ s, sp }: { s: Shortlist; sp: RawSearchParams }) {
  const text = hiddenSummary(s);
  if (!text) return null;
  const linkClass = 'inline-flex min-h-tap items-center font-semibold md:min-h-0';
  return (
    <p className="text-sm text-muted">
      {text}{' '}
      {s.activeFilterCount > 0 ? (
        <Link href={shortlistHref(sp, { ...CLEAR_FILTERS, panel: null })} scroll={false} prefetch={false} className={linkClass}>
          Clear filters
        </Link>
      ) : s.hidden.country > 0 && s.filters.countrySource === 'profile' ? (
        <Link href={shortlistHref(sp, { country: 'all', panel: null })} scroll={false} prefetch={false} className={linkClass}>
          Show all countries
        </Link>
      ) : null}
    </p>
  );
}

export default async function ShortlistPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const { profile, linkRejected } = await getRequestProfileState(sp);
  if (!profile) return <NoProfile />;

  const now = getNow();
  const data = await getDataset();
  const s = buildShortlist({ ...data, profile, now, query: parseShortlistQuery(sp) });

  const pq = profileQueryString(sp);
  const detailsHref = (id: string) => `/program/${encodeURIComponent(id)}${pq}`;
  const planBHref = (id: string) => planBTargetHref(pq, id);
  const rankLabel = RANK_LABEL[s.query.rank];
  const clearHref = shortlistHref(sp, { ...CLEAR_FILTERS, panel: null });
  const listed = listedCount(s);

  return (
    <div className="space-y-6">
      {linkRejected ? (
        <Callout tone="neutral">We could not read the profile in this link, so we show the profile saved on this device.</Callout>
      ) : null}
      <PageHeader
        title="Your shortlist"
        subtitle={
          <>
            <span className="break-words">{profileSummaryParts(profile).join(' · ')}</span>{' '}
            <Link href="/onboarding" className="inline-flex min-h-tap items-center px-1 font-semibold md:min-h-0">
              Edit<span className="sr-only"> your profile</span>
            </Link>
          </>
        }
      >
        <ul className="mt-1 flex flex-wrap gap-x-4 text-sm">
          <li>
            <Link href="/citizenship" className="inline-flex min-h-tap items-center font-semibold">
              Compare citizenship rules and costs<span aria-hidden="true">&nbsp;→</span>
            </Link>
          </li>
          <li>
            <Link href="/saved" className="inline-flex min-h-tap items-center font-semibold">
              Saved programs<span aria-hidden="true">&nbsp;→</span>
            </Link>
          </li>
        </ul>
      </PageHeader>

      <CoverageMeter coverage={s.coverage} fieldLabel={s.field.label} />

      {s.noProgramsForField ? (
        <EmptyFieldCard shortlist={s} profile={profile} />
      ) : (
        <>
          <ClosingSoon rows={closingSoon(s, now)} detailsHref={detailsHref} />

          <section aria-labelledby="controls-heading" className="space-y-3">
            <h2 id="controls-heading" className="text-sm font-semibold text-muted">
              Rank by
            </h2>
            <RankChips sp={sp} shortlist={s} />
            <Filters sp={sp} shortlist={s} profile={profile} />
          </section>

          <div className="space-y-2">
            <p role="status" aria-live="polite" className="text-sm font-semibold text-ink">
              {s.ranked.length} ranked by {rankLabel.toLowerCase()} · {s.notRanked.length} not ranked (data missing)
              {s.cantCheck.length > 0 ? ` · ${s.cantCheck.length} can't check` : ''}
              {s.ruledOut.length > 0 ? ` · ${s.ruledOut.length} ruled out` : ''}
            </p>
            <p className="text-sm text-muted">Only verified or likely values are ranked. Missing data is never treated as zero.</p>
            <HiddenNote s={s} sp={sp} />
            {s.filters.budgetUnavailable ? (
              <Callout tone="neutral">
                &ldquo;Within my budget&rdquo; needs a budget in your profile.{' '}
                <Link href="/onboarding" className="font-semibold">
                  Add your budget
                </Link>
              </Callout>
            ) : null}
          </div>

          <Section id="ranked-heading" title={`Ranked by ${rankLabel} (${s.ranked.length})`}>
            {s.ranked.length === 0 ? (
              <Callout tone="neutral">
                {emptyRankedMessage(s)}
                {listed === 0 && s.activeFilterCount > 0 ? (
                  <>
                    {' '}
                    <Link href={clearHref} scroll={false} prefetch={false} className="font-semibold">
                      Clear filters
                    </Link>
                  </>
                ) : null}
              </Callout>
            ) : (
              <>
                <ol className="space-y-3 md:hidden">
                  {s.ranked.map((r) => (
                    <li key={r.program.id}>
                      <ProgramCard
                        row={r}
                        now={now}
                        rank={r.rank}
                        rankKey={r.key}
                        rankBy={s.query.rank}
                        detailsHref={detailsHref(r.program.id)}
                        planBHref={planBHref(r.program.id)}
                      />
                    </li>
                  ))}
                </ol>
                <ProgramTable
                  rows={s.ranked}
                  now={now}
                  rankBy={s.query.rank}
                  caption={`Programs ranked by ${rankLabel}`}
                  detailsHref={detailsHref}
                  planBHref={planBHref}
                />
              </>
            )}
          </Section>

          {s.notRanked.length > 0 ? (
            <Section
              id="not-ranked-heading"
              title={`Not ranked: data missing (${s.notRanked.length})`}
              description={`These programs are not hidden. We will not guess the value needed to rank them by ${rankLabel.toLowerCase()}.`}
            >
              <ul className="space-y-3 md:hidden">
                {s.notRanked.map((r) => (
                  <li key={r.program.id}>
                    <ProgramCard
                      row={r}
                      now={now}
                      rankBy={s.query.rank}
                      detailsHref={detailsHref(r.program.id)}
                      planBHref={planBHref(r.program.id)}
                      note={<ReasonNote title="Not ranked because" reasons={[r.reason]} />}
                    />
                  </li>
                ))}
              </ul>
              <ProgramTable
                rows={s.notRanked.map((r) => ({ ...r, reasons: [r.reason] }))}
                now={now}
                rankBy={s.query.rank}
                caption="Programs not ranked because data is missing"
                reasonHeader="Why not ranked"
                detailsHref={detailsHref}
                planBHref={planBHref}
              />
            </Section>
          ) : null}

          {s.cantCheck.length > 0 ? (
            <Section
              id="cant-check-heading"
              title={`Can't check: data missing (${s.cantCheck.length})`}
              description="Your filters need data these programs do not have yet, or that we can't compare. They are not hidden and not counted as a match."
            >
              <ul className="space-y-3 md:hidden">
                {s.cantCheck.map((r) => (
                  <li key={r.program.id}>
                    <ProgramCard
                      row={r}
                      now={now}
                      rankBy={s.query.rank}
                      detailsHref={detailsHref(r.program.id)}
                      planBHref={planBHref(r.program.id)}
                      note={<ReasonNote title="We can't check this filter" reasons={r.reasons} />}
                    />
                  </li>
                ))}
              </ul>
              <ProgramTable
                rows={s.cantCheck}
                now={now}
                rankBy={s.query.rank}
                caption="Programs your filters cannot check yet"
                reasonHeader="Why we can't check"
                detailsHref={detailsHref}
                planBHref={planBHref}
              />
            </Section>
          ) : null}

          {s.ruledOut.length > 0 ? (
            <Section
              id="ruled-out-heading"
              title={`Ruled out (${s.ruledOut.length})`}
              description="Listed so you know why. Never ranked. Check the note and the official page."
            >
              <ul className="grid gap-3 md:grid-cols-2">
                {s.ruledOut.map((r) => (
                  <li key={r.program.id}>
                    <RuledOutCard row={r} now={now} detailsHref={detailsHref(r.program.id)} />
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <ShareShortlist path={profileShortlistPath(profile, { rank: s.query.rank, dir: s.query.dir })} />

          <details className="rounded-card border border-line bg-surface p-4">
            <summary className="inline-flex min-h-tap cursor-pointer items-center font-semibold text-primary-ink">
              What do the labels mean?
            </summary>
            <div className="mt-2">
              <BadgeLegend />
            </div>
          </details>
        </>
      )}

      {/* Below the results on purpose: on a phone the programs come first. */}
      <UniversityContextCard universityId={profile.university_id} universityName={profile.university_name} />
    </div>
  );
}
