import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { conflicting, FIXED_NOW, likely, makeProgram, unverified, verified } from '@/lib/test-fixtures';
import type { Fact, GpaRule, Program } from '@/lib/types';
import {
  askUniversityMailto,
  buildAskUniversityEmail,
  missingFactQuestions,
  QUESTION_FOR,
  TO_PLACEHOLDER,
  TRANSCRIPT_QUESTION,
  usableAdmissionsEmail,
} from './ask-university';
import { applicableFactKeys, PROGRAM_FACT_KEYS } from './fields';

const now = FIXED_NOW;

/** The email without the list numbers ("  1. ") and the scale name "CGPA out of 4.0": no other digit may remain. */
function digitsCheckable(text: string): string {
  return text.replace(/^\s+\d+\. /gm, '').replace(/CGPA out of 4\.0/g, '');
}
const LIVE_NOW = new Date('2026-11-24T12:00:00Z');

function emailFor(p: Program, at: Date = now) {
  return buildAskUniversityEmail({
    programName: p.name,
    institutionName: 'Fixture University',
    questions: missingFactQuestions(p, at),
    to: usableAdmissionsEmail(p, at),
  });
}

/** Every number, date and money amount from a program's fact values and notes (what the email must never repeat). */
function valuesOf(p: Program): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (v == null) return;
    if (typeof v === 'number') out.add(String(v));
    else if (typeof v === 'string') {
      // Short words ("semester") can appear in a fixed question; data sentences and dates cannot.
      if (v.trim().length >= 10) out.add(v.trim());
    } else if (typeof v === 'object') for (const x of Object.values(v as object)) walk(x);
  };
  for (const k of PROGRAM_FACT_KEYS) {
    if (k === 'admissions_email') continue;
    const f = p[k] as Fact<unknown>;
    walk(f?.value);
    walk(f?.note);
    walk(f?.evidence_snippet);
  }
  return [...out];
}

describe('QUESTION_FOR', () => {
  it('has a fixed, neutral question for every fact we would ask about, with no numbers', () => {
    for (const k of PROGRAM_FACT_KEYS) {
      const q = QUESTION_FOR[k];
      if (k === 'status_note' || k === 'admissions_email') {
        expect(q).toBeNull();
        continue;
      }
      expect(q, k).toBeTruthy();
      // "4.0" names the scale, it is not a value from data. No other digits at all.
      expect((q as string).replace('CGPA out of 4.0', ''), k).not.toMatch(/\d/);
      // Asking whether progression is guaranteed is a question, not a promise; nothing else may use these words.
      if (k !== 'progression_guaranteed') expect(q, k).not.toMatch(/chance|guarantee|promise/i);
      expect(q, k).not.toMatch(/chance|promise/i);
    }
  });
});

describe('missingFactQuestions', () => {
  it('asks about every applicable Unverified field (plus transcripts), in page order', () => {
    const qs = missingFactQuestions(makeProgram(), now);
    const keys = qs.map((q) => q.key);
    const expected = applicableFactKeys(makeProgram()).filter((k) => QUESTION_FOR[k] !== null);
    expect(keys).toEqual([...expected, 'transcript']);
    expect(keys).toContain('conditional_admission');
    expect(keys).toContain('language_waiver');
    expect(keys).not.toContain('admissions_email');
    expect(keys).not.toContain('progression_requirement'); // direct route: not applicable
    expect(qs.at(-1)?.question).toBe(TRANSCRIPT_QUESTION);
  });

  it('skips Verified, Likely and Conflict fields; a value without evidence still counts as not verified', () => {
    const p = makeProgram({
      deadline: verified('2027-01-15'),
      tuition: likely({ amount: 1, currency: 'GBP', period: 'year' as const }),
      lor_count: conflicting(2, 3),
      sop_requirements: unverified('Fixture SOP with no source'),
    });
    const keys = missingFactQuestions(p, now).map((q) => q.key);
    expect(keys).not.toContain('deadline');
    expect(keys).not.toContain('tuition');
    expect(keys).not.toContain('lor_count'); // Conflicts have their own email with both sources
    expect(keys).toContain('sop_requirements');
  });

  it('asks about progression only on pathway routes', () => {
    const keys = missingFactQuestions(makeProgram({ pathway_type: 'pre_masters' }), now).map((q) => q.key);
    expect(keys).toContain('progression_guaranteed');
    expect(keys).toContain('progression_requirement');
  });

  it('live seed: every program gets questions, and only for fields that are really not verified', () => {
    for (const p of loadSeedDataset().programs) {
      const qs = missingFactQuestions(p, LIVE_NOW);
      expect(qs.length, p.id).toBeGreaterThan(0);
      for (const q of qs) if (q.key !== 'transcript') expect(p[q.key]?.evidence_snippet ?? null, `${p.id}.${q.key}`).toBeNull();
    }
    // ETH has a Verified deadline, so it is not asked; CSUDH has almost nothing verified.
    const eth = loadSeedDataset().programs.find((p) => p.id === 'ethz-msc-cs') as Program;
    expect(missingFactQuestions(eth, LIVE_NOW).map((q) => q.key)).not.toContain('deadline');
  });
});

