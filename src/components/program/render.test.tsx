/**
 * Server-render smoke tests (node environment, no DOM library) for the program page building blocks.
 * Each block renders with today's EMPTY seed data and with FULL fixture data ("Fixture University" values only),
 * and follows the evidence rules: badges everywhere, "Not verified yet" + official link, both sources on Conflict,
 * plain text only.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyFact } from '@/lib/confidence';
import { programTotalCost } from '@/lib/cost';
import { buildChecklist } from '@/lib/program/checklist';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { computeCoverage, FACT_SECTIONS, PROGRAM_FACT_KEYS, reportFieldOptions } from '@/lib/program/fields';
import { programForFitPanel } from '@/lib/program/fit-view';
import { PERSONA_A } from '@/lib/profile';
import {
  conflicting,
  FIXED_NOW,
  likely,
  makeInstitution,
  makeProgram,
  unverified,
  verified,
  loadEmptySeedDataset,
} from '@/lib/test-fixtures';
import type { ConditionalAdmission, CountryFact, Fact, FxRate, GpaRule, Money, Profile, Program } from '@/lib/types';
import type { CostResult } from '@/lib/cost';
import { missingFactQuestions, usableAdmissionsEmail } from '@/lib/program/ask-university';
import { clientNow, DaysLeft, daysLeftSnapshot } from '@/components/ui/days-left';
import { AskUniversity } from './ask-university';
import { CitizenshipSnapshot, RecognitionSection, ResearchSection } from './context-sections';
import { CostSummary, costCaveats } from './cost-summary';
import { EligibilityCallout } from './eligibility-callout';
import { ProgramFactSection, type ConflictContext } from './fact-section';
import { FitPanel, FitPanelView } from './fit-panel';
import { JumpLinks, ProgramHeader } from './program-header';
import { ReportForm } from './report-form';
import { RequirementsChecklist } from './requirements-checklist';

const now = FIXED_NOW;
const seed = loadEmptySeedDataset();
const OFFICIAL = 'https://fixture.example.edu/program';
const ctx: ConflictContext = { programName: 'MSc Fixture Computing', institutionName: 'Fixture University', admissionsEmail: null };

function count(html: string, needle: string | RegExp): number {
  const re = typeof needle === 'string' ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : needle;
  return (html.match(re) ?? []).length;
}

/** The way React escapes text content. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

/** Copy only: class names (w-[17%]) and inline styles (width:0%) are not user-facing text. */
function copyOf(html: string): string {
  return html.replace(/\s(?:class|style)="[^"]*"/g, '');
}

function expectCleanCopy(html: string) {
  const copy = copyOf(html);
  expect(copy).not.toMatch(/\d\s*%/);
  expect(copy).not.toMatch(/fastest citizenship|admission probability|chance of/i);
  expect(copy).not.toMatch(/passport|cnic/i);
}

