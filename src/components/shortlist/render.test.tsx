/**
 * Server-render smoke tests (node environment, no DOM library): the shortlist components render with
 * today's empty seed data AND with full fixture data, and follow the evidence rules
 * (badge on every value, "Not verified yet" for gaps, hardened links, no nested links, no percentages).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyFact } from '@/lib/confidence';
import { programTotalCost } from '@/lib/cost';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { PERSONA_A } from '@/lib/profile';
import { buildShortlist, closingSoon, planBTargetHref, type ShortlistInput } from '@/lib/shortlist';
import { FIXED_NOW, conflicting, likely, makeInstitution, makeProgram, verified, loadEmptySeedDataset } from '@/lib/test-fixtures';
import type { CountryFact, CountryFactValue, FxRate, Money, Profile, Program } from '@/lib/types';
import { ClosingSoon } from './closing-soon';
import { BUDGET_NEEDS_RATE, Filters, RankChips } from './controls';
import { CoverageMeter } from './coverage-meter';
import { EmptyFieldCard } from './empty-field';
import { TotalCostCell } from './fact-cells';
import { PLAN_B_LINK_TEXT, ProgramCard, ReasonNote, RuledOutCard } from './program-card';
import { ProgramTable } from './program-table';
import { SavedList } from './saved-list';
import { ShareShortlist } from './share-shortlist';

const now = FIXED_NOW;
const seed = loadEmptySeedDataset();
const details = (id: string) => `/program/${id}`;

const BANNED = [/guaranteed/i, /fastest citizenship/i, /chance/i, /\d\s*%/, /passport number/i, /probability/i];

function expectCleanCopy(html: string) {
  const copy = html.replace(/\sclass="[^"]*"/g, ''); // class names like w-[17%] are not copy
  for (const re of BANNED) expect(copy).not.toMatch(re);
  const external = html.match(/<a [^>]*target="_blank"[^>]*>/g) ?? [];
  for (const a of external) expect(a).toContain('rel="noopener noreferrer nofollow"');
  expect(html).not.toMatch(/href="javascript:/i);
  expect(hasNestedAnchor(html)).toBe(false);
}

/** True when an <a> opens inside another <a>. */
function hasNestedAnchor(html: string): boolean {
  let depth = 0;
  for (const m of html.matchAll(/<(\/?)a[\s>]/g)) {
    depth += m[1] ? -1 : 1;
    if (depth > 1) return true;
  }
  return false;
}

/* --------------------------------------------------------------- fixtures */
// Fictional "Fixture University" values only.

const gbp = (amount: number, period: Money['period'] = 'year'): Money => ({ amount, currency: 'GBP', period });
const fx: FxRate[] = [{ id: 'gbp-pkr', currency: 'GBP', pkr_per_unit: verified(100, 1, 'https://fixture.example.org/fx') }];
const fixtureCitizenship: CountryFact = {
  ...likely<CountryFactValue>({ text: 'Fixture citizenship rule wording.', sort_months: 48 }),
  id: 'uk-citizenship-rule',
  country: 'UK',
  key: 'citizenship_rule',
};
const profile: Profile = { cgpa: 3.0, scale: 'cgpa_4', min_pass: null, field: 'cs', budget_pkr: 5_000_000, target_countries: [] };

function full(overrides: Partial<Program> = {}): Program {
  return makeProgram({
    min_gpa_rule: verified({ scale: 'cgpa_4', min: 2.5 }),
    deadline: verified('2027-03-01'),
    tuition: verified(gbp(20_000)),
    living_cost: verified(gbp(10_000)),
    duration_months: verified(12),
    language_req: verified({ ielts_overall: 6.5 }),
    intake: verified('September 2027'),
    ...overrides,
  });
}

function fixtureInput(programs: Program[], over: Partial<ShortlistInput> = {}): ShortlistInput {
  return {
    programs,
    institutions: [makeInstitution()],
    countryFacts: [fixtureCitizenship],
    conversionRules: [],
    fxRates: fx,
    profile,
    now,
    ...over,
  };
}

/* ------------------------------------------------------------ seed (today) */

