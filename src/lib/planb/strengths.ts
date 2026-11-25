/**
 * Strengths helpers for Plan B. Pure and dependency-free so the tiny client island stays small.
 *
 * Strengths (publications, research) only add the note "Your research may matter here" on research-led routes.
 * They NEVER change a fit label and NEVER change the order of routes.
 */
import type { Strengths } from '../types';

/** True when the student listed at least one publication or research experience. */
export function hasResearchStrengths(s: Strengths | null | undefined): boolean {
  if (!s || typeof s !== 'object') return false;
  const pubs = Array.isArray(s.publications) ? s.publications.length : 0;
  const research = Array.isArray(s.research) ? s.research.length : 0;
  return pubs + research > 0;
}
