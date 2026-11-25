import { describe, expect, it } from 'vitest';
import { FIXED_NOW } from '@/lib/test-fixtures';
import type { PathwayType } from '@/lib/types';
import { PROGRAM_FACT_KEYS, type ProgramFactKey, type ProgramFactValue } from './fields';
import {
  conditionalAdmissionLines,
  countryFactLines,
  daysLeftText,
  daysUntil,
  deadlineLines,
  factLines,
  factText,
  formatGrade,
  gpaRuleLines,
  isDatePassed,
  languageReqLines,
  lorCountText,
  minimumText,
  PATHWAY_LABEL,
  progressionText,
  recognitionText,
  yesNoText,
} from './render';

const now = FIXED_NOW; // 2026-11-24T12:00:00Z

describe('grades', () => {
  it('formats grades per scale', () => {
    expect(formatGrade(3, 'cgpa_4')).toBe('3.0');
    expect(formatGrade(2.5, 'cgpa_4')).toBe('2.5');
    expect(formatGrade(2.75, 'cgpa_4')).toBe('2.75');
    expect(formatGrade(60, 'percent')).toBe('60%');
    expect(formatGrade(62.5, 'percent')).toBe('62.5%');
    expect(formatGrade(2, 'german')).toBe('2.0');
  });

  it('describes a minimum, with "or better" on the German scale (lower is better)', () => {
    expect(minimumText(3, 'cgpa_4')).toBe('3.0 or higher (CGPA out of 4.0)');
    expect(minimumText(3.5, 'cgpa_5')).toBe('3.5 or higher (CGPA out of 5.0)');
    expect(minimumText(60, 'percent')).toBe('60% or higher');
    expect(minimumText(2.5, 'german')).toBe('2.5 or better (German grade, 1.0 is best)');
    expect(minimumText(Number.NaN, 'cgpa_4')).toBe('Minimum not given');
  });

  it('adds the short summary of a GPA rule when present, labelled "In short:" and never in quotation marks', () => {
    expect(gpaRuleLines({ scale: 'cgpa_4', min: 3 })).toEqual(['3.0 or higher (CGPA out of 4.0)']);
    expect(gpaRuleLines({ scale: 'cgpa_4', min: 3, text: '  Fixture wording  ' })).toEqual([
      '3.0 or higher (CGPA out of 4.0)',
      'In short: Fixture wording',
    ]);
    expect(gpaRuleLines({ scale: 'german', min: 2.5, text: '   ' })).toHaveLength(1);
  });

  it('regression: rule.text is a team summary, so it is not presented as wording quoted from the source', () => {
    // Review finding: 'Wording on the source: "Pakistan four-year bachelor's: …"' put a paraphrase in quotes.
    const paraphrase = "Fixture four-year bachelor's: 2:2 (direct entry) = 60% or GPA 2.7";
    const lines = gpaRuleLines({ scale: 'cgpa_4', min: 2.7, text: paraphrase });
    expect(lines).toEqual(['2.7 or higher (CGPA out of 4.0)', `In short: ${paraphrase}`]);
    for (const l of lines) {
      expect(l).not.toMatch(/Wording on the source/i);
      expect(l).not.toMatch(/^.*: ["“]/); // no opening quotation mark after a label
      expect(l.endsWith('"')).toBe(false);
    }
    // A text stored with wrapping quotes (the USF '""B" average …"' glitch) loses the wrapping pair only.
    expect(gpaRuleLines({ scale: 'cgpa_4', min: 3, text: '"Fixture B average or better"' })[1]).toBe(
      'In short: Fixture B average or better',
    );
    expect(gpaRuleLines({ scale: 'cgpa_4', min: 3, text: '“B” average (3.00 on a 4.00 scale) fixture' })[1]).toBe(
      'In short: “B” average (3.00 on a 4.00 scale) fixture',
    );
  });
});

describe('languageReqLines', () => {
  it('lists each part that the record has', () => {
    expect(languageReqLines({ ielts_overall: 6.5, toefl_ibt: 90, waiver: 'Fixture waiver', text: 'Fixture text' })).toEqual([
      'IELTS overall: 6.5',
      'TOEFL iBT: 90',
      'Waiver: Fixture waiver',
      'Fixture text',
    ]);
    expect(languageReqLines({ ielts_overall: 7 })).toEqual(['IELTS overall: 7']);
  });

  it('never invents a score when none is listed', () => {
    expect(languageReqLines({})).toEqual(['No test scores listed in this record']);
    expect(languageReqLines({ ielts_overall: null, toefl_ibt: null, waiver: ' ', text: null })).toEqual([
      'No test scores listed in this record',
    ]);
  });
});

describe('small renderers', () => {
  it('counts letters', () => {
    expect(lorCountText(1)).toBe('1 letter');
    expect(lorCountText(2)).toBe('2 letters');
    expect(lorCountText(0)).toBe('0 letters');
    expect(lorCountText(2.5)).toBe('2.5');
  });

  it('renders booleans as stated by the source', () => {
    expect(yesNoText(true)).toBe('Yes, as stated on the source');
    expect(yesNoText(false)).toBe('No, as stated on the source');
    expect(progressionText(true)).toBe('Guaranteed, as stated on the source');
    expect(progressionText(false)).toBe('Not guaranteed, as stated on the source');
  });

  it('renders recognition status without a verdict about the student', () => {
    expect(recognitionText('listed')).toBe('Listed on the official recognition list');
    expect(recognitionText('not_listed')).toBe('Not found on the official recognition list');
  });

  it('renders country facts with the clock note', () => {
    expect(countryFactLines({ text: 'Fixture rule' })).toEqual(['Fixture rule']);
    expect(countryFactLines({ text: 'Fixture rule', clock_note: 'Fixture clock' })).toEqual([
      'Fixture rule',
      'How time is counted: Fixture clock',
    ]);
  });

  it('has a label for every pathway type', () => {
    const types: PathwayType[] = ['direct', 'conditional', 'pre_masters', 'pathway', 'score_based', 'research_led'];
    for (const t of types) expect(PATHWAY_LABEL[t]).toBeTruthy();
  });
});

describe('deadlines', () => {
  it('counts whole UTC days', () => {
    expect(daysUntil('2026-11-24', now)).toBe(0);
    expect(daysUntil('2026-11-25', now)).toBe(1);
    expect(daysUntil('2027-01-15', now)).toBe(52);
    expect(daysUntil('2026-11-01', now)).toBe(-23);
    expect(daysUntil('not a date', now)).toBeNull();
  });

  it('says how many days are left', () => {
    expect(daysLeftText('2026-11-24', now)).toBe('Today');
    expect(daysLeftText('2026-11-25', now)).toBe('1 day left');
    expect(daysLeftText('2027-01-15', now)).toBe('52 days left');
    expect(daysLeftText('2026-11-01', now)).toBe('This date has passed');
    expect(daysLeftText('soon', now)).toBeNull();
  });

  it('isDatePassed: the day itself has not passed; invalid dates count as passed', () => {
    expect(isDatePassed('2026-11-24', now)).toBe(false);
    expect(isDatePassed('2026-11-23', now)).toBe(true);
    expect(isDatePassed('soon', now)).toBe(true);
  });

  it('adds the relative line only when now is given', () => {
    expect(deadlineLines('2027-01-15', now)).toEqual(['15 Jan 2027', '52 days left']);
    expect(deadlineLines('2027-01-15')).toEqual(['15 Jan 2027']);
    expect(deadlineLines('rolling', now)).toEqual(['rolling']);
  });
});

describe('minimum alternatives and the route below the minimum', () => {
  it('shows other minimums printed in the same evidence, as written, never converted', () => {
    expect(
      gpaRuleLines({ scale: 'cgpa_4', min: 2.7, text: '2:2 60% or GPA 2.7', alternatives: [{ scale: 'percent', min: 60 }] }),
    ).toEqual(['2.7 or higher (CGPA out of 4.0)', 'Or: 60% or higher', 'In short: 2:2 60% or GPA 2.7']);
    // A duplicate of the main scale or a broken number is not repeated.
    expect(
      gpaRuleLines({ scale: 'cgpa_4', min: 2.7, alternatives: [{ scale: 'cgpa_4', min: 2.7 }, { scale: 'percent', min: NaN }] }),
    ).toEqual(['2.7 or higher (CGPA out of 4.0)']);
    expect(gpaRuleLines({ scale: 'cgpa_4', min: 2.7, alternatives: null })).toEqual(['2.7 or higher (CGPA out of 4.0)']);
  });

  it('route below the minimum: the floor when the page names one, then the summary as "In short:"', () => {
    expect(conditionalAdmissionLines({ scale: 'cgpa_4', min: 2.5, text: 'Fixture route' })).toEqual([
      "This route's minimum: 2.5 or higher (CGPA out of 4.0)",
      'In short: Fixture route',
    ]);
    expect(conditionalAdmissionLines({ scale: 'german', min: 4, text: '"Fixture German route"' })).toEqual([
      "This route's minimum: 4.0 or better (German grade, 1.0 is best)",
      'In short: Fixture German route',
    ]);
    expect(conditionalAdmissionLines({ scale: 'cgpa_4', min: null, text: 'Fixture provisional' })).toEqual([
      'In short: Fixture provisional',
    ]);
    expect(conditionalAdmissionLines({ scale: 'cgpa_4', min: null, text: '  ' })).toEqual([
      'The official page describes a route below the minimum',
    ]);
  });
});

describe('factLines / factText', () => {
  const samples: { [K in ProgramFactKey]: ProgramFactValue<K> } = {
    status_note: 'Fixture status note',
    eligibility_note: 'Fixture eligibility note',
    conditional_admission: { scale: 'cgpa_4', min: 2.5, text: 'Fixture conditional route' },
    language_waiver: 'Fixture waiver rule',
    intake: 'September 2027',
    deadline: '2027-01-15',
    duration_months: 12,
    tuition: { amount: 10000, currency: 'GBP', period: 'year' },
    living_cost: { amount: 1000, currency: 'GBP', period: 'month' },
    scholarship_info: 'Fixture scholarship',
    min_gpa_rule: { scale: 'cgpa_4', min: 3, text: 'Fixture wording' },
    language_req: { ielts_overall: 6.5 },
    tests_required: 'Fixture tests',
    sop_requirements: 'Fixture SOP',
    lor_count: 2,
    cv_requirements: 'Fixture CV',
    research_considered: 'Fixture research',
    progression_guaranteed: false,
    progression_requirement: 'Fixture progression',
    admissions_email: 'admissions@fixture.example.edu',
  };

  it('renders every fact field as non-empty plain text', () => {
    for (const k of PROGRAM_FACT_KEYS) {
      const lines = factLines(k, samples[k] as never, now);
      expect(lines.length, k).toBeGreaterThan(0);
      for (const l of lines) {
        expect(typeof l).toBe('string');
        expect(l.trim().length).toBeGreaterThan(0);
        expect(l).not.toMatch(/<[a-z/]/i); // no markup
      }
    }
  });

  it('renders the typed values', () => {
    expect(factLines('duration_months', 18)).toEqual(['18 months']);
    expect(factLines('duration_months', 24)).toEqual(['2 years']);
    expect(factLines('tuition', { amount: 10000, currency: 'GBP', period: 'year' })).toEqual(['£10,000 per year']);
    expect(factLines('lor_count', 3)).toEqual(['3 letters']);
    expect(factLines('progression_guaranteed', true)).toEqual(['Guaranteed, as stated on the source']);
    expect(factLines('deadline', '2027-01-15', now)).toEqual(['15 Jan 2027', '52 days left']);
  });

  it('factText is one line without relative dates (for the admissions email)', () => {
    expect(factText('deadline', '2027-01-15')).toBe('15 Jan 2027');
    expect(factText('min_gpa_rule', { scale: 'cgpa_4', min: 3, text: 'Fixture wording' })).toBe(
      '3.0 or higher (CGPA out of 4.0); In short: Fixture wording',
    );
  });

  it('keeps scraped text as text, even if it looks like HTML', () => {
    expect(factLines('sop_requirements', '<script>alert(1)</script>')).toEqual(['<script>alert(1)</script>']);
  });
});