describe('shortlist components — seed data with persona A (today)', () => {
  const s = buildShortlist({ ...seed, profile: PERSONA_A, now });

  it('a not-ranked card shows "Not verified yet" with badges, the reason, and a university link from data', () => {
    const row = s.notRanked.find((r) => r.program.id === 'tum-msc-informatics')!;
    const html = renderToStaticMarkup(
      <ProgramCard
        row={row}
        now={now}
        rankBy="fit"
        detailsHref={details(row.program.id)}
        note={<ReasonNote title="Not ranked because" reasons={[row.reason]} />}
      />,
    );
    expectCleanCopy(html);
    expect(html).toContain('Germany');
    expect(html).toContain('Competitive range unknown');
    expect(html).toContain('Not verified yet');
    expect(html).toContain('Unverified');
    expect(html).toContain('Minimum grade not verified yet');
    expect(html).toContain('href="/program/tum-msc-informatics"');
    expect(html).toContain('href="https://www.tum.de/"'); // institution website from data (no program page yet)
    expect(html).toContain('aria-pressed="false"'); // SaveButton
    expect(html).not.toContain('Rank ');
    // Germany's citizenship rule is a Likely row: its exact wording is shown, not a paraphrase.
    expect(html).toContain('At least 5 years of legal residence in Germany before applying for naturalisation.');
    expect(html).toContain('Likely');
    expect(html).toContain('href="/citizenship"');
  });

  it("Canada's rule keeps its own wording (no code paraphrase of 1,095 days)", () => {
    const row = s.notRanked.find((r) => r.program.country === 'CA')!;
    const html = renderToStaticMarkup(<ProgramCard row={row} now={now} rankBy="fit" detailsHref={details(row.program.id)} />);
    expect(html).toContain('1,095 days');
    expect(html).not.toMatch(/3 years of residence/);
  });

  it('the LJMU ruled-out card shows the status note with its computed badge and note', () => {
    const row = s.ruledOut[0];
    const html = renderToStaticMarkup(<RuledOutCard row={row} now={now} detailsHref={details(row.program.id)} />);
    expectCleanCopy(html);
    expect(html).toContain('Ruled out');
    expect(html).toContain('Not accepting Pakistan applicants');
    expect(html).toContain('Unverified');
    expect(html).toContain('Reported, not yet verified');
  });

  it('the not-ranked table lists each reason', () => {
    const html = renderToStaticMarkup(
      <ProgramTable
        rows={s.notRanked.map((r) => ({ ...r, reasons: [r.reason] }))}
        now={now}
        rankBy="fit"
        caption="Programs not ranked"
        reasonHeader="Why not ranked"
        detailsHref={details}
      />,
    );
    expectCleanCopy(html);
    expect(html).toContain('Why not ranked');
    expect(html).not.toContain('Ranked on');
    expect(html.match(/<tr[\s>]/g)?.length).toBe(s.notRanked.length + 1); // header + one row each
  });

  it('coverage meter shows "0 of N" with an accessible progress element', () => {
    const html = renderToStaticMarkup(<CoverageMeter coverage={s.coverage} fieldLabel={s.field.label} />);
    expect(html).toContain(`0 of ${s.coverage.total}`);
    expect(html).toMatch(/<progress[^>]*value="0"/);
    expect(html).toMatch(/aria-label="0 of \d+ Computer Science programs fully verified"/);
  });

  it('controls: rank chips are links with an order toggle; no intake chips without usable intakes', () => {
    const chips = renderToStaticMarkup(<RankChips sp={{}} shortlist={s} />);
    for (const label of ['Fit', 'Tuition', 'Total cost', 'Citizenship rule', 'Study time', 'Deadline']) {
      expect(chips).toContain(`>${label}</a>`);
    }
    expect(chips).toContain('href="/shortlist?rank=tuition"');
    expect(chips).toContain('href="/shortlist?dir=desc"');
    expect(chips).toContain('aria-current="true"');

    const filters = renderToStaticMarkup(<Filters sp={{}} shortlist={s} profile={PERSONA_A} />);
    expect(filters).toContain('<details');
    expect(filters).toContain('Filters</summary>'); // label without a count
    expect(filters).not.toContain('Intake');
    expect(filters).toContain('Within my budget');
    expect(filters).toContain('Showing the countries from your profile.');
    expect(filters).toContain('Switzerland');
    expect(filters).not.toContain('Clear filters');
  });

  it('filters with active chips show the count and "Clear filters"', () => {
    const sp = { inbudget: '1', fit: 'meets' };
    const active = buildShortlist({ ...seed, profile: PERSONA_A, now, query: { budget: true, fit: ['meets'] } });
    const html = renderToStaticMarkup(<Filters sp={sp} shortlist={active} profile={PERSONA_A} />);
    expect(html).toContain('Filters (2)');
    expect(html).toContain('Clear filters');
    // Every program needs data it does not have: listed under "Can't check", none dropped.
    expect(active.cantCheck.length).toBeGreaterThan(0);
    const row = active.cantCheck[0];
    const card = renderToStaticMarkup(
      <ProgramCard
        row={row}
        now={now}
        rankBy="fit"
        detailsHref={details(row.program.id)}
        note={<ReasonNote title="We can't check this filter" reasons={row.reasons} />}
      />,
    );
    expect(card).toContain('Fit: minimum grade not verified yet');
    expect(card).toContain('Budget: Tuition not verified yet');
  });

  it('saved list renders a skeleton on the server (localStorage is read after hydration)', () => {
    const html = renderToStaticMarkup(
      <SavedList programs={[{ id: 'x', name: 'MSc Fixture', institutionName: 'Fixture University', country: 'UK', status: 'active' }]} />,
    );
    expect(html).toContain('aria-busy="true"');
  });
});

/* --------------------------------------------------------- full fixture data */

