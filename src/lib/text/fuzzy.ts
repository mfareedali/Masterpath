/**
 * Tolerant name matching for misspellings ("Imprial", "Brooks", "Toranto"). Pure.
 *
 * Rules (never guess silently — callers must ASK "Did you mean …?"):
 *  - only words of 5+ letters are compared (short acronyms such as TUM, ETH, CMU never fuzzy-match);
 *  - distance <= 1 for 5–7 letter words, <= 2 for 8+ letter words (Damerau-Levenshtein, case-insensitive);
 *  - a suggestion is returned only when exactly ONE candidate is closest (ties -> null).
 */

export function damerauLevenshtein(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

export function maxDistanceFor(word: string): number {
  if (word.length < 5) return 0;
  return word.length >= 8 ? 2 : 1;
}

export interface FuzzyCandidate {
  /** Your id for the thing (e.g. institution id). */
  key: string;
  /** Display name to suggest, e.g. "Imperial College London". */
  label: string;
  /** Single-word aliases to compare against, e.g. ["imperial"], ["brookes", "oxford"]. Lower-case, 5+ letters. */
  words: string[];
}

export interface FuzzySuggestion {
  key: string;
  label: string;
  /** The word the user typed. */
  typed: string;
  /** The alias it was close to. */
  matched: string;
  distance: number;
}

const WORD = /[\p{L}]{5,}/gu;

/**
 * Find the single closest candidate for any 5+ letter word in `text` that is NOT already an exact alias.
 * Returns null when nothing is close enough or when two candidates are equally close.
 */
export function suggestName(text: string, candidates: readonly FuzzyCandidate[]): FuzzySuggestion | null {
  const exact = new Set(candidates.flatMap((c) => c.words.map((w) => w.toLowerCase())));
  const typedWords = [...new Set((text.match(WORD) ?? []).map((w) => w.toLowerCase()))].filter((w) => !exact.has(w));
  let best: FuzzySuggestion | null = null;
  let tie = false;
  for (const typed of typedWords) {
    const limit = maxDistanceFor(typed);
    if (limit === 0) continue;
    for (const c of candidates) {
      for (const w of c.words) {
        if (w.length < 5) continue;
        const dist = damerauLevenshtein(typed, w);
        if (dist === 0 || dist > limit) continue;
        if (!best || dist < best.distance) {
          best = { key: c.key, label: c.label, typed, matched: w, distance: dist };
          tie = false;
        } else if (dist === best.distance && best.key !== c.key) {
          tie = true;
        }
      }
    }
  }
  return best && !tie ? best : null;
}