describe('buildAskUniversityEmail', () => {
  it('uses a placeholder address when the admissions email is not usable, and asks numbered questions', () => {
    const p = makeProgram({ admissions_email: unverified('fixture@fixture.example.edu') });
    const e = emailFor(p);
    expect(e.to).toBeNull();
    expect(e.text.split('\n')[0]).toBe(`To: ${TO_PLACEHOLDER}`);
    expect(e.text).toContain('Subject: Questions about MSc Fixture Computing from an applicant in Pakistan');
    expect(e.body).toContain('  1. which bachelor’s degree subjects the programme accepts?');
    expect(e.body).toContain('[Your name]');
    expect(e.body).not.toContain('To:');
    expect(askUniversityMailto(e)).toBeNull();
  });

  it('addresses a usable admissions email and builds a mailto link with the encoded subject and body', () => {
    const p = makeProgram({ admissions_email: verified('admissions@fixture.example.edu') });
    const e = emailFor(p);
    expect(e.to).toBe('admissions@fixture.example.edu');
    expect(e.text.split('\n')[0]).toBe('To: admissions@fixture.example.edu');
    const mailto = askUniversityMailto(e) as string;
    expect(mailto.startsWith('mailto:admissions@fixture.example.edu?subject=Questions%20about%20')).toBe(true);
    expect(mailto).toContain('&body=Dear%20Admissions%20Team%2C%0D%0A');
    expect(decodeURIComponent(mailto.split('&body=')[1])).toBe(e.body.replace(/\n/g, '\r\n'));
  });

  it('never uses an address that is in Conflict or not an email', () => {
    expect(usableAdmissionsEmail(makeProgram({ admissions_email: conflicting('a@fixture.example.edu', 'b@fixture.example.edu') }), now)).toBeNull();
    expect(usableAdmissionsEmail(makeProgram({ admissions_email: verified('Use the online form') }), now)).toBeNull();
    expect(usableAdmissionsEmail(makeProgram({ admissions_email: verified('x@y.example.edu?bcc=evil@z.com') }), now)).toBeNull();
    expect(usableAdmissionsEmail(makeProgram({ admissions_email: likely(' admissions@fixture.example.edu ') }), now)).toBe(
      'admissions@fixture.example.edu',
    );
  });

  it('contains no value from the data: no numbers, dates, fees or requirement text (fixture with values)', () => {
    const p = makeProgram({
      deadline: unverified('2027-01-15'),
      tuition: unverified({ amount: 23456, currency: 'GBP', period: 'year' as const }),
      min_gpa_rule: unverified<GpaRule>({ scale: 'cgpa_4', min: 2.85, text: 'Fixture GPA text' }),
      lor_count: unverified(3),
      intake: verified('Fixture intake September'),
    });
    const e = emailFor(p);
    for (const v of ['2027', '23456', '23,456', '2.85', 'Fixture GPA text', 'Fixture intake September']) expect(e.text).not.toContain(v);
    expect(digitsCheckable(e.text)).not.toMatch(/\d/);
  });

  it('live seed: no fact value, note or snippet from the data appears in any program email', () => {
    for (const p of loadSeedDataset().programs) {
      const e = emailFor(p, LIVE_NOW);
      const body = digitsCheckable(e.body);
      for (const v of valuesOf(p)) {
        if (/^\d+(\.\d+)?$/.test(v)) expect(body, `${p.id}: ${v}`).not.toMatch(new RegExp(`(^|[^\\d.])${v.replace('.', '\\.')}([^\\d]|$)`));
        else expect(e.body, `${p.id}: ${v.slice(0, 40)}`).not.toContain(v);
      }
      expect(body, p.id).not.toMatch(/\d/);
    }
  });

  it('live seed: NYIT (usable admissions email) gets a mailto link; Brookes (no email) gets the placeholder', () => {
    const live = loadSeedDataset().programs;
    const nyit = emailFor(live.find((p) => p.id === 'nyit-mscs') as Program, LIVE_NOW);
    expect(nyit.to).toBe('admissions@nyit.edu');
    expect(askUniversityMailto(nyit)).toMatch(/^mailto:admissions@nyit\.edu\?subject=/);
    const brookes = emailFor(live.find((p) => p.id === 'brookes-msc-cs') as Program, LIVE_NOW);
    expect(brookes.to).toBeNull();
    expect(brookes.text).toContain(`To: ${TO_PLACEHOLDER}`);
  });
});
