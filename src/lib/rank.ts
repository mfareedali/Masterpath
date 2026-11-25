/**
 * Generic "Rank by" engine — plain code over rows, no AI.
 *
 * RANKING RULE (non-negotiable): only Verified or Likely values are ranked. Rows with no usable value
 * for the chosen key go into a separate "Not ranked: data missing" group. A missing value is NEVER
 * treated as zero or infinity.
 */
import { isUsable } from './confidence';
import type { Confidence } from './types';

export type SortDir = 'asc' | 'desc';

export interface RankKey {
  /** Numeric sort value, or null when unknown. */
  value: number | null;
  /** Confidence of the underlying data (for computed keys, the weakest input's confidence). */
  confidence: Confidence;
  /** Why the row is not ranked, e.g. "Tuition not verified yet". Shown in the "Not ranked" group. */
  missingReason?: string;
}

export interface Ranked<T> {
  item: T;
  key: RankKey;
  /** 1-based rank within the ranked group. */
  rank: number;
}

export interface NotRanked<T> {
  item: T;
  key: RankKey;
  reason: string;
}

export interface RankResult<T> {
  ranked: Ranked<T>[];
  notRanked: NotRanked<T>[];
}

/** Weakest confidence wins: Conflict < Unverified < Likely < Verified. */
export function weakestConfidence(...cs: Confidence[]): Confidence {
  const order: Confidence[] = ['Conflict', 'Unverified', 'Likely', 'Verified'];
  let worst = 3;
  for (const c of cs) worst = Math.min(worst, order.indexOf(c));
  return order[worst];
}

export function rankItems<T>(
  items: readonly T[],
  getKey: (item: T) => RankKey,
  dir: SortDir,
  tiebreak: (a: T, b: T) => number = () => 0,
): RankResult<T> {
  const usable: { item: T; key: RankKey; idx: number }[] = [];
  const notRanked: NotRanked<T>[] = [];

  items.forEach((item, idx) => {
    const key = getKey(item);
    const ok = key.value !== null && Number.isFinite(key.value) && isUsable(key.confidence);
    if (ok) usable.push({ item, key, idx });
    else {
      const reason =
        key.missingReason ??
        (key.confidence === 'Conflict' ? 'Sources conflict' : 'Data missing or not verified yet');
      notRanked.push({ item, key, reason });
    }
  });

  usable.sort((a, b) => {
    const d = (a.key.value as number) - (b.key.value as number);
    if (d !== 0) return dir === 'asc' ? d : -d;
    const t = tiebreak(a.item, b.item);
    return t !== 0 ? t : a.idx - b.idx; // stable
  });

  return {
    ranked: usable.map((u, i) => ({ item: u.item, key: u.key, rank: i + 1 })),
    notRanked,
  };
}
