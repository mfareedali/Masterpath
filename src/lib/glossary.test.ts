/**
 * Glossary data (proposal #40): meanings only. A definition must never carry a fact (amount, date, duration, score,
 * requirement), a link, HTML, or chance/guarantee wording.
 */
import { describe, expect, it } from 'vitest';
import { hasForbiddenText, hasHtmlTag } from '@/lib/seed/text-rules';
import { GLOSSARY, GLOSSARY_GROUPS, glossaryEntriesIn, glossaryHref } from './glossary';

/** Every term the task and the audit found on our pages. */
const REQUIRED_TERMS = [
  'CGPA',
  'Percentage and division',
  'SOP',
  'LOR',
  'CV',
  'IELTS and TOEFL',
  'MOI letter',
  'GRE',
  'CAS',
  'Pre-CAS interview',
  'I-20',
  'OPT',
  'STEM',
  'Graduate visa',
  'Blocked account',
  'Proof of funds',
  'Conditional or provisional admission',
  "Pre-master's",
  'Pathway',
  'ECTS',
  'anabin',
  'HEC attestation',
  'Semester contribution',
  'Naturalisation',
];

const NUMBER_WORDS =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|lakh|crore|half|twice|double|dozen)\b/i;
const MONTHS = /\b(?:January|February|March|April|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/;
const MONEY = /[£$€¥₹₨%]|\b(?:Rs|PKR|EUR|USD|GBP|CAD|CHF|AUD)\b/i;
const URL_LIKE = /https?:|www\.|\.(?:com|org|edu|gov|de|uk|ca|pk)\b/i;
const PROMISES = /guarantee|\bchances?\b|probab|\bcertain(?:ly)?\b|\bdefinitely\b|\bwill get\b|\bsure to\b/i;

describe('glossary data', () => {
  it('covers every required term, each once', () => {
    const terms = GLOSSARY.map((e) => e.term);
    for (const t of REQUIRED_TERMS) expect(terms, t).toContain(t);
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('no definition contains a digit (no facts)', () => {
    for (const e of GLOSSARY) {
      expect(e.definition, e.id).not.toMatch(/\d/);
      if ('also' in e) expect(e.also, e.id).not.toMatch(/\d/);
    }
  });

  it('no definition states an amount, a date, a link or a number in words', () => {
    for (const e of GLOSSARY) {
      const texts = 'also' in e ? [e.definition, e.also] : [e.definition];
      for (const s of texts) {
        expect(s, e.id).not.toMatch(NUMBER_WORDS);
        expect(s, e.id).not.toMatch(MONTHS);
        expect(s, e.id).not.toMatch(MONEY);
        expect(s, e.id).not.toMatch(URL_LIKE);
      }
    }
  });

  it('no chance, probability or promise wording, and plain text only (no HTML)', () => {
    for (const e of GLOSSARY) {
      expect(hasForbiddenText(e.definition), e.id).toBe(false);
      expect(hasHtmlTag(e.definition), e.id).toBe(false);
      expect(hasHtmlTag(e.term), e.id).toBe(false);
      expect(e.definition, e.id).not.toMatch(PROMISES);
    }
  });

  it('conditional routes are explained as information that never changes the fit result', () => {
    const conditional = GLOSSARY.find((e) => e.id === 'conditional-admission');
    expect(conditional?.definition).toMatch(/never changes your fit result/);
  });

  it('definitions are short, complete sentences', () => {
    for (const e of GLOSSARY) {
      expect(e.definition.length, e.id).toBeGreaterThan(40);
      expect(e.definition.length, e.id).toBeLessThanOrEqual(360);
      expect(e.definition, e.id).toMatch(/^[A-Z].*\.$/);
      expect(e.definition, e.id).toBe(e.definition.trim());
    }
  });

  it('anchors are unique url-safe ids and never collide with group anchors', () => {
    const ids = [...GLOSSARY.map((e) => e.id), ...GLOSSARY_GROUPS.map((g) => g.id), ...GLOSSARY_GROUPS.map((g) => `${g.id}-title`)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('every entry is in a known group, and every group has entries', () => {
    const groupIds = GLOSSARY_GROUPS.map((g) => g.id) as string[];
    for (const e of GLOSSARY) expect(groupIds, e.id).toContain(e.group);
    for (const g of GLOSSARY_GROUPS) expect(glossaryEntriesIn(g.id).length, g.id).toBeGreaterThan(0);
    expect(GLOSSARY_GROUPS.reduce((n, g) => n + glossaryEntriesIn(g.id).length, 0)).toBe(GLOSSARY.length);
  });

  it('glossaryHref builds an internal anchor link', () => {
    expect(glossaryHref('cas')).toBe('/glossary#cas');
    expect(glossaryHref('blocked-account')).toBe('/glossary#blocked-account');
  });
});
