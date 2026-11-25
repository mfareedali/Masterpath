import { describe, expect, it } from 'vitest';
import { EXAMPLE_CLAIMS, findExample } from './examples';
import { MAX_INPUT_CHARS } from './extract';
import { checkPageUrl, parseCheckQuery } from './query';

describe('parseCheckQuery', () => {
  it('empty page', () => {
    expect(parseCheckQuery({})).toEqual({ text: '', submitted: false, truncated: false, redacted: false, exampleId: null });
  });

  it('an example link only prefills', () => {
    const q = parseCheckQuery({ example: 'uk' });
    expect(q).toMatchObject({ submitted: false, exampleId: 'uk' });
    expect(q.text).toBe(findExample('uk')!.text);
    expect(parseCheckQuery({ example: 'nope' }).text).toBe('');
  });

  it('a submitted form wins over an example', () => {
    const q = parseCheckQuery({ claims: '  No IELTS needed  ', example: 'uk' });
    expect(q).toMatchObject({ text: 'No IELTS needed', submitted: true, exampleId: null, truncated: false, redacted: false });
  });

  it('an empty submission is still a submission', () => {
    expect(parseCheckQuery({ claims: '   ' })).toMatchObject({ text: '', submitted: true });
  });

  it('takes the first value of a repeated param', () => {
    expect(parseCheckQuery({ claims: ['first', 'second'] }).text).toBe('first');
  });

  it('cuts long text and says so', () => {
    const q = parseCheckQuery({ claims: 'a '.repeat(3000) });
    expect(q.truncated).toBe(true);
    expect(q.text.length).toBeLessThanOrEqual(MAX_INPUT_CHARS);
  });

  it('removes personal numbers and says so', () => {
    const q = parseCheckQuery({ claims: 'My CNIC is 35202-1234567-1. No IELTS needed.' });
    expect(q.redacted).toBe(true);
    expect(q.text).not.toContain('35202');
  });

  it('every example has a label and text within the limit', () => {
    expect(EXAMPLE_CLAIMS.length).toBeGreaterThanOrEqual(2);
    expect(EXAMPLE_CLAIMS.length).toBeLessThanOrEqual(3);
    for (const e of EXAMPLE_CLAIMS) {
      expect(e.label.length).toBeGreaterThan(0);
      expect(e.text.length).toBeLessThanOrEqual(MAX_INPUT_CHARS);
    }
  });
});

describe('checkPageUrl', () => {
  it('builds an https link to the check page', () => {
    expect(checkPageUrl('masterspath.example', 'https')).toBe('https://masterspath.example/check');
    expect(checkPageUrl('MastersPath.Example, proxy.internal', 'https,http')).toBe('https://masterspath.example/check');
  });

  it('refuses http, localhost and odd hosts', () => {
    expect(checkPageUrl('masterspath.example', 'http')).toBeNull();
    expect(checkPageUrl('masterspath.example', null)).toBeNull();
    expect(checkPageUrl('localhost:3000', 'https')).toBeNull();
    expect(checkPageUrl('127.0.0.1', 'https')).toBeNull();
    expect(checkPageUrl('evil.example/path?x=', 'https')).toBeNull();
    expect(checkPageUrl(null, 'https')).toBeNull();
  });
});
