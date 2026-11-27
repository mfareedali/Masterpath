/**
 * Screen 3: Shortlist. Server component, rendered per request (profile from cookie or query, filters in the URL).
 * Code decides everything here: fit, ranking, filters and cost come from src/lib/shortlist over data rows.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { LoadPersonaButtons } from '@/components/demo/load-persona';
import { ClosingSoon } from '@/components/shortlist/closing-soon';
import { Filters, RankChips } from '@/components/shortlist/controls';
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
  sortedByText,
  urgentBadgeText,
  urgentDeadlines,
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
  description: 'Masters programs sorted by plain code over official data. Every number links to its official page.',
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
    <section aria-labelledby={id} className="scroll-mt-20 space-y-3">
      <div className="border-b border-line pb-2">
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
      <PageHeader
        step="shortlist"
        title="Your shortlist"
        subtitle="Programs that match your grade, field and budget. Every number links to its official page."
        action={<ButtonLink href="/onboarding">Add my profile</ButtonLink>}
      />
      <Card>
        <h2 className="text-lg font-bold">Start with your profile</h2>
        <p className="mt-1 text-sm text-muted">
          Tell us your grade, field, budget and countries. It takes about a minute. No passport or ID number needed.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
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
  const closing = closingSoon(s, now);
  const urgent = urgentDeadlines(closing);
  const more = [...s.notRanked, ...s.cantCheck];
  const cardProps = (r: (typeof more)[number] | (typeof s.ranked)[number]) => ({
    row: r,
    now,
    rankBy: s.query.rank,
    detailsHref: detailsHref(r.program.id),
    planBHref: planBHref(r.program.id),
  });

  return (
    <div className="space-y-6">
      {linkRejected ? (
        <Callout tone="neutral">We could not read the profile in this link, so we show the profile saved on this device.</Callout>
      ) : null}
      <PageHeader
        step="shortlist"
        title="Your shortlist"
        subtitle="Programs for your grade, field and budget. Every number links to its official page."
      >
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {profileSummaryParts(profile).map((part) => (
            <span key={part} className="inline-flex items-center rounded-chip border border-line bg-surface px-3 py-1 text-sm text-ink break-words">
              {part}
            </span>
          ))}
          <Link href="/onboarding" className="inline-flex min-h-tap items-center px-1 font-semibold md:min-h-0">
            Edit<span className="sr-only"> your profile</span>
          </Link>
        </div>
        {urgent.length > 0 && !s.noProgramsForField ? (
          <p className="mt-3">
            <a
              href="#closing-soon-heading"
              className="inline-flex min-h-tap items-center gap-1.5 rounded-chip border border-conflict-fg bg-conflict-bg px-3 text-sm font-semibold text-conflict-fg no-underline md:min-h-0 md:py-1"
              data-urgent-deadlines=""
            >
              <span aria-hidden="true">⏰</span>
              {urgentBadgeText(urgent.length)}
            </a>
          </p>
        ) : null}
      </PageHeader>

      {s.noProgramsForField ? (
        <EmptyFieldCard shortlist={s} profile={profile} />
      ) : (
        <>
          <section aria-labelledby="controls-heading" className="space-y-3 rounded-card border border-line bg-surface/70 p-4 shadow-card">
            <h2 id="controls-heading" className="text-sm font-semibold text-muted">
              Rank by
            </h2>
            <RankChips sp={sp} shortlist={s} />
            <Filters sp={sp} shortlist={s} profile={profile} />
          </section>

          <div className="space-y-2">
            <p role="status" aria-live="polite" className="sr-only">
              {listed} program{listed === 1 ? '' : 's'} shown, sorted by {rankLabel.toLowerCase()}
              {s.ruledOut.length > 0 ? ` · ${s.ruledOut.length} ruled out` : ''}
            </p>
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

          <Section
            id="programs-heading"
            title={s.ranked.length > 0 ? `Your programs (${listed})` : `Programs to explore (${listed})`}
            description={s.ranked.length > 0 ? sortedByText(s.query.rank, s.query.dir) : undefined}
          >
            {listed === 0 ? (
              <Callout tone="neutral">
                {emptyRankedMessage(s)}
                {s.activeFilterCount > 0 ? (
                  <>
                    {' '}
                    <Link href={clearHref} scroll={false} prefetch={false} className="font-semibold">
                      Clear filters
                    </Link>
                  </>
                ) : null}
              </Callout>
            ) : null}

            {s.ranked.length > 0 ? (
              <>
                <ol className="space-y-3 md:hidden" data-program-list="ordered">
                  {s.ranked.map((r) => (
                    <li key={r.program.id}>
                      <ProgramCard {...cardProps(r)} rank={r.rank} rankKey={r.key} />
                    </li>
                  ))}
                </ol>
                <ProgramTable
                  rows={s.ranked}
                  now={now}
                  rankBy={s.query.rank}
                  caption={`Programs sorted by ${rankLabel}`}
                  detailsHref={detailsHref}
                  planBHref={planBHref}
                />
              </>
            ) : null}

            {more.length > 0 ? (
              <>
                {s.ranked.length > 0 ? (
                  <div className="flex items-center gap-3 pt-2" data-more-programs="">
                    <hr className="flex-1 border-line" />
                    <h3 className="text-sm font-semibold text-muted">More programs to explore</h3>
                    <hr className="flex-1 border-line" />
                  </div>
                ) : null}
                <ul className="space-y-3 md:hidden" data-program-list="more">
                  {more.map((r) => (
                    <li key={r.program.id}>
                      <ProgramCard
                        {...cardProps(r)}
                        note={'reasons' in r ? <ReasonNote title="To use your filters, check on the official page" reasons={r.reasons} /> : null}
                      />
                    </li>
                  ))}
                </ul>
                <ProgramTable
                  rows={more}
                  now={now}
                  rankBy={s.query.rank}
                  caption="More programs to explore"
                  detailsHref={detailsHref}
                  planBHref={planBHref}
                />
              </>
            ) : null}
          </Section>

          {s.ruledOut.length > 0 ? (
            <Section
              id="ruled-out-heading"
              title={`Not open to you (${s.ruledOut.length})`}
              description="Listed so you know why. Check the note and the official page."
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

          <div id="closing-soon" className="scroll-mt-20">
            <ClosingSoon rows={closing} detailsHref={detailsHref} />
          </div>

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
