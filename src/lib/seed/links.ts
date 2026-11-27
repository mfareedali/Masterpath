/**
 * Link checker core (used by scripts/check-links.ts). Collects every official_url / website / source_url in the seed
 * and checks each one through safeFetch (HEAD first, GET fallback). Hosts that are not on the allowlist are never
 * fetched; they are reported as warnings so a human can confirm the domain is official.
 */
import { INGEST_ALLOWLIST, isAllowedHost } from '../net/hosts';
import { SafeFetchError, safeFetch, type SafeFetchOptions, type SafeResponse } from '../net/safe-fetch';

export type LinkKind = 'official_url' | 'website' | 'source_url';

export interface SeedLink {
  url: string;
  kinds: LinkKind[];
  /** Where the URL is used, e.g. "programs.seed.json /programs/3/deadline/source_url". */
  refs: string[];
}

export type LinkStatus = 'ok' | 'redirected' | 'broken' | 'warning';

export interface LinkResult {
  url: string;
  status: LinkStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  note: string;
  refs: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every URL in the four seed files, de-duplicated, in first-seen order. */
export function collectSeedLinks(files: Record<string, unknown>): SeedLink[] {
  const byUrl = new Map<string, SeedLink>();
  const add = (url: unknown, kind: LinkKind, ref: string) => {
    if (typeof url !== 'string' || url.trim() === '') return;
    const link = byUrl.get(url) ?? { url, kinds: [], refs: [] };
    if (!link.kinds.includes(kind)) link.kinds.push(kind);
    link.refs.push(ref);
    byUrl.set(url, link);
  };
  const walk = (node: unknown, file: string, pointer: string) => {
    if (Array.isArray(node)) {
      node.forEach((x, i) => walk(x, file, `${pointer}/${i}`));
      return;
    }
    if (!isObj(node)) return;
    for (const [k, v] of Object.entries(node)) {
      const here = `${pointer}/${k}`;
      if (k === 'official_url' || k === 'website' || k === 'source_url') add(v, k, `${file} ${here}`);
      else walk(v, file, here);
    }
  };
  for (const [file, data] of Object.entries(files)) walk(data, file, '');
  return [...byUrl.values()];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** HTTP statuses where a server rejects HEAD (or bots) but the page may still be fine with GET. */
const RETRY_WITH_GET = new Set([400, 403, 404, 405, 406, 429, 500, 501, 502, 503]);

function classify(link: SeedLink, res: SafeResponse, method: 'HEAD' | 'GET'): LinkResult {
  const base = { url: link.url, httpStatus: res.status, finalUrl: res.url, refs: link.refs };
  if (res.ok) {
    if (res.redirects.length) return { ...base, status: 'redirected', note: `redirects to ${res.url} (update the seed?)` };
    return { ...base, status: 'ok', note: method === 'GET' ? 'ok (GET)' : 'ok' };
  }
  if (res.status === 401 || res.status === 403 || res.status === 429) {
    return { ...base, status: 'warning', note: `HTTP ${res.status}: the site blocks bots; check it in a browser` };
  }
  return { ...base, status: 'broken', note: `HTTP ${res.status}` };
}

/** Checks one link. `options` is passed to safeFetch (tests inject a fake transport and DNS). */
export async function checkLink(link: SeedLink, options: SafeFetchOptions = {}): Promise<LinkResult> {
  const allowlist = options.allowlist ?? INGEST_ALLOWLIST;
  const host = hostOf(link.url);
  const base = { url: link.url, httpStatus: null, finalUrl: null, refs: link.refs };
  if (host === null) return { ...base, status: 'broken', note: 'not a valid URL' };
  if (!isAllowedHost(host, allowlist)) {
    return { ...base, status: 'warning', note: `${host} is not on data/ingest.allowlist.json (not fetched)` };
  }
  const common: SafeFetchOptions = { ...options, allowlist, readBody: false, acceptTypes: 'any' };
  try {
    const head = await safeFetch(link.url, { ...common, method: 'HEAD' });
    if (head.ok || !RETRY_WITH_GET.has(head.status)) return classify(link, head, 'HEAD');
  } catch (e) {
    // Policy refusals (robots.txt, private address, redirect off the allowlist) will not change with GET.
    if (e instanceof SafeFetchError && ['ROBOTS', 'PRIVATE_ADDRESS', 'HOST_NOT_ALLOWED', 'PROTOCOL', 'CREDENTIALS', 'BAD_URL'].includes(e.code)) {
      return errorResult(link, e);
    }
  }
  try {
    return classify(link, await safeFetch(link.url, { ...common, method: 'GET' }), 'GET');
  } catch (e) {
    return errorResult(link, e);
  }
}

function errorResult(link: SeedLink, e: unknown): LinkResult {
  const base = { url: link.url, httpStatus: null, finalUrl: null, refs: link.refs };
  if (e instanceof SafeFetchError) {
    if (e.code === 'ROBOTS') return { ...base, status: 'warning', note: `robots.txt: ${e.message}` };
    if (e.code === 'HOST_NOT_ALLOWED') return { ...base, status: 'warning', note: e.message };
    return { ...base, status: 'broken', note: `${e.code}: ${e.message}` };
  }
  return { ...base, status: 'broken', note: e instanceof Error ? e.message : String(e) };
}

/**
 * Runs checks across hosts in parallel but never more than ONE request at a time per host (the per-host throttle in
 * safeFetch also spaces them 1.5 s apart). Preserves input order.
 */
export async function checkLinks(
  links: readonly SeedLink[],
  options: SafeFetchOptions & { concurrency?: number } = {},
): Promise<LinkResult[]> {
  const { concurrency = 4, ...fetchOptions } = options;
  const results: LinkResult[] = new Array(links.length);
  const byHost = new Map<string, number[]>();
  links.forEach((l, i) => {
    const key = (hostOf(l.url) ?? '').toLowerCase();
    byHost.set(key, [...(byHost.get(key) ?? []), i]);
  });
  const queues = [...byHost.values()];
  let next = 0;
  const worker = async () => {
    while (next < queues.length) {
      const queue = queues[next++];
      for (const i of queue) results[i] = await checkLink(links[i], fetchOptions);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queues.length)) }, worker));
  return results;
}

/** Plain-text table for the terminal. */
export function formatLinkTable(results: readonly LinkResult[]): string {
  const rows = results.map((r) => [r.status.toUpperCase(), r.httpStatus === null ? '-' : String(r.httpStatus), r.url, r.note]);
  const header = ['STATUS', 'HTTP', 'URL', 'NOTE'];
  const widths = [0, 1, 2].map((c) => Math.min(c === 2 ? 70 : 12, Math.max(header[c].length, ...rows.map((r) => r[c].length))));
  const line = (cells: string[]) => cells.map((cell, c) => (c < 3 ? cell.padEnd(widths[c]) : cell)).join('  ');
  const counts = (s: LinkStatus) => results.filter((r) => r.status === s).length;
  return [
    line(header),
    line(widths.map((w) => '-'.repeat(w)).concat('----')),
    ...rows.map(line),
    '',
    `${results.length} link(s): ${counts('ok')} ok, ${counts('redirected')} redirected, ${counts('warning')} warning(s), ${counts('broken')} broken.`,
  ].join('\n');
}
