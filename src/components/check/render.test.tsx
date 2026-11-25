/**
 * Server-render smoke tests (node environment, no DOM library): the Consultant Check components render with
 * today's empty seed data AND with full fixture data, and follow the evidence and safety rules.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { runCheck, type CheckData, type CheckResult } from '@/lib/consultant/compare';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { FIXED_NOW, conflicting, makeInstitution, makeProgram, verified, loadEmptySeedDataset } from '@/lib/test-fixtures';
import { CheckForm } from './check-form';
import { CheckLegend } from './check-legend';
import { CheckResults } from './check-results';
import { ClaimCard } from './claim-card';
import { NameSuggestionNote, suggestionHref } from './name-suggestion';
import { VerdictBadge } from './verdict-badge';

const seed = loadEmptySeedDataset();
const UK_TEXT = 'Guaranteed admission at Oxford Brookes, no IELTS needed, total cost 25 lakh, PR in 2 years';

const fixtureData: CheckData = {
  programs: [
    makeProgram({
      language_req: verified({ ielts_overall: 6.5 }),
      tuition: verified({ amount: 10_000, currency: 'GBP', period: 'year' }),
      living_cost: verified({ amount: 8_000, currency: 'GBP', period: 'year' }),
      duration_months: verified(12),
      deadline: conflicting('2027-03-15', '2027-04-01'),
    }),
  ],
  institutions: [makeInstitution()],
  countryFacts: [],
  conversionRules: [],
  fxRates: [{ id: 'fixture-gbp', currency: 'GBP', pkr_per_unit: verified(300) }],
};

const ACCUSING = /\b(lie|lies|lied|lying|liar|fraud\w*|scam\w*|cheat\w*|fake|dishonest\w*|mislead\w*)\b/i;

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function externalLinks(html: string): string[] {
  return [...html.matchAll(/<a [^>]*href="(https?:[^"]*)"[^>]*>/g)].map((m) => m[0]);
}

describe('CheckResults', () => {
  it('renders the seed run: one "Differs" card (UK PR) and three "Can\'t verify" cards', () => {
    const run = runCheck(UK_TEXT, seed, FIXED_NOW);
    const html = renderToStaticMarkup(<CheckResults run={run} shareUrl="https://masterspath.example/check" />);
    const text = textOf(html);
    expect(text).toContain("We checked 4 claims against the official information we hold: 1 differs, 3 we can't verify yet, 0 match.");
    // The frozen seed's UK PR row is an unquoted summary: the card never says "official page".
    expect(text).toContain('Differs from our summary of the official position');
    expect(text).not.toContain('Differs from official page');
    expect(text).toContain('Our summary (not a quote):');
    expect(text).not.toContain('Exact words on the official page');
    expect(text).toContain('Not verified yet');
    expect(text).toContain('Questions to ask them in writing');
    expect(text).toContain('Copy all questions');
    expect(html).toContain('https://wa.me/?text=');
    expect(html).toContain(encodeURIComponent('https://masterspath.example/check'));
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/<h1/);
    expect(text).not.toMatch(ACCUSING);
    expect(text).not.toMatch(/\d\s*%/);
  });

  it('renders full fixture data with sources, confidence badges and both conflicting sources', () => {
    const run = runCheck('Fixture University: no IELTS needed, total cost 25 lakh, deadline is 15 March 2027', fixtureData, FIXED_NOW);
    const html = renderToStaticMarkup(<CheckResults run={run} shareUrl={null} />);
    const text = textOf(html);
    expect(text).toContain('What the official sources we hold say');
    expect(text).toContain('IELTS 6.5 overall');
    expect(text).toContain('Exact words on the official page:');
    expect(text).toContain('“Fixture snippet for {"ielts_overall":6.5}”');
    expect(text).toContain('In short:');
    expect(text).toContain('Verified');
    expect(text).toContain('Conflict');
    expect(html).toContain('https://fixture.example.edu/page-a');
    expect(html).toContain('https://fixture.example.edu/page-b');
    expect(text).not.toMatch(ACCUSING);
  });

  it('every external link opens safely', () => {
    const run = runCheck(UK_TEXT, seed, FIXED_NOW);
    const html = renderToStaticMarkup(<CheckResults run={run} shareUrl={null} />);
    const links = externalLinks(html);
    expect(links.length).toBeGreaterThan(0);
    for (const a of links) {
      expect(a).toContain('target="_blank"');
      expect(a).toMatch(/rel="noopener noreferrer[^"]*"/);
    }
  });
});

describe('ClaimCard', () => {
  const base: CheckResult = {
    id: 'c1',
    claim: '<script>alert(1)</script> no IELTS',
    type: 'no_language_test',
    typeLabel: 'English test',
    verdict: 'conflict',
    verdictLabel: 'Differs from official page',
    explanation: '<b>plain</b> text only',
    sources: [{ label: 'Fixture', value: '<img src=x onerror=alert(1)>', confidence: 'Verified', source_url: 'javascript:alert(1)' }],
    questionsToAsk: ['Fixture question?'],
    about: [],
    reading: null,
    officialLinks: [],
  };

  it('escapes user text and data, and never links a javascript: URL', () => {
    const html = renderToStaticMarkup(<ClaimCard result={base} index={0} />);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('href="javascript:');
    expect(textOf(html)).toContain('No source link yet');
  });

  it('shows "Not verified yet" with the official link when there is no usable source', () => {
    const html = renderToStaticMarkup(
      <ClaimCard
        result={{ ...base, verdict: 'cant_verify', sources: [], officialLinks: [{ label: 'x', url: 'https://fixture.example.edu/program' }] }}
        index={1}
      />,
    );
    expect(textOf(html)).toContain('Not verified yet');
    expect(html).toContain('href="https://fixture.example.edu/program"');
    expect(textOf(html)).toContain("Can't verify");
    expect(textOf(html)).toContain('Claim 2');
  });

  it('a label that does not belong to the verdict falls back to the cautious summary label', () => {
    const html = renderToStaticMarkup(<ClaimCard result={{ ...base, verdict: 'matches', verdictLabel: 'Differs from official page' }} index={0} />);
    expect(textOf(html)).toContain('Matches our summary of the official position');
    expect(textOf(html)).not.toContain('official page');
  });

  it('shows the exact words in quotes, our wording as "In short:", and the notes; a summary row says so', () => {
    const source = {
      label: 'Fixture rule',
      value: 'Fixture paraphrase',
      confidence: 'Verified' as const,
      source_url: 'https://fixture.example.gov/rule',
      snippet: 'Fixture exact words',
      clockNote: 'Fixture clock rule',
      note: 'Fixture student note',
    };
    const text = textOf(renderToStaticMarkup(<ClaimCard result={{ ...base, sources: [source] }} index={0} />));
    expect(text).toContain('Exact words on the official page:');
    expect(text).toContain('“Fixture exact words”');
    expect(text).toContain('In short:  Fixture paraphrase');
    expect(text).not.toContain('“Fixture paraphrase');
    expect(text).toContain('How the clock works:  Fixture clock rule');
    expect(text).toContain('Note:  Fixture student note');
    const summary = textOf(
      renderToStaticMarkup(<ClaimCard result={{ ...base, sources: [{ ...source, confidence: 'Likely', snippet: null }] }} index={0} />),
    );
    expect(summary).toContain('Our summary (not a quote):  Fixture paraphrase');
    expect(summary).not.toContain('Exact words');
  });
});

describe('VerdictBadge', () => {
  it('differs by label, glyph and border, not colour alone', () => {
    const conflict = renderToStaticMarkup(<VerdictBadge verdict="conflict" />);
    const cant = renderToStaticMarkup(<VerdictBadge verdict="cant_verify" />);
    const match = renderToStaticMarkup(<VerdictBadge verdict="matches" />);
    expect(textOf(conflict)).toContain('Differs from official page');
    expect(textOf(cant)).toContain("Can't verify");
    expect(textOf(match)).toContain('Matches official page');
    expect(conflict).toContain('bg-conflict-bg');
    expect(cant).toContain('border-dashed');
    expect(match).toContain('bg-verified-bg');
  });

  it('shows a label override and lets a long label wrap on small screens', () => {
    const long = renderToStaticMarkup(<VerdictBadge verdict="conflict" label="Differs from our summary of the official position" />);
    expect(textOf(long)).toContain('Differs from our summary of the official position');
    expect(textOf(long)).not.toContain('Differs from official page');
    expect(long).toContain('whitespace-normal');
    expect(renderToStaticMarkup(<VerdictBadge verdict="conflict" />)).toContain('whitespace-nowrap');
  });
});

describe('CheckForm and legend', () => {
  it('has a labelled, limited textarea and example links that only prefill', () => {
    const html = renderToStaticMarkup(<CheckForm defaultText="" activeExample="uk" heading="Paste what you were told" headingId="h" />);
    expect(html).toMatch(/<label[^>]*for="claims-input"/);
    expect(html).toMatch(/<textarea[^>]*id="claims-input"/);
    expect(html).toContain('name="claims"');
    expect(html).toContain('maxLength="2000"');
    expect(html).toContain('href="/check?example=uk"');
    expect(html).toContain('href="/check?example=germany"');
    expect(html).toContain('aria-current="true"');
    expect(textOf(html)).toContain('made-up example');
  });

  it('legend explains every verdict and confidence label', () => {
    const text = textOf(renderToStaticMarkup(<CheckLegend />));
    for (const s of [
      'Matches official page',
      'Differs from official page',
      "Can't verify",
      'Differs from our summary of the official position',
      'Matches our summary of the official position',
      'In short:',
      'Verified',
      'Likely',
      'Unverified',
      'Conflict',
    ]) {
      expect(text).toContain(s);
    }
  });
});

describe("review regressions on today's data", () => {
  const live = loadSeedDataset();
  const render = (text: string) => {
    const html = renderToStaticMarkup(<CheckResults run={runCheck(text, live, FIXED_NOW)} shareUrl={null} />);
    return { html, text: textOf(html) };
  };

  it('UK PR in 2 years: "Differs from official page" beside the verbatim gov.uk words, never the Home Office homepage', () => {
    const row = live.countryFacts.find((f) => f.id === 'uk-pr-route')!;
    const { html, text } = render('PR in UK in 2 years');
    expect(text).toContain('Differs from official page');
    expect(text).toContain(`“${row.evidence_snippet}”`);
    expect(html).toContain('class="evidence-quote mt-1"');
    expect(html).not.toContain('href="https://www.gov.uk/government/organisations/home-office"');
  });

  it('Canada citizenship after your masters: no green "Matches", the half-day rule and its note are shown', () => {
    const row = live.countryFacts.find((f) => f.id === 'ca-citizenship-rule')!;
    const { text } = render('Canada PR and citizenship in 3 years after your masters, guaranteed.');
    expect(text).not.toContain('Matches official page');
    expect(text).toContain('How the clock works:');
    expect(text).toContain(row.value!.clock_note!);
    expect(text).toContain(`Note:  ${row.note}`);
  });

  it('UK graduate visa is 2 years: not "Differs", and never "up to about 18 months"', () => {
    const { text } = render('UK graduate visa is 2 years');
    expect(text).not.toContain('Differs from');
    expect(text).not.toContain('up to about 18 months');
  });

  it('Brookes minimum grade: the exact words are quoted, the paraphrase is "In short:" and never in quotes', () => {
    const rule = live.programs.find((p) => p.id === 'brookes-msc-cs')!.min_gpa_rule;
    const { text } = render('Oxford Brookes accepts 2.5 CGPA');
    expect(text).toContain(`“${rule.evidence_snippet}”`);
    expect(text).toContain(`In short:  ${rule.value!.text}`);
    expect(text).not.toContain(`“${rule.value!.text}`);
    expect(text).toContain(rule.note!);
  });

  it('Brookes promise shows the verified Pakistan notice; Imperial shows who the course is for, with "Not verified yet"', () => {
    const brookes = render('Guaranteed admission at Oxford Brookes').text;
    expect(brookes).toContain('notice for applicants');
    expect(brookes).toContain('No offers beyond 23 October 2026');
    const imperial = render('Imperial deadline is 31 May').text;
    expect(imperial).toContain('who the course is for');
    expect(imperial).toContain('subjects other than computing');
    expect(imperial).toContain('Not verified yet');
  });

  it('a German-language snippet is labelled as the original German', () => {
    const { html, text } = render('German passport in 3 years');
    expect(text).toContain('Exact words on the official page (original German):');
    expect(html).toContain('lang="de"');
  });

  it('never renders an internal review_note', () => {
    const notes = [
      ...live.countryFacts.map((f) => f.review_note),
      ...live.programs.flatMap((p) => Object.values(p).map((v) => (v && typeof v === 'object' && 'review_note' in v ? v.review_note : null))),
    ].filter((n): n is string => typeof n === 'string' && n.trim().length > 0);
    expect(notes.length).toBeGreaterThan(5);
    const { text } = render(
      [
        'Guaranteed admission at Oxford Brookes, no IELTS needed, total cost 25 lakh, PR in 2 years.',
        'Oxford Brookes accepts 2.5 CGPA. Imperial deadline is 31 May. QMUL progression guaranteed.',
        'Canada citizenship in 3 years after your masters. UK graduate visa is 2 years. German passport in 3 years.',
        'Post-study work 3 years in the USA. ETH deadline is 15 December. Tuition at Wurzburg is free.',
      ].join(' '),
    );
    for (const n of notes) expect(text).not.toContain(n.slice(0, 60));
    expect(text).not.toContain('Proposed from the official page');
    expect(text).not.toContain('730 days as a permanent resident');
  });
});

describe('NameSuggestionNote ("Did you mean …?")', () => {
  it('asks, and links back to /check with the corrected text (an internal link, never an official-source link)', () => {
    const run = runCheck('Brooks mein admission pakka hai & <b>2.5 CGPA</b> chal jayega', loadSeedDataset(), FIXED_NOW);
    expect(run.suggestion).not.toBeNull();
    const html = renderToStaticMarkup(<NameSuggestionNote suggestion={run.suggestion!} />);
    const text = textOf(html);
    expect(text).toContain('We could not match “Brooks”. Did you mean Oxford Brookes University?');
    expect(text).toContain('Yes, check again with Oxford Brookes University');
    const href = suggestionHref(run.suggestion!);
    expect(href.startsWith('/check?claims=')).toBe(true);
    expect(decodeURIComponent(href.slice('/check?claims='.length))).toBe('Brookes mein admission pakka hai & <b>2.5 CGPA</b> chal jayega');
    expect(html).toContain(`href="${href.replace(/&/g, '&amp;')}"`);
    // Plain text only: the user's markup is escaped, and the link is not an external (blue, nofollow) source link.
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('nofollow');
    expect(externalLinks(html)).toEqual([]);
  });
});

describe('source rules for my files', () => {
  const roots = ['src/components/check', 'src/app/check', 'src/lib/consultant'];
  const files = roots.flatMap((r) => readdirSync(r).filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx')).map((f) => join(r, f)));

  it('never renders HTML from strings', () => {
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toContain('dangerouslySetInnerHTML');
  });

  it('uses no default Tailwind palette colours', () => {
    const banned = /\b(?:bg|text|border|ring|fill|stroke)-(?:red|gray|grey|blue|green|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(banned);
  });
});