describe('shortlist components — full fixture data', () => {
  const a = full({ id: 'a', name: 'MSc Fixture A', tuition: verified(gbp(30_000)) });
  const b = full({ id: 'b', name: 'MSc Fixture B', tuition: verified(gbp(10_000)) });

  it('a ranked card shows the rank, fit, values with badges and "Ranked on" for tuition', () => {
    const s = buildShortlist(fixtureInput([a, b], { query: { rank: 'tuition' } }));
    const r = s.ranked[0];
    expect(r.program.id).toBe('b');
    const html = renderToStaticMarkup(
      <ProgramCard row={r} now={now} rank={r.rank} rankKey={r.key} rankBy="tuition" detailsHref={details(r.program.id)} />,
    );
    expectCleanCopy(html);
    expect(html).toContain('aria-label="Rank 1"');
    expect(html).toContain('Meets minimum');
    expect(html).toContain('1 Mar 2027');
    expect(html).toContain('£10,000 per year');
    expect(html).toContain('Ranked on');
    expect(html).toContain('PKR 1,000,000 (10 lakh) tuition for the whole programme');
    expect(html).toContain('PKR 2,000,000 (20 lakh)'); // total cost
    expect(html).toContain('Within your budget');
    expect(html).toContain('Fixture citizenship rule wording.');
    expect(html).toContain('Verified');
    expect(html).toContain('Official program page');
    expect(html).not.toContain('Not verified yet');
  });

  it('the ranked table adds a "Ranked on" column for keys without their own column', () => {
    const s = buildShortlist(fixtureInput([a, b], { query: { rank: 'study' } }));
    const html = renderToStaticMarkup(
      <ProgramTable rows={s.ranked} now={now} rankBy="study" caption="Ranked" detailsHref={details} />,
    );
    expectCleanCopy(html);
    expect(html).toContain('Ranked on');
    expect(html).toContain('1 year');
    const byFit = renderToStaticMarkup(
      <ProgramTable rows={buildShortlist(fixtureInput([a, b])).ranked} now={now} rankBy="fit" caption="Ranked" detailsHref={details} />,
    );
    expect(byFit).not.toContain('Ranked on');
    expect(byFit).toContain('aria-label="Rank 2"');
  });

  it('a conflicting deadline shows "Sources disagree" with a Conflict badge, never a single value', () => {
    const c = full({ id: 'c', name: 'MSc Fixture C', deadline: conflicting('2027-01-01', '2027-02-01') });
    const s = buildShortlist(fixtureInput([c], { query: { rank: 'deadline' } }));
    expect(s.notRanked[0].reason).toBe('Deadline sources conflict');
    const html = renderToStaticMarkup(<ProgramCard row={s.notRanked[0]} now={now} rankBy="deadline" detailsHref={details('c')} />);
    expect(html).toContain('Sources disagree');
    expect(html).toContain('Conflict');
    expect(html).not.toContain('1 Jan 2027');
  });

  it('intake chips appear only for usable intake values', () => {
    const spring = full({ id: 's', name: 'MSc Fixture S', intake: verified('January 2028') });
    const hidden = full({ id: 'h', name: 'MSc Fixture H', intake: { ...emptyFact<string>(), value: 'October 2028' } });
    const s = buildShortlist(fixtureInput([a, spring, hidden]));
    const html = renderToStaticMarkup(<Filters sp={{}} shortlist={s} profile={profile} />);
    expect(html).toContain('>September</a>');
    expect(html).toContain('>January</a>');
    expect(html).toContain('href="/shortlist?intake=january&amp;panel=filters"');
    expect(html).not.toContain('October');
  });

  it('without a profile budget the budget chip becomes a link to add one', () => {
    const noBudget = { ...profile, budget_pkr: null };
    const s = buildShortlist(fixtureInput([a], { profile: noBudget }));
    const html = renderToStaticMarkup(<Filters sp={{}} shortlist={s} profile={noBudget} />);
    expect(html).toContain('Add a budget to filter by cost');
    expect(html).not.toContain('Within my budget');
  });
});

describe('source rules for shortlist files', () => {
  const roots = ['src/components/shortlist', 'src/app/shortlist', 'src/app/saved', 'src/lib/shortlist'];
  const files = roots.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => join(dir, f)),
  );

  it('never renders HTML from data and never uses the deleted default palette', () => {
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toContain('dangerouslySetInnerHTML');
      expect(src, f).not.toMatch(/\b(?:bg|text|border)-(?:red|gray|blue|green|slate|zinc|neutral|amber|emerald)-\d{2,3}\b/);
      expect(src, f).not.toMatch(/new Date\(\)/);
    }
  });
});

/* ------------------------------------------- notes on cards (review finding) */

