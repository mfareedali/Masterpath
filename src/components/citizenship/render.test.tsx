/**
 * Server-render smoke tests (node environment, no DOM library): the citizenship components render
 * with today's empty seed data AND with full fixture data, and follow the evidence rules.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  NO_PKR_RATE,
  VISA_FUNDS_NOT_RANKED,
  buildCountryRows,
  pakistanDualNationality,
  parseCitizenshipQuery,
  rankCountries,
  type CitizenshipRanking,
} from '@/lib/citizenship';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { FIXED_NOW, conflicting, likely, unverified, verified, loadEmptySeedDataset } from '@/lib/test-fixtures';
import type { CountryFact, CountryFactKey, CountryFactValue, Fact, FxRate } from '@/lib/types';
import { CountryCard, RankedValue, type CountryEntry } from './country-card';
import { CountryTable } from './country-table';
import { PakistanNationalityCard } from './pakistan-card';
import { RankControls } from './rank-controls';
import { HowRankingWorks } from './ranking-help';
import { VisaFundsBlock } from './visa-funds';

const seed = loadEmptySeedDataset();

function entries(r: CitizenshipRanking): CountryEntry[] {
  return [
    ...r.ranked.map((x) => ({ row: x.row, key: x.key, rank: x.rank })),
    ...r.notRanked.map((x) => ({ row: x.row, key: x.key, reason: x.reason })),
  ];
}

function cf(country: string, key: CountryFactKey, fact: Fact<CountryFactValue>): CountryFact {
  return { id: `${country.toLowerCase()}-${key}`, country, key, ...fact };
}

const BANNED = [/guaranteed/i, /fastest citizenship/i, /chance/i, /\d\s*%/, /passport number/i];

function expectCleanCopy(html: string) {
  const copy = html.replace(/\sclass="[^"]*"/g, ''); // class names like w-[17%] are not copy
  for (const re of BANNED) expect(copy).not.toMatch(re);
  // Every link from data is hardened.
  const anchors = html.match(/<a [^>]*target="_blank"[^>]*>/g) ?? [];
  for (const a of anchors) expect(a).toContain('rel="noopener noreferrer nofollow"');
}

describe('CountryCard / CountryTable — seed data (today)', () => {
  const rows = buildCountryRows(seed.countryFacts);
  const ranking = rankCountries(rows, parseCitizenshipQuery({}), seed.fxRates, FIXED_NOW);

  it('ranked Canada card shows the exact rule, clock note, Likely badge, source and checked date', () => {
    const ca = entries(ranking).find((e) => e.row.country === 'CA')!;
    const html = renderToStaticMarkup(<CountryCard entry={ca} now={FIXED_NOW} fx={seed.fxRates} rankLabel="Citizenship rule" />);
    expect(html).toContain('Rank 1');
    expect(html).toContain('Canada');
    expect(html).toContain('1,095 days');
    expect(html).toContain('How the clock starts');
    expect(html).toContain('half days');
    expect(html).toContain('Likely');
    expect(html).toContain('re-verify on the official page before relying on it');
    expect(html).toContain('href="https://www.canada.ca/');
    expect(html).toContain('Checked 23 Nov 2026');
    expect(html).toContain('36 months (the number this rule is ranked by)');
    expect(html).not.toContain('minimum residence');
    expect(html).toContain('Not verified yet'); // e.g. PR route, typical costs
    expectCleanCopy(html);
  });

  it('not-ranked UK card shows the reason and still shows its Likely post-study work fact', () => {
    const uk = entries(ranking).find((e) => e.row.country === 'UK')!;
    const html = renderToStaticMarkup(<CountryCard entry={uk} now={FIXED_NOW} fx={seed.fxRates} rankLabel="Citizenship rule" isTarget />);
    expect(html).not.toContain('Rank ');
    expect(html).toContain('Not ranked: data missing');
    expect(html).toContain('Citizenship rule not verified yet');
    expect(html).toContain('Graduate visa');
    expect(html).toContain('In your plan');
    expectCleanCopy(html);
  });

  it('an Unverified value with text is marked as not from an official page, with its data note', () => {
    const de = entries(ranking).find((e) => e.row.country === 'DE')!;
    const html = renderToStaticMarkup(<CountryCard entry={de} now={FIXED_NOW} fx={seed.fxRates} rankLabel="Citizenship rule" />);
    expect(html).toContain('Recent change');
    expect(html).toContain('Not from an official page yet. Do not rely on it.');
    expect(html).toContain('From a news report');
  });

  it('secondary facts show the source details line (UK post-study work)', () => {
    const uk = entries(ranking).find((e) => e.row.country === 'UK')!;
    const html = renderToStaticMarkup(<CountryCard entry={uk} now={FIXED_NOW} fx={seed.fxRates} rankLabel="Citizenship rule" />);
    expect(html).toContain('Details: </span>The length depends on the date you apply');
  });

  it('table renders every country with a badge', () => {
    const html = renderToStaticMarkup(
      <CountryTable entries={entries(ranking)} now={FIXED_NOW} fx={seed.fxRates} rankLabel="Citizenship rule" caption="All" targets={new Set(['DE'])} />,
    );
    for (const name of ['Germany', 'Switzerland', 'United Kingdom', 'Canada', 'United States']) expect(html).toContain(name);
    expect(html).toContain('hidden');
    expect(html).toContain('md:block');
    expect(html).toContain('Unverified');
    expectCleanCopy(html);
  });

  it('empty table renders nothing', () => {
    expect(renderToStaticMarkup(<CountryTable entries={[]} now={FIXED_NOW} fx={[]} rankLabel="x" caption="x" targets={new Set()} />)).toBe('');
  });
});

describe('PakistanNationalityCard', () => {
  it('today: Not verified yet, no deep link, check the Government of Pakistan source', () => {
    const html = renderToStaticMarkup(<PakistanNationalityCard fact={pakistanDualNationality(seed.countryFacts)} now={FIXED_NOW} />);
    expect(html).toContain('Pakistan&#x27;s rules on holding another nationality');
    expect(html).toContain('Not verified yet');
    expect(html).toContain('Government of Pakistan');
    expect(html).toContain('not legal advice');
    expect(html).not.toContain('<a ');
    expectCleanCopy(html);
  });

  it('with a verified row: value, badge and source link', () => {
    const fact = cf('PK', 'pakistan_dual_nationality', verified({ text: 'Fixture Pakistan rule (fictional).' }, 1, 'https://fixture.example.gov.pk/rule'));
    const html = renderToStaticMarkup(<PakistanNationalityCard fact={fact} now={FIXED_NOW} />);
    expect(html).toContain('Fixture Pakistan rule (fictional).');
    expect(html).toContain('Verified');
    expect(html).toContain('href="https://fixture.example.gov.pk/rule"');
  });
});

describe('full fixture data', () => {
  const facts: CountryFact[] = [
    cf('DE', 'citizenship_rule', conflicting<CountryFactValue>({ text: 'Fixture rule A', sort_months: 40 }, { text: 'Fixture rule B', sort_months: 50 })),
    cf('CA', 'citizenship_rule', verified({ text: 'Fixture CA rule', sort_months: 30, clock_note: 'Fixture clock' })),
    cf('CA', 'tuition_typical', verified({ text: 'Fixture tuition', money: { amount: 1000, currency: 'CAD', period: 'year' } })),
    cf('CA', 'living_cost_typical', likely({ text: 'Fixture living', money: { amount: 500, currency: 'CAD', period: 'year' } })),
  ];
  const fx: FxRate[] = [{ id: 'cad-pkr', currency: 'CAD', pkr_per_unit: verified(10) }];
  const rows = buildCountryRows(facts);

  it('conflict shows both values, both links and a copy-question button', () => {
    const r = rankCountries(rows, { rank: 'citizenship', dir: 'asc' }, fx, FIXED_NOW);
    const de = entries(r).find((e) => e.row.country === 'DE')!;
    expect(de.reason).toBe('Sources disagree on the citizenship rule');
    const html = renderToStaticMarkup(<CountryCard entry={de} now={FIXED_NOW} fx={fx} rankLabel="Citizenship rule" />);
    expect(html).toContain('Fixture rule A');
    expect(html).toContain('Fixture rule B');
    expect(html).toContain('https://fixture.example.edu/page-a');
    expect(html).toContain('https://fixture.example.edu/page-b');
    expect(html).toContain('Copy question: citizenship rule');
    const table = renderToStaticMarkup(<CountryTable entries={[de]} now={FIXED_NOW} fx={fx} rankLabel="Citizenship rule" caption="x" targets={new Set()} />);
    expect(table).toContain('Official sources disagree');
    expect(table).toContain('Copy question: citizenship rule');
  });

  it('total cost ranks Canada and shows the PKR amount with the weakest badge', () => {
    const r = rankCountries(rows, { rank: 'total', dir: 'asc' }, fx, FIXED_NOW);
    expect(r.ranked.map((x) => x.row.country)).toEqual(['CA']);
    const html = renderToStaticMarkup(<CountryCard entry={entries(r)[0]} now={FIXED_NOW} fx={fx} rankLabel="Total cost" />);
    expect(html).toContain('PKR 15,000 per year');
    expect(html).toContain('Ranked by total cost');
    expect(html).toContain('Likely');
    expect(html).toContain('Fixture tuition');
  });
});

describe('RankControls', () => {
  it('renders link chips with the active state and the psw default direction', () => {
    const html = renderToStaticMarkup(<RankControls query={{ rank: 'psw', dir: 'desc' }} />);
    expect(html).toContain('href="/citizenship"');
    expect(html).toContain('href="/citizenship?rank=psw"');
    expect(html).toContain('href="/citizenship?rank=psw&amp;dir=asc"');
    expect(html).toContain('href="/citizenship?rank=tuition"');
    expect(html).toContain('href="/citizenship?rank=total"');
    expect(html.match(/aria-current="true"/g)).toHaveLength(2);
    expect(html).toContain('Longest first');
    expect(html).toContain('Shortest first');
  });
});

describe('source rules for this workstream', () => {
  const roots = ['src/lib/citizenship', 'src/components/citizenship', 'src/app/citizenship'];
  const files: string[] = [];
  for (const root of roots) {
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(root);
  }

  it('finds the files', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it('never renders HTML from data, never uses default palette colours, never promises outcomes', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toContain('dangerouslySetInnerHTML');
      expect(src, f).not.toMatch(/\b(?:bg|text|border)-(?:red|gray|blue|green|slate|zinc|amber|emerald)-\d/);
      expect(src, f).not.toMatch(/guaranteed|fastest citizenship/i);
      expect(src, f).not.toMatch(/new Date\(/);
      // Review findings: no code-made legal paraphrases; the internal reviewer note is never read for display.
      expect(src, f).not.toMatch(/minimum residence|longest work permit|shortest time you must live/i);
      expect(src, f).not.toMatch(/\.review_note\b|\[['"]review_note['"]\]/);
    }
  });
});

/* ---------------- review findings (regressions) ---------------- */

