/**
 * UI/UX fixes: ordering of the shortlist page, one list instead of "ranked / not ranked" boxes, action lines for
 * unknown fit, collapsed "not on file" rows, quiet Plan B, navigation and the journey cue. Presentation only:
 * none of these tests touches scoring or data.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NAV_ITEMS } from '@/components/nav/bottom-nav';
import { BlockedSection, RouteTypesSection } from '@/components/planb/sections';
import { ProgramCard } from '@/components/shortlist/program-card';
import { ProgramTable } from '@/components/shortlist/program-table';
import { JOURNEY_STEPS, JourneyCue } from '@/components/ui/journey';
import { PageHeader } from '@/components/ui/card';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { PERSONA_A } from '@/lib/profile';
import {
  buildShortlist,
  fitActionText,
  fitIsKnown,
  missingDetailCount,
  noteHeadline,
  sortedByText,
  urgentBadgeText,
  urgentDeadlines,
  type ClosingSoonRow,
} from '@/lib/shortlist';
import { FIXED_NOW } from '@/lib/test-fixtures';
import type { TypeCoverage } from '@/lib/planb';

const now = FIXED_NOW;
const details = (id: string) => `/program/${id}`;
const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), 'utf8');

describe('shortlist page order and removed boxes', () => {
  const page = src('src/app/shortlist/page.tsx');

  it('order: rank by and filters, then the programs, then the deadlines card', () => {
    const controls = page.indexOf('id="controls-heading"');
    const programs = page.indexOf('id="programs-heading"');
    const closing = page.indexOf('<ClosingSoon');
    expect(controls).toBeGreaterThan(-1);
    expect(programs).toBeGreaterThan(controls);
    expect(closing).toBeGreaterThan(programs);
  });

  it('has no "How much is verified" box, no Ranked / Not ranked tiles, and no "will not guess" wording', () => {
    expect(page).not.toContain('CoverageMeter');
    expect(page).not.toContain('StatTile');
    expect(page).not.toMatch(/Not ranked: data missing|We will not guess|Why not ranked/);
  });

  it('shows the trust line and the urgent-deadline badge that jumps to the card', () => {
    expect(page).toContain('Every number links to its official page.');
    expect(page).toContain('data-urgent-deadlines');
    expect(page).toContain('href="#closing-soon-heading"');
    expect(page).toContain('More programs to explore');
  });
});

describe('presentation helpers', () => {
  it('urgentDeadlines keeps only deadlines within 7 days; the badge text is plural-aware', () => {
    const row = (days: number) => ({ days }) as ClosingSoonRow;
    expect(urgentDeadlines([row(0), row(3), row(7), row(8), row(20)]).map((r) => r.days)).toEqual([0, 3, 7]);
    expect(urgentBadgeText(1)).toBe('1 deadline closing soon');
    expect(urgentBadgeText(2)).toBe('2 deadlines closing soon');
  });

  it('noteHeadline: short notes stay whole; long notes become one headline plus the full text', () => {
    expect(noteHeadline('Applications close at noon CET.')).toEqual({ head: 'Applications close at noon CET.', full: null });
    const long = 'This is the final university deadline for Fall. The same page lists a Fall priority deadline and several other dates for scholarships and housing.';
    const n = noteHeadline(long);
    expect(n.full).toBe(long);
    expect(n.head.length).toBeLessThanOrEqual(95);
    expect(n.head.endsWith('…')).toBe(true);
  });

  it('sortedByText is one plain line', () => {
    expect(sortedByText('fit', 'asc')).toBe('Sorted by Fit · Meets minimum first');
  });

  it('missingDetailCount counts only what is missing', () => {
    expect(missingDetailCount({ deadline: true, tuition: false, totalCost: false, citizenship: true, study: false })).toBe(2);
    expect(missingDetailCount({ deadline: true, tuition: false, totalCost: false, citizenship: true, study: false }, true)).toBe(3);
  });
});

describe('rows: fit pill only for a real result, one "not on file" line per row', () => {
  const live = loadSeedDataset();
  const s = buildShortlist({ ...live, profile: PERSONA_A, now });
  const known = [...s.ranked, ...s.notRanked, ...s.cantCheck].find((r) => fitIsKnown(r.fit));
  const unknown = [...s.ranked, ...s.notRanked, ...s.cantCheck].find((r) => !fitIsKnown(r.fit));

  it('a real result keeps its pill and reason', () => {
    expect(known).toBeDefined();
    const html = renderToStaticMarkup(<ProgramCard row={known!} now={now} rankBy="fit" detailsHref={details(known!.program.id)} />);
    expect(html).toContain(known!.fit.label);
    expect(html).not.toContain('data-fit-action');
  });

  it('an unknown fit has no pill, links an action line, and says "not on file" once', () => {
    expect(unknown).toBeDefined();
    const html = renderToStaticMarkup(<ProgramCard row={unknown!} now={now} rankBy="fit" detailsHref={details(unknown!.program.id)} />);
    expect(html).not.toContain('Competitive range unknown');
    expect(html).toContain(fitActionText(unknown!.fit));
    expect(html).toContain('data-fit-action');
    expect(html.match(/not on file yet/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(html).not.toContain('Not verified yet');
  });

  it('every verified value on a card carries "Source: <domain> · checked <date>"', () => {
    const withSource = s.ranked.find((r) => r.program.deadline.value != null && r.program.deadline.source_url);
    expect(withSource).toBeDefined();
    const html = renderToStaticMarkup(<ProgramCard row={withSource!} now={now} rankBy="fit" detailsHref={details(withSource!.program.id)} />);
    expect(html).toMatch(/Source: [a-z0-9.-]+ · checked /);
  });

  it('the desktop table has no "Why not ranked" column and no repeated "Not verified yet"', () => {
    const html = renderToStaticMarkup(
      <ProgramTable rows={[...s.ranked, ...s.notRanked]} now={now} rankBy="fit" caption="x" detailsHref={details} />,
    );
    expect(html).not.toContain('Why not ranked');
    expect(html).not.toContain('Not verified yet');
  });
});

describe('Plan B: quiet when there is nothing to show', () => {
  const empty = (type: TypeCoverage['type']): TypeCoverage => ({ type, shown: 0, blocked: 0, notDecided: 0, notForYourGrade: 0 });

  it('no blocked routes: the section is not rendered', () => {
    expect(renderToStaticMarkup(<BlockedSection blocked={[]} />)).toBe('');
  });

  it('route types without results collapse into one line, with no "None yet" badges', () => {
    const html = renderToStaticMarkup(
      <RouteTypesSection coverage={[empty('pathway'), empty('pre_masters'), { ...empty('conditional'), shown: 2 }]} />,
    );
    expect(html).not.toContain('None yet');
    expect(html).toContain('2 shown');
    expect(html).toContain('More routes we&#x27;re adding: Pathway');
    expect(html.match(/data-routes-coming/g)?.length).toBe(1);
  });

  it('when every type is empty, only the one-line list remains', () => {
    const html = renderToStaticMarkup(<RouteTypesSection coverage={[empty('pathway'), empty('pre_masters')]} />);
    expect(html).not.toContain('Routes with results');
    expect(html).toContain('More routes we&#x27;re adding');
  });

  it('the page source drops the "No route can be ranked" box and "We will not guess an order"', () => {
    const page = src('src/app/plan-b/page.tsx');
    expect(page).not.toMatch(/No route can be ranked|We will not guess/);
    expect(page).toContain('plan.ranked.length > 0');
  });
});

describe('navigation and the journey cue', () => {
  it('the mobile nav has five items including Saved', () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(['Home', 'Shortlist', 'Plan B', 'Check', 'Saved']);
    expect(NAV_ITEMS.find((i) => i.label === 'Saved')?.href).toBe('/saved');
    expect(src('src/components/nav/bottom-nav.tsx')).toContain("aria-current={active ? 'page' : undefined}");
  });

  it('the cue marks the current step and names the next one', () => {
    const html = renderToStaticMarkup(<JourneyCue current="shortlist" />);
    expect(html).toContain('aria-current="step"');
    expect(html.match(/aria-current="step"/g)?.length).toBe(1);
    for (const step of JOURNEY_STEPS) expect(html).toContain(step.label);
    expect(html).toContain('Next:');
  });

  it('PageHeader renders the cue, the purpose line and the primary action in that order', () => {
    const html = renderToStaticMarkup(<PageHeader step="plan-b" title="T" subtitle="Purpose" action={<a href="/x">Go</a>} />);
    const order = ['Your journey', '<h1', 'Purpose', 'Go'].map((t) => html.indexOf(t));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('error, loading and not-found pages exist', () => {
  for (const f of [
    'src/app/error.tsx',
    'src/app/global-error.tsx',
    'src/app/not-found.tsx',
    'src/app/shortlist/loading.tsx',
    'src/app/citizenship/loading.tsx',
    'src/app/check/loading.tsx',
    'src/app/plan-b/loading.tsx',
    'src/app/program/[id]/loading.tsx',
  ]) {
    it(f, () => expect(src(f).length).toBeGreaterThan(50));
  }
});