/** React's text escaping, so a raw string can be searched for in rendered markup. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

describe('shortlist notes — live seed data', () => {
  const live = loadSeedDataset();
  const s = buildShortlist({ ...live, profile: { ...PERSONA_A, target_countries: [] }, now });
  const rows = [...s.ranked, ...s.notRanked, ...s.cantCheck];
  const row = (id: string) => {
    const r = rows.find((x) => x.program.id === id);
    if (!r) throw new Error(`missing ${id}`);
    return r;
  };
  const card = (id: string) => renderToStaticMarkup(<ProgramCard row={row(id)} now={now} rankBy="fit" detailsHref={details(id)} />);

  it("Brookes' card shows its verified Pakistan note as a \"Note\" row with badge and source", () => {
    const html = card('brookes-msc-cs');
    expectCleanCopy(html);
    expect(html).toContain('>Note</dt>');
    expect(html).toContain('Extra compliance measures for Pakistan applicants');
    expect(html).toContain('no offers beyond 23 October 2026');
    expect(html).toContain('href="https://www.brookes.ac.uk/study/international-students/applying-to-arriving/how-to-apply"');
    const noteRow = html.slice(html.indexOf('>Note</dt>'), html.indexOf('>Deadline</dt>'));
    expect(noteRow).toContain('Verified');
    // Brookes is a direct-entry course: no "Who it's for" warning.
    expect(html).not.toContain('Who it&#x27;s for');
  });

  it('Imperial and QMUL cards show a "! Who it\'s for" warning with the official wording, badge and source', () => {
    for (const [id, text] of [
      ['imperial-msc-computing', 'For graduates of subjects other than computing'],
      ['qmul-premasters-cs', 'not related to Computer Science, Software Engineering'],
    ] as const) {
      const html = card(id);
      expectCleanCopy(html);
      const start = html.indexOf('role="note"');
      expect(start, id).toBeGreaterThan(-1);
      const box = html.slice(start, html.indexOf('</div>', start));
      expect(box).toContain('aria-label="Who it&#x27;s for"');
      expect(box).toContain('!');
      expect(box).toContain('Who it&#x27;s for:');
      expect(box).toContain(text);
      expect(box).toContain('Verified');
      expect(box).toContain('href="https://www.');
      expect(box).toContain('border-conflict-fg');
      expect(box).toContain('It does not change the fit result.');
      expect(html).not.toContain('>Note</dt>');
    }
  });

  it('a program with no notes shows neither row', () => {
    const html = card('tum-msc-informatics');
    expect(html).not.toContain('Who it&#x27;s for');
    expect(html).not.toContain('>Note</dt>');
  });

  it('the desktop table shows compact markers that open to the full text', () => {
    const html = renderToStaticMarkup(
      <ProgramTable
        rows={[row('brookes-msc-cs'), row('imperial-msc-computing'), row('tum-msc-informatics')]}
        now={now}
        rankBy="fit"
        caption="Programs"
        detailsHref={details}
      />,
    );
    expectCleanCopy(html);
    expect(html.match(/<details/g)?.length).toBe(2);
    expect(html).toMatch(/<summary[^>]*>.*Who it&#x27;s for<\/span><\/summary>/);
    expect(html).toMatch(/<summary[^>]*>.*Note<\/summary>/);
    expect(html).toContain('Extra compliance measures for Pakistan applicants');
    expect(html).toContain('For graduates of subjects other than computing');
  });

  it('student-facing notes on deadline and tuition are shown; internal review notes never are', () => {
    expect(card('brookes-msc-cs')).toContain('Note: £20,800 is the 2027/28 international fee');
    expect(card('usf-mscs')).toContain('Fall priority deadline of January 15');

    for (const r of rows) {
      const html = card(r.program.id);
      const table = renderToStaticMarkup(<ProgramTable rows={[r]} now={now} rankBy="study" caption="x" detailsHref={details} />);
      for (const v of Object.values(r.program)) {
        if (!v || typeof v !== 'object' || !('review_note' in v) || !v.review_note) continue;
        const internal = escapeHtml(String(v.review_note));
        expect(html, r.program.id).not.toContain(internal);
        expect(table, r.program.id).not.toContain(internal);
      }
    }
  });
});

describe('shortlist notes — fixtures', () => {
  it('an Unverified note is not shown on the card; a Likely one is, with its badge', () => {
    const unv = buildShortlist(
      fixtureInput([full({ id: 'u', status_note: { ...emptyFact<string>(), value: 'Fixture rumour' }, eligibility_note: { ...emptyFact<string>(), value: 'Fixture rumour' } })]),
    ).ranked[0];
    const unvHtml = renderToStaticMarkup(<ProgramCard row={unv} now={now} rankBy="fit" detailsHref={details('u')} />);
    expect(unvHtml).not.toContain('Fixture rumour');

    const lik = buildShortlist(fixtureInput([full({ id: 'l', eligibility_note: likely('Fixture for other subjects') })])).ranked[0];
    const likHtml = renderToStaticMarkup(<ProgramCard row={lik} now={now} rankBy="fit" detailsHref={details('l')} />);
    expect(likHtml).toContain('Fixture for other subjects');
    expect(likHtml).toContain('Likely');
    expect(likHtml).toContain('href="https://fixture.example.edu/summary"');
  });

  it('a Conflict eligibility note shows both values and both links', () => {
    const c = buildShortlist(fixtureInput([full({ id: 'c', eligibility_note: conflicting('Fixture wording A', 'Fixture wording B') })])).ranked[0];
    const html = renderToStaticMarkup(<ProgramCard row={c} now={now} rankBy="fit" detailsHref={details('c')} />);
    expectCleanCopy(html);
    expect(html).toContain('Who it&#x27;s for');
    expect(html).toContain('Conflict');
    expect(html).toContain('Fixture wording A');
    expect(html).toContain('Fixture wording B');
    expect(html).toContain('href="https://fixture.example.edu/page-a"');
    expect(html).toContain('href="https://fixture.example.edu/page-b"');
  });

  it('a fact note is shown under its value, but review_note never is; a ruled-out card keeps its own layout', () => {
    const p = full({
      id: 'n',
      deadline: { ...verified('2027-03-01'), note: 'Fixture noon cut-off.', review_note: 'Fixture internal reviewer text.' },
      status_note: { ...verified('Fixture active note'), review_note: 'Fixture internal status text.' },
    });
    const r = buildShortlist(fixtureInput([p])).ranked[0];
    const html = renderToStaticMarkup(<ProgramCard row={r} now={now} rankBy="fit" detailsHref={details('n')} />);
    expect(html).toContain('Note: Fixture noon cut-off.');
    expect(html).toContain('Fixture active note');
    expect(html).not.toContain('Fixture internal');

    const out = buildShortlist(fixtureInput([full({ id: 'o', status: 'ruled_out', status_note: verified('Fixture out note') })])).ruledOut[0];
    const outHtml = renderToStaticMarkup(<RuledOutCard row={out} now={now} detailsHref={details('o')} />);
    expect(outHtml).toContain('Fixture out note');
    expect(outHtml).not.toContain('>Note</dt>');
  });
});

describe('coverage meter wording with 20 facts per program', () => {
  it('says "N of M individual facts verified" and "fully verified"', () => {
    // 20 fact fields per program: the 18 before, plus conditional_admission and language_waiver.
    const FACTS_PER_PROGRAM = 20;
    const live = loadSeedDataset();
    const s = buildShortlist({ ...live, profile: PERSONA_A, now });
    const n = live.programs.filter((p) => p.field === 'cs' && p.status === 'active').length;
    expect(s.coverage.facts.total).toBe(FACTS_PER_PROGRAM * n);
    const html = renderToStaticMarkup(<CoverageMeter coverage={s.coverage} fieldLabel={s.field.label} />);
    expect(html).toContain(`of ${FACTS_PER_PROGRAM * n} individual facts verified`);
    expect(html).toContain('Computer Science programs fully verified');
  });
});

/* ------------------------------------------- wave: deadlines, Plan B, routes, budget, share */

