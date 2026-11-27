/**
 * The one way scripts turn an official URL into page text: through safeFetch (https, allowlisted host, public IPs,
 * robots.txt, per-host throttle, size and type caps). Scripts must not keep private fetch helpers.
 */
import { extractText, getDocumentProxy } from 'unpdf';
import { ALLOWED_CONTENT_TYPES, SafeFetchError, safeFetch, type SafeFetchOptions, type SafeResponse } from '../net/safe-fetch';
import { pageTextOf } from './ingest';

export interface PageText {
  /** Final URL after redirects. */
  url: string;
  text: string;
  etag: string | null;
  lastModified: string | null;
}

/** Fetches an official page and returns its plain text. Throws SafeFetchError (policy/network) or Error (HTTP status). */
export async function fetchPageText(url: string, options: SafeFetchOptions = {}): Promise<PageText> {
  const res = await safeFetch(url, { acceptTypes: PAGE_TYPES, ...options });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { url: res.url, text: await textOfResponse(res), etag: res.etag, lastModified: res.lastModified };
}

/** HTML, plain text and PDF (for example the State Bank of Pakistan rate sheets). */
export const PAGE_TYPES: readonly string[] = [...ALLOWED_CONTENT_TYPES, 'application/pdf'];

/** Plain text of a fetched page. PDFs: the text layer, whitespace collapsed (no OCR). */
export async function textOfResponse(res: SafeResponse): Promise<string> {
  if (res.raw) {
    const doc = await getDocumentProxy(new Uint8Array(res.raw));
    const { text } = await extractText(doc, { mergePages: true });
    return text.replace(/[ 	]+/g, ' ').trim();
  }
  return pageTextOf(res.body, res.contentType);
}

/** Short, human-readable reason for a failed fetch (used in reports and terminal output). */
export function describeFetchError(e: unknown): string {
  if (e instanceof SafeFetchError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
