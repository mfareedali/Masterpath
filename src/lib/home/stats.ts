/**
 * Numbers for the Home hero, computed from data rows (never written as copy). Pure.
 * Only active programs count. A fact counts as "verified" when computeConfidence says Verified today.
 */
import { computeConfidence } from '../confidence';
import type { Fact, Program } from '../types';

export interface HomeStats {
  programs: number;
  universities: number;
  countries: number;
  facts: { verified: number; total: number };
}

function isFact(v: unknown): v is Fact<unknown> {
  return Boolean(v) && typeof v === 'object' && 'value' in (v as object);
}

export function homeStats(programs: readonly Program[], now: Date): HomeStats {
  const active = programs.filter((p) => p.status === 'active');
  const facts = { verified: 0, total: 0 };
  for (const p of active) {
    for (const v of Object.values(p)) {
      if (!isFact(v)) continue;
      facts.total++;
      if (computeConfidence(v, now) === 'Verified') facts.verified++;
    }
  }
  return {
    programs: active.length,
    universities: new Set(active.map((p) => p.institution_id)).size,
    countries: new Set(active.map((p) => p.country)).size,
    facts,
  };
}