const DEC_2 = new Date('2026-12-02T09:00:00Z');
const PQ = '?cgpa=2.5&scale=cgpa_4&field=cs';
const planB = (id: string) => planBTargetHref(PQ, id);

describe('deadline cells: days left on every card and table row', () => {
  it('"N days left", "Closes today", "Date has passed"; never a countdown for an Unverified date', () => {
    const card = (deadline: Program['deadline'], at: Date) => {
      const r = buildShortlist(fixtureInput([full({ id: 'x', deadline })], { now: at })).ranked[0];
      return renderToStaticMarkup(<ProgramCard row={r} now={at} rankBy="fit" detailsHref={details('x')} />);
    };
    const open = card(verified('2027-03-01'), now);
    expectCleanCopy(open);
    expect(open).toContain('1 Mar 2027');
    expect(open).toContain('97 days left');
    expect(card(verified('2026-12-03'), DEC_2)).toContain('1 day left');
    const today = card(verified('2026-12-02'), DEC_2);
    expect(today).toContain('Closes today');
    expect(today).not.toContain('days left');
    const passed = card(verified('2026-11-30'), DEC_2);
    expect(passed).toContain('30 Nov 2026');
    expect(passed).toContain('Date has passed');
    expect(passed).not.toContain('days left');
    const unv = card({ ...emptyFact<string>(), value: '2027-01-01' }, now);
    expect(unv).toContain('1 Jan 2027');
    expect(unv).toContain('Unverified');
    expect(unv).not.toMatch(/days? left|Closes today|Date has passed/);
    const table = renderToStaticMarkup(
      <ProgramTable
        rows={buildShortlist(fixtureInput([full({ id: 'x', deadline: verified('2027-03-01') })])).ranked}
        now={now}
        rankBy="fit"
        caption="x"
        detailsHref={details}
      />,
    );
    expect(table).toContain('97 days left');
  });

  it('live seed, 2 Dec 2026, rank by deadline: ETH is under "Not ranked" with its date, "Date has passed" and the reason', () => {
    const live = loadSeedDataset();
    const s = buildShortlist({ ...live, profile: { ...PERSONA_A, target_countries: [] }, now: DEC_2, query: { rank: 'deadline' } });
    expect(s.ranked[0].program.id).toBe('cmu-mscs');
    const cmu = renderToStaticMarkup(
      <ProgramCard row={s.ranked[0]} now={DEC_2} rank={1} rankKey={s.ranked[0].key} rankBy="deadline" detailsHref={details('cmu-mscs')} />,
    );
    expect(cmu).toContain('9 Dec 2026');
    expect(cmu).toContain('7 days left');
    const eth = s.notRanked.find((r) => r.program.id === 'ethz-msc-cs')!;
    const html = renderToStaticMarkup(
      <ProgramCard
        row={eth}
        now={DEC_2}
        rankBy="deadline"
        detailsHref={details(eth.program.id)}
        note={<ReasonNote title="Not ranked because" reasons={[eth.reason]} />}
      />,
    );
    expectCleanCopy(html);
    expect(html).toContain('30 Nov 2026');
    expect(html).toContain('Date has passed');
    expect(html).toContain('Deadline has passed (30 Nov 2026). The next deadline is not verified yet.');
    expect(html).not.toContain('Rank 1');
  });
});

