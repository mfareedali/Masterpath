/**
 * Consultant Check — "Did you mean …?" for a misspelled university name ("Brooks", "Imprial", "Toranto"). Pure, no I/O.
 *
 * Code only PROPOSES a correction; the student confirms it by following the link, which reruns the check with the
 * corrected text. Nothing is ever checked against a guessed university. Uses the shared suggestName() helper
 * (src/lib/text/fuzzy.ts): short acronyms never fuzzy-match, and two equally close names give no suggestion.
 */
import { suggestName, type FuzzyCandidate } from '../text/fuzzy';
import type { Institution } from '../types';
import { INSTITUTION_ALIASES, buildAliasPatterns, derivedNames, findInstitutions, normalizeText, type AliasPattern } from './aliases';

export interface NameSuggestion {
  /** The word as the student wrote it, e.g. "Brooks". */
  typed: string;
  /** The institution's official name, e.g. "Oxford Brookes University". */
  label: string;
  institutionId: string;
  /** The student's text with the word corrected, so that the institution now matches exactly. */
  correctedText: string;
}

/**
 * Words that are not distinctive enough to suggest a university by: generic words, place words shared by many
 * universities, and words close to everyday words ("springs" ~ "spring", "urbana" ~ "urban", "hills" ~ "bills").
 */
const NOT_DISTINCTIVE = new Set([
  'university',
  'universitat',
  'universitaet',
  'college',
  'institute',
  'technology',
  'technical',
  'school',
  'science',
  'sciences',
  'state',
  'national',
  'international',
  'london',
  'oxford',
  'queen',
  'queens',
  'california',
  'south',
  'north',
  'hills',
  'springs',
  'urbana',
]);

function isAcronym(alias: string): boolean {
  return /^[A-Z]{2,6}$/.test(alias);
}

/** Every non-acronym name we match an institution by (official name variants plus aliases). */
function namesOf(inst: Institution): string[] {
  return [...new Set([...derivedNames(inst.name), ...(INSTITUTION_ALIASES[inst.id] ?? [])])].filter((n) => !isAcronym(n));
}

function wordsOf(name: string): string[] {
  return normalizeText(name).split(/[^a-z]+/).filter((w) => w.length >= 5 && !NOT_DISTINCTIVE.has(w));
}

/** Fuzzy candidates for destination universities, built from their names (never from facts). */
export function suggestionCandidates(institutions: readonly Institution[], exclude: ReadonlySet<string> = new Set()): FuzzyCandidate[] {
  return institutions
    .filter((i) => i.kind === 'destination' && !exclude.has(i.id))
    .map((i) => ({ key: i.id, label: i.name, words: [...new Set(namesOf(i).flatMap(wordsOf))] }))
    .filter((c) => c.words.length > 0);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "brookes" written like "Brooks" -> "Brookes"; like "BROOKS" -> "BROOKES". */
function likeTyped(word: string, typed: string): string {
  if (typed === typed.toUpperCase()) return word.toUpperCase();
  return typed[0] === typed[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word;
}

/**
 * One "Did you mean …?" suggestion for a university name that is close to, but not exactly, one we hold.
 * Universities already named exactly in the text are never suggested. Returns null when nothing is close enough,
 * when two names are equally close, or when no correction would make the name match exactly.
 */
export function suggestInstitution(
  text: string,
  institutions: readonly Institution[],
  patterns: readonly AliasPattern[] = buildAliasPatterns(institutions),
): NameSuggestion | null {
  if (!text.trim()) return null;
  // Accents never count as a misspelling ("Zürich" is "Zurich").
  const plainText = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const matched = new Set(findInstitutions(plainText, patterns));
  const s = suggestName(plainText, suggestionCandidates(institutions, matched));
  if (!s) return null;
  const inst = institutions.find((i) => i.id === s.key);
  if (!inst) return null;
  const wordRe = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(s.typed)}(?![\\p{L}\\p{N}])`, 'giu');
  const asWritten = plainText.match(wordRe)?.[0];
  if (!asWritten) return null;
  // First the corrected word alone ("Brooks" -> "Brookes"); else the shortest name that contains it
  // ("Toranto" -> "Toronto University"). Keep only a correction that makes the name match exactly.
  const fuller = namesOf(inst)
    .filter((n) => normalizeText(n).split(/[^a-z]+/).includes(s.matched))
    .sort((a, b) => a.length - b.length);
  for (const replacement of [likeTyped(s.matched, asWritten), ...fuller]) {
    const correctedText = plainText.replace(wordRe, replacement);
    if (findInstitutions(correctedText, patterns).includes(inst.id)) {
      return { typed: asWritten, label: inst.name, institutionId: inst.id, correctedText };
    }
  }
  return null;
}
