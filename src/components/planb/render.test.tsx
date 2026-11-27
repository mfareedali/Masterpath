/**
 * Server-render smoke tests (node environment, no DOM library): the Plan B components render with today's
 * empty seed data AND with full fixture data, and follow the evidence and integrity rules.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import {
  CONDITIONAL_MESSAGE,
  NO_FLOOR_TEXT,
  buildPlanB,
  planBHref,
  shortlistUnknownHref,
  strengthsForProfile,
  targetRouteNote,
  type PlanB,
  type PlanRoute,
} from '@/lib/planb';
import { PERSONA_A, PERSONA_B_STRENGTHS } from '@/lib/profile';
import { FIXED_NOW, makeInstitution, makeProgram, unverified, verified } from '@/lib/test-fixtures';
import type { FxRate, GpaRule, Institution, Money, Profile, Program, SourcedValue } from '@/lib/types';
import { RouteCard } from './route-card';
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
} from './sections';

const now = FIXED_NOW;

/** Copy rules: no probabilities, no "chances", no promised outcomes, no ID numbers. */
const BANNED = [/\d\s*%/, /chance/i, /probabilit/i, /guaranteed (admission|a place|entry)/i, /fastest citizenship/i, /passport number/i];

function copyOf(html: string): string {
  return html.replace(/\s(class|href|id|aria-labelledby|aria-describedby)="[^"]*"/g, '');
}

function expectCleanCopy(html: string) {
  const copy = copyOf(html);
  for (const re of BANNED) expect(copy).not.toMatch(re);
}