/** How React escapes text in static markup. */
function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

const live = loadSeedDataset();
const liveRows = buildCountryRows(live.countryFacts);

function liveEntries(rank: 'citizenship' | 'psw'): CountryEntry[] {
  return entries(rankCountries(liveRows, parseCitizenshipQuery({ rank }), live.fxRates, FIXED_NOW));
}

function cardHtml(country: string, rank: 'citizenship' | 'psw' = 'citizenship'): string {
  const e = liveEntries(rank).find((x) => x.row.country === country)!;
  return renderToStaticMarkup(
    <CountryCard entry={e} now={FIXED_NOW} fx={live.fxRates} rankLabel={rank === 'psw' ? 'Post-study work' : 'Citizenship rule'} />,
  );
}

function tableHtml(rank: 'citizenship' | 'psw' = 'citizenship'): string {
  return renderToStaticMarkup(
    <CountryTable entries={liveEntries(rank)} now={FIXED_NOW} fx={live.fxRates} rankLabel="Citizenship rule" caption="All" targets={new Set()} />,
  );
}

describe('finding: no code-made legal paraphrase with a Verified badge on the ranked line (live seed)', () => {
  it('Canada: "36 months (the number this rule is ranked by)" with no badge; the rule keeps its own wording and badge', () => {
    const ca = liveEntries('citizenship').find((e) => e.row.country === 'CA')!;
    const line = renderToStaticMarkup(<RankedValue entry={ca} rankLabel="Citizenship rule" />);
    expect(line).toContain('36 months (the number this rule is ranked by)');
    expect(line).not.toMatch(/Verified|Likely|Unverified|Conflict|✓/);
    expect(line).not.toMatch(/minimum residence|3 years/);
    expect(line).toContain('Read the exact rule');
    const html = cardHtml('CA');
    expect(html).toContain('1,095 days');
    expect(html).toContain('</svg>Verified'); // the rule row itself still carries its computed badge (check icon + label)
  });

  it('UK post-study work: "18 months (the number this rule is ranked by)" with no badge, above the exact 2-year/18-month rule', () => {
    const uk = liveEntries('psw').find((e) => e.row.country === 'UK')!;
    const line = renderToStaticMarkup(<RankedValue entry={uk} rankLabel="Post-study work" />);
    expect(line).toContain('18 months (the number this rule is ranked by)');
    expect(line).not.toMatch(/Verified|Likely|✓|longest work permit/);
    const html = cardHtml('UK', 'psw');
    expect(html).toContain('2 years if you apply by 31 December 2026');
    expect(html).not.toContain('longest work permit');
  });

  it('US post-study work: the "36 months" line has no badge and no "3 years longest work permit"', () => {
    const us = liveEntries('psw').find((e) => e.row.country === 'US')!;
    const line = renderToStaticMarkup(<RankedValue entry={us} rankLabel="Post-study work" />);
    expect(line).toContain('36 months (the number this rule is ranked by)');
    expect(line).not.toMatch(/Verified|Likely|✓|3 years|longest work permit/);
  });

  it('the table ranked line has no paraphrase either', () => {
    for (const rank of ['citizenship', 'psw'] as const) {
      const html = tableHtml(rank);
      expect(html).not.toMatch(/minimum residence|longest work permit/);
      expect(html).toContain('(the number this rule is ranked by)');
    }
  });

  it('a converted money amount keeps its computed badge', () => {
    const facts: CountryFact[] = [
      cf('CA', 'tuition_typical', verified({ text: 'Fixture tuition', money: { amount: 1000, currency: 'CAD', period: 'year' } })),
    ];
    const fx: FxRate[] = [{ id: 'cad-pkr', currency: 'CAD', pkr_per_unit: verified(10) }];
    const r = rankCountries(buildCountryRows(facts), { rank: 'tuition', dir: 'asc' }, fx, FIXED_NOW);
    const line = renderToStaticMarkup(<RankedValue entry={entries(r)[0]} rankLabel="Tuition" />);
    expect(line).toContain('PKR 10,000 per year');
    expect(line).toContain('Verified');
  });

  it('"How this ranking works" never calls the number a legal minimum/maximum and says the rule text counts', () => {
    const html = renderToStaticMarkup(<HowRankingWorks />);
    expect(html).toContain('How this ranking works');
    expect(html).toContain('It is only the number we rank by');
    expect(html).toContain('not a legal minimum or');
    expect(html).toContain('The exact rule');
    expect(html).toContain('is what counts');
    expect(html).not.toMatch(/shortest time you must live|longest work permit the rule allows|minimum residence/);
    expect(html).toContain('not legal or immigration advice');
    expect(html).toContain('href="/disclaimer"');
    expectCleanCopy(html);
  });
});

