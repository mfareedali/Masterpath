/**
 * Country comparison table (md and up). Server component.
 * Same facts as the mobile cards, one row per country. Status is never shown by colour alone.
 * The money to show for the student visa sits in a full-width line under each country (it is never ranked).
 */
import { Fragment } from 'react';
import { FACT_LABELS, conflictedFacts } from '@/lib/citizenship';
import type { FxRate } from '@/lib/types';
import { RankBadge } from '@/components/ui/badges';
import { ConflictQuestions, RankedValue, type CountryEntry } from './country-card';
import { FactSummary } from './fact-parts';
import { VisaFundsBlock } from './visa-funds';

const th = 'px-3 py-2 text-left align-bottom text-xs font-bold text-muted';
const td = 'px-3 py-3 align-top text-sm';

function SubFact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 first:mt-0">
      <p className="text-xs font-semibold text-muted">{label}</p>
      {children}
    </div>
  );
}

export function CountryTable({
  entries,
  now,
  fx,
  rankLabel,
  caption,
  targets,
}: {
  entries: CountryEntry[];
  now: Date;
  /** Exchange rates: the visa-money PKR line uses only a Verified/Likely one. */
  fx: FxRate[];
  rankLabel: string;
  caption: string;
  targets: ReadonlySet<string>;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-card md:block">
      <table className="w-full table-fixed border-collapse">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col className="w-16" />
          <col className="w-[17%]" />
          <col className="w-[25%]" />
          <col />
          <col className="w-[15%]" />
          <col className="w-[15%]" />
        </colgroup>
        <thead className="border-b border-line bg-surface-tint">
          <tr>
            <th scope="col" className={th}>
              Rank
            </th>
            <th scope="col" className={th}>
              Country
            </th>
            <th scope="col" className={th}>
              {FACT_LABELS.citizenship_rule}
            </th>
            <th scope="col" className={th}>
              Work and residence
            </th>
            <th scope="col" className={th}>
              {FACT_LABELS.dual_nationality_destination}
            </th>
            <th scope="col" className={th}>
              Typical cost per year
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.map((e) => (
            <Fragment key={e.row.country}>
            <tr>
              <td className={td}>
                {e.rank != null ? <RankBadge rank={e.rank} /> : <span className="text-xs font-semibold text-muted">Not ranked</span>}
              </td>
              <th scope="row" className={`${td} text-left font-normal`}>
                <span className="block text-base font-bold text-heading">{e.row.name}</span>
                {targets.has(e.row.country) ? <span className="block text-xs font-semibold text-muted">In your plan</span> : null}
                <div className="mt-2">
                  <RankedValue entry={e} rankLabel={rankLabel} />
                </div>
              </th>
              <td className={td}>
                <FactSummary fact={e.row.facts.citizenship_rule} now={now} compact clock />
                <SubFact label={FACT_LABELS.citizenship_update}>
                  <FactSummary fact={e.row.facts.citizenship_update} now={now} compact />
                </SubFact>
              </td>
              <td className={td}>
                <SubFact label={FACT_LABELS.post_study_work}>
                  <FactSummary fact={e.row.facts.post_study_work} now={now} compact />
                </SubFact>
                <SubFact label={FACT_LABELS.pr_route}>
                  <FactSummary fact={e.row.facts.pr_route} now={now} compact />
                </SubFact>
              </td>
              <td className={td}>
                <FactSummary fact={e.row.facts.dual_nationality_destination} now={now} compact />
              </td>
              <td className={td}>
                <SubFact label="Tuition">
                  <FactSummary fact={e.row.facts.tuition_typical} now={now} compact kind="money" />
                </SubFact>
                <SubFact label="Living cost">
                  <FactSummary fact={e.row.facts.living_cost_typical} now={now} compact kind="money" />
                </SubFact>
              </td>
            </tr>
            <tr>
              <td colSpan={6} className="px-3 pt-2 pb-3 align-top text-sm">
                <div className="max-w-3xl md:pl-16">
                  <p className="text-xs font-semibold text-muted">
                    {FACT_LABELS.proof_of_funds}
                    <span className="sr-only">{`, ${e.row.name}`}</span>
                  </p>
                  <VisaFundsBlock fact={e.row.facts.proof_of_funds} fx={fx} now={now} compact />
                </div>
              </td>
            </tr>
            {conflictedFacts(e.row, now).length > 0 ? (
              <tr>
                <td colSpan={6} className="px-3 pb-3">
                  <ConflictQuestions row={e.row} now={now} />
                </td>
              </tr>
            ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