describe('"Deadlines in the next 30 days" strip', () => {
  const live = loadSeedDataset();

  it("persona A on 24 Nov: UIUC and Toronto (7 days), then CMU (15), each with its badge, link and the university's note", () => {
    const s = buildShortlist({ ...live, profile: PERSONA_A, now });
    const html = renderToStaticMarkup(<ClosingSoon rows={closingSoon(s, now)} detailsHref={(id) => `/program/${id}${PQ}`} />);
    expectCleanCopy(html);
    expect(html).toContain('Deadlines in the next 30 days');
    const order = [...html.matchAll(/data-closing-soon="([^"]+)"/g)].map((m) => m[1]);
    expect(order.slice(0, 2).sort()).toEqual(['uiuc-mscs', 'utoronto-mscac']);
    expect(order[2]).toBe('cmu-mscs');
    expect(order).toHaveLength(3);
    expect(html).toContain('href="/program/cmu-mscs?cgpa=2.5&amp;scale=cgpa_4&amp;field=cs"');
    expect(html.match(/7 days left/g)).toHaveLength(2);
    expect(html).toContain('15 days left');
    expect(html).toContain('1 Dec 2026');
    expect(html).toContain('9 Dec 2026');
    expect(html).toContain('Verified');
    expect(html).toContain('Likely');
    expect(html).toContain('11:59 p.m. Toronto time (ET)');
    expect(html).toContain('Dates are the university&#x27;s own. Check the cut-off time and time zone on the official page.');
    for (const r of closingSoon(s, now)) {
      if (r.program.deadline.review_note) expect(html).not.toContain(escapeHtml(r.program.deadline.review_note));
    }
  });

  it('on 2 Dec only CMU is left (7 days); with nothing in the window the strip renders nothing', () => {
    const s = buildShortlist({ ...live, profile: PERSONA_A, now: DEC_2 });
    const html = renderToStaticMarkup(<ClosingSoon rows={closingSoon(s, DEC_2)} detailsHref={details} />);
    expect([...html.matchAll(/data-closing-soon="([^"]+)"/g)].map((m) => m[1])).toEqual(['cmu-mscs']);
    expect(html).toContain('7 days left');
    expect(renderToStaticMarkup(<ClosingSoon rows={[]} detailsHref={details} />)).toBe('');
    const later = new Date('2027-07-01T00:00:00Z');
    expect(closingSoon(buildShortlist({ ...live, profile: PERSONA_A, now: later }), later)).toEqual([]);
  });

  it('a deadline closing today says "Closes today"', () => {
    const s = buildShortlist(fixtureInput([full({ id: 't', deadline: verified('2026-12-02') })], { now: DEC_2 }));
    const html = renderToStaticMarkup(<ClosingSoon rows={closingSoon(s, DEC_2)} detailsHref={details} />);
    expect(html).toContain('Closes today');
  });
});

describe('Plan B link and the official route below the minimum', () => {
  const live = loadSeedDataset();
  const s = buildShortlist({ ...live, profile: { ...PERSONA_A, target_countries: [] }, now });
  const rows = [...s.ranked, ...s.notRanked, ...s.cantCheck];
  const row = (id: string) => rows.find((r) => r.program.id === id)!;
  const card = (id: string) =>
    renderToStaticMarkup(<ProgramCard row={row(id)} now={now} rankBy="fit" detailsHref={details(id)} planBHref={planB(id)} />);

  it('Brookes and USF (Below minimum) link to Plan B with the profile and target; the fit label stays', () => {
    for (const id of ['brookes-msc-cs', 'usf-mscs']) {
      const html = card(id);
      expectCleanCopy(html);
      expect(html, id).toContain(PLAN_B_LINK_TEXT);
      expect(html, id).toContain(`href="/plan-b?cgpa=2.5&amp;scale=cgpa_4&amp;field=cs&amp;target=${id}"`);
      expect(html, id).toContain('Below minimum');
    }
    // Not for an undecided fit, and never without an href.
    expect(card('tum-msc-informatics')).not.toContain(PLAN_B_LINK_TEXT);
    const noHref = renderToStaticMarkup(<ProgramCard row={row('brookes-msc-cs')} now={now} rankBy="fit" detailsHref={details('x')} />);
    expect(noHref).not.toContain(PLAN_B_LINK_TEXT);
  });

  it('fixtures: no link when the minimum is met or for a pre-masters route', () => {
    const meets = buildShortlist(fixtureInput([full({ id: 'm' })])).ranked[0];
    expect(renderToStaticMarkup(<ProgramCard row={meets} now={now} rankBy="fit" detailsHref={details('m')} planBHref={planB('m')} />)).not.toContain(
      PLAN_B_LINK_TEXT,
    );
    const pre = buildShortlist(
      fixtureInput([full({ id: 'p', pathway_type: 'pre_masters', min_gpa_rule: verified({ scale: 'cgpa_4', min: 3.5 }) })]),
    ).ranked[0];
    expect(pre.fit.label).toBe('Below minimum');
    expect(renderToStaticMarkup(<ProgramCard row={pre} now={now} rankBy="fit" detailsHref={details('p')} planBHref={planB('p')} />)).not.toContain(
      PLAN_B_LINK_TEXT,
    );
  });

  it('the table shows the link in the Fit column, only where it applies', () => {
    const html = renderToStaticMarkup(
      <ProgramTable rows={[row('brookes-msc-cs'), row('tum-msc-informatics')]} now={now} rankBy="fit" caption="x" detailsHref={details} planBHref={planB} />,
    );
    expectCleanCopy(html);
    expect(html.match(/data-plan-b-link/g)).toHaveLength(1);
    expect(html).toContain('target=brookes-msc-cs');
  });

  it('UCCS, NYIT and Würzburg cards show "Official route below the minimum" with the text, badge and source', () => {
    const uccs = card('uccs-mscs');
    expectCleanCopy(uccs);
    expect(uccs).toContain('>Official route below the minimum</dt>');
    expect(uccs).toContain('if admitted at all, expect provisional admission');
    expect(uccs).toContain('href="https://eas.uccs.edu/academics/programs/computer-science-ms"');
    expect(uccs).toContain('It does not change the fit result.');
    const routeRow = uccs.slice(uccs.indexOf('data-conditional-route'), uccs.indexOf('>Deadline</dt>'));
    expect(routeRow).toMatch(/Verified|Likely/);
    // The fit label is the one code computed without the route.
    expect(uccs).toContain(row('uccs-mscs').fit.label);
    expect(row('uccs-mscs').fit.label).toBe('Below minimum'); // minimum 3.0 verified on 2026-11-27

    const nyit = card('nyit-mscs');
    expect(nyit).toContain('>Official route below the minimum</dt>');
    expect(nyit).toContain('Undergraduate GPA between 2.5 and 2.84');
    expect(nyit).toContain('href="https://catalog.nyit.edu/engineering/computer_science_ms/"');
    expect(card('wuerzburg-msc-cs')).toContain('>Official route below the minimum</dt>');
    expect(card('tum-msc-informatics')).not.toContain('Official route below the minimum');
    for (const id of ['uccs-mscs', 'nyit-mscs', 'wuerzburg-msc-cs']) {
      const note = row(id).program.conditional_admission.review_note;
      if (note) expect(card(id), id).not.toContain(escapeHtml(note));
    }
  });

  it('the table shows the route as a compact marker that opens to the full text', () => {
    const html = renderToStaticMarkup(
      <ProgramTable rows={[row('uccs-mscs'), row('tum-msc-informatics')]} now={now} rankBy="fit" caption="x" detailsHref={details} />,
    );
    expectCleanCopy(html);
    expect(html).toMatch(/<summary[^>]*>Official route below the minimum<\/summary>/);
    expect(html.match(/data-conditional-route/g)).toHaveLength(1);
    expect(html).toContain('expect provisional admission');
  });

  it('fixtures: not shown when the regular minimum is met, or when the route is Unverified', () => {
    const route = { scale: 'cgpa_4' as const, min: 2.5, text: 'Fixture conditional route' };
    const meets = buildShortlist(fixtureInput([full({ id: 'm', conditional_admission: verified(route) })])).ranked[0];
    expect(meets.fit.label).toBe('Meets minimum');
    expect(renderToStaticMarkup(<ProgramCard row={meets} now={now} rankBy="fit" detailsHref={details('m')} />)).not.toContain(
      'Fixture conditional route',
    );
    const unv = buildShortlist(
      fixtureInput([
        full({ id: 'u', min_gpa_rule: verified({ scale: 'cgpa_4', min: 3.5 }), conditional_admission: { ...emptyFact<typeof route>(), value: route } }),
      ]),
    ).ranked[0];
    expect(renderToStaticMarkup(<ProgramCard row={unv} now={now} rankBy="fit" detailsHref={details('u')} />)).not.toContain(
      'Fixture conditional route',
    );
    const below = buildShortlist(
      fixtureInput([full({ id: 'b', min_gpa_rule: verified({ scale: 'cgpa_4', min: 3.5 }), conditional_admission: likely(route) })]),
    ).ranked[0];
    const html = renderToStaticMarkup(<ProgramCard row={below} now={now} rankBy="fit" detailsHref={details('b')} />);
    expect(html).toContain('Fixture conditional route');
    expect(html).toContain('Likely');
    expect(html).toContain('Below minimum');
  });
});

describe('budget chip, empty field, share and cost caveats', () => {
  const live = loadSeedDataset();

  it('"Within my budget" explains itself while no PKR rate is usable; the behaviour is unchanged', () => {
    // The live seed now has dated State Bank of Pakistan rates, so blank them to test the no-rate behaviour.
    const noRates = live.fxRates.map((r) => ({ ...r, pkr_per_unit: { value: null, source_url: null, evidence_snippet: null, fetched_at: null } }));
    const s = buildShortlist({ ...live, fxRates: noRates, profile: PERSONA_A, now, query: { budget: true } });
    expect(s.options.pkrRateAvailable).toBe(false);
    const html = renderToStaticMarkup(<Filters sp={{ inbudget: '1' }} shortlist={s} profile={PERSONA_A} />);
    expect(html).toContain('Within my budget');
    expect(html).toContain(BUDGET_NEEDS_RATE);
    expect(BUDGET_NEEDS_RATE).toBe('Needs a verified PKR exchange rate. None yet.');
    // Same behaviour as before: every program goes to "Can't check", none is dropped.
    expect(s.ranked).toHaveLength(0);
    expect(s.hidden.budget).toBe(0);

    const withRate = buildShortlist(fixtureInput([full()]));
    expect(renderToStaticMarkup(<Filters sp={{}} shortlist={withRate} profile={profile} />)).not.toContain(BUDGET_NEEDS_RATE);
    const noBudget = { ...PERSONA_A, budget_pkr: null };
    const nb = buildShortlist({ ...live, fxRates: noRates, profile: noBudget, now });
    expect(renderToStaticMarkup(<Filters sp={{}} shortlist={nb} profile={noBudget} />)).not.toContain(BUDGET_NEEDS_RATE);
  });

  it('an empty field offers Computer Science in one tap, keeping grade, budget and countries (no name or university)', () => {
    // 'other' has no seeded programs (Data Science, Software and Electrical Engineering do since 27 Nov 2026).
    const ds = { ...PERSONA_A, field: 'other' };
    const s = buildShortlist({ ...live, profile: ds, now });
    const html = renderToStaticMarkup(<EmptyFieldCard shortlist={s} profile={ds} />);
    expectCleanCopy(html);
    expect(html).toContain('No programs for your field yet');
    expect(html).toContain('See Computer Science programs (the closest field we have)');
    const tag = html.match(/<a [^>]*data-fallback-field="cs"[^>]*>/)?.[0] ?? '';
    const href = tag.match(/href="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
    expect(href).toBeDefined();
    const u = new URL(href!, 'https://masterspath.example');
    expect(u.pathname).toBe('/shortlist');
    expect(u.searchParams.get('field')).toBe('cs');
    expect(u.searchParams.get('cgpa')).toBe('2.5');
    expect(u.searchParams.get('scale')).toBe('cgpa_4');
    expect(u.searchParams.get('budget')).toBe('6000000');
    expect(u.searchParams.get('countries')).toBe('DE,UK,CA,US');
    expect(html).not.toContain('Demo Private University');
    expect(html).toContain('Check on each official page that the course fits your degree before you apply.');

    const none = renderToStaticMarkup(<EmptyFieldCard shortlist={{ ...s, fallbackField: null }} profile={ds} />);
    expect(none).not.toContain('closest field');
    expect(none).toContain('Change my field');
  });

  it('"Share my shortlist" renders a button and the privacy line; the WhatsApp fallback appears only after a tap', () => {
    const html = renderToStaticMarkup(<ShareShortlist path="/shortlist?cgpa=2.5&scale=cgpa_4&field=cs" />);
    expectCleanCopy(html);
    expect(html).toContain('type="button"');
    expect(html).toContain('Share my shortlist');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('The link contains your grade, field, budget and countries. It never contains your name or university.');
    expect(html).not.toContain('wa.me');
  });

  it('caveats from cost.ts appear under a shown total; nothing extra without one', () => {
    const p = full({ tuition: { ...verified({ amount: 20_000, currency: 'GBP', period: 'year' as const }), note: 'Fixture semester fee extra.' } });
    const cost = programTotalCost(p, fx, now);
    expect(cost.pkr).not.toBeNull();
    const html = renderToStaticMarkup(<TotalCostCell cost={cost} withinBudget={null} />);
    expect(html).toContain('Tuition: Fixture semester fee extra.');
    const plain = renderToStaticMarkup(<TotalCostCell cost={programTotalCost(full(), fx, now)} withinBudget={null} />);
    expect(plain).not.toContain('data-cost-caveat');
    // A card shows it under "Total cost" too.
    const r = buildShortlist(fixtureInput([p])).ranked[0];
    const card = renderToStaticMarkup(<ProgramCard row={r} now={now} rankBy="fit" detailsHref={details('x')} />);
    const totalRow = card.slice(card.indexOf('>Total cost</dt>'), card.indexOf('>Citizenship rule</dt>'));
    expect(totalRow).toContain('Tuition: Fixture semester fee extra.');
  });
});