/** Every external link must be hardened. */
function expectSafeLinks(html: string) {
  const blank = html.match(/<a [^>]*target="_blank"[^>]*>/g) ?? [];
  for (const a of blank) expect(a).toContain('rel="noopener noreferrer nofollow"');
  expect(html).not.toMatch(/href="javascript:/i);
}

const money = (amount: number, period: Money['period'] = 'year'): Money => ({ amount, currency: 'GBP', period });

/** A fully populated, fictional program. */
function fullProgram(overrides: Partial<Program> = {}): Program {
  return makeProgram({
    pathway_type: 'pre_masters',
    last_checked: '2026-11-20',
    eligibility_note: verified('Fixture: for graduates of subjects other than computing'),
    intake: verified('Fixture intake: September'),
    deadline: verified('2027-01-15'),
    duration_months: verified(12),
    tuition: verified(money(10000)),
    living_cost: verified(money(9000)),
    scholarship_info: verified('Fixture scholarship text'),
    min_gpa_rule: verified<GpaRule>({ scale: 'cgpa_4', min: 2.5, text: 'Fixture GPA wording' }),
    language_req: verified({ ielts_overall: 6.5, toefl_ibt: 90 }),
    tests_required: verified('Fixture: no extra tests'),
    sop_requirements: verified('Fixture SOP text'),
    lor_count: verified(2),
    cv_requirements: verified('Fixture CV text'),
    research_considered: likely('Fixture research text'),
    conditional_admission: verified<ConditionalAdmission>({ scale: 'cgpa_4', min: 2.2, text: 'Fixture route below the minimum' }),
    language_waiver: verified('Fixture: waiver with a medium-of-instruction letter'),
    progression_guaranteed: verified(false),
    progression_requirement: verified('Fixture progression text'),
    admissions_email: verified('admissions@fixture.example.edu'),
    ...overrides,
  });
}

const fx: FxRate[] = [{ id: 'fx-gbp', currency: 'GBP', pkr_per_unit: verified(350) }];

function sections(program: Program) {
  return renderToStaticMarkup(
    <>
      {Object.values(FACT_SECTIONS).map((s) => (
        <ProgramFactSection key={s.id} section={s} program={program} now={now} officialUrl={OFFICIAL} conflictContext={ctx} />
      ))}
    </>,
  );
}

describe('ProgramFactSection', () => {
  it('seed data: every row says "Not verified yet" with the official link and an Unverified badge', () => {
    const p = seed.programs[0];
    const html = sections(p);
    const keys = Object.values(FACT_SECTIONS).reduce((n, s) => n + s.keys.length, 0);
    expect(count(html, 'Not verified yet')).toBe(keys);
    expect(count(html, 'check the official page')).toBe(keys);
    expect(count(html, '>Unverified<')).toBe(keys);
    expectSafeLinks(html);
    expectCleanCopy(html);
  });

  it('every seed program renders without errors', () => {
    for (const p of seed.programs) expect(() => sections(p)).not.toThrow();
  });

  it('full data: values, Verified badges, sources and evidence; no "Not verified yet"', () => {
    const html = sections(fullProgram());
    expect(html).not.toContain('Not verified yet');
    expect(html).toContain('15 Jan 2027');
    // Regression (#31): the static page never bakes in "N days left"; a reserved, empty client line holds it.
    expect(html).not.toContain('days left');
    expect(html).toContain('<span class="block min-h-6 leading-6" data-days-left="2027-01-15"></span>');
    expect(html).toContain('Add deadline to my calendar');
    expect(html).toContain('Route below the minimum');
    expect(html).toContain('This route&#x27;s minimum: 2.2 or higher (CGPA out of 4.0)');
    expect(html).toContain('In short: Fixture route below the minimum');
    expect(html).toContain('English test waiver');
    expect(html).toContain('Fixture: waiver with a medium-of-instruction letter');
    expect(html).toContain('1 year');
    expect(html).toContain('IELTS overall: 6.5');
    expect(html).toContain('TOEFL iBT: 90');
    expect(html).toContain('2 letters');
    expect(html).toContain('2.5 or higher');
    expect(html).toContain('Fixture GPA wording');
    expect(html).toContain('Not guaranteed, as stated on the source');
    expect(html).toContain('admissions@fixture.example.edu');
    expect(html).toContain('Evidence from the official page');
    expect(html).toContain('Source: fixture.example.edu');
    expect(count(html, '>Verified<')).toBeGreaterThanOrEqual(14);
    expectSafeLinks(html);
    expectCleanCopy(html);
  });

  it('conflict: both values, both links and "Copy email to admissions"', () => {
    const p = fullProgram({ tuition: conflicting(money(10000), money(12000)) });
    const html = sections(p);
    expect(html).toContain('Official sources disagree');
    expect(html).toContain('Copy email to admissions');
    expect(html).toContain('https://fixture.example.edu/page-a');
    expect(html).toContain('https://fixture.example.edu/page-b');
    expect(html).toMatch(/10,000/);
    expect(html).toMatch(/12,000/);
    expect(html).toContain('>Conflict<');
  });

  it('renders data as escaped text, never as HTML', () => {
    const evil = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const p = fullProgram({
      sop_requirements: { ...verified(evil), evidence_snippet: evil, source_url: 'javascript:alert(1)' },
    });
    const html = sections(p);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toMatch(/href="javascript:/i);
  });
});

describe('ProgramHeader + JumpLinks', () => {
  it('seed: one h1, pathway label, not-verified official page, coverage line', () => {
    const p = seed.programs.find((x) => x.id === 'qmul-premasters-cs') ?? seed.programs[0];
    const inst = seed.institutions.find((i) => i.id === p.institution_id) ?? null;
    const html = renderToStaticMarkup(<ProgramHeader program={p} institution={inst} coverage={computeCoverage(p, now)} />);
    expect(count(html, '<h1')).toBe(1);
    expect(html).toContain(escapeHtml(p.name));
    expect(html).toMatch(/0 of \d+ fields verified/);
    expect(html).toContain('Not verified yet');
    expect(html).toContain('Not checked yet');
    expectSafeLinks(html);
    expectCleanCopy(html);
  });

  it('full data: official page link, last checked date, coverage counts', () => {
    const p = fullProgram();
    const html = renderToStaticMarkup(
      <ProgramHeader program={p} institution={makeInstitution()} coverage={computeCoverage(p, now)} />,
    );
    expect(html).toContain('Open the official page');
    expect(html).toContain('20 Nov 2026');
    expect(html).toContain("Pre-master&#x27;s route");
    // 19 applicable fields (status note not applicable): 18 Verified + 1 Likely.
    expect(html).toContain('18 of 19 fields verified');
    expect(html).toContain('1 likely');
  });

  it('jump links are plain anchors', () => {
    const html = renderToStaticMarkup(<JumpLinks links={[{ id: 'fit', label: 'Your fit' }]} />);
    expect(html).toContain('href="#fit"');
  });
});

describe('CostSummary', () => {
  it('seed: shows what is missing, never a number', () => {
    const p = seed.programs[0];
    const html = renderToStaticMarkup(<CostSummary cost={programTotalCost(p, seed.fxRates, now)} officialUrl={OFFICIAL} />);
    expect(html).toContain('Not verified yet');
    expect(html).toContain('Tuition not verified yet');
    expect(html).toContain('Living cost not verified yet');
    expect(html).not.toMatch(/PKR \d/);
  });

  it('full data without an exchange rate: native total, PKR not verified', () => {
    const html = renderToStaticMarkup(<CostSummary cost={programTotalCost(fullProgram(), [], now)} officialUrl={OFFICIAL} />);
    expect(html).toMatch(/£19,000 total/);
    expect(html).toContain('In PKR: not verified yet');
    expect(html).toContain('No verified GBP→PKR exchange rate yet');
  });

  it('full data with a fixture exchange rate: PKR total', () => {
    const html = renderToStaticMarkup(<CostSummary cost={programTotalCost(fullProgram(), fx, now)} officialUrl={OFFICIAL} />);
    expect(html).toContain('PKR 6,650,000');
    expect(html).toContain('>Verified<');
  });
});

describe('Context sections', () => {
  it('citizenship snapshot: country facts as FactRows, not-legal-advice note, link to /citizenship', () => {
    const facts = seed.countryFacts;
    const find = (key: CountryFact['key']) => facts.find((f) => f.country === 'DE' && f.key === key) ?? null;
    const html = renderToStaticMarkup(
      <CitizenshipSnapshot country="DE" citizenship={find('citizenship_rule')} postStudyWork={find('post_study_work')} now={now} />,
    );
    expect(html).toContain('Work and citizenship in Germany');
    expect(html).toContain('not legal or immigration advice');
    expect(html).toContain('href="/citizenship"');
    expect(count(html, /class="[^"]*rounded-badge/g)).toBeGreaterThanOrEqual(2);
    expectSafeLinks(html);
    expectCleanCopy(html);
  });

  it('citizenship snapshot with no rows at all still renders "Not verified yet"', () => {
    const html = renderToStaticMarkup(<CitizenshipSnapshot country="US" citizenship={null} postStudyWork={null} now={now} />);
    expect(count(html, 'Not verified yet')).toBe(2);
  });

  it('recognition: anabin only for German universities, and a check-before-applying note', () => {
    const de = renderToStaticMarkup(
      <RecognitionSection institution={makeInstitution({ country: 'DE', anabin_status: verified('H+') })} now={now} conflictContext={ctx} />,
    );
    expect(de).toContain('anabin status');
    expect(de).toContain('H+');
    expect(de).toContain('check them before you apply');
    const uk = renderToStaticMarkup(
      <RecognitionSection
        institution={makeInstitution({ recognition_list_status: verified<'listed' | 'not_listed'>('listed') })}
        now={now}
        conflictContext={ctx}
      />,
    );
    expect(uk).not.toContain('anabin');
    expect(uk).toContain('Listed on the official recognition list');
    expectCleanCopy(uk);
  });

  it('research section says strengths never change the fit label', () => {
    const html = renderToStaticMarkup(
      <ResearchSection program={fullProgram()} now={now} officialUrl={OFFICIAL} conflictContext={ctx} />,
    );
    expect(html).toContain('Where your research may matter');
    expect(html).toContain('Fixture research text');
    expect(html).toContain('never change the fit label');
  });
});

describe('Client islands (server render)', () => {
  it('checklist: seed data says requirements are not verified, every item has a badge, progress 0 of 6', () => {
    const p = seed.programs[0];
    const items = buildChecklist(p, now);
    const html = renderToStaticMarkup(<RequirementsChecklist programId={p.id} items={items} />);
    expect(html).toContain('0 of 6 done');
    expect(html).toContain('Number of LORs not verified yet');
    expect(count(html, '>Unverified<')).toBe(6);
    expect(count(html, 'type="checkbox"')).toBe(6);
  });

  it('checklist: full data uses the LOR count from the data row', () => {
    const items = buildChecklist(fullProgram(), now);
    const html = renderToStaticMarkup(<RequirementsChecklist programId="fixture-msc-cs" items={items} />);
    expect(html).toContain('Letters of recommendation: 2 letters');
  });

  it('report form: a labelled select of the program fact fields and a labelled textarea', () => {
    const p = fullProgram();
    const html = renderToStaticMarkup(<ReportForm programId={p.id} fields={reportFieldOptions(p)} />);
    expect(html).toContain('Report incorrect data');
    expect(html).toMatch(/<label[^>]*for="report-fixture-msc-cs-field"/);
    expect(html).toMatch(/<label[^>]*for="report-fixture-msc-cs-message"/);
    expect(html).toContain('value="lor_count"');
    expect(html).toContain('maxLength="1000"');
    expect(html).toContain('minLength="10"');
    expect(html).toContain('role="status"');
  });

  it('fit panel: renders a loading state on the server (the profile is read in the browser)', () => {
    const html = renderToStaticMarkup(
      <FitPanel program={makeProgram({ status_note: emptyFact() })} rules={seed.conversionRules} officialUrl={OFFICIAL} />,
    );
    expect(html).toContain('Your fit');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-live="polite"');
  });

  it('regression: the server-rendered privacy line is true (no "never leaves this phone" promise)', () => {
    const html = renderToStaticMarkup(
      <FitPanel program={makeProgram({ status_note: emptyFact() })} rules={seed.conversionRules} officialUrl={OFFICIAL} />,
    );
    expect(html).not.toMatch(/never leaves/i);
    expect(html).toContain('Your grade is saved on this device');
    expect(html).toContain('we never ask for ID numbers');
    expect(html).toContain('we never show admission chances');
    expect(html).toContain('href="/privacy"');
    expectCleanCopy(html);
  });
});

describe('FitPanelView (what the island shows once the profile is read)', () => {
  const program = makeProgram({ min_gpa_rule: verified<GpaRule>({ scale: 'cgpa_4', min: 3, text: 'Fixture wording' }) });
  const linkProfile = { cgpa: 2.5, scale: 'cgpa_4' as const, field: 'cs', target_countries: ['DE'] };

  it('regression: a profile from the shortlist link shows the fit instead of "Add your CGPA", and says it is not saved', () => {
    const html = renderToStaticMarkup(
      <FitPanelView program={program} rules={[]} pinnedNow={now.toISOString()} state={{ profile: linkProfile, source: 'link' }} />,
    );
    expect(html).not.toContain('Add your CGPA');
    expect(html).toContain('Below minimum');
    expect(html).toContain('From the link you opened. It is not saved on this device.');
    expect(copyOf(html)).not.toMatch(/\d\s*%/);
  });

  it('a saved profile shows the fit without the link note', () => {
    const html = renderToStaticMarkup(
      <FitPanelView program={program} rules={[]} pinnedNow={now.toISOString()} state={{ profile: PERSONA_A, source: 'device' }} />,
    );
    expect(html).toContain('Below minimum');
    expect(html).not.toContain('From the link you opened');
  });

  it('no profile anywhere: asks for the CGPA', () => {
    const html = renderToStaticMarkup(<FitPanelView program={program} rules={[]} state={null} />);
    expect(html).toContain('Add your CGPA');
  });

  it("shows the minimum's student-facing note but never its review_note", () => {
    const p = makeProgram({
      min_gpa_rule: {
        ...likely<GpaRule>({ scale: 'cgpa_4', min: 2.7 }),
        basis: 'inferred',
        note: 'Fixture: the page does not name the grade scale.',
        review_note: 'FIXTURE INTERNAL REVIEWER NOTE',
      },
    });
    const html = renderToStaticMarkup(
      <FitPanelView program={programForFitPanel(p)} rules={[]} state={{ profile: PERSONA_A, source: 'device' }} />,
    );
    expect(html).toContain('Note: Fixture: the page does not name the grade scale.');
    expect(html).not.toContain('FIXTURE INTERNAL REVIEWER NOTE');
  });
});

describe('EligibilityCallout ("Who this course is for")', () => {
  const text = 'Fixture: for graduates of subjects other than computing.';

  it('a Verified note: warning call-out with title, value, badge and source link', () => {
    const html = renderToStaticMarkup(<EligibilityCallout fact={verified(text)} now={now} />);
    expect(html).toContain('role="note"');
    expect(html).toContain('Who this course is for');
    expect(html).toContain(escapeHtml(text));
    expect(html).toContain('>Verified<');
    expect(html).toContain('Source: fixture.example.edu');
    expect(html).toContain('href="#entry"');
    expect(html).toContain('only compares grades');
    expectSafeLinks(html);
    expectCleanCopy(html);
  });

  it('a Likely note is shown with its Likely badge', () => {
    const html = renderToStaticMarkup(<EligibilityCallout fact={likely(text)} now={now} />);
    expect(html).toContain('>Likely<');
    expect(html).toContain(escapeHtml(text));
  });

  it('nothing at the top when the note is empty, Unverified or in Conflict', () => {
    const cases: (Fact<string> | null)[] = [
      null,
      emptyFact<string>(),
      unverified('Fixture text with no source'),
      conflicting('Fixture A', 'Fixture B'),
      verified('   '),
    ];
    for (const fact of cases) expect(renderToStaticMarkup(<EligibilityCallout fact={fact} now={now} />)).toBe('');
  });

  it('shows the student-facing note, never the review_note, and escapes text', () => {
    const fact: Fact<string> = {
      ...verified('<b>Fixture</b> eligibility'),
      note: 'Fixture student note',
      review_note: 'FIXTURE INTERNAL REVIEWER NOTE',
    };
    const html = renderToStaticMarkup(<EligibilityCallout fact={fact} now={now} />);
    expect(html).toContain('Note: Fixture student note');
    expect(html).not.toContain('FIXTURE INTERNAL REVIEWER NOTE');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;Fixture&lt;/b&gt; eligibility');
  });

  it('is also the first row of Entry requirements, with its evidence', () => {
    const html = renderToStaticMarkup(
      <ProgramFactSection
        section={FACT_SECTIONS.entry}
        program={fullProgram()}
        now={now}
        officialUrl={OFFICIAL}
        conflictContext={ctx}
      />,
    );
    const first = html.indexOf('Who this course is for');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(html.indexOf('Minimum grade'));
    expect(html).toContain('Fixture: for graduates of subjects other than computing');
  });
});

describe('Minimum grade summary and fact notes', () => {
  it('regression: rule.text is shown as "In short:" with no quotation marks; only the evidence is a quote', () => {
    const rule = verified<GpaRule>({ scale: 'cgpa_4', min: 2.7, text: 'Fixture paraphrase: 2:2 = GPA 2.7' });
    const html = sections(fullProgram({ min_gpa_rule: { ...rule, evidence_snippet: 'Fixture verbatim snippet 2:2 GPA 2.7' } }));
    expect(html).toContain('In short: Fixture paraphrase: 2:2 = GPA 2.7');
    expect(html).not.toContain('Wording on the source');
    expect(html).not.toContain('&quot;Fixture paraphrase');
    expect(html).not.toContain('“Fixture paraphrase');
    // The verbatim snippet is still shown, in the evidence block.
    expect(html).toMatch(/<blockquote[^>]*>Fixture verbatim snippet 2:2 GPA 2\.7<\/blockquote>/);
  });

  it('student-facing notes render under each FactRow value; review_note never renders', () => {
    const withNotes = <T,>(f: Fact<T>, note: string): Fact<T> => ({ ...f, note, review_note: `FIXTURE INTERNAL ${note}` });
    const p = fullProgram({
      deadline: withNotes(verified('2027-01-15'), 'Fixture: applications close at noon.'),
      tuition: withNotes(verified(money(10000)), 'Fixture: fees are for the first year only.'),
      min_gpa_rule: withNotes(verified<GpaRule>({ scale: 'cgpa_4', min: 2.5 }), 'Fixture: scale assumed.'),
      eligibility_note: withNotes(verified('Fixture eligibility'), 'Fixture: eligibility note.'),
    });
    const html = sections(p);
    for (const note of [
      'Fixture: applications close at noon.',
      'Fixture: fees are for the first year only.',
      'Fixture: scale assumed.',
      'Fixture: eligibility note.',
    ]) {
      expect(html).toContain(`Note: ${note}`);
    }
    expect(html).not.toContain('FIXTURE INTERNAL');
  });

  it('live seed: no review_note text appears anywhere on any program page block', () => {
    const live = loadSeedDataset();
    const liveNow = new Date('2026-11-25T12:00:00Z');
    let reviewNotes = 0;
    let callouts = 0;
    for (const p of live.programs) {
      const html =
        sections(p) +
        renderToStaticMarkup(<EligibilityCallout fact={p.eligibility_note} now={liveNow} />) +
        renderToStaticMarkup(
          <FitPanelView program={programForFitPanel(p)} rules={live.conversionRules} state={{ profile: PERSONA_A, source: 'device' }} />,
        );
      if (renderToStaticMarkup(<EligibilityCallout fact={p.eligibility_note} now={liveNow} />)) callouts += 1;
      for (const k of PROGRAM_FACT_KEYS) {
        const f = p[k] as Fact<unknown> & { conflicts?: Fact<unknown>[] };
        for (const s of [f, ...(f?.conflicts ?? [])]) {
          const rn = s?.review_note?.trim();
          if (!rn || rn.length < 20) continue;
          reviewNotes += 1;
          expect(html, `${p.id}.${k}`).not.toContain(rn);
          expect(html, `${p.id}.${k}`).not.toContain(escapeHtml(rn));
        }
      }
    }
    // Not vacuous: the live data has review notes, and at least one "who this course is for" warning.
    expect(reviewNotes).toBeGreaterThan(0);
    expect(callouts).toBeGreaterThan(0);
  });
});

describe('Back to shortlist', () => {
  it('server render is a plain /shortlist link (the page stays static; the browser adds the profile query)', () => {
    const p = fullProgram();
    const html = renderToStaticMarkup(<ProgramHeader program={p} institution={makeInstitution()} coverage={computeCoverage(p, now)} />);
    expect(html).toMatch(/<a [^>]*href="\/shortlist"[^>]*>.*Back to shortlist<\/a>/);
  });
});

describe('Deadline countdown and calendar (#31, #35): nothing time-relative is baked into the static page', () => {
  const NOV_24 = new Date('2026-11-24T12:00:00Z');
  const DEC_02 = new Date('2026-12-02T12:00:00Z');

  function keyFacts(p: Program, at: Date, pinnedNow: string | null = null) {
    return renderToStaticMarkup(
      <ProgramFactSection
        section={FACT_SECTIONS.keyFacts}
        program={p}
        now={at}
        officialUrl={OFFICIAL}
        conflictContext={ctx}
        pinnedNow={pinnedNow}
      />,
    );
  }

  it('DaysLeft renders a reserved, empty line on the server (no layout shift, no stale count)', () => {
    const html = renderToStaticMarkup(<DaysLeft iso="2027-01-15" pinnedNow={NOV_24.toISOString()} />);
    expect(html).toBe('<span class="block min-h-6 leading-6" data-days-left="2027-01-15"></span>');
  });

  it('daysLeftSnapshot uses the pinned demo clock when set, otherwise the device clock', () => {
    const device = () => DEC_02;
    expect(daysLeftSnapshot('2026-11-30', NOV_24.toISOString(), device)).toBe('6 days left');
    expect(daysLeftSnapshot('2026-11-30', null, device)).toBe('This date has passed');
    expect(daysLeftSnapshot('2026-11-30', 'not a date', device)).toBe('This date has passed');
    expect(daysLeftSnapshot('2026-12-02', null, device)).toBe('Today');
    expect(daysLeftSnapshot('rolling', null, device)).toBeNull();
    expect(clientNow(null, device)).toBe(DEC_02);
  });

  it('a usable deadline gets the countdown leaf and the calendar button; the server HTML has no "days left"', () => {
    const html = keyFacts(fullProgram(), NOV_24, NOV_24.toISOString());
    expect(html).toContain('15 Jan 2027');
    expect(html).toContain('data-days-left="2027-01-15"');
    expect(html).toContain('Add deadline to my calendar');
    expect(html).not.toMatch(/days? left|This date has passed/);
  });

  it('Unverified or Conflict deadlines: date(s) only, no countdown and no calendar button', () => {
    for (const deadline of [unverified('2027-01-15'), conflicting('2027-01-15', '2027-01-29')]) {
      const html = keyFacts(fullProgram({ deadline }), NOV_24);
      expect(html).toContain('15 Jan 2027');
      expect(html).not.toContain('data-days-left');
      expect(html).not.toContain('Add deadline to my calendar');
    }
  });

  it('a passed deadline keeps its countdown line but offers no calendar event', () => {
    const html = keyFacts(fullProgram({ deadline: verified('2026-11-20') }), NOV_24);
    expect(html).toContain('data-days-left="2026-11-20"');
    expect(html).not.toContain('Add deadline to my calendar');
  });

  it('live seed: ETH (closes 30 Nov 2026) offers the calendar on 24 Nov and not on 2 Dec; never a baked count', () => {
    const live = loadSeedDataset();
    const eth = live.programs.find((p) => p.id === 'ethz-msc-cs') as Program;
    const before = keyFacts(eth, NOV_24);
    expect(before).toContain('30 Nov 2026');
    expect(before).toContain('Add deadline to my calendar');
    expect(before).toContain('Note: Applications close at 12:00 noon CET');
    const after = keyFacts(eth, DEC_02);
    expect(after).toContain('30 Nov 2026');
    expect(after).not.toContain('Add deadline to my calendar');
    for (const p of live.programs) expect(keyFacts(p, NOV_24), p.id).not.toMatch(/\d+ days? left/);
  });
});

describe('FitPanelView next steps (#2, #10): shown next to the label, never changing it', () => {
  const at = new Date('2026-11-24T12:00:00Z').toISOString();
  const below = makeProgram({ min_gpa_rule: verified<GpaRule>({ scale: 'cgpa_4', min: 3, text: 'Fixture wording' }) });
  const route: ConditionalAdmission = { scale: 'cgpa_4', min: 2.5, text: 'Fixture: GPA 2.5 to 2.84 at the director discretion' };

  function panel(p: Program, profile: Profile = PERSONA_A, source: 'device' | 'link' = 'device') {
    return renderToStaticMarkup(
      <FitPanelView program={programForFitPanel(p)} rules={[]} pinnedNow={at} officialUrl={OFFICIAL} state={{ profile, source }} />,
    );
  }

  it('Below minimum: "See other routes (Plan B)" to /plan-b with the profile and this program as target', () => {
    const html = panel(below);
    expect(html).toContain('Below minimum');
    expect(html).toContain(
      'href="/plan-b?cgpa=2.5&amp;scale=cgpa_4&amp;field=cs&amp;budget=6000000&amp;countries=DE,UK,CA,US&amp;target=fixture-msc-cs"',
    );
    expect(html).toContain('See other routes (Plan B)');
  });

  it('no Plan B link when the minimum is met or unknown', () => {
    const meets = makeProgram({ min_gpa_rule: verified<GpaRule>({ scale: 'cgpa_4', min: 2 }) });
    expect(panel(meets)).not.toContain('/plan-b');
    expect(panel(makeProgram())).not.toContain('/plan-b');
  });

  it('a usable route below the minimum: title, summary, badge and source; the label is still Below minimum', () => {
    const p = makeProgram({ ...below, conditional_admission: { ...verified(route), review_note: 'FIXTURE INTERNAL ROUTE NOTE' } });
    const html = panel(p);
    expect(html).toContain('Below minimum');
    expect(html).not.toContain('Meets minimum');
    expect(html).toContain('This program publishes a route below its minimum');
    expect(html).toContain('This route&#x27;s minimum: 2.5 or higher (CGPA out of 4.0)');
    expect(html).toContain('In short: Fixture: GPA 2.5 to 2.84 at the director discretion');
    expect(html).toContain('It does not change your fit label above');
    expect(html).not.toContain('FIXTURE INTERNAL');
    expect(count(html, '>Verified<')).toBeGreaterThanOrEqual(2);
    // The panel's own footer says "It is not a chance of admission", so check the route block's copy only.
    const block = html.slice(html.indexOf('data-conditional-route'));
    expect(copyOf(block)).not.toMatch(/\d\s*%|admission probability|will be admitted|guarantee/i);
    expectSafeLinks(html);
  });

  it('no route block for an Unverified route', () => {
    expect(panel(makeProgram({ ...below, conditional_admission: unverified(route) }))).not.toContain('publishes a route below');
  });

  it('no conversion rule (CGPA out of 5.0): the next step to /onboarding and the official minimum text', () => {
    const p = makeProgram({ min_gpa_rule: verified<GpaRule>({ scale: 'cgpa_4', min: 3, text: 'Fixture: CGPA 3.0 out of 4.0' }) });
    const html = panel(p, { cgpa: 3.4, scale: 'cgpa_5', field: 'cs', target_countries: [] }, 'link');
    expect(html).toContain('Competitive range unknown');
    expect(html).toContain('If your transcript also states your grade on another scale');
    expect(html).toMatch(/<a [^>]*href="\/onboarding"[^>]*>Enter your grade on another scale/);
    expect(html).toContain('The official minimum, in short: Fixture: CGPA 3.0 out of 4.0');
    expect(html).toContain('Fixture snippet for');
    expect(html).not.toContain('/plan-b');
  });

  it('live seed, persona A: Brookes links to Plan B; NYIT (verified minimum 2.85) is Below minimum and shows its route', () => {
    const live = loadSeedDataset();
    const find = (id: string) => live.programs.find((p) => p.id === id) as Program;
    const render = (p: Program) =>
      renderToStaticMarkup(
        <FitPanelView
          program={programForFitPanel(p)}
          rules={live.conversionRules}
          pinnedNow={at}
          state={{ profile: PERSONA_A, source: 'device' }}
        />,
      );
    const brookes = render(find('brookes-msc-cs'));
    expect(brookes).toContain('Below minimum');
    expect(brookes).toContain('target=brookes-msc-cs');
    const nyit = render(find('nyit-mscs'));
    expect(nyit).toContain('Below minimum');
    expect(nyit).toContain('This program publishes a route below its minimum');
    expect(nyit).toContain('This route&#x27;s minimum: 2.5 or higher (CGPA out of 4.0)');
    expect(nyit).not.toContain(escapeHtml(find('nyit-mscs').conditional_admission.review_note as string));
  });

  it('regression (#19): a link profile is labelled as such and the fit uses it', () => {
    const html = panel(below, { cgpa: 3.6, scale: 'cgpa_4', field: 'cs', target_countries: [] }, 'link');
    expect(html).toContain('Meets minimum');
    expect(html).toContain('From the link you opened. It is not saved on this device.');
  });
});

describe('Ask the university (#33)', () => {
  it('lists what we could not verify and offers a copy button; no mail-app link without a usable address', () => {
    const p = makeProgram({ deadline: verified('2027-01-15') });
    const html = renderToStaticMarkup(
      <AskUniversity
        programName={p.name}
        institutionName="Fixture University"
        questions={missingFactQuestions(p, now)}
        admissionsEmail={usableAdmissionsEmail(p, now)}
      />,
    );
    expect(html).toContain('Ask the university');
    expect(html).toContain('<li>Minimum grade</li>');
    expect(html).toContain('<li>Transcript and degree documents</li>');
    expect(html).not.toContain('<li>Application deadline</li>');
    expect(html).toContain('Copy email to the university');
    expect(html).not.toContain('mailto:');
    expect(html).toContain('We have no verified admissions address yet');
    expectCleanCopy(html);
  });

  it('a usable admissions address adds a mailto link (no new tab)', () => {
    const p = makeProgram({ admissions_email: verified('admissions@fixture.example.edu') });
    const html = renderToStaticMarkup(
      <AskUniversity
        programName={p.name}
        institutionName="Fixture University"
        questions={missingFactQuestions(p, now)}
        admissionsEmail={usableAdmissionsEmail(p, now)}
      />,
    );
    expect(html).toMatch(/<a href="mailto:admissions@fixture\.example\.edu\?subject=[^"]+"[^>]*>Open in my email app<\/a>/);
    expect(html).toContain('It goes to admissions@fixture.example.edu');
    expectSafeLinks(html);
  });

  it('renders nothing without questions', () => {
    expect(renderToStaticMarkup(<AskUniversity programName="x" institutionName="y" questions={[]} admissionsEmail={null} />)).toBe(
      '',
    );
  });
});

describe('CostSummary caveats', () => {
  const base = programTotalCost(fullProgram(), fx, now);

  it('renders each caveat from the cost result as a note (strings or {text})', () => {
    const cost = { ...base, caveats: ['Fixture: tuition covers the first year only.', { text: 'Fixture: fees may rise.' }, '', 7] };
    expect(costCaveats(cost as unknown as CostResult)).toEqual([
      'Fixture: tuition covers the first year only.',
      'Fixture: fees may rise.',
    ]);
    const html = renderToStaticMarkup(<CostSummary cost={cost as unknown as CostResult} officialUrl={OFFICIAL} />);
    expect(html).toContain('Note: Fixture: tuition covers the first year only.');
    expect(html).toContain('Note: Fixture: fees may rise.');
  });

  it('no caveats: nothing extra', () => {
    expect(costCaveats({ ...base, caveats: [] } as unknown as CostResult)).toEqual([]);
    expect(renderToStaticMarkup(<CostSummary cost={{ ...base, caveats: [] } as unknown as CostResult} officialUrl={OFFICIAL} />)).not.toContain(
      'About this total',
    );
  });
});
