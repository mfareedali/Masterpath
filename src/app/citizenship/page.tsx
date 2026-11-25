/**
 * Screen 6 — Citizenship and cost. Server component (dynamic: reads searchParams + the profile cookie).
 * Ranking is plain code over country_facts rows (rankCountries -> rankItems). No AI decides anything here.
 */
import type { Metadata } from 'next';
import { ChatPanel } from '@/components/chat/chat-panel';
import { CountryCard, type CountryEntry } from '@/components/citizenship/country-card';
import { CountryTable } from '@/components/citizenship/country-table';
import { PakistanNationalityCard } from '@/components/citizenship/pakistan-card';
import { RankControls } from '@/components/citizenship/rank-controls';
import { HowRankingWorks } from '@/components/citizenship/ranking-help';
import { Callout, PageHeader } from '@/components/ui/card';
import { BadgeLegend } from '@/components/ui/legend';
import {
  CITIZENSHIP_CALLOUT,
  buildCountryRows,
  pakistanDualNationality,
  parseCitizenshipQuery,
  rankCountries,
  rankOption,
  rankingSummary,
} from '@/lib/citizenship';
import { getCountryFacts, getFxRates } from '@/lib/data';
import { getNow, getRequestProfile } from '@/lib/profile-server';

export const metadata: Metadata = {
  title: 'Citizenship and cost',
  description:
    'Compare the earliest citizenship rule, post-study work, typical yearly costs and the money to show for the student visa by country. Every value links to its official source. Not immigration advice.',
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function CitizenshipPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const query = parseCitizenshipQuery(sp);
  const now = getNow();
  const [facts, fx, profile] = await Promise.all([getCountryFacts(), getFxRates(), getRequestProfile(sp)]);

  const rows = buildCountryRows(facts);
  const ranking = rankCountries(rows, query, fx, now);
  const pkFact = pakistanDualNationality(facts);
  const targets = new Set<string>(profile?.target_countries ?? []);
  const opt = rankOption(query.rank);

  const ranked: CountryEntry[] = ranking.ranked.map((r) => ({ row: r.row, key: r.key, rank: r.rank }));
  const notRanked: CountryEntry[] = ranking.notRanked.map((n) => ({ row: n.row, key: n.key, reason: n.reason }));

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Citizenship and cost"
          subtitle="Compare citizenship rules, post-study work and typical yearly costs by country, and see the money to show for the student visa. Every value shows where it comes from."
        />
        <Callout title={CITIZENSHIP_CALLOUT.title}>
          <p>{CITIZENSHIP_CALLOUT.body}</p>
        </Callout>
      </div>

      <section aria-labelledby="rank-heading">
        <h2 id="rank-heading" className="sr-only">
          Rank countries
        </h2>
        <RankControls query={query} />
      </section>

      <section aria-labelledby="ranked-heading" className="space-y-3">
        <div>
          <h2 id="ranked-heading" className="text-xl font-bold">
            Ranked by {opt.label.toLowerCase()} ({ranked.length})
          </h2>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {rankingSummary(ranking)}
          </p>
        </div>
        {ranked.length === 0 ? (
          <Callout tone="neutral" title="Nothing to rank yet">
            <p>
              No country has a Verified or Likely value for {opt.label.toLowerCase()} yet, so we do not rank them. We never
              guess a missing value. Each country is listed below with what is missing.
            </p>
          </Callout>
        ) : (
          <>
            <ol className="space-y-3 md:hidden">
              {ranked.map((e) => (
                <li key={e.row.country}>
                  <CountryCard entry={e} now={now} fx={fx} rankLabel={opt.label} isTarget={targets.has(e.row.country)} />
                </li>
              ))}
            </ol>
            <CountryTable
              entries={ranked}
              now={now}
              fx={fx}
              rankLabel={opt.label}
              caption={`Countries ranked by ${opt.label.toLowerCase()}, ${opt.dirLabels[query.dir].toLowerCase()}`}
              targets={targets}
            />
          </>
        )}
      </section>

      {notRanked.length > 0 ? (
        <section aria-labelledby="not-ranked-heading" className="space-y-3">
          <div>
            <h2 id="not-ranked-heading" className="text-xl font-bold">
              Not ranked: data missing ({notRanked.length})
            </h2>
            <p className="mt-1 text-sm text-muted">
              These countries have no Verified or Likely value for {opt.label.toLowerCase()} yet. They are not treated as
              zero or as last. The reason is shown for each one.
            </p>
          </div>
          <ul className="space-y-3 md:hidden">
            {notRanked.map((e) => (
              <li key={e.row.country}>
                <CountryCard entry={e} now={now} fx={fx} rankLabel={opt.label} isTarget={targets.has(e.row.country)} />
              </li>
            ))}
          </ul>
          <CountryTable
            entries={notRanked}
            now={now}
            fx={fx}
            rankLabel={opt.label}
            caption={`Countries not ranked by ${opt.label.toLowerCase()} because data is missing`}
            targets={targets}
          />
        </section>
      ) : null}

      <PakistanNationalityCard fact={pkFact} now={now} />

      <details className="rounded-card border border-line bg-surface p-4">
        <summary className="min-h-tap cursor-pointer py-2 font-semibold text-primary-ink">What do the labels mean?</summary>
        <div className="mt-2">
          <BadgeLegend showFit={false} />
        </div>
      </details>

      <HowRankingWorks />

      <ChatPanel
        title="Ask about citizenship rules"
        suggestions={['How does the Canada citizenship clock work?', 'Can I keep my Pakistani nationality?']}
      />
    </div>
  );
}
