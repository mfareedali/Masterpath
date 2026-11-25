/**
 * Consultant Check page state from the URL. Pure, no I/O.
 *
 * The form is a plain GET form: /check?claims=<text> runs the check, /check?example=<id> only prefills the box.
 * Text is cleaned (personal numbers removed, max 2,000 characters) before it is shown or checked.
 */
import { findExample } from './examples';
import { MAX_INPUT_CHARS, cleanInput, redactPersonalNumbers } from './extract';

export type SearchParams = Record<string, string | string[] | undefined>;

export interface CheckQuery {
  /** Cleaned text for the textarea (and for the check when `submitted`). */
  text: string;
  /** True when the form was submitted (a `claims` param is present, even if empty). */
  submitted: boolean;
  /** The submitted text was longer than MAX_INPUT_CHARS and was cut. */
  truncated: boolean;
  /** Something that looked like an ID, passport or phone number (or an email) was removed. */
  redacted: boolean;
  /** Example id when the box was prefilled from an example link. */
  exampleId: string | null;
}

function firstParam(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export function parseCheckQuery(sp: SearchParams): CheckQuery {
  const claims = firstParam(sp.claims);
  if (claims != null) {
    // Bound the work on hand-made URLs; anything past 2x the limit is never checked anyway.
    const raw = claims.slice(0, MAX_INPUT_CHARS * 2).replace(/\r\n?/g, '\n');
    return {
      text: cleanInput(raw),
      submitted: true,
      truncated: raw.trim().length > MAX_INPUT_CHARS,
      redacted: redactPersonalNumbers(raw) !== raw,
      exampleId: null,
    };
  }
  const example = findExample(firstParam(sp.example));
  return { text: example?.text ?? '', submitted: false, truncated: false, redacted: false, exampleId: example?.id ?? null };
}

/**
 * Absolute https link to the Check page, for the WhatsApp text. Null on localhost, plain http, or a strange host
 * (the share text then simply has no link).
 */
export function checkPageUrl(host: string | null | undefined, proto: string | null | undefined): string | null {
  const h = host?.split(',')[0]?.trim().toLowerCase() ?? '';
  const p = proto?.split(',')[0]?.trim().toLowerCase() ?? '';
  if (!h || p !== 'https') return null;
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(h)) return null;
  if (/^(localhost|127\.|0\.0\.0\.0)/.test(h) || !h.includes('.')) return null;
  return `https://${h}/check`;
}
