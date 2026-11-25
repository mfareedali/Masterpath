/**
 * "Rank by" chips and filters. Server components: every chip is a plain link (works without JS);
 * the state lives in the URL (see src/lib/shortlist/query.ts).
 * Mobile: filters sit in a <details> panel styled like a bottom sheet. Desktop: shown inline.
 */
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/button';
import { ChipLink, ChipRow, chipClass } from '@/components/ui/chip';
import { countryName } from '@/lib/format';
import {
  CLEAR_FILTERS,
  DIR_LABEL,
  FIT_FILTERS,
  FIT_FILTER_LABEL,
  RANK_KEYS,
  RANK_LABEL,
  intakeTermLabel,
  shortlistHref,
  toggleCountry,
  toggleValue,
  type RawSearchParams,
  type Shortlist,
  type ShortlistQueryChanges,
} from '@/lib/shortlist';
import type { Profile } from '@/lib/types';

/** Chip links: no scroll jump, no prefetch (saves data on 4G; a tap fetches on demand). */
const chipLinkProps = { scroll: false, prefetch: false } as const;

export function RankChips({ sp, shortlist }: { sp: RawSearchParams; shortlist: Shortlist }) {
  const { rank, dir } = shortlist.query;
  const other = dir === 'asc' ? 'desc' : 'asc';
  return (
    <ChipRow label="Rank by">
      {RANK_KEYS.map((k) => (
        <ChipLink key={k} href={shortlistHref(sp, { rank: k, dir: null, panel: null })} active={rank === k} {...chipLinkProps}>
          {RANK_LABEL[k]}
        </ChipLink>
      ))}
      <ChipLink
        href={shortlistHref(sp, { dir: other, panel: null })}
        aria-label={`Order: ${DIR_LABEL[rank][dir]}. Change to ${DIR_LABEL[rank][other]}`}
        className="border-dashed"
        {...chipLinkProps}
      >
        <span aria-hidden="true">⇅</span>
        {DIR_LABEL[rank][dir]}
      </ChipLink>
    </ChipRow>
  );
}

function FilterRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="md:flex md:items-center md:gap-3">
      <p className="mb-1 text-sm font-semibold text-muted md:mb-0 md:w-20 md:shrink-0">{title}</p>
      <div className="min-w-0 md:flex-1">
        <ChipRow label={title}>{children}</ChipRow>
      </div>
    </div>
  );
}

function FilterGroups({
  sp,
  shortlist,
  profile,
  keepPanelOpen,
}: {
  sp: RawSearchParams;
  shortlist: Shortlist;
  profile: Profile;
  keepPanelOpen: boolean;
}) {
  const href = (c: ShortlistQueryChanges) => shortlistHref(sp, { ...c, panel: keepPanelOpen ? true : null });
  const { filters, options, query } = shortlist;
  const shown = filters.countries;
  const defaults = profile.target_countries;

  return (
    <div className="space-y-3">
      <FilterRow title="Country">
        <ChipLink href={href({ country: defaults.length > 0 ? 'all' : null })} active={shown === null} {...chipLinkProps}>
          All countries
        </ChipLink>
        {options.countries.map((c) => (
          <ChipLink
            key={c}
            href={href({ country: toggleCountry(shown, c, defaults) })}
            active={shown?.includes(c) ?? false}
            {...chipLinkProps}
          >
            {countryName(c)}
          </ChipLink>
        ))}
      </FilterRow>
      {filters.countrySource === 'profile' ? (
        <p className="text-xs text-muted">Showing the countries from your profile.</p>
      ) : null}

      <FilterRow title="Fit">
        {FIT_FILTERS.map((f) => (
          <ChipLink key={f} href={href({ fit: toggleValue(query.fit, f) })} active={query.fit.includes(f)} {...chipLinkProps}>
            {FIT_FILTER_LABEL[f]}
          </ChipLink>
        ))}
      </FilterRow>

      {options.intakes.length > 0 ? (
        <FilterRow title="Intake">
          {options.intakes.map((v) => (
            <ChipLink
              key={v}
              href={href({ intake: toggleValue(filters.intake, v) })}
              active={filters.intake.includes(v)}
              {...chipLinkProps}
            >
              {intakeTermLabel(v)}
            </ChipLink>
          ))}
        </FilterRow>
      ) : null}

      <FilterRow title="Cost">
        {profile.budget_pkr != null ? (
          <ChipLink href={href({ budget: query.budget ? null : true })} active={filters.budget} {...chipLinkProps}>
            Within my budget
          </ChipLink>
        ) : (
          <Link href="/onboarding" className="inline-flex min-h-tap items-center text-sm font-semibold">
            Add a budget to filter by cost
          </Link>
        )}
      </FilterRow>
      {profile.budget_pkr != null && !options.pkrRateAvailable ? (
        // Behaviour is unchanged (programs go to "Can't check"); this line says why, before the tap.
        <p className="text-xs text-muted" data-budget-needs-rate="">
          {BUDGET_NEEDS_RATE}
        </p>
      ) : null}
    </div>
  );
}

/** Shown under "Within my budget" while no exchange-rate row is usable for PKR totals. */
export const BUDGET_NEEDS_RATE = 'Needs a verified PKR exchange rate. None yet.';

export function Filters({ sp, shortlist, profile }: { sp: RawSearchParams; shortlist: Shortlist; profile: Profile }) {
  const n = shortlist.activeFilterCount;
  const label = n > 0 ? `Filters (${n})` : 'Filters';
  const shownCount = shortlist.ranked.length + shortlist.notRanked.length + shortlist.cantCheck.length;

  return (
    <>
      {/* Mobile: bottom-sheet style panel. `panel=filters` keeps it open after a chip tap. */}
      <details className="group md:hidden" open={shortlist.query.panel || undefined}>
        <summary className={chipClass(n > 0, 'cursor-pointer list-none [&::-webkit-details-marker]:hidden')}>
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          {label}
        </summary>
        <div className="mt-3 rounded-card border border-line bg-surface px-4 pb-4 pt-2 shadow-sheet">
          <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-chip bg-line" />
          <FilterGroups sp={sp} shortlist={shortlist} profile={profile} keepPanelOpen />
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
            {n > 0 ? (
              <Link
                href={shortlistHref(sp, { ...CLEAR_FILTERS, panel: true })}
                scroll={false}
                prefetch={false}
                className="inline-flex min-h-tap items-center text-sm font-semibold"
              >
                Clear filters
              </Link>
            ) : (
              <span />
            )}
            <ButtonLink href={shortlistHref(sp, { panel: null })} scroll={false} prefetch={false}>
              Show {shownCount} program{shownCount === 1 ? '' : 's'}
            </ButtonLink>
          </div>
        </div>
      </details>

      {/* Desktop: inline. */}
      <div className="hidden space-y-3 md:block">
        <FilterGroups sp={sp} shortlist={shortlist} profile={profile} keepPanelOpen={false} />
        {n > 0 ? (
          <Link
            href={shortlistHref(sp, { ...CLEAR_FILTERS, panel: null })}
            scroll={false}
            prefetch={false}
            className="inline-flex text-sm font-semibold"
          >
            Clear filters
          </Link>
        ) : null}
      </div>
    </>
  );
}
