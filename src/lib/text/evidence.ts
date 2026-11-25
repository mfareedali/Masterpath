/**
 * Evidence text utilities shared by the ingestion script, the snippet verifier and tests.
 * Pure functions; no I/O.
 *
 * RULE: a proposed value is accepted only if its evidence snippet appears VERBATIM in the official page text
 * (after the light normalisation below: whitespace, quotes, dashes, entities — never wording).
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', euro: '€', pound: '£', hellip: '…',
  uuml: 'ü', ouml: 'ö', auml: 'ä', Uuml: 'Ü', Ouml: 'Ö', Auml: 'Ä', szlig: 'ß', eacute: 'é',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code] ?? m;
  });
}

const BLOCK_CLOSERS = /<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/td|\/th|\/section|\/article|\/dt|\/dd|\/table|\/ul|\/ol)\b[^>]*>/gi;
const INLINE_TAGS = /<\/?(a|span|strong|b|i|em|small|sup|sub|abbr|mark|u|code|time|bdi|bdo|wbr)\b[^>]*>/gi;

/** Convert HTML to plain text: drops script/style/noscript/svg/template, turns block tags into newlines. */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(BLOCK_CLOSERS, '\n');
  // Inline tags vanish without adding a space (so "<b>2027</b>." stays "2027."); other tags become a space.
  s = s.replace(INLINE_TAGS, '');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Normalisation applied to BOTH the page text and the snippet before the verbatim check. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[\s ​]+/g, ' ')
    .replace(/ ([.,;:!?)])/g, '$1')
    .replace(/\( /g, '(')
    .trim()
    .toLowerCase();
}

/** True when `snippet` appears verbatim (modulo normalisation) in `pageText`. Snippets shorter than 12 chars are rejected. */
export function snippetAppearsIn(snippet: string, pageText: string): boolean {
  const n = normalizeForMatch(snippet);
  if (n.length < 12) return false;
  return normalizeForMatch(pageText).includes(n);
}
