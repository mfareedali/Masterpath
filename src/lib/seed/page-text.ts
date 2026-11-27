/**
 * The one way scripts turn an official URL into page text: through safeFetch (https, allowlisted host, public IPs,
 * robots.txt, per-host throttle, size and type caps). Scripts must not keep private fetch helpers.
 */
import { SafeFetchError, safeFetch, type SafeFetchOptions } from '../net/safe-fetch';
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
  const res = await safeFetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { url: res.url, text: pageTextOf(res.body, res.contentType), etag: res.etag, lastModified: res.lastModified };
}

/** Short, human-readable reason for a failed fetch (used in reports and terminal output). */
export function describeFetchError(e: unknown): string {
  if (e instanceof SafeFetchError) return `${e.code}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}