describe('finding: every country fact with evidence shows it (live seed)', () => {
  const withSnippet = live.countryFacts.filter(
    (f) => f.country !== 'PK' && f.evidence_snippet != null && f.evidence_snippet.trim() !== '',
  );

  it('there are verified country facts with snippets to check', () => {
    expect(withSnippet.map((f) => f.id)).toEqual(
      expect.arrayContaining([
        'ca-citizenship-rule',
        'de-citizenship-update',
        'de-dual-nationality-destination',
        'uk-post-study-work',
        'us-post-study-work',
        'uk-proof-of-funds',
        'de-proof-of-funds',
        'ca-proof-of-funds',
        'us-proof-of-funds',
      ]),
    );
  });

  it('cards show each verbatim snippet in a collapsible "Evidence from the official page"', () => {
    for (const f of withSnippet) {
      const html = cardHtml(f.country);
      expect(html, f.id).toContain(esc(f.evidence_snippet as string));
      expect(html, f.id).toMatch(/<details[^>]*><summary[^>]*>Evidence from the official page/);
      expect(html, f.id).toContain('class="evidence-quote mt-1"');
    }
  });

  it('the table shows each snippet compactly', () => {
    const html = tableHtml();
    for (const f of withSnippet) expect(html, f.id).toContain(esc(f.evidence_snippet as string));
    expect(html).toContain('>Evidence</summary>');
  });

  it('Germany: recent-change and dual-nationality snippets are shown; only the German one is labelled "original German"', () => {
    const html = cardHtml('DE');
    expect(html).toContain('Turboeinb');
    expect(html).toContain('As of 27 June 2024, citizens');
    expect(html.match(/\(original German\)/g)).toHaveLength(1);
    expect(html).toContain('lang="de"');
    expect(html).toContain('The official page is in German');
    const table = tableHtml();
    expect(table).toContain('Turboeinb');
    expect(table).toContain('As of 27 June 2024, citizens');
    expect(table).toContain('Evidence (original German)');
  });

  it('evidence is plain text (never HTML) and conflict sources each show their own snippet', () => {
    const snippetHtml = '<img src=x onerror=alert(1)>Fixture snippet';
    const fact = cf('CA', 'post_study_work', {
      ...conflicting<CountryFactValue>({ text: 'Fixture PSW A', sort_months: 12 }, { text: 'Fixture PSW B', sort_months: 24 }),
      evidence_snippet: snippetHtml,
    });
    const row = buildCountryRows([fact], ['CA'])[0];
    const e: CountryEntry = { row, key: { value: null, confidence: 'Conflict', display: null, showBadge: false }, reason: 'x' };
    const html = renderToStaticMarkup(<CountryCard entry={e} now={FIXED_NOW} fx={[]} rankLabel="Post-study work" />);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;Fixture snippet');
    expect(html).toContain('Fixture snippet for'); // the second source's own snippet
  });
});

