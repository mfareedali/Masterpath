/**
 * Host allowlist for the offline ingestion script and link checker (data/ingest.allowlist.json). Pure functions.
 */
import { isIP } from 'node:net';
import allowlistJson from '@data/ingest.allowlist.json';

export const INGEST_ALLOWLIST: readonly string[] = allowlistJson.domains;

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
}

/**
 * True when `hostname` equals an allowlist entry or is a subdomain of one (label boundary: "tum.de" allows
 * "www.tum.de", never "evil-tum.de" or "tum.de.evil.com"). IP literals and non-ASCII (non-punycode) hosts are
 * never allowed.
 */
export function isAllowedHost(hostname: string, allowlist: readonly string[] = INGEST_ALLOWLIST): boolean {
  const h = normalizeHost(hostname);
  if (!h || isIP(h) !== 0) return false;
  if (!/^[a-z0-9.-]+$/.test(h) || h.split('.').some((label) => label === '')) return false;
  return allowlist.some((entry) => {
    const e = normalizeHost(entry).replace(/^\*?\./, '');
    return e !== '' && (h === e || h.endsWith(`.${e}`));
  });
}

/** Host of a URL if it parses and is allowlisted, else null. */
export function allowlistedHostOf(url: string, allowlist: readonly string[] = INGEST_ALLOWLIST): string | null {
  try {
    const host = new URL(url).hostname;
    return isAllowedHost(host, allowlist) ? normalizeHost(host) : null;
  } catch {
    return null;
  }
}
