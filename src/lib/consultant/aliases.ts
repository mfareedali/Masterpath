/**
 * Name matching for the Consultant Check. Pure, no I/O.
 *
 * These are NAMES people use for institutions and countries (not facts about them). Aliases only apply
 * when the institution id exists in the dataset. All-caps acronyms (TUM, ETH, USF...) are matched
 * case-sensitively on purpose: "tum" is the Roman Urdu word for "you", "us" is "that".
 */
import type { CountryCode, Institution } from '../types';

/** Extra names people use, keyed by institution id. Keep acronyms in CAPITALS (matched case-sensitively). */
export const INSTITUTION_ALIASES: Record<string, string[]> = {
  tum: ['TUM', 'TU Munich', 'TU Muenchen', 'TU Munchen', 'Technical University Munich'],
  ethz: ['ETH', 'ETHZ', 'ETH Zurich', 'ETH Zuerich'],
  'uni-wuerzburg': ['Wurzburg', 'Wuerzburg', 'University of Wurzburg', 'University of Wuerzburg', 'Uni Wurzburg'],
  imperial: ['Imperial', 'Imperial College'],
  cardiff: ['Cardiff', 'Cardiff Uni'],
  'oxford-brookes': ['Oxford Brookes', 'Brookes', 'OBU'],
  qmul: ['QMUL', 'Queen Mary', 'Queen Mary University', 'Queen Mary London'],
  utoronto: ['UofT', 'U of T', 'Toronto University', 'UToronto'],
  cmu: ['CMU', 'Carnegie Mellon'],
  uiuc: ['UIUC', 'Illinois Urbana-Champaign', 'Illinois Urbana Champaign', 'UIUC Illinois'],
  csudh: ['CSUDH', 'Cal State Dominguez Hills', 'CSU Dominguez Hills', 'Dominguez Hills'],
  nyit: ['NYIT', 'New York Tech', 'NY Tech'],
  usf: ['USF', 'South Florida', 'Univ of South Florida'],
  uccs: ['UCCS', 'Colorado Springs'],
  ljmu: ['LJMU', 'John Moores', 'Liverpool John Moores'],
};

/** Lower-case, strip diacritics ("Würzburg" -> "wurzburg"), straighten quotes, collapse spaces. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Same as normalizeText but keeps the original letter case (for acronyms). Same length mapping not guaranteed. */
export function stripMarks(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const ACRONYM = /^[A-Z]{2,6}$/;

export interface AliasPattern {
  institutionId: string;
  alias: string;
  re: RegExp;
  /** Match against the case-preserving text (acronyms) instead of the lower-cased text. */
  caseSensitive: boolean;
}

/** Names derived from the official name: without "(...)" notes, without a leading "The", without a trailing "University". */
export function derivedNames(name: string): string[] {
  const out = new Set<string>();
  const clean = name.replace(/\s*\(.*\)\s*$/, '').trim();
  out.add(clean);
  const noThe = clean.replace(/^the\s+/i, '');
  out.add(noThe);
  const noUni = noThe.replace(/\s+(university|universitat|universität)$/i, '').trim();
  if (noUni !== noThe && noUni.length >= 5) out.add(noUni);
  return [...out].filter((n) => n.length >= 3);
}

export function buildAliasPatterns(institutions: readonly Institution[]): AliasPattern[] {
  const patterns: AliasPattern[] = [];
  for (const inst of institutions) {
    const names = new Set<string>([...derivedNames(inst.name), ...(INSTITUTION_ALIASES[inst.id] ?? [])]);
    for (const alias of names) {
      const caseSensitive = ACRONYM.test(alias);
      const body = caseSensitive ? escapeRegExp(stripMarks(alias)) : escapeRegExp(normalizeText(alias)).replace(/[ -]+/g, '[\\s-]+');
      const re = caseSensitive
        ? new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, 'g')
        : new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`, 'g');
      patterns.push({ institutionId: inst.id, alias, re, caseSensitive });
    }
  }
  return patterns;
}

interface Hit {
  id: string;
  start: number;
  end: number;
}

/** Institution ids mentioned in `text`, in order of first mention. Longer, overlapping names win. */
export function findInstitutions(text: string, patterns: readonly AliasPattern[]): string[] {
  const lower = normalizeText(text);
  const cased = stripMarks(text);
  const hits: Hit[] = [];
  for (const p of patterns) {
    const target = p.caseSensitive ? cased : lower;
    p.re.lastIndex = 0;
    for (const m of target.matchAll(p.re)) {
      const start = m.index ?? 0;
      hits.push({ id: p.institutionId, start, end: start + m[0].length });
    }
  }
  // Prefer longer hits; drop hits that overlap an already-kept one.
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: Hit[] = [];
  for (const h of hits) {
    if (kept.some((k) => h.start < k.end && k.start < h.end)) continue;
    kept.push(h);
  }
  kept.sort((a, b) => a.start - b.start);
  const ids: string[] = [];
  for (const k of kept) if (!ids.includes(k.id)) ids.push(k.id);
  return ids;
}

const COUNTRY_PATTERNS: { code: CountryCode; lower?: RegExp; cased?: RegExp }[] = [
  {
    code: 'UK',
    lower: /(?<![a-z])(uk|u\.k\.?|united kingdom|great britain|britain|british|england|english universit\w*|scotland|scottish|wales|welsh|northern ireland)(?![a-z])/,
  },
  { code: 'DE', lower: /(?<![a-z])(germany|german|deutschland)(?![a-z])/ },
  { code: 'CA', lower: /(?<![a-z])(canada|canadian)(?![a-z])/ },
  {
    code: 'US',
    lower: /(?<![a-z])(usa|u\.s\.a\.?|u\.s\.|united states|america|american)(?![a-z])/,
    // "us" is a common Roman Urdu word ("that"), so only the capitalised form counts.
    cased: /(?<![A-Za-z])US(?![A-Za-z])/,
  },
  { code: 'CH', lower: /(?<![a-z])(switzerland|swiss|schweiz|suisse)(?![a-z])/ },
];

/** Destination countries named in `text`, in a stable order (Pakistan is the home country and never counted). */
export function findCountries(text: string): CountryCode[] {
  const lower = normalizeText(text);
  const cased = stripMarks(text);
  const found: { code: CountryCode; at: number }[] = [];
  for (const c of COUNTRY_PATTERNS) {
    const a = c.lower ? lower.search(c.lower) : -1;
    const b = c.cased ? cased.search(c.cased) : -1;
    const at = [a, b].filter((x) => x >= 0);
    if (at.length) found.push({ code: c.code, at: Math.min(...at) });
  }
  return found.sort((x, y) => x.at - y.at).map((f) => f.code);
}
