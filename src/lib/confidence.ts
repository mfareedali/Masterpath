import type { Confidence, Fact, SourcedValue } from './types';

/** A Verified value must have been fetched within this many days. */
export const VERIFIED_MAX_AGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

function isBlank(s: string | null | undefined): boolean {
  return s == null || s.trim() === '';
}

/** Stable JSON for comparing fact values (object keys sorted). */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const obj = v as Record<string, unknown>;
  return (
    '{' +
    Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]))
      .join(',') +
    '}'
  );
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/** Age in whole days between fetched_at and now. Returns Infinity for missing/invalid dates. */
export function ageInDays(fetched_at: string | null | undefined, now: Date): number {
  if (isBlank(fetched_at)) return Infinity;
  const t = Date.parse(fetched_at as string);
  if (Number.isNaN(t)) return Infinity;
  return Math.floor((now.getTime() - t) / DAY_MS);
}

/**
 * True when the fact has at least one other SOURCED value that differs. An alternative without a source_url is an
 * unsourced claim, not a second source: it never turns a Verified fact into a Conflict (it stays in allSources()).
 */
export function hasConflict<T>(fact: Fact<T>): boolean {
  if (!fact.conflicts || fact.conflicts.length === 0) return false;
  const sourced = fact.conflicts.filter((s) => !isBlank(s.source_url));
  const all = [fact, ...sourced].filter((s) => s.value !== null && s.value !== undefined);
  if (all.length < 2) return false;
  const first = stableStringify(all[0].value);
  return all.some((s) => stableStringify(s.value) !== first);
}

/**
 * Confidence of a single source (ignores conflicts):
 *  - Unverified: no value, or no evidence snippet and no declared summary/inferred basis with a source URL.
 *  - Verified:   value + source_url + evidence_snippet + basis 'verbatim' (default) + fetched within 30 days.
 *  - Likely:     has a source but is older than 30 days, or is a summary/inferred value.
 */
export function sourceConfidence<T>(s: SourcedValue<T>, now: Date): Exclude<Confidence, 'Conflict'> {
  if (s.value === null || s.value === undefined) return 'Unverified';
  const hasSnippet = !isBlank(s.evidence_snippet);
  const hasUrl = !isBlank(s.source_url);
  const basis = s.basis ?? (hasSnippet ? 'verbatim' : undefined);

  if (basis === 'summary' || basis === 'inferred') {
    return hasUrl ? 'Likely' : 'Unverified';
  }
  if (!hasSnippet || !hasUrl) return 'Unverified';
  return ageInDays(s.fetched_at, now) <= VERIFIED_MAX_AGE_DAYS ? 'Verified' : 'Likely';
}

/** Confidence of a fact, computed in code. Conflict wins over everything else. */
export function computeConfidence<T>(fact: Fact<T> | null | undefined, now: Date): Confidence {
  if (!fact) return 'Unverified';
  if (hasConflict(fact)) return 'Conflict';
  return sourceConfidence(fact, now);
}

/** Only Verified and Likely values may be used for ranking, filtering and fit decisions. */
export function isUsable(conf: Confidence): conf is 'Verified' | 'Likely' {
  return conf === 'Verified' || conf === 'Likely';
}

/** Returns the value only if it is usable (Verified or Likely); otherwise null. */
export function usableValue<T>(fact: Fact<T> | null | undefined, now: Date): T | null {
  if (!fact) return null;
  return isUsable(computeConfidence(fact, now)) ? (fact.value as T) : null;
}

/** All sources of a fact (primary first) that carry a value — used to render Conflict states. */
export function allSources<T>(fact: Fact<T>): SourcedValue<T>[] {
  return [fact, ...(fact.conflicts ?? [])].filter((s) => s.value !== null && s.value !== undefined);
}

/** An empty, Unverified fact. Use for stubs. */
export function emptyFact<T>(): Fact<T> {
  return { value: null, source_url: null, evidence_snippet: null, fetched_at: null };
}

/** Human-readable explanation of a confidence label (for tooltips / legend). */
export const CONFIDENCE_HELP: Record<Confidence, string> = {
  Verified: `Copied word-for-word from the official page and checked within the last ${VERIFIED_MAX_AGE_DAYS} days.`,
  Likely: `From an official source but older than ${VERIFIED_MAX_AGE_DAYS} days, or summarised rather than quoted. Re-check before you rely on it.`,
  Unverified: 'No evidence from an official page yet. Treat as unknown.',
  Conflict: 'Official sources disagree. Both values and links are shown. Ask the university in writing.',
};
