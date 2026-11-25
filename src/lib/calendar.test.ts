import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { conflicting, likely, makeProgram, unverified, verified } from '@/lib/test-fixtures';
import type { Fact, Program } from '@/lib/types';
import {
  buildIcs,
  CHECK_OFFICIAL_PAGE,
  deadlineDate,
  deadlineEvent,
  escapeIcsText,
  foldIcsLine,
  isPassedDate,
  type CalendarEvent,
} from './calendar';

const NOV_24 = new Date('2026-11-24T12:00:00Z');
const DEC_02 = new Date('2026-12-02T12:00:00Z');

const octets = (s: string) => new TextEncoder().encode(s).length;

/** Undo RFC 5545 folding (CRLF + one space). */
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

function fixtureDeadline(fact: Fact<string>, overrides: Partial<Program> = {}): Program {
  return makeProgram({ deadline: fact, ...overrides });
}

describe('deadlineDate / isPassedDate', () => {
  it('reads real calendar dates only', () => {
    expect(deadlineDate('2027-01-15')).toBe('2027-01-15');
    expect(deadlineDate('2027-01-15T12:00:00Z')).toBe('2027-01-15');
    expect(deadlineDate('2027-02-30')).toBeNull();
    expect(deadlineDate('15 Jan 2027')).toBeNull();
    expect(deadlineDate('')).toBeNull();
    expect(deadlineDate(null)).toBeNull();
  });

  it('the deadline day itself has not passed; the day after has', () => {
    expect(isPassedDate('2026-11-24', NOV_24)).toBe(false);
    expect(isPassedDate('2026-11-23', NOV_24)).toBe(true);
    expect(isPassedDate('2026-11-30', DEC_02)).toBe(true);
  });
});

describe('deadlineEvent', () => {
  it('Verified, not passed: an all-day event with the confidence, note, source and "check the official page"', () => {
    const fact: Fact<string> = {
      ...verified('2027-01-15'),
      note: 'Fixture: applications close at noon.',
      review_note: 'FIXTURE INTERNAL REVIEWER NOTE',
    };
    const e = deadlineEvent(fixtureDeadline(fact), 'Fixture University', NOV_24) as CalendarEvent;
    expect(e).not.toBeNull();
    expect(e.date).toBe('2027-01-15');
    expect(e.uid).toBe('fixture-msc-cs-deadline-20270115@masterspath');
    expect(e.summary).toBe('Application deadline: MSc Fixture Computing (Fixture University)');
    expect(e.filename).toBe('fixture-msc-cs-deadline.ics');
    expect(e.description).toContain('How sure we are: Verified.');
    expect(e.description).toContain('Note: Fixture: applications close at noon.');
    expect(e.description).toContain('Source: https://fixture.example.edu/program');
    expect(e.description).toContain(CHECK_OFFICIAL_PAGE);
    expect(e.description).not.toContain('FIXTURE INTERNAL');
  });

  it('Likely: an event that says it is Likely', () => {
    const e = deadlineEvent(fixtureDeadline(likely('2027-01-15')), 'Fixture University', NOV_24) as CalendarEvent;
    expect(e.description).toContain('How sure we are: Likely.');
    expect(e.description).toContain('Source: https://fixture.example.edu/summary');
  });

  it('no event for Unverified, Conflict, empty, unreadable or passed dates', () => {
    const cases: Program[] = [
      fixtureDeadline(unverified('2027-01-15')),
      fixtureDeadline(conflicting('2027-01-15', '2027-01-20')),
      fixtureDeadline(unverified()),
      fixtureDeadline(verified('soon')),
      fixtureDeadline(verified('2026-11-23')),
    ];
    for (const p of cases) expect(deadlineEvent(p, 'Fixture University', NOV_24)).toBeNull();
  });

  it('never links a javascript: source', () => {
    const fact = { ...verified('2027-01-15'), source_url: 'javascript:alert(1)' };
    const e = deadlineEvent(fixtureDeadline(fact), null, NOV_24) as CalendarEvent;
    expect(e).not.toBeNull();
    expect(e.description).not.toContain('javascript');
    expect(e.summary).toBe('Application deadline: MSc Fixture Computing');
  });

  it('live seed: ETH (Verified, 30 Nov 2026) has an event on 24 Nov with its noon cut-off note, and none on 2 Dec', () => {
    const live = loadSeedDataset();
    const eth = live.programs.find((p) => p.id === 'ethz-msc-cs') as Program;
    const inst = live.institutions.find((i) => i.id === eth.institution_id)?.name ?? null;
    const e = deadlineEvent(eth, inst, NOV_24) as CalendarEvent;
    expect(e.date).toBe('2026-11-30');
    expect(e.description).toContain('How sure we are: Verified.');
    expect(e.description).toContain(`Note: ${eth.deadline.note}`);
    expect(e.description).toContain(`Source: ${eth.deadline.source_url}`);
    expect(e.description).not.toContain(eth.deadline.review_note as string);
    expect(deadlineEvent(eth, inst, DEC_02)).toBeNull();
  });

  it('live seed: only usable, not-passed deadlines get events (Brookes has none; Imperial has none)', () => {
    const live = loadSeedDataset().programs;
    const withEvents = live.filter((p) => deadlineEvent(p, null, NOV_24)).map((p) => p.id);
    expect(withEvents).toContain('ethz-msc-cs');
    expect(withEvents).not.toContain('brookes-msc-cs');
    expect(withEvents).not.toContain('imperial-msc-computing');
    expect(withEvents.length).toBeGreaterThanOrEqual(5);
    // On 2 Dec, ETH (30 Nov) and Toronto / UIUC (1 Dec) have passed.
    const later = live.filter((p) => deadlineEvent(p, null, DEC_02)).map((p) => p.id);
    expect(later).not.toContain('ethz-msc-cs');
    expect(later).not.toContain('utoronto-mscac');
    expect(later).toContain('cmu-mscs');
  });
});