describe("finding: each fact's student note is shown; review_note never is", () => {
  it('Canada: the half-day quote is shown under the rule, in the card and in the table', () => {
    const quote = 'Each day as a temporary resident or protected person during your eligibility period counts as 0.5 days';
    expect(cardHtml('CA')).toContain(`Note: </span>${esc('The same page says: "')}${quote}`);
    expect(tableHtml()).toContain(quote);
  });

  it('United States: the STEM extension quote is shown under the post-study work rule', () => {
    const quote = 'Science, Technology, Engineering and Mathematics (STEM) fields';
    expect(cardHtml('US', 'psw')).toContain(quote);
    expect(tableHtml('psw')).toContain(quote);
  });

  it('a "Not verified yet." note is not repeated as a note', () => {
    for (const c of ['DE', 'CH', 'UK', 'CA', 'US']) expect(cardHtml(c)).not.toContain('Note: </span>Not verified yet');
    expect(tableHtml()).not.toContain('Note: </span>Not verified yet');
  });

  it('live seed: no review_note text appears anywhere on the cards, table or Pakistan card', () => {
    const reviewNotes = live.countryFacts.map((f) => f.review_note).filter((n): n is string => Boolean(n));
    expect(reviewNotes.length).toBeGreaterThan(0);
    const all = [
      ...['DE', 'CH', 'UK', 'CA', 'US'].flatMap((c) => [cardHtml(c), cardHtml(c, 'psw')]),
      tableHtml(),
      tableHtml('psw'),
      renderToStaticMarkup(<PakistanNationalityCard fact={pakistanDualNationality(live.countryFacts)} now={FIXED_NOW} />),
    ].join('\n');
    for (const n of reviewNotes) {
      expect(all).not.toContain(esc(n));
      expect(all).not.toContain(esc(n.slice(0, 60)));
    }
    expect(all).not.toContain('checked by a second reviewer');
    expect(all).not.toContain('Awaiting human review');
  });

  it('fixtures: review_note is never rendered, for usable, Unverified, empty and conflicting facts', () => {
    const MARK = 'REVIEW-NOTE-MARKER-7f3a';
    const facts: CountryFact[] = [
      cf('CA', 'citizenship_rule', {
        ...verified<CountryFactValue>({ text: 'Fixture CA rule', sort_months: 30 }),
        note: 'Fixture student note',
        review_note: MARK,
      }),
      cf('CA', 'post_study_work', { ...unverified<CountryFactValue>({ text: 'Fixture unverified PSW' }), review_note: MARK }),
      cf('CA', 'pr_route', { ...unverified<CountryFactValue>(null), review_note: MARK }),
      cf('CA', 'dual_nationality_destination', {
        ...conflicting<CountryFactValue>({ text: 'Fixture A' }, { text: 'Fixture B' }),
        review_note: MARK,
      }),
      cf('PK', 'pakistan_dual_nationality', { ...likely<CountryFactValue>({ text: 'Fixture PK rule' }), review_note: MARK }),
    ];
    const r = rankCountries(buildCountryRows(facts), { rank: 'citizenship', dir: 'asc' }, [], FIXED_NOW);
    const ca = entries(r).find((e) => e.row.country === 'CA')!;
    const card = renderToStaticMarkup(<CountryCard entry={ca} now={FIXED_NOW} fx={[]} rankLabel="Citizenship rule" />);
    const table = renderToStaticMarkup(
      <CountryTable entries={[ca]} now={FIXED_NOW} fx={[]} rankLabel="x" caption="x" targets={new Set()} />,
    );
    const pk = renderToStaticMarkup(<PakistanNationalityCard fact={pakistanDualNationality(facts)} now={FIXED_NOW} />);
    for (const html of [card, table, pk]) expect(html).not.toContain(MARK);
    expect(card).toContain('Note: </span>Fixture student note');
    expect(table).toContain('Fixture student note');
    expect(card).toContain('Not from an official page yet. Do not rely on it.');
    expect(pk).toContain('Summary of the source, not a direct quote');
  });
});

