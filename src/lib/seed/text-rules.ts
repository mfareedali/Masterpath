/**
 * Plain-text content rules shared by the seed validator and the ingestion script. Pure functions.
 */

/** Admission probabilities / "chances" are banned everywhere (product rule 5). */
export const FORBIDDEN_TEXT = /probabilit|chance of admission|admission chance|\d+\s*%\s*(chance|probability)/i;

/** Looks like an HTML tag, comment or CDATA block. "a < b" and "<3" are fine; "<b>", "</p>", "<!--" are not. */
const HTML_TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>|<!--|<!\[CDATA\[|<![a-z]/i;

export function hasForbiddenText(s: string): boolean {
  return FORBIDDEN_TEXT.test(s);
}

export function hasHtmlTag(s: string): boolean {
  return HTML_TAG.test(s);
}

export const SNIPPET_MIN = 12;
export const SNIPPET_MAX = 600;

/** Returns a problem description, or null when the snippet length is fine. */
export function snippetLengthProblem(snippet: string): string | null {
  const n = snippet.trim().length;
  if (n < SNIPPET_MIN) return `evidence_snippet is too short (${n} characters; at least ${SNIPPET_MIN})`;
  if (n > SNIPPET_MAX) return `evidence_snippet is too long (${n} characters; at most ${SNIPPET_MAX})`;
  return null;
}

/** Problems with a URL that must be an https link to an official page (null = fine). */
export function httpsUrlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `"${raw}" is not a valid URL`;
  }
  if (u.protocol !== 'https:') return `"${raw}" must use https://`;
  if (u.username || u.password) return `"${raw}" must not contain a username or password`;
  if (!u.hostname || !u.hostname.includes('.')) return `"${raw}" has no valid host name`;
  if (raw.trim() !== raw) return `"${raw}" has leading or trailing spaces`;
  return null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Parses an ISO date or timestamp strictly (rejects 2026-02-30). Returns epoch ms or null. */
export function parseIsoDate(s: string): number | null {
  const m = ISO_DATE.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const day = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (day.getUTCFullYear() !== Number(y) || day.getUTCMonth() !== Number(mo) - 1 || day.getUTCDate() !== Number(d)) {
    return null;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Calls `visit` for every key and string value in a JSON tree, with its JSON pointer. */
export function walkJson(
  node: unknown,
  visit: (kind: 'key' | 'string', text: string, pointer: string) => void,
  pointer = '',
): void {
  if (typeof node === 'string') {
    visit('string', node, pointer || '/');
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkJson(item, visit, `${pointer}/${i}`));
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const child = `${pointer}/${k.replace(/~/g, '~0').replace(/\//g, '~1')}`;
      visit('key', k, child);
      walkJson(v, visit, child);
    }
  }
}

/**
 * Ways a number may be printed on a page ("1500" -> "1500", "1,500", "1.500", "1 500"; "6.5" -> "6,5";
 * "4" -> "4.0", "4,0", "4.00").
 */
function numberSpellings(n: number): string[] {
  const s = String(n);
  const [int, frac] = s.split('.');
  const grouped = (sep: string) => int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const forms = new Set<string>([s]);
  // Thousands separators: comma, dot, space, no-break space, narrow no-break space, none.
  for (const sep of [',', '.', ' ', String.fromCharCode(0xa0), String.fromCharCode(0x202f), '']) {
    const g = grouped(sep);
    forms.add(frac ? `${g}.${frac}` : g);
    forms.add(frac ? `${g},${frac}` : g);
  }
  if (Number.isInteger(n)) {
    forms.add(`${int}.0`);
    forms.add(`${int},0`);
    forms.add(`${int}.00`);
    forms.add(`${int},00`);
  }
  return [...forms];
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `n` is written in `text` as a whole number (so 2 does not match "12" and 6 does not match "6.5").
 * Shared by the ingestion review notes and the seed validator.
 */
export function mentionsNumber(text: string, n: number): boolean {
  const digits = numberSpellings(n).some((f) => new RegExp(`(?<![\\d.,])${escapeRegex(f)}(?!\\d|[.,]\\d)`).test(text));
  if (digits) return true;
  const word = Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : null;
  return word !== null && new RegExp(`\\b${word}\\b`, 'i').test(text);
}
