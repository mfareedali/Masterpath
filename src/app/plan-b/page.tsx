/**
 * Plan B (screen 5): honest alternative routes when a student is "Below minimum", behind an integrity gate
 * that blocks or warns instead of pushing the easiest option. Dynamic (profile from cookie / query params).
 */
import type { Metadata } from 'next';
import { LoadPersonaButtons } from '@/components/demo/load-persona';
import { RouteCard } from '@/components/planb/route-card';
import {
  BlockedSection,
  DirectSection,
  ExcludedSection,
  ImproveCard,
  IntegrityNote,
  NotDecidedSection,
  NotForYourGradeSection,
  RouteTypesSection,
  TargetChips,
} from '@/components/planb/sections';
import { ButtonLink } from '@/components/ui/button';
import { Callout, Card, PageHeader } from '@/components/ui/card';
import { getConversionRules, getFxRates, getInstitutionMap, getPrograms } from '@/lib/data';
import {
  ORDER_NOTE,
  buildPlanB,
  planBHref,
  programHref,
  shortlistUnknownHref,
  strengthsForProfile,
  type PlanRoute,
} from '@/lib/planb';
import { getNow, getRequestProfileState } from '@/lib/profile-server';

export const metadata: Metadata = {
  title: 'Plan B',
  description:
    'Below a program minimum? See other honest routes with total time and cost, and the risks of each. Nothing is ranked by ease alone.',
};

type SearchParams = Record<string, string | string[] | undefined>;

const TITLE = 'Plan B: other ways in';
const SUBTITLE = "Below a program's minimum? Here are other honest routes, with time, cost and risks side by side.";

function first(v: string | string[] | undefined): string | null {
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

export default async function PlanBPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { profile, linkRejected } = await getRequestProfileState(sp);
  const linkNotice = linkRejected ? (
    <Callout tone="neutral">We could not read the profile in this link, so we show the profile saved on this device.</Callout>
  ) : null;

  if (!profile) {
    return (
      <div>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <IntegrityNote />
        <Card>
          <h2 className="text-lg font-bold">First, tell us your grade</h2>
          <p className="mt-1 text-sm text-ink">
            Plan B compares other routes with your target program. We need your CGPA, field and target countries. We never
            ask for passport or ID numbers.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <ButtonLink href="/onboarding">Add your details</ButtonLink>
            <LoadPersonaButtons compact />
          </div>
        </Card>
      </div>
    );
  }

  const [programs, institutions, rules, fx] = await Promise.all([
    getPrograms(),
    getInstitutionMap(),
    getConversionRules(),
    getFxRates(),
  ]);
  const now = getNow();
  const plan = buildPlanB({
    profile,
    programs,
    institutions,
    rules,
    fx,
    now,
    target: first(sp.target),
    strengths: strengthsForProfile(profile),
  });

  const card = (r: PlanRoute) => (
    <RouteCard
      route={r}
      now={now}
      programHref={programHref(sp, r.program.id)}
      followOnHref={r.followOn ? programHref(sp, r.followOn.id) : undefined}
      compare={plan.direct != null}
    />
  );

  const comparing = plan.direct
    ? `Comparing with ${plan.direct.program.name}${plan.direct.institution ? ` at ${plan.direct.institution.name}` : ''}.`
    : 'Showing routes for all your targets.';

  return (
    <div>
      {linkNotice}
      <PageHeader title={TITLE} subtitle={SUBTITLE} />
      <IntegrityNote />

      <TargetChips plan={plan} hrefFor={(t) => planBHref(sp, t)} />
      <p aria-live="polite" className="sr-only">
        {comparing}
      </p>

      {plan.notice ? (
        <Callout tone="neutral" className="mb-4">
          {plan.notice}
        </Callout>
      ) : null}

      <DirectSection plan={plan} programHref={(id) => programHref(sp, id)} now={now} />

      <section aria-labelledby="routes-h" className="mb-6">
        <h2 id="routes-h" className="text-xl font-bold">
          Other routes, best first
        </h2>
        <p className="mt-1 text-sm text-muted">{ORDER_NOTE}</p>
        {plan.direct ? null : (
          <p className="mt-1 text-sm text-ink">Pick one target above to compare each route with going direct.</p>
        )}
        {plan.ranked.length > 0 ? (
          <ol className="mt-3 space-y-3">
            {plan.ranked.map((r) => (
              <li key={r.id}>{card(r)}</li>
            ))}
          </ol>
        ) : (
          <Card className="mt-3">
            <p className="text-sm text-ink">
              No route can be ranked yet, because the facts we would rank by are not verified. We will not guess an order.
              {plan.notRanked.length > 0 ? ' The routes we found are listed below, with their warnings.' : ''}
            </p>
          </Card>
        )}
      </section>

      {plan.notRanked.length > 0 ? (
        <section aria-labelledby="notranked-h" className="mb-6">
          <h2 id="notranked-h" className="text-xl font-bold">
            Not ranked: data missing
          </h2>
          <p className="mt-1 text-sm text-muted">
            We show these so nothing is hidden. Their minimum grade, recognition and cost are not verified yet, so we do
            not put them in order.
          </p>
          <ul className="mt-3 space-y-3">
            {plan.notRanked.map((r) => (
              <li key={r.id}>{card(r)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <NotDecidedSection
        undecided={plan.undecided}
        shortlistHref={shortlistUnknownHref(sp)}
        programHref={(id) => programHref(sp, id)}
      />
      <NotForYourGradeSection rows={plan.notForYourGrade} programHref={(id) => programHref(sp, id)} />

      <ImproveCard />
      <RouteTypesSection coverage={plan.coverage} />
      <BlockedSection blocked={plan.blocked} />
      <ExcludedSection excluded={plan.excluded} now={now} />
    </div>
  );
}
