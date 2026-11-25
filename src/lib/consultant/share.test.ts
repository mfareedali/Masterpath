import { describe, expect, it } from 'vitest';
import { FIXED_NOW, loadEmptySeedDataset } from '../test-fixtures';
import { runCheck, type CheckResult } from './compare';
import { SHARE_FOOTER, SHARE_MAX_CHARS, buildQuestionsText, buildShareText, summarySentence, truncate, whatsappShareUrl } from './share';

const seed = loadEmptySeedDataset();

function result(over: Partial<CheckResult> = {}): CheckResult {
  return {
    id: 'c1',
    claim: 'No IELTS needed',
    type: 'no_language_test',
    typeLabel: 'English test',
    verdict: 'cant_verify',
    verdictLabel: "Can't verify",
    explanation: 'x',
    sources: [],
    questionsToAsk: ['Which official page says IELTS is not required for Pakistani applicants?'],
    about: [],
    reading: null,
    officialLinks: [],
    ...over,
  };
}

describe('buildShareText', () => {
  const run = runCheck('Guaranteed admission at Oxford Brookes, no IELTS needed, total cost 25 lakh, PR in 2 years', seed, FIXED_NOW);
  const text = buildShareText(run.results);

  it('has one line per claim with a plain verdict', () => {
    expect(text).toContain(`- Can't verify yet: "Guaranteed admission at Oxford Brookes"`);
    expect(text).toContain(`- Can't verify yet: "no IELTS needed"`);
    // The frozen seed's UK PR row has no exact words from the official page, so the line never says "official page".
    expect(text).toContain(`- Differs from our summary of the official position: "PR in 2 years"`);
    expect(text).not.toContain('Differs from official page');
    expect(
      buildShareText([result({ verdict: 'matches', verdictLabel: 'Matches official page', claim: 'Fixture claim' })]),
    ).toContain('- Matches official page: "Fixture claim"');
  });

  it(`uses each result's own label, and never "official page" for a summary-based verdict`, () => {
    const t = buildShareText([
      result({ id: 'a', verdict: 'conflict', verdictLabel: 'Differs from official page', claim: 'Quoted claim' }),
      result({ id: 'b', verdict: 'matches', verdictLabel: 'Matches our summary of the official position', claim: 'Summary claim' }),
      result({ id: 'c', verdict: 'conflict', verdictLabel: '', claim: 'No label claim' }),
    ]);
    expect(t).toContain('- Differs from official page: "Quoted claim"');
    expect(t).toContain('- Matches our summary of the official position: "Summary claim"');
    expect(t).toContain('- Differs from our summary of the official position: "No label claim"');
  });

  it('includes the key questions and the footer', () => {
    expect(text).toContain('Questions to ask in writing:');
    expect(text).toContain('1. Which official government page says PR is possible in 2 years?');
    expect(text.endsWith(SHARE_FOOTER)).toBe(true);
    expect(SHARE_FOOTER).toBe('Checked with MastersPath (free, open source). Not legal advice.');
  });

  it('is plain text (no HTML)', () => {
    expect(text).not.toMatch(/<[a-z/]/i);
  });

  it(`stays within ${SHARE_MAX_CHARS} characters with many long claims, and keeps the footer`, () => {
    const long = 'Guaranteed admission and a confirmed seat with a very long description of everything that was promised '.repeat(3);
    const many = Array.from({ length: 20 }, (_, i) =>
      result({ id: `c${i}`, claim: `${long} ${i}`, questionsToAsk: [`Question number ${i} about ${long}?`, `Second ${i} ${long}?`] }),
    );
    const t = buildShareText(many);
    expect(t.length).toBeLessThanOrEqual(SHARE_MAX_CHARS);
    expect(t.endsWith(SHARE_FOOTER)).toBe(true);
    expect(t).toContain('and 10 more');
  });

  it('respects a tiny limit and still ends with the footer', () => {
    const t = buildShareText(run.results, { maxChars: 120 });
    expect(t.length).toBeLessThanOrEqual(120);
    expect(t.endsWith(SHARE_FOOTER)).toBe(true);
  });

  it('appends only an https link', () => {
    expect(buildShareText(run.results, { url: 'https://masterspath.example/check' }).endsWith('https://masterspath.example/check')).toBe(true);
    expect(buildShareText(run.results, { url: 'http://localhost:3000/check' })).not.toContain('localhost');
    expect(buildShareText(run.results, { url: 'javascript:alert(1)' })).not.toContain('javascript');
  });

  it('handles no results', () => {
    const t = buildShareText([]);
    expect(t).toContain(SHARE_FOOTER);
    expect(t).not.toContain('Questions to ask');
  });
});

describe('whatsappShareUrl', () => {
  it('encodes the text for wa.me', () => {
    const text = 'Line 1 & "two" #3?\nLine 2: 25 lakh = PKR 2,500,000 — “quoted” 100%';
    const url = whatsappShareUrl(text);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    const encoded = url.slice('https://wa.me/?text='.length);
    expect(encoded).not.toMatch(/[\s&#?"]/);
    expect(decodeURIComponent(encoded)).toBe(text);
    expect(new URL(url).searchParams.get('text')).toBe(text);
  });

  it('round-trips a real share text', () => {
    const run = runCheck('Guaranteed admission at Oxford Brookes, no IELTS needed, total cost 25 lakh, PR in 2 years', seed, FIXED_NOW);
    const text = buildShareText(run.results);
    expect(new URL(whatsappShareUrl(text)).searchParams.get('text')).toBe(text);
  });
});

describe('helpers', () => {
  it('truncate keeps short text and cuts long text on a word boundary', () => {
    expect(truncate('  short   text ', 20)).toBe('short text');
    const t = truncate('one two three four five six seven', 20);
    expect(t.length).toBeLessThanOrEqual(20);
    expect(t.endsWith('…')).toBe(true);
    expect(t).toBe('one two three four…');
  });

  it('summarySentence', () => {
    expect(summarySentence({ total: 0, matches: 0, conflict: 0, cant_verify: 0 })).toBe('We could not find a claim to check.');
    // Counts include summary-based verdicts, so the sentence never says "official pages".
    expect(summarySentence({ total: 4, matches: 0, conflict: 1, cant_verify: 3 })).toBe(
      "We checked 4 claims against the official information we hold: 1 differs, 3 we can't verify yet, 0 match.",
    );
    expect(summarySentence({ total: 1, matches: 1, conflict: 0, cant_verify: 0 })).toBe(
      "We checked 1 claim against the official information we hold: 0 differ, 0 we can't verify yet, 1 matches.",
    );
  });

  it('buildQuestionsText is a polite numbered message', () => {
    expect(buildQuestionsText([])).toBe('');
    const t = buildQuestionsText(['First?', 'Second?']);
    expect(t).toContain('Thank you for your help.');
    expect(t).toContain('1. First?\n2. Second?');
  });
});
