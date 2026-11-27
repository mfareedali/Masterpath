/**
 * Presentation helpers for the shortlist and Plan B screens. Pure functions, no clock, no data changes:
 * they only decide how a value we already have is phrased or grouped. Nothing here ranks, scores or fills a value.
 */
import { safeHref } from '@/lib/format';
import type { CostResult } from '@/lib/cost';
import type { Fact, FitResult, Institution, Program } from '@/lib/types';
import type { ClosingSoonRow, ProgramView, ShortlistRankKey } from './index';
import type { SortDir } from '../rank';
import { DIR_LABEL, RANK_LABEL } from './query';

/** A deadline this close gets a badge at the top of the shortlist. */
export const URGENT_DEADLINE_DAYS = 7;

/** Rows from closingSoon() that close within URGENT_DEADLINE_DAYS (usable dates only, already filtered upstream). */
export function urgentDeadlines(rows: readonly ClosingSoonRow[], days = URGENT_DEADLINE_DAYS): ClosingSoonRow[] {
  return rows.filter((r) => r.days >= 0 && r.days <= days);
}

export function urgentBadgeText(n: number): string {
  return `${n} deadline${n === 1 ? '' : 's'} closing soon`;
}

/** True when the fit label is a real result ("Meets minimum" / "Below minimum"). */
export function fitIsKnown(fit: Pick<FitResult, 'label'>): boolean {
  return fit.label !== 'Competitive range unknown';
}

/** What the student can do when the fit is unknown. Phrased as an action, never as a value. */
export function fitActionText(fit: Pick<FitResult, 'reason'>): string {
  switch (fit.reason.code) {
    case 'MIN_CONFLICT':
      return 'Official pages disagree: confirm the minimum grade with the university';
    case 'NO_CONVERSION_RULE':
    case 'CONVERSION_RULE_UNSOURCED':
      return 'Check how your grade is read on the official page';
    case 'INVALID_INPUT':
      return 'Check the grade in your profile';
    case 'NOT_ACCEPTING':
      return 'Check who can apply on the official page';
    default:
      return 'Check the minimum grade on the official page';
  }
}

/** The official page where the student can do `fitActionText`: the minimum-grade source first, then the program page. */
export function fitActionUrl(program: Program, fit: Pick<FitResult, 'required'>): string | null {
  return (
    safeHref(fit.required?.source_url) ??
    safeHref(program.min_gpa_rule.source_url) ??
    safeHref(program.official_url) ??
    null
  );
}

/** The one page a student should open for anything not on file: program page, else the university site. */
export function officialFallbackUrl(program: Program, institution: Institution | null): string | null {
  return safeHref(program.official_url) ?? safeHref(institution?.website) ?? null;
}

const has = (f: Fact<unknown> | null | undefined) => !!f && f.value != null;

export interface RowDetailPresence {
  deadline: boolean;
  tuition: boolean;
  totalCost: boolean;
  citizenship: boolean;
  study: boolean;
}

/** Which of a row's detail values are on file. Used to hide empty cells and count what is missing. */
export function rowDetailPresence(v: Pick<ProgramView, 'program' | 'totalCost' | 'citizenship'>): RowDetailPresence {
  const cost: CostResult = v.totalCost;
  return {
    deadline: has(v.program.deadline),
    tuition: has(v.program.tuition),
    totalCost: cost.pkr != null || !!cost.native,
    citizenship: has(v.citizenship),
    study: has(v.program.duration_months),
  };
}

/** How many of the four always-shown details are not on file (study time only counts when ranked by it). */
export function missingDetailCount(p: RowDetailPresence, includeStudy = false): number {
  return [p.deadline, p.tuition, p.totalCost, p.citizenship, ...(includeStudy ? [p.study] : [])].filter((x) => !x).length;
}

export function missingDetailsText(n: number): string {
  return `${n} detail${n === 1 ? '' : 's'} not on file yet`;
}

const HEADLINE_MAX = 90;

/** One headline line for a long note, plus the full text for a "Read more" expander (null when short). */
export function noteHeadline(text: string, max = HEADLINE_MAX): { head: string; full: string | null } {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return { head: t, full: null };
  const cut = t.slice(0, max);
  const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '), cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  const head = (at > 30 ? cut.slice(0, at) : cut).replace(/[.,;:\s]+$/, '');
  return { head: `${head}…`, full: t };
}

/** "Sorted by Fit · Meets minimum first". */
export function sortedByText(rank: ShortlistRankKey, dir: SortDir): string {
  return `Sorted by ${RANK_LABEL[rank]} · ${DIR_LABEL[rank][dir]}`;
}

/** Short summary of the active filters for the mobile "Filters" button, e.g. "Germany, UK · Meets minimum". */
export function activeFilterSummary(parts: readonly string[]): string {
  return parts.filter(Boolean).join(' · ');
}