/* ---------------- Money to show for the student visa (proof_of_funds) ---------------- */

describe('Money to show for the student visa (live seed)', () => {
  const HEADING = 'Money to show for the student visa';
  const fact = (c: string) => liveRows.find((r) => r.country === c)!.facts.proof_of_funds;
  const block = (c: string, fx: FxRate[] = live.fxRates, now: Date = FIXED_NOW, compact = false) =>
    renderToStaticMarkup(<VisaFundsBlock fact={fact(c)} fx={fx} now={now} compact={compact} />);

  it('every card and the table show the block for all five countries, whatever the ranking', () => {
    for (const rank of ['citizenship', 'psw', 'tuition', 'total'] as const) {
      const all = entries(rankCountries(liveRows, parseCitizenshipQuery({ rank }), live.fxRates, FIXED_NOW));
      expect(all).toHaveLength(5);
      for (const e of all) {
        const html = renderToStaticMarkup(<CountryCard entry={e} now={FIXED_NOW} fx={live.fxRates} rankLabel={rank} />);
        expect(html, `${rank} ${e.row.country}`).toContain(`<h4 class="mt-2 text-sm font-bold text-heading">${HEADING}</h4>`);
        expect(html.match(/data-block="visa-funds"/g), `${rank} ${e.row.country}`).toHaveLength(1);
      }
      const table = renderToStaticMarkup(
        <CountryTable entries={all} now={FIXED_NOW} fx={live.fxRates} rankLabel={rank} caption="All" targets={new Set()} />,
      );
      expect(table.match(/data-block="visa-funds"/g)).toHaveLength(5);
      expect(table.match(new RegExp(HEADING, 'g'))).toHaveLength(5);
    }
    // The frozen empty seed (no proof_of_funds rows at all) still shows the block, as "Not verified yet".
    for (const e of entries(rankCountries(buildCountryRows(seed.countryFacts), parseCitizenshipQuery({}), seed.fxRates, FIXED_NOW))) {
      const html = renderToStaticMarkup(<CountryCard entry={e} now={FIXED_NOW} fx={seed.fxRates} rankLabel="x" />);
      expect(html).toContain(HEADING);
    }
  });

  it('UK: rule text, how it is checked, Verified badge, gov.uk link and blue evidence; no amount and no PKR line', () => {
    const html = block('UK');
    expect(html).toContain('£1,529 per month for courses in London or £1,171 per month for courses outside London');
    expect(html).toContain('How it is checked: </span>You must have this money for at least 28 days in a row.');
    expect(html).toContain('</svg>Verified');
    expect(html).toContain('href="https://www.gov.uk/student-visa/money"');
    expect(html).toContain('Checked 24 Nov 2026');
    expect(html).toMatch(/<summary[^>]*text-link[^>]*>Evidence from the official page<\/summary>/);
    expect(html).toContain(
      `<blockquote class="evidence-quote mt-1">${esc('£1,529 per month (for up to 9 months) for courses in London £1,171 per month (for up to 9 months) for courses outside London')}</blockquote>`,
    );
    expect(html).toContain('Confirmation of Acceptance for Studies (CAS)'); // student note
    expect(html).not.toContain('Amount: ');
    expect(html).not.toContain('In Pakistani rupees');
    expect(html).toContain(esc(VISA_FUNDS_NOT_RANKED));
    expectCleanCopy(html);
  });

  it('DE: EUR 11,904 per year and "No verified PKR rate yet" (no usable EUR rate today)', () => {
    const html = block('DE');
    expect(html).toContain('Amount: </span>€11,904 per year');
    expect(html).toContain(`In Pakistani rupees: </span><span class="text-muted">${NO_PKR_RATE}</span>`);
    expect(html).toContain('href="https://pakistan.diplo.de/pk-en/service/1995528-1995528"');
    expect(html).toContain('11.904,00 Euros yearly'); // verbatim evidence
    expect(html).not.toContain('(original German)'); // the embassy page is in English
    expect(html).not.toMatch(/PKR \d/);
    expectCleanCopy(html);
  });

  it('CA: CAD 23,448 per year and "No verified PKR rate yet"', () => {
    const html = block('CA');
    expect(html).toContain('Amount: </span>CA$23,448 per year');
    expect(html).toContain(`In Pakistani rupees: </span><span class="text-muted">${NO_PKR_RATE}</span>`);
    expect(html).toContain('not including tuition and transport');
    expect(html).toContain('How it is checked: </span>The amount is for the first year of your program');
    expect(html).toContain('href="https://www.canada.ca/en/immigration-refugees-citizenship/');
    expectCleanCopy(html);
  });

  it('US: the I-20 rule with its evidence, but no amount and no PKR line', () => {
    const html = block('US');
    expect(html).toContain('Your school checks this before it issues your Form I-20');
    expect(html).toContain('href="https://studyinthestates.dhs.gov/students/prepare/financial-ability"');
    expect(html).toContain('Designated school officials (DSOs) must collect evidence');
    expect(html).not.toContain('Amount: ');
    expect(html).not.toContain('In Pakistani rupees');
    expect(html).not.toContain('How it is checked');
    expectCleanCopy(html);
  });

  it('CH: "Not verified yet" with the Unverified badge, no repeated note and no link', () => {
    const html = block('CH');
    expect(html).toContain('Not verified yet');
    expect(html).toContain('Unverified');
    expect(html).not.toContain('Note: </span>Not verified yet');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('Amount: ');
    expect(html).toContain(esc(VISA_FUNDS_NOT_RANKED));
  });

  it('cards and the table carry the same evidence; the table uses the compact toggle and names the country for screen readers', () => {
    const table = tableHtml();
    for (const c of ['UK', 'DE', 'CA', 'US']) expect(table).toContain(esc(fact(c)!.evidence_snippet as string));
    expect(table).toContain('<td colSpan="6"');
    expect(table).toContain('<span class="sr-only">, United Kingdom</span>');
    expect(block('UK', live.fxRates, FIXED_NOW, true)).toContain('>Evidence</summary>');
    expect(cardHtml('DE')).toContain('Amount: </span>€11,904 per year');
    expect(cardHtml('CA', 'psw')).toContain('Amount: </span>CA$23,448 per year');
  });

  it('no review_note of a visa-money row is ever rendered (card, table, block)', () => {
    const notes = ['UK', 'DE', 'CA', 'US'].map((c) => fact(c)!.review_note).filter((n): n is string => Boolean(n));
    expect(notes).toHaveLength(4);
    const all = [
      ...['UK', 'DE', 'CA', 'US', 'CH'].flatMap((c) => [block(c), block(c, [], FIXED_NOW, true), cardHtml(c)]),
      tableHtml(),
    ].join('\n');
    for (const n of notes) {
      expect(all).not.toContain(esc(n.slice(0, 60)));
    }
    expect(all).not.toContain('Companion snippets');
    expect(all).not.toContain('Awaiting human review');
  });

  it('pinned 2 Dec 2026: still Verified; 10 Jan 2027: Likely with the re-verify note', () => {
    expect(block('DE', live.fxRates, new Date('2026-12-02T12:00:00Z'))).toContain('</svg>Verified');
    const later = block('DE', live.fxRates, new Date('2027-01-10T12:00:00Z'));
    expect(later).not.toContain('</svg>Verified');
    expect(later).toContain('Likely');
    expect(later).toContain('re-verify on the official page before relying on it');
  });

  it('"How this ranking works" says visa money is never ranked, and why', () => {
    const html = renderToStaticMarkup(<HowRankingWorks />);
    expect(html).toContain(`${HEADING}:</strong> never used to rank or filter.`);
    expect(html).toContain('so the amounts cannot be compared');
    expect(html).toContain('A PKR amount is shown only with a Verified or Likely exchange rate.');
    expectCleanCopy(html);
  });
});