/** Every external link opens safely. */
function expectSafeLinks(html: string) {
  const anchors = html.match(/<a [^>]*>/g) ?? [];
  for (const a of anchors) {
    if (/href="https?:/.test(a)) expect(a).toMatch(/rel="noopener noreferrer nofollow"/);
    expect(a).not.toMatch(/href="javascript:/i);
  }
}

/** Rendered text with React's entity escaping undone (to compare with raw data strings). */
function decoded(html: string): string {
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Every internal review_note in the data (programs and institutions, including conflict sources). */
function reviewNotes(rows: object[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    for (const v of Object.values(row)) {
      if (!v || typeof v !== 'object' || !('value' in v)) continue;
      const fact = v as SourcedValue<unknown> & { conflicts?: SourcedValue<unknown>[] };
      for (const s of [fact, ...(fact.conflicts ?? [])]) if (s.review_note?.trim()) out.push(s.review_note.trim());
    }
  }
  return out;
}

/** Internal reviewer notes are never rendered to students. */
function expectNoReviewNotes(html: string, rows: object[]) {
  const text = decoded(html);
  for (const note of reviewNotes(rows)) expect(text).not.toContain(note);
}

function renderCards(plan: PlanB): string {
  const card = (r: PlanRoute) => (
    <RouteCard
      key={r.id}
      route={r}
      now={now}
      programHref={`/program/${r.program.id}`}
      followOnHref={r.followOn ? `/program/${r.followOn.id}` : undefined}
      compare={plan.direct != null}
    />
  );
  return renderToStaticMarkup(
    <div>
      <IntegrityNote />
      <TargetChips plan={plan} hrefFor={(t) => planBHref({}, t)} />
      <DirectSection plan={plan} programHref={(id) => `/program/${id}`} now={now} />
      {plan.ranked.map(card)}
      {plan.notRanked.map(card)}
      <NotDecidedSection undecided={plan.undecided} shortlistHref={shortlistUnknownHref({})} programHref={(id) => `/program/${id}`} />
      <NotForYourGradeSection rows={plan.notForYourGrade} programHref={(id) => `/program/${id}`} />
      <ImproveCard />
      <RouteTypesSection coverage={plan.coverage} />
      <BlockedSection blocked={plan.blocked} />
      <ExcludedSection excluded={plan.excluded} now={now} />
    </div>,
  );
}

describe("today's seed data + persona A (the demo moment)", () => {
  const seed = loadSeedDataset();
  const plan = buildPlanB({
    profile: PERSONA_A,
    programs: seed.programs,
    institutions: seed.institutions,
    rules: seed.conversionRules,
    fx: seed.fxRates,
    now,
    strengths: strengthsForProfile(PERSONA_A),
  });
  const html = renderCards(plan);

  it('shows the QMUL pre-master\'s card with the progression warning, in a warning call-out', () => {
    expect(html).toContain('The official page does not guarantee progression to the Masters');
    expect(html).toContain('role="note"');
    expect(html).toContain("Pre-master&#x27;s, then Masters");
  });

  it('says "Not verified yet" for unknown time and cost, never a number', () => {
    expect(html).toContain('Not verified yet');
    expect(html).toContain('length not verified yet');
    expect(html).toContain('Tuition not verified yet');
  });

  it('always shows the integrity note and the "Improve and reapply" card', () => {
    expect(html).toContain('We never rank by ease alone. Routes that look easy or cheap but carry risk are warned or blocked.');
    expect(html).toContain('Improve and reapply');
    expect(html).toContain('At least one application cycle');
    expect(html).toContain('not legal or immigration advice');
  });

  it('explains every route type, and never shows the ruled-out program as a route', () => {
    for (const label of ['Direct entry, lower minimum', 'Conditional offer', 'Pathway programme', 'Test-score route', 'Research-led route']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Show 1 ruled-out program');
    expect(html).toContain('All my targets');
  });

  it('follows the copy and link rules', () => {
    expectCleanCopy(html);
    expectSafeLinks(html);
  });
});

describe("today's seed + persona A with a chosen target (review regressions)", () => {
  const seed = loadSeedDataset();
  const rows = [...seed.programs, ...seed.institutions];
  const build = (target: string) =>
    buildPlanB({
      profile: PERSONA_A,
      programs: seed.programs,
      institutions: seed.institutions,
      rules: seed.conversionRules,
      fx: seed.fxRates,
      now,
      target,
      strengths: strengthsForProfile(PERSONA_A),
    });
  const findRoute = (plan: PlanB, id: string) => [...plan.ranked, ...plan.notRanked].find((r) => r.program.id === id);

  it('target usf-mscs: the QMUL card shows "Check you are eligible" first, then the progression warning', () => {
    const plan = build('usf-mscs');
    expect(plan.direct?.program.id).toBe('usf-mscs');
    const qmul = seed.programs.find((p) => p.id === 'qmul-premasters-cs')!;
    const route = findRoute(plan, qmul.id)!;
    expect(route).toBeDefined();
    const html = renderToStaticMarkup(<RouteCard route={route} now={now} programHref={`/program/${qmul.id}`} compare />);

    const callout = html.indexOf('role="note"');
    const eligibility = html.indexOf('Check you are eligible: ');
    const progression = html.indexOf('The official page does not guarantee progression to the Masters');
    expect(callout).toBeGreaterThan(-1);
    expect(eligibility).toBeGreaterThan(callout);
    expect(progression).toBeGreaterThan(eligibility);
    expect(html.indexOf('data-warning="ELIGIBILITY"')).toBeLessThan(html.indexOf('data-warning="PROGRESSION_NOT_GUARANTEED"'));
    expect(decoded(html)).toContain(`Check you are eligible: ${qmul.eligibility_note.value}`);
    expect(html).toContain(`href="${qmul.eligibility_note.source_url}"`);
    expect(html).toContain('we do not hide this route');

    // Not ranked: it says plainly why, and has no "Why this order".
    expect(html).toContain('To compare this route, check: minimum grade not verified yet');
    expect(html).not.toContain('Why this order');

    expectNoReviewNotes(html, rows);
    expectCleanCopy(html);
    expectSafeLinks(html);
  });

  it('target brookes-msc-cs: the target card shows the Pakistan note with its badge and source', () => {
    const plan = build('brookes-msc-cs');
    expect(plan.direct?.program.id).toBe('brookes-msc-cs');
    const brookes = seed.programs.find((p) => p.id === 'brookes-msc-cs')!;
    const html = renderToStaticMarkup(<DirectSection plan={plan} programHref={(id) => `/program/${id}`} now={now} />);

    const at = html.indexOf('Note for Pakistan applicants');
    expect(at).toBeGreaterThan(-1);
    const row = html.slice(at);
    expect(row.slice(0, 900)).toContain('</svg>Verified');
    expect(decoded(row)).toContain(brookes.status_note.value!);
    expect(row).toContain(`href="${brookes.status_note.source_url}"`);
    expect(row).toContain('Evidence from the official page');
    // Shown before the time and cost of the target.
    expect(at).toBeLessThan(html.indexOf('Total time'));

    expectNoReviewNotes(html, rows);
    expect(decoded(html)).not.toMatch(/Azad Jammu|Awaiting human review/);
    expectCleanCopy(html);
    expectSafeLinks(html);
  });

  it('the full page for both targets never renders an internal review_note', () => {
    for (const target of ['usf-mscs', 'brookes-msc-cs', 'all']) expectNoReviewNotes(renderCards(build(target)), rows);
  });
});

/* ---------------- Full fixture data ---------------- */

const fx: FxRate[] = [{ id: 'gbp-pkr', currency: 'GBP', pkr_per_unit: verified(100) }];
const student: Profile = { cgpa: 2.5, scale: 'cgpa_4', field: 'cs', target_countries: ['UK'], budget_pkr: 3_000_000 };
const min = (m: number) => verified<GpaRule>({ scale: 'cgpa_4', min: m });
const gbp = (amount: number) => verified<Money>({ amount, currency: 'GBP', period: 'total' });
const costed = (months: number, tuition: number, living: number): Partial<Program> => ({
  duration_months: verified(months),
  tuition: gbp(tuition),
  living_cost: gbp(living),
});
const listed = verified<'listed' | 'not_listed'>('listed');

const INSTITUTIONS: Institution[] = [
  makeInstitution({ id: 'u-target', name: 'Fixture University Target', recognition_list_status: listed }),
  makeInstitution({ id: 'u-low', name: 'Fixture University Low', recognition_list_status: listed }),
  makeInstitution({ id: 'u-pre', name: 'Fixture University Pre', recognition_list_status: listed }),
  makeInstitution({ id: 'u-res', name: 'Fixture University Research' }),
  makeInstitution({
    id: 'u-blocked',
    name: 'Fixture University Blocked',
    recognition_list_status: verified<'listed' | 'not_listed'>('not_listed', 1, 'https://fixture.example.edu/recognition-list'),
  }),
];

const PROGRAMS: Program[] = [
  makeProgram({ id: 'target', institution_id: 'u-target', name: 'MSc Fixture Target', min_gpa_rule: min(3), ...costed(12, 10_000, 5_000) }),
  makeProgram({ id: 'low', institution_id: 'u-low', name: 'MSc Fixture Low', min_gpa_rule: min(2), ...costed(12, 8_000, 5_000) }),
  makeProgram({ id: 'pre', institution_id: 'u-pre', name: 'Fixture Pre-Masters', pathway_type: 'pre_masters', ...costed(6, 4_000, 3_000) }),
  makeProgram({ id: 'pre-msc', institution_id: 'u-pre', name: 'MSc Fixture Pre Follow-on', min_gpa_rule: min(3), ...costed(12, 9_000, 5_000) }),
  makeProgram({ id: 'res', institution_id: 'u-res', name: 'MSc Fixture Research', research_considered: verified('Fixture: research experience is considered.') }),
  makeProgram({ id: 'blocked', institution_id: 'u-blocked', name: 'MSc Fixture Blocked', pathway_type: 'conditional' }),
];

describe('full fixture data', () => {
  const plan = buildPlanB({ profile: student, programs: PROGRAMS, institutions: INSTITUTIONS, rules: [], fx, now });
  const html = renderCards(plan);

  it('renders the direct target with its fit badge, minimum and confidence badge', () => {
    expect(html).toContain('Your target');
    expect(html).toContain('MSc Fixture Target');
    expect(html).toContain('Below minimum');
    expect(html).toContain('Source of the minimum');
    expect(html).toContain('Verified');
  });

  it('renders ranked cards with a rank badge, time and cost versus going direct, and "Why this order"', () => {
    expect(html).toContain('aria-label="Rank 1"');
    expect(html).toContain('Why this order');
    expect(html).toContain('6 months longer than going direct');
    expect(html).toMatch(/PKR [^<]* more than going direct/);
    expect(html).toContain('Within your budget');
    expect(html).toContain('href="/program/pre-msc"');
  });

  it('shows blocked routes last, collapsed, with the blocked badge, reason and source', () => {
    const blockedAt = html.indexOf('id="blocked-h"');
    expect(blockedAt).toBeGreaterThan(html.indexOf('Improve and reapply'));
    const blockedHtml = html.slice(blockedAt);
    expect(blockedHtml).toContain('<details');
    expect(blockedHtml).toContain('</path></svg>Blocked');
    expect(blockedHtml).toContain('<circle');
    expect(blockedHtml).toContain('Show 1 blocked route');
    expect(blockedHtml).toContain("not on the destination&#x27;s official recognition list");
    expect(blockedHtml).toContain('href="https://fixture.example.edu/recognition-list"');
    // The blocked program is not rendered as a route card.
    expect(html).not.toContain('id="route-conditional-blocked"');
  });

  it('shows "Your research may matter here" on research-led routes only when strengths are known', () => {
    expect(html).not.toContain('Your research may matter here');
    const withStrengths = buildPlanB({
      profile: student,
      programs: PROGRAMS,
      institutions: INSTITUTIONS,
      rules: [],
      fx,
      now,
      strengths: PERSONA_B_STRENGTHS,
    });
    const html2 = renderCards(withStrengths);
    expect(html2).toContain('Your research may matter here');
    expect(html2).toContain('Your research does not change your fit label.');
  });

  it('follows the copy and link rules', () => {
    expectCleanCopy(html);
    expectSafeLinks(html);
  });

  it('every ranked route shows "Why this order" with its score; not-ranked routes say why they are not ordered', () => {
    expect(plan.ranked.length).toBeGreaterThan(0);
    expect(plan.notRanked.length).toBeGreaterThan(0);
    const one = (r: PlanRoute) => renderToStaticMarkup(<RouteCard route={r} now={now} programHref="/program/x" compare />);
    for (const r of plan.ranked) {
      const h = one(r);
      expect(h).toContain(`Why this order (score ${r.score!.total} out of ${r.score!.max})`);
      expect(h).toContain('Feasibility: ');
      expect(h).not.toContain('Not ranked yet');
    }
    for (const r of plan.notRanked) {
      const h = one(r);
      expect(h).not.toContain('Why this order');
      expect(h).toContain(`${r.notRankedReason}.`);
      expect(r.notRankedReason).toMatch(/^To compare this route, check: /);
      expect(h).toContain('A route is put in order once one of these is confirmed on its official page.');
    }
    expect((html.match(/Why this order/g) ?? []).length).toBe(plan.ranked.length);
  });

  it('a ranked route with an eligibility note shows it first and keeps "Why this order"', () => {
    const progs = PROGRAMS.map((p) =>
      p.id === 'low' ? { ...p, eligibility_note: verified('For graduates of a fixture subject.', 1, 'https://fixture.example.edu/who') } : p,
    );
    const p2 = buildPlanB({ profile: student, programs: progs, institutions: INSTITUTIONS, rules: [], fx, now });
    const r = p2.ranked.find((x) => x.program.id === 'low')!;
    expect(r.fit.label).toBe('Meets minimum');
    const h = renderToStaticMarkup(<RouteCard route={r} now={now} programHref="/program/low" compare />);
    expect(h).toContain('Check before you choose this: 1 warning');
    expect(h).toContain('Check you are eligible: For graduates of a fixture subject.');
    expect(h).toContain('href="https://fixture.example.edu/who"');
    expect(h).toContain('Why this order');
  });

  it('the target card shows a usable status note with neutral wording when it is not about Pakistan', () => {
    const withNote = (fact: Program['status_note']) =>
      buildPlanB({
        profile: student,
        programs: PROGRAMS.map((p) => (p.id === 'target' ? { ...p, status_note: fact } : p)),
        institutions: INSTITUTIONS,
        rules: [],
        fx,
        now,
      });
    const render = (p: PlanB) => renderToStaticMarkup(<DirectSection plan={p} programHref={(id) => `/program/${id}`} now={now} />);

    const shown = render(withNote(verified('Fixture: applications for this intake are closed.')));
    expect(shown).toContain('Note from the official page');
    expect(shown).not.toContain('Note for Pakistan applicants');
    expect(shown).toContain('Fixture: applications for this intake are closed.');

    // Unverified notes are not shown on the target card.
    const hidden = render(withNote(unverified('Fixture: unverified note.')));
    expect(hidden).not.toContain('Fixture: unverified note.');
    expect(hidden).not.toContain('Note from the official page');
  });
});

/* ---------------- Conditional routes, deadlines, not decided (this wave) ---------------- */

describe("today's seed + persona A: conditional route cards and the not-decided list", () => {
  const seed = loadSeedDataset();
  const rows = [...seed.programs, ...seed.institutions];
  const build = (target?: string) =>
    buildPlanB({
      profile: PERSONA_A,
      programs: seed.programs,
      institutions: seed.institutions,
      rules: seed.conversionRules,
      fx: seed.fxRates,
      now,
      target,
      strengths: strengthsForProfile(PERSONA_A),
    });
  const plan = build();
  const card = (r: PlanRoute) => renderToStaticMarkup(<RouteCard route={r} now={now} programHref={`/program/${r.program.id}`} compare />);
  const nyitProgram = seed.programs.find((p) => p.id === 'nyit-mscs')!;
  const uccsProgram = seed.programs.find((p) => p.id === 'uccs-mscs')!;

  it('the NYIT card quotes the official page with its badge and source, ranks with "Why this order", and keeps the fit label', () => {
    const r = plan.ranked.find((x) => x.id === 'conditional:nyit-mscs')!;
    expect(r).toBeDefined();
    const html = card(r);
    const text = decoded(html);
    expect(text).toContain('Conditional offer');
    expect(text).toContain('Conditional route: the official page says');
    expect(text).toContain(nyitProgram.conditional_admission.evidence_snippet!);
    expect(text).toMatch(/3\.0 or higher in the first four graduate courses/);
    expect(html).toContain(`href="${nyitProgram.conditional_admission.source_url}"`);
    expect(html).toContain('data-conditional="meets_floor"');
    expect(decoded(html.replace(/<[^>]+>/g, ''))).toContain(
      'Your grade and this route: Your grade, 2.5 on the CGPA (out of 4.0), meets the lower limit this route names (2.5).',
    );
    expect(text).toContain('A conditional route does not change your fit label, and it is not a promise of a place.');
    expect(text).toContain('Regular entry:');
    expect(text).toContain(r.fit.label);
    expect(html).toContain('data-warning="CONDITIONAL"');
    expect(text).toContain(CONDITIONAL_MESSAGE);
    expect(html).toContain(`Why this order (score ${r.score!.total} out of ${r.score!.max})`);
    // The team summary is not shown when we hold the verbatim words.
    expect(text).not.toContain(nyitProgram.conditional_admission.value!.text);
    // Order: conditional details, then the deadline row, then time and cost.
    expect(html.indexOf('data-conditional')).toBeLessThan(html.indexOf('data-deadlines'));
    expect(html.indexOf('data-deadlines')).toBeLessThan(html.indexOf('Total time'));
    expectNoReviewNotes(html, rows);
    expectCleanCopy(html);
    expectSafeLinks(html);
  });

  it('the UCCS card warns that no lower limit is named and shows its deadline with days left and its note', () => {
    const r = plan.ranked.find((x) => x.id === 'conditional:uccs-mscs')!;
    const html = card(r);
    const text = decoded(html);
    expect(html).toContain('data-warning="CONDITIONAL_NO_FLOOR"');
    expect(text).toContain(NO_FLOOR_TEXT);
    expect(text).toContain('Application deadline');
    expect(text).toContain('1 Mar 2027 (97 days left)');
    expect(text).toContain(`Note: ${uccsProgram.deadline.note}`);
    expect(html).toContain('Why this order');
    expectNoReviewNotes(html, rows);
    expectCleanCopy(html);
  });

  it('the full page lists "Not decided yet" with Würzburg and a link to the shortlist (fit=unknown)', () => {
    const html = renderCards(plan);
    const text = decoded(html);
    const at = html.indexOf('id="undecided-h"');
    expect(at).toBeGreaterThan(-1);
    const section = decoded(html.slice(at, html.indexOf('id="improve-h"')));
    expect(section).toMatch(/\d+ programs need you to check the minimum grade on the official page/);
    expect(html).toContain('href="/shortlist?fit=unknown"');
    // Würzburg is no longer undecided: its German-scale conversion rule now has an official source.
    const w = section.slice(section.indexOf('data-undecided="wuerzburg-msc-cs"'));
    expect(w).toContain('Minimum grade not verified yet.');
    expect(w).toContain('Also shown above as a route');
    expect(section).not.toMatch(/no official source yet/);
    // "Routes with results" counts the conditional routes, including the one we cannot decide.
    expect(text).toContain('3 shown');
    // No "Not for your grade" section when nothing is below its own limit.
    expect(html).not.toContain('id="notforgrade-h"');
    expectNoReviewNotes(html, rows);
    expectCleanCopy(html);
    expectSafeLinks(html);
  });

  it('target=nyit-mscs: the target card points to its conditional route and the route card is labelled', () => {
    const p = build('nyit-mscs');
    const direct = decoded(renderToStaticMarkup(<DirectSection plan={p} programHref={(id) => `/program/${id}`} now={now} />));
    expect(direct).toContain('This program also has an official conditional route below its regular minimum.');
    expect(direct).toContain('Application deadline');
    const r = p.ranked.find((x) => x.id === 'conditional:nyit-mscs')!;
    const html = decoded(card(r));
    expect(html).toContain('Your target');
    expect(html).toContain(targetRouteNote('conditional'));
  });

  it('a 2.4 student sees NYIT under "Conditional routes: not for your grade" with the reason and source', () => {
    const p = buildPlanB({
      profile: { ...PERSONA_A, cgpa: 2.4 },
      programs: seed.programs,
      institutions: seed.institutions,
      rules: seed.conversionRules,
      fx: seed.fxRates,
      now,
    });
    const html = renderToStaticMarkup(<NotForYourGradeSection rows={p.notForYourGrade} programHref={(id) => `/program/${id}`} />);
    const text = decoded(html);
    expect(text).toContain('Conditional routes: not for your grade');
    expect(html).toContain('data-not-for-grade="nyit-mscs"');
    expect(text).toContain('Your grade, 2.4 on the CGPA (out of 4.0), is below the lower limit this route names (2.5).');
    expect(text).toContain(nyitProgram.conditional_admission.evidence_snippet!);
    expect(html).toContain(`href="${nyitProgram.conditional_admission.source_url}"`);
    expect(html).toContain('href="/program/nyit-mscs"');
    expectNoReviewNotes(html, rows);
    expectCleanCopy(html);
    expectSafeLinks(html);
  });
});

describe('fixture: a route whose deadline has passed (2 Dec 2026)', () => {
  const dec2 = new Date('2026-12-02T12:00:00Z');
  const dl = (iso: string) => ({ ...verified(iso, 1, 'https://fixture.example.edu/deadline'), fetched_at: '2026-12-01' });
  const progs: Program[] = [
    ...PROGRAMS,
    makeProgram({
      id: 'closed',
      institution_id: 'u-low',
      name: 'MSc Fixture Alpha Closed',
      min_gpa_rule: min(2),
      ...costed(12, 8_000, 5_000),
      deadline: dl('2026-11-30'),
    }),
  ];
  const plan = buildPlanB({ profile: student, programs: progs, institutions: INSTITUTIONS, rules: [], fx, now: dec2 });

  it('shows the passed deadline as a warning and on the deadline row, and ranks it below the open twin', () => {
    const r = plan.ranked.find((x) => x.program.id === 'closed')!;
    const html = renderToStaticMarkup(<RouteCard route={r} now={dec2} programHref="/program/closed" compare />);
    const text = decoded(html);
    expect(html).toContain('data-warning="DEADLINE_PASSED"');
    expect(text).toContain('The deadline we hold (30 Nov 2026) has passed');
    expect(text).toContain('The next deadline is not verified yet. Check the official page before you pay anything.');
    expect(text).toContain('30 Nov 2026 (This date has passed)');
    expect(html).toContain('href="https://fixture.example.edu/deadline"');
    expect(r.rank!).toBeGreaterThan(plan.ranked.find((x) => x.program.id === 'low')!.rank!);
    expectCleanCopy(html);
    expectSafeLinks(html);
  });

  it('an unknown deadline says "Not verified yet" with no days-left text', () => {
    const r = plan.ranked.find((x) => x.program.id === 'low')!;
    const html = decoded(renderToStaticMarkup(<RouteCard route={r} now={dec2} programHref="/program/low" compare />));
    const row = html.slice(html.indexOf('Application deadline'), html.indexOf('Total time'));
    expect(row).toContain('Not verified yet');
    expect(row).not.toMatch(/days? left/);
  });
});

describe('source rules', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return walk(p);
      return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
    });
  const files = ['src/lib/planb', 'src/app/plan-b', 'src/components/planb'].flatMap((d) => walk(d));

  it('never renders data as HTML and never reads the clock in the plan logic', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/dangerouslySetInnerHTML/);
      if (f.includes('lib')) expect(src, f).not.toMatch(/new Date\(\s*\)|Date\.now\(/);
    }
  });
});
