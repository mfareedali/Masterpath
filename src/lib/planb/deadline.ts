/**
 * Deadlines on Plan B routes — pure, no clock (pass `now` in). Only a usable (Verified/Likely) deadline is
 * compared with today; anything else is shown as it is, with its badge, and never decides anything.
 */
import { computeConfidence, emptyFact, isUsable } from '../confidence';
import { formatDate } from '../format';
import type { Confidence, Fact, ISODate, Program } from '../types';

export interface RouteDeadline {
  /** Row label, e.g. "Application deadline", "Masters deadline". */
  label: string;
  programId: string;
  programName: string;
  /** Official page of that program (for "Not verified yet — check the official page"). */
  officialUrl: string | null;
  /** The deadline fact as stored (rendered with its badge, source, evidence and student note). */
  fact: Fact<ISODate>;
  confidence: Confidence;
  /** The deadline date when it is usable (Verified/Likely) and readable; else null. */
  date: ISODate | null;
  /** Whole UTC calendar days from today to `date` (negative = passed). Null when `date` is null. */
  daysLeft: number | null;
}

const DAY_MS = 86_400_000;

/** Whole days from `now` to an ISO date (UTC calendar days). Null when the date cannot be read. */
export function daysUntil(iso: string, now: Date): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / DAY_MS);
}

/** "52 days left", "1 day left", "Last day today", "This date has passed". */
export function daysLeftText(days: number): string {
  if (days < 0) return 'This date has passed';
  if (days === 0) return 'Last day today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

/** "1 Mar 2027 (97 days left)" for a usable deadline; just the date otherwise. */
export function deadlineText(value: string, d: Pick<RouteDeadline, 'date' | 'daysLeft'>): string {
  const date = formatDate(value);
  return d.date === value && d.daysLeft != null ? `${date} (${daysLeftText(d.daysLeft)})` : date;
}

export function deadlineOf(program: Program, label: string, now: Date): RouteDeadline {
  const fact = program.deadline ?? emptyFact<ISODate>();
  const confidence = computeConfidence(fact, now);
  const raw = isUsable(confidence) && typeof fact.value === 'string' ? fact.value : null;
  const daysLeft = raw != null ? daysUntil(raw, now) : null;
  return {
    label,
    programId: program.id,
    programName: program.name,
    officialUrl: program.official_url ?? null,
    fact,
    confidence,
    date: daysLeft != null ? raw : null,
    daysLeft,
  };
}

/** True when a usable deadline is before today (a deadline that is today has not passed). */
export function hasPassed(d: RouteDeadline): boolean {
  return d.date != null && d.daysLeft != null && d.daysLeft < 0;
}