describe('escapeIcsText', () => {
  it('escapes backslash, semicolon, comma and newlines, and drops control characters', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf\rg')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ng');
    expect(escapeIcsText('x\u0000y\u0007z\tt')).toBe('xyz\tt');
  });
});

describe('foldIcsLine', () => {
  it('leaves short lines alone', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short');
    const exactly75 = 'X'.repeat(75);
    expect(foldIcsLine(exactly75)).toBe(exactly75);
  });

  it('folds at 75 octets with CRLF + space, and unfolds back to the original', () => {
    const line = `DESCRIPTION:${'abcdefghij'.repeat(20)}`;
    const folded = foldIcsLine(line);
    for (const physical of folded.split('\r\n')) expect(octets(physical)).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').slice(1).every((l) => l.startsWith(' '))).toBe(true);
    expect(unfold(folded)).toBe(line);
  });

  it('never splits a multi-byte character', () => {
    const line = `SUMMARY:${'Würzburg — Universität '.repeat(8)}`;
    const folded = foldIcsLine(line);
    for (const physical of folded.split('\r\n')) {
      expect(octets(physical)).toBeLessThanOrEqual(75);
      expect(physical).not.toContain('�');
    }
    expect(unfold(folded)).toBe(line);
  });
});

describe('buildIcs', () => {
  const event = deadlineEvent(
    fixtureDeadline({ ...verified('2027-01-15'), note: 'Fixture: closes at 12:00 noon; late, applications are not possible.' }),
    'Fixture University, London',
    NOV_24,
  ) as CalendarEvent;
  const ics = buildIcs([event], NOV_24);

  it('is a VCALENDAR with CRLF line endings only, ending in CRLF', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//MastersPath//Application deadlines//EN\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const physical of ics.split('\r\n')) expect(octets(physical)).toBeLessThanOrEqual(75);
  });

  it('has one all-day event: DTSTART date, DTEND the next day, stable UID, DTSTAMP from `now`', () => {
    const text = unfold(ics);
    expect(text).toContain('\r\nBEGIN:VEVENT\r\n');
    expect(text).toContain('\r\nUID:fixture-msc-cs-deadline-20270115@masterspath\r\n');
    expect(text).toContain('\r\nDTSTAMP:20261124T120000Z\r\n');
    expect(text).toContain('\r\nDTSTART;VALUE=DATE:20270115\r\n');
    expect(text).toContain('\r\nDTEND;VALUE=DATE:20270116\r\n');
    expect(text).not.toMatch(/DTSTART:|TZID/); // no time or time zone is inferred
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('escapes the summary and description, keeps the note text and the check-the-official-page line', () => {
    const text = unfold(ics);
    expect(text).toContain('\r\nSUMMARY:Application deadline: MSc Fixture Computing (Fixture University\\, London)\r\n');
    expect(text).toContain('Note: Fixture: closes at 12:00 noon\\; late\\, applications are not possible.');
    expect(text).toContain('\\nSource: https://fixture.example.edu/program\\n');
    expect(text).toContain('Check the official page before you rely on this date.');
  });

  it('adds reminders 7 days and 1 day before', () => {
    const text = unfold(ics);
    expect(text).toContain('\r\nTRIGGER:-P7D\r\n');
    expect(text).toContain('\r\nTRIGGER:-P1D\r\n');
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(2);
  });

  it('end of month and year roll over correctly', () => {
    const dec31 = { ...event, date: '2026-12-31' };
    expect(unfold(buildIcs([dec31], NOV_24))).toContain('DTEND;VALUE=DATE:20270101');
  });

  it('skips an event whose date is not readable', () => {
    expect(buildIcs([{ ...event, date: 'not a date' }], NOV_24)).not.toContain('BEGIN:VEVENT');
  });
});
