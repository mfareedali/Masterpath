import { describe, expect, it } from 'vitest';
import {
  INTAKE_TERM_IDS,
  compareIntakeTerms,
  intakeTermKind,
  intakeTermLabel,
  intakeTermsOf,
  isIntakeTermId,
  matchIntake,
  parseIntake,
} from './intake';

describe('parseIntake', () => {
  it("reads the reviewer's free-text intakes into the same terms (TUM, Brookes, QMUL, Imperial)", () => {
    expect(parseIntake('Summer or Winter semester')).toEqual({
      terms: ['summer-semester', 'winter-semester'],
      complete: true,
    });
    // Brookes and QMUL write the same two intakes differently: they must read the same.
    expect(parseIntake('January 2027, September 2027')).toEqual({ terms: ['january', 'september'], complete: true });
    expect(parseIntake('January 2027 and September 2027')).toEqual({ terms: ['january', 'september'], complete: true });
    expect(parseIntake('October 2027')).toEqual({ terms: ['october'], complete: true });
    // The wording the reviewer saw on TUM before the data update.
    expect(parseIntake('Winter semester (October start)')).toEqual({
      terms: ['october', 'winter-semester'],
      complete: true,
    });
  });

  it('knows abbreviations, academic years, seasons and one-word semesters', () => {
    expect(parseIntake('Sept 2027 / Jan 2028').terms).toEqual(['january', 'september']);
    expect(parseIntake('Starts in Sep. 2027/28').complete).toBe(true);
    expect(parseIntake('Fall 2027 and Spring 2028')).toEqual({ terms: ['spring', 'autumn'], complete: true });
    expect(parseIntake('Autumn').terms).toEqual(['autumn']);
    expect(parseIntake('Wintersemester').terms).toEqual(['winter-semester']);
    expect(parseIntake('Winter and Summer semesters').terms).toEqual(['summer-semester', 'winter-semester']);
    // A bare season is not a German semester: "Winter 2027" (a January term) stays "winter".
    expect(parseIntake('Winter 2027').terms).toEqual(['winter']);
  });

  it('"May" is a month only next to a year (otherwise it may be the verb)', () => {
    expect(parseIntake('May 2027').terms).toEqual(['may']);
    expect(parseIntake('September; January intake may be offered')).toEqual({
      terms: ['january', 'september'],
      complete: false,
    });
  });

  it('is incomplete when a word is not understood, or when no term is found', () => {
    expect(parseIntake('Rolling admission')).toEqual({ terms: [], complete: false });
    expect(parseIntake('January 2027 (25/01/2027 to 16/07/2027)').complete).toBe(false);
    expect(parseIntake('Fixture Autumn 2027')).toEqual({ terms: ['autumn'], complete: false });
    expect(parseIntake('2027')).toEqual({ terms: [], complete: false });
    expect(parseIntake('')).toEqual({ terms: [], complete: false });
    expect(parseIntake(null)).toEqual({ terms: [], complete: false });
  });
});

describe('matchIntake', () => {
  const tum = parseIntake('Summer or Winter semester');
  const brookes = parseIntake('January 2027, September 2027');
  const qmul = parseIntake('January 2027 and September 2027');
  const imperial = parseIntake('October 2027');

  it('passes when any of the text\'s terms is selected', () => {
    expect(matchIntake(brookes, ['september'])).toBe('pass');
    expect(matchIntake(qmul, ['september'])).toBe('pass');
    expect(matchIntake(brookes, ['october', 'january'])).toBe('pass');
    expect(matchIntake(tum, ['winter-semester'])).toBe('pass');
    expect(matchIntake(parseIntake('Winter semester (October start)'), ['october'])).toBe('pass');
    expect(matchIntake(brookes, [])).toBe('pass');
  });

  it('fails only when the text was read in full and names other terms of the same kind', () => {
    expect(matchIntake(brookes, ['october'])).toBe('fail');
    expect(matchIntake(imperial, ['january', 'september'])).toBe('fail');
    expect(matchIntake(tum, ['summer-semester'])).toBe('pass');
    expect(matchIntake(parseIntake('Winter semester'), ['summer-semester'])).toBe('fail');
  });

  it('is unknown across kinds (never reads "Winter semester" as October) and for text it cannot read', () => {
    expect(matchIntake(tum, ['october'])).toBe('unknown');
    expect(matchIntake(imperial, ['winter-semester'])).toBe('unknown');
    expect(matchIntake(parseIntake('Fall 2027'), ['september'])).toBe('unknown');
    // October is a miss, but "Winter semester" cannot be compared with months: unknown, not fail.
    expect(matchIntake(brookes, ['october', 'winter-semester'])).toBe('unknown');
    expect(matchIntake(parseIntake('Rolling admission'), ['january'])).toBe('unknown');
    expect(matchIntake(parseIntake('September; January intake may be offered'), ['october'])).toBe('unknown');
  });
});

describe('terms', () => {
  it('ids, labels, kinds and chip order', () => {
    expect(isIntakeTermId('september')).toBe(true);
    expect(isIntakeTermId('September 2027')).toBe(false);
    expect(isIntakeTermId(3)).toBe(false);
    expect(intakeTermLabel('winter-semester')).toBe('Winter semester');
    expect(intakeTermLabel('autumn')).toBe('Autumn / Fall');
    expect(intakeTermKind('may')).toBe('month');
    expect(intakeTermKind('summer')).toBe('season');
    expect(intakeTermKind('summer-semester')).toBe('semester');
    expect((['winter-semester', 'october', 'january'] as const).slice().sort(compareIntakeTerms)).toEqual([
      'january',
      'october',
      'winter-semester',
    ]);
    // Every label is distinct, so no two chips read the same.
    const labels = INTAKE_TERM_IDS.map(intakeTermLabel);
    expect(new Set(labels).size).toBe(labels.length);
    expect(intakeTermsOf('January 2027 and September 2027')).toEqual(['january', 'september']);
  });
});