describe('Money to show for the student visa (fixtures)', () => {
  const visa = (amount: number, currency = 'EUR'): CountryFactValue => ({
    text: 'Fixture visa money rule (fictional).',
    money: { amount, currency, period: 'year' },
  });

  it('with a usable exchange rate: the PKR line, its computed badge and the rate date; never blue', () => {
    const f = cf('DE', 'proof_of_funds', verified(visa(1000)));
    const fx: FxRate[] = [{ id: 'eur-pkr', currency: 'EUR', pkr_per_unit: { ...verified(300), fetched_at: '2026-11-20' } }];
    const html = renderToStaticMarkup(<VisaFundsBlock fact={f} fx={fx} now={FIXED_NOW} />);
    expect(html).toContain('Amount: </span>€1,000 per year');
    expect(html).toMatch(/In Pakistani rupees: <\/span><span class="[^"]*"><span class="text-ink">PKR 300,000 \(3 lakh\) per year<\/span><span [^>]*bg-verified-bg/);
    expect(html).toContain('Converted from EUR with the exchange rate checked 20 Nov 2026. The official amount is the one in EUR.');
    expect(html).not.toContain(NO_PKR_RATE);
    // Blue is for official sources only: the converted line is ink, not link-blue.
    const pkrLine = html.slice(html.indexOf('In Pakistani rupees'), html.indexOf('Converted from EUR'));
    expect(pkrLine).not.toContain('text-link');
  });

  it('an Unverified amount is shown as not from an official page and never converted', () => {
    const f = cf('DE', 'proof_of_funds', unverified(visa(1000)));
    const fx: FxRate[] = [{ id: 'eur-pkr', currency: 'EUR', pkr_per_unit: verified(300) }];
    const html = renderToStaticMarkup(<VisaFundsBlock fact={f} fx={fx} now={FIXED_NOW} />);
    expect(html).toContain('Unverified');
    expect(html).toContain('Not from an official page yet. Do not rely on it.');
    expect(html).toContain('Not converted to PKR because the amount is not verified yet');
    expect(html).not.toMatch(/PKR \d/);
  });

  it('Conflict: both amounts with both links, and a copy-question button on the card', () => {
    const f = cf('CA', 'proof_of_funds', conflicting(visa(1000, 'CAD'), visa(2000, 'CAD')));
    const html = renderToStaticMarkup(<VisaFundsBlock fact={f} fx={[]} now={FIXED_NOW} />);
    expect(html).toContain('Official sources disagree');
    expect(html).toContain('CA$1,000 per year. Fixture visa money rule (fictional).');
    expect(html).toContain('CA$2,000 per year. Fixture visa money rule (fictional).');
    expect(html).toContain('https://fixture.example.edu/page-a');
    expect(html).toContain('https://fixture.example.edu/page-b');
    expect(html).not.toContain('In Pakistani rupees');
    const row = buildCountryRows([f], ['CA'])[0];
    const e: CountryEntry = { row, key: { value: null, confidence: 'Unverified', display: null, showBadge: false }, reason: 'x' };
    const card = renderToStaticMarkup(<CountryCard entry={e} now={FIXED_NOW} fx={[]} rankLabel="Citizenship rule" />);
    expect(card).toContain('Copy question: money to show for the student visa');
  });

  it('data is plain text, never HTML; review_note never shows', () => {
    const MARK = 'REVIEW-NOTE-MARKER-visa';
    const f = cf('UK', 'proof_of_funds', {
      ...verified<CountryFactValue>({ text: '<img src=x onerror=alert(1)>Fixture rule', clock_note: '<b>Fixture check</b>' }),
      note: '<script>x</script>Fixture note',
      review_note: MARK,
    });
    const html = renderToStaticMarkup(<VisaFundsBlock fact={f} fx={[]} now={FIXED_NOW} />);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;Fixture rule');
    expect(html).toContain('How it is checked: </span>&lt;b&gt;Fixture check&lt;/b&gt;');
    expect(html).not.toContain(MARK);
  });

  it('no row at all: "Not verified yet" and the not-ranked line', () => {
    const html = renderToStaticMarkup(<VisaFundsBlock fact={null} fx={[]} now={FIXED_NOW} />);
    expect(html).toContain('Not verified yet');
    expect(html).toContain('Unverified');
    expect(html).toContain(esc(VISA_FUNDS_NOT_RANKED));
  });
});
