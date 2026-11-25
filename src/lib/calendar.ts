/**
 * "Add deadline to my calendar": an RFC 5545 (.ics) all-day event for a program's application deadline.
 * Pure: no DOM, no clock (`now` is passed in). The browser builds the file on the device (no PII, works offline).
 *
 * Rules:
 *  - only a usable (Verified / Likely) deadline with a readable date that has not passed gets an event;
 *  - the event is ALL-DAY on the university's stated date. No time or time zone is inferred: a cut-off time
 *    ("12:00 noon CET") stays as text in the note, exactly as the data row says it;
 *  - the description says how sure we are, carries the student-facing note and the source link, and tells the
 *    student to check the official page. The internal review_note is never read.
 *  - text is escaped (\ ; , newlines), lines end in CRLF and are folded at 75 octets.
 */
import { CONFIDENCE_HELP, computeConfidence, isUsable } from './confidence';
import { formatDate, safeHref } from './format';
import type { Program } from './types';

export interface CalendarEvent {
  /** Stable id, so importing the file twice updates the same event: "<program>-deadline-<yyyymmdd>@masterspath". */
  uid: string;
  /** All-day date as "YYYY-MM-DD". */
  date: string;
  summary: string;
  description: string;
  /** Suggested download name, e.g. "ethz-msc-cs-deadline.ics". */
  filename: string;
}

const DAY_MS = 86_400_000;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** "YYYY-MM-DD" for a stored deadline, or null when it is not a real calendar date. */
export function deadlineDate(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // Rejects "2027-02-30" and similar (Date.UTC would roll it over into March).
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function utcDay(now: Date): string {
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

/** True when `date` ("YYYY-MM-DD") is before today's UTC calendar day. The deadline day itself has not passed. */
export function isPassedDate(date: string, now: Date): boolean {
  return date < utcDay(now);
}

function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + DAY_MS);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}

function stamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

function safeId(id: string): string {
  const s = id.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'program';
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** The closing reminder in every event description. */
export const CHECK_OFFICIAL_PAGE = 'Check the official page before you rely on this date.';

/**
 * The calendar event for a program's deadline, or null when there must not be one: the deadline is
 * Unverified or in Conflict, the date is not readable, or it has passed (on `now`'s UTC calendar day).
 */
export function deadlineEvent(
  program: Pick<Program, 'id' | 'name' | 'deadline'>,
  institutionName: string | null,
  now: Date,
): CalendarEvent | null {
  const fact = program.deadline;
  const confidence = computeConfidence(fact, now);
  if (!fact || !isUsable(confidence)) return null;
  const date = deadlineDate(fact.value);
  if (!date || isPassedDate(date, now)) return null;

  const where = clean(institutionName);
  const name = clean(program.name) || 'Program';
  const summary = `Application deadline: ${name}${where ? ` (${where})` : ''}`;

  const source = safeHref(fact.source_url);
  const note = clean(fact.note);
  const description = [
    `How sure we are: ${confidence}. ${CONFIDENCE_HELP[confidence]}`,
    fact.fetched_at ? `Checked: ${formatDate(fact.fetched_at)}.` : null,
    note ? `Note: ${note}` : null,
    'This is an all-day reminder on the stated date. Any closing time is in the note or on the official page.',
    source ? `Source: ${source}` : null,
    CHECK_OFFICIAL_PAGE,
  ]
    .filter((l): l is string => Boolean(l))
    .join('\n');

  const id = safeId(program.id);
  return { uid: `${id}-deadline-${compactDate(date)}@masterspath`, date, summary, description, filename: `${id}-deadline.ics` };
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and newlines. Other control characters are dropped. */
export function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
}

const encoder = new TextEncoder();

/**
 * Folds one content line so no physical line is longer than 75 octets (UTF-8), per RFC 5545 section 3.1.
 * Continuation lines start with one space. Multi-byte characters are never split.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = ' ';
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n');
}

/** A complete VCALENDAR with one all-day VEVENT per event, two reminders each (7 days and 1 day before). */
export function buildIcs(events: readonly CalendarEvent[], now: Date): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MastersPath//Application deadlines//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const e of events) {
    const date = deadlineDate(e.date);
    if (!date) continue;
    const summary = escapeIcsText(e.summary);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcsText(e.uid)}`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${compactDate(date)}`,
      `DTEND;VALUE=DATE:${nextDay(date)}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${escapeIcsText(e.description)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${summary}`,
      'TRIGGER:-P7D',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${summary}`,
      'TRIGGER:-P1D',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
