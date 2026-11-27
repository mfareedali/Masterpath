import { describe, expect, it } from 'vitest';
import { snippetAppearsIn } from '../../text/evidence';
import { parseCoventryCourse } from './coventry';

/* Fictional page text in the same layout as the real pages (numbers are fixtures). */
const PAGE = [
  'Computer Science MSc',
  'Course features',
  'Duration',
  '1 year full-time',
  'Up to 2 years full-time with professional placement',
  'Start date',
  'January 2027',
  'March 2027',
  'How to apply',
  'An honours degree 2:2 or above (or international equivalent) in a computational discipline.',
  'English language requirements',
  'IELTS: 6.5 overall, with no component lower than 5.5',
  'Student',
  'Full-time',
  'UK, Ireland*, Channel Islands or Isle of Man',
  '£11,700 per year',
  'International',
  '£19,500 per year',
  '£1,900 professional placement fee (if placement secured) per year',
].join('\n');

describe('parseCoventryCourse', () => {
  const c = parseCoventryCourse(PAGE);

  it('reads each value with the text it came from', () => {
    expect(c.intake).toEqual({ value: 'January 2027, March 2027', evidence_snippet: 'Start date January 2027 March 2027' });
    expect(c.duration_months).toEqual({ value: 12, evidence_snippet: 'Duration 1 year full-time' });
    expect(c.language_req?.value).toEqual({ ielts_overall: 6.5, text: 'IELTS: 6.5 overall, with no component lower than 5.5' });
    expect(c.tuition_international).toEqual({
      value: { amount: 19500, currency: 'GBP', period: 'year' },
      evidence_snippet: 'International £19,500 per year',
    });
    expect(c.entry_requirement?.value).toMatch(/^An honours degree 2:2 or above/);
    expect(c.title).toBe('Computer Science MSc');
  });

  it('every snippet appears in the page by the project evidence matcher', () => {
    for (const f of [c.intake, c.duration_months, c.entry_requirement, c.language_req, c.tuition_international]) {
      expect(snippetAppearsIn(f!.evidence_snippet, PAGE)).toBe(true);
    }
  });

  it('gives null, never a guess, when a block is missing or the duration is not exactly one year', () => {
    const bare = parseCoventryCourse('Some MSc\nDuration\n18 months part-time\nNothing else here');
    expect(bare).toMatchObject({ intake: null, duration_months: null, entry_requirement: null, language_req: null, tuition_international: null });
  });

  it('does not take the UK fee when no International row exists', () => {
    expect(parseCoventryCourse('UK\n£11,700 per year\nEU\n£19,500 per year').tuition_international).toBeNull();
  });
});
