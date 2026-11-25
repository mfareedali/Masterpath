import { describe, expect, it } from 'vitest';
import { parseRobots, robotsAllows, ruleMatchLength } from './robots';

describe('parseRobots', () => {
  it('groups consecutive user-agent lines and ignores comments and other directives', () => {
    const groups = parseRobots(
      '﻿User-agent: a\nUser-agent: B # comment\nDisallow: /x\nSitemap: https://example.org/s.xml\nUser-agent: c\nAllow: /',
    );
    expect(groups).toEqual([
      { agents: ['a', 'b'], rules: [{ allow: false, pattern: '/x' }] },
      { agents: ['c'], rules: [{ allow: true, pattern: '/' }] },
    ]);
  });
});

describe('ruleMatchLength', () => {
  it('supports prefixes, * wildcards and the $ anchor', () => {
    expect(ruleMatchLength('/study', '/study/masters')).toBe(6);
    expect(ruleMatchLength('/*.pdf$', '/files/a.pdf')).toBe(7);
    expect(ruleMatchLength('/*.pdf$', '/files/a.pdf?x=1')).toBe(-1);
    expect(ruleMatchLength('/a*c', '/abbbc/d')).toBe(4);
    expect(ruleMatchLength('', '/anything')).toBe(-1);
    expect(ruleMatchLength('/x', '/y')).toBe(-1);
  });
});

describe('robotsAllows', () => {
  it('allows everything when there are no rules', () => {
    expect(robotsAllows('', '/any')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow:', '/any')).toBe(true);
  });

  it('honours Disallow for *', () => {
    const txt = 'User-agent: *\nDisallow: /private\n';
    expect(robotsAllows(txt, '/private/page')).toBe(false);
    expect(robotsAllows(txt, '/public')).toBe(true);
  });

  it('honours Disallow for our product token (case-insensitive, version ignored)', () => {
    const txt = 'User-agent: mastersPATHingest/2.0\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
    expect(robotsAllows(txt, '/study')).toBe(false);
  });

  it('honours Disallow for * even when our own group exists (conservative)', () => {
    const txt = 'User-agent: MastersPathIngest\nAllow: /programs\n\nUser-agent: *\nDisallow: /private\n';
    expect(robotsAllows(txt, '/private/x')).toBe(false);
    expect(robotsAllows(txt, '/programs/msc')).toBe(true);
  });

  it('lets an explicit Allow in our own group win over a * Disallow', () => {
    const txt = 'User-agent: MastersPathIngest\nAllow: /\n\nUser-agent: *\nDisallow: /\n';
    expect(robotsAllows(txt, '/study')).toBe(true);
  });

  it('ignores groups for other bots', () => {
    const txt = 'User-agent: Googlebot\nDisallow: /\n';
    expect(robotsAllows(txt, '/study')).toBe(true);
  });

  it('uses the longest match, Allow winning ties', () => {
    const txt = 'User-agent: *\nDisallow: /study\nAllow: /study/masters\n';
    expect(robotsAllows(txt, '/study/masters/cs')).toBe(true);
    expect(robotsAllows(txt, '/study/bachelor')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /a\nAllow: /a\n', '/a')).toBe(true);
  });

  it('matches against the query string too', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /*?print=', '/page?print=1')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /*?print=', '/page')).toBe(true);
  });

  it('always allows /robots.txt itself', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /', '/robots.txt')).toBe(true);
  });

  it('handles CRLF line endings', () => {
    expect(robotsAllows('User-agent: *\r\nDisallow: /x\r\n', '/x')).toBe(false);
  });
});
