/**
 * The one way scripts turn an official URL into page text: through safeFetch (https, allowlisted host, public IPs,
 * robots.txt, per-host throttle, size and type caps). Scripts must not keep private fetch helpers.
 */
import { extractText, getDocumentProxy } from 'unpdf';
import { ALLOWED_CONTENT_TYPES, SafeFetchError, safeFetch, type SafeFetchOptions, type SafeResponse } from '../net/safe-fetch';
import { MIN_STATIC_TEXT_CHARS, renderFetch } from '../net/render-fetch';
import { pageTextOf } from './ingest';

export interface PageText {
  /** Final URL after redirects. */
  url: string;
  text: string;
  etag: string | null;
  lastModified: string | null;
  method?: FetchMethod;
}

export type FetchMethod = 'static' | 'render';

export interface FetchPageOptions {
  /** 'static' = safeFetch only; 'render' = renderFetch only; 'auto' (default) = static, then render when the text is under 200 characters (MIN_STATIC_TEXT_CHARS). */
  fetchMethod?: FetchMethod | 'auto';
  /** The source registry's "render": true. */
  render?: boolean;
  conditional?: SafeFetchOptions['conditional'];
}

export interface FetchedPage {
  res: SafeResponse;
  text: string;
  /** How the text was produced. Re-verification must use the same method. */
  method: FetchMethod;
  /** Why the render fallback was not used (browser missing, ...); the static result is returned instead. */
  renderNote?: string;
}

/**
 * The one entry point for page text: safeFetch first; renderFetch (Playwright) only as a fallback when the static page
 * has almost no text, or when the registry says "render": true. A bot challenge is reported, never worked around.
 */
export async function fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchedPage> {
  let want = options.render ? 'render' : (options.fetchMethod ?? 'auto');
  // INGEST_RENDER=0 turns the automatic fallback off (a machine without Chromium). Explicit render requests still render.
  if (want === 'auto' && process.env.INGEST_RENDER === '0') want = 'static';
  if (want === 'render') {
    const res = await renderFetch(url);
    return { res, text: res.body, method: 'render' };
  }
  const res = await safeFetch(url, { acceptTypes: PAGE_TYPES, conditional: options.conditional });
  if (res.notModified || !res.ok) return { res, text: '', method: 'static' };
  const text = await textOfResponse(res);
  const html = !res.raw;
  if (want === 'auto' && html && text.length < MIN_STATIC_TEXT_CHARS) {
    try {
      const rendered = await renderFetch(url);
      if (rendered.ok && rendered.body.length > text.length) return { res: rendered, text: rendered.body, method: 'render' };
    } catch (e) {
      if (e instanceof SafeFetchError && (e.code === 'BLOCKED_BY_CHALLENGE' || e.code === 'ROBOTS')) throw e;
      return { res, text, method: 'static', renderNote: describeFetchError(e) };
    }
  }
  return { res, text, method: 'static' };
}

/** Fetches an official page and returns its plain text. Throws SafeFetchError (policy/network) or Error (HTTP status). */
export async function fetchPageText(url: string, options: SafeFetchOptions & FetchPageOptions = {}): Promise<PageText> {
  const { fetchMethod, render, ...safe } = options;
  if (fetchMethod === undefined && !render && Object.keys(safe).length > 0) {
    const res = await safeFetch(url, { acceptTypes: PAGE_TYPES, ...safe });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { url: res.url, text: await textOfResponse(res), etag: res.etag, lastModified: res.lastModified, method: 'static' };
  }
  const f = await fetchPage(url, { fetchMethod, render });
  if (!f.res.ok) throw new Error(`HTTP ${f.res.status}`);
  return { url: f.res.url, text: f.text, etag: f.res.etag, lastModified: f.res.lastModified, method: f.method };
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
