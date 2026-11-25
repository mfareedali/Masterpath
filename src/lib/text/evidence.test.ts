import { describe, expect, it } from 'vitest';
import { htmlToText, normalizeForMatch, snippetAppearsIn } from './evidence';

describe('evidence text', () => {
  const html = `<html><head><style>.x{}</style><script>var a = "Deadline: 1 Jan";</script></head>
  <body><h1>MSc Fixture</h1><p>Applications close on <strong>15&nbsp;January&nbsp;2027</strong>.</p>
  <p>Applicants need a CGPA of 3.0 &ndash; or equivalent.</p></body></html>`;

  it('strips scripts/styles and tags, decodes entities', () => {
    const t = htmlToText(html);
    expect(t).toContain('Applications close on 15 January 2027.');
    expect(t).not.toContain('var a');
  });

  it('verbatim check tolerates whitespace/quote/dash differences, not wording', () => {
    const t = htmlToText(html);
    expect(snippetAppearsIn('Applicants need a CGPA of 3.0 - or equivalent', t)).toBe(true);
    expect(snippetAppearsIn('Applicants need a CGPA of 2.5 - or equivalent', t)).toBe(false);
    expect(snippetAppearsIn('Deadline: 1 Jan', t)).toBe(false); // script content is not evidence
  });

  it('rejects very short snippets', () => {
    expect(snippetAppearsIn('3.0', 'a CGPA of 3.0')).toBe(false);
  });

  it('normalises curly quotes', () => {
    expect(normalizeForMatch('Master’s “degree”')).toBe(`master's "degree"`);
  });
});
