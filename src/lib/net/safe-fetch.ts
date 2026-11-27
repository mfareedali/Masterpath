/**
 * SSRF-safe fetch for OFFLINE scripts (ingestion, link checker). Never used by the app at request time.
 *
 *  - https only (http only when `allowHttp` is set, for tests); default ports only; no credentials in URLs;
 *    no IP-literal hosts
 *  - the host must be on the allowlist (data/ingest.allowlist.json), suffix match on label boundaries
 *  - DNS is resolved once (all addresses); ANY private / loopback / link-local / CGNAT / multicast / unspecified /
 *    ULA / IPv4-mapped address blocks the request; the connection is then PINNED to the checked addresses
 *    (custom `lookup`), so a second DNS answer cannot rebind it to an internal address
 *  - redirects are followed manually (max 5) and every hop is re-validated (URL, allowlist, DNS, robots.txt)
 *  - 10 s timeout per hop, 3 MB body cap (counted after decompression), content-type allowlist
 *  - robots.txt is fetched once per origin and honoured for our user agent and "*"
 */
import * as http from 'node:http';
import * as https from 'node:https';
import * as zlib from 'node:zlib';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP, type LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import { INGEST_ALLOWLIST, isAllowedHost, normalizeHost } from './hosts';
import { isPrivateIp } from './ip';
import { robotsAllows } from './robots';
import { defaultThrottle, noThrottle, type Throttle } from './throttle';

export { isPrivateIp } from './ip';
export { INGEST_ALLOWLIST, isAllowedHost, normalizeHost } from './hosts';
export { robotsAllows, parseRobots } from './robots';

/**
 * User agent with a contact URL, so a site owner can find out who is fetching and ask us to stop.
 * The URL comes from INGEST_CONTACT_URL (or NEXT_PUBLIC_REPO_URL); it is never invented.
 */
export function buildUserAgent(env: Record<string, string | undefined> = process.env): string {
  const contact = (env.INGEST_CONTACT_URL ?? env.NEXT_PUBLIC_REPO_URL ?? '').trim();
  const valid = /^https:\/\/[^\s()]+$/.test(contact) ? contact : null;
  return valid
    ? `MastersPathIngest/0.2 (open-source evidence bot; +${valid})`
    : 'MastersPathIngest/0.2 (open-source evidence bot; contact URL not configured: set INGEST_CONTACT_URL)';
}

export const USER_AGENT = buildUserAgent();
export const ROBOTS_PRODUCT_TOKEN = 'MastersPathIngest';
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 3 * 1024 * 1024;
export const ROBOTS_MAX_BYTES = 512 * 1024;
export const MAX_REDIRECTS = 5;
export const ALLOWED_CONTENT_TYPES: readonly string[] = ['text/html', 'text/plain', 'application/xhtml+xml'];

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type SafeFetchErrorCode =
  | 'BAD_URL'
  | 'PROTOCOL'
  | 'CREDENTIALS'
  | 'HOST_NOT_ALLOWED'
  | 'DNS'
  | 'PRIVATE_ADDRESS'
  | 'TOO_MANY_REDIRECTS'
  | 'BAD_REDIRECT'
  | 'TIMEOUT'
  | 'TOO_LARGE'
  | 'CONTENT_TYPE'
  | 'ROBOTS'
  | 'NETWORK';

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly url: string | undefined;
  constructor(code: SafeFetchErrorCode, message: string, url?: string) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
    this.url = url;
  }
}

/** Errors caused by our own safety policy (as opposed to the remote server or the network). */
export const POLICY_ERROR_CODES: ReadonlySet<SafeFetchErrorCode> = new Set<SafeFetchErrorCode>([
  'BAD_URL',
  'PROTOCOL',
  'CREDENTIALS',
  'HOST_NOT_ALLOWED',
  'PRIVATE_ADDRESS',
  'ROBOTS',
]);

export type LookupAllFn = (hostname: string) => Promise<LookupAddress[]>;

export interface TransportRequest {
  url: URL;
  method: 'GET' | 'HEAD';
  headers: Record<string, string>;
  /** Pre-validated addresses the connection must use. */
  addresses: LookupAddress[];
  signal: AbortSignal;
}

export interface TransportResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** Decompressed body. */
  body: AsyncIterable<Uint8Array>;
  close(): void;
}

export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

export type RobotsEntry =
  | { kind: 'rules'; txt: string }
  | { kind: 'allow-all'; reason: string }
  | { kind: 'disallow-all'; reason: string };

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  allowlist?: readonly string[];
  /** Tests only: also allow http:// and non-default ports. */
  allowHttp?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Media types accepted for a GET body; 'any' skips the check. */
  acceptTypes?: readonly string[] | 'any';
  /** false = do not download the body (link checker). */
  readBody?: boolean;
  checkRobots?: boolean;
  robotsCache?: Map<string, RobotsEntry>;
  lookup?: LookupAllFn;
  transport?: Transport;
  userAgent?: string;
  /** Per-host request spacing. Default: 1 request per 1.5 s per host (none when a test injects its own transport). */
  throttle?: Throttle;
  /** Validators from an earlier fetch: sent as If-None-Match / If-Modified-Since. A 304 sets `notModified`. */
  conditional?: { etag?: string | null; lastModified?: string | null };
}

export interface SafeResponse {
  requestedUrl: string;
  /** Final URL after redirects. */
  url: string;
  status: number;
  ok: boolean;
  contentType: string | null;
  body: string;
  /** The undecoded bytes, kept only for application/pdf (text extraction happens in page-text.ts). */
  raw?: Uint8Array;
  bytes: number;
  redirects: string[];
  /** HTTP 304 for a conditional request: the page has not changed since the validators were issued. */
  notModified: boolean;
  /** Validators the server sent (use them for the next conditional request). */
  etag: string | null;
  lastModified: string | null;
}

/* ---------------- pure helpers ---------------- */

/** Validates a URL against the fetch policy and returns it parsed (fragment removed). Throws SafeFetchError. */
export function validateUrl(raw: string, opts: { allowlist?: readonly string[]; allowHttp?: boolean } = {}): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SafeFetchError('BAD_URL', `Not a valid URL: ${raw}`, raw);
  }
  const allowHttp = opts.allowHttp ?? false;
  if (!(u.protocol === 'https:' || (allowHttp && u.protocol === 'http:'))) {
    throw new SafeFetchError('PROTOCOL', `Only https URLs are allowed: ${raw}`, raw);
  }
  if (u.username || u.password) throw new SafeFetchError('CREDENTIALS', 'URLs with credentials are not allowed', raw);
  if (u.port && !allowHttp) throw new SafeFetchError('BAD_URL', `Non-default ports are not allowed: ${raw}`, raw);
  const host = normalizeHost(u.hostname);
  if (isIP(host) !== 0) throw new SafeFetchError('HOST_NOT_ALLOWED', `IP addresses are not allowed; use the official domain: ${raw}`, raw);
  if (!isAllowedHost(host, opts.allowlist ?? INGEST_ALLOWLIST)) {
    throw new SafeFetchError('HOST_NOT_ALLOWED', `Host ${host} is not on data/ingest.allowlist.json`, raw);
  }
  u.hash = '';
  return u;
}

/** Resolves every address of `hostname` and refuses if ANY of them is private. */
export async function resolvePublicAddresses(hostname: string, lookup: LookupAllFn): Promise<LookupAddress[]> {
  let addresses: LookupAddress[];
  try {
    addresses = await lookup(hostname);
  } catch (e) {
    throw new SafeFetchError('DNS', `DNS lookup failed for ${hostname}: ${(e as Error).message}`);
  }
  if (!addresses.length) throw new SafeFetchError('DNS', `No addresses for ${hostname}`);
  const bad = addresses.find((a) => isPrivateIp(a.address));
  if (bad) throw new SafeFetchError('PRIVATE_ADDRESS', `${hostname} resolves to a non-public address (${bad.address})`);
  return addresses;
}

/** A `lookup` for http(s).request that only ever returns the pre-validated addresses. */
export function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const raw = typeof options === 'object' && options ? options.family : undefined;
    const family = raw === 'IPv4' ? 4 : raw === 'IPv6' ? 6 : raw;
    const wanted = family === 4 || family === 6 ? addresses.filter((a) => a.family === family) : addresses;
    if (!wanted.length) {
      callback(Object.assign(new Error('No validated address for the requested family'), { code: 'ENOTFOUND' }), '', 0);
      return;
    }
    if (typeof options === 'object' && options && options.all) callback(null, wanted);
    else callback(null, wanted[0].address, wanted[0].family);
  };
}

export function headerValue(headers: TransportResponse['headers'], name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

export function mediaTypeOf(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const t = contentType.split(';')[0].trim().toLowerCase();
  return t || null;
}

export function decodeBody(buf: Uint8Array, contentType: string | null): string {
  const label = /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType ?? '')?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/* ---------------- I/O ---------------- */

const defaultLookup: LookupAllFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

function decompress(res: http.IncomingMessage): Readable {
  const enc = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

/** Node http(s) transport with the connection pinned to the validated addresses. TLS verification stays on. */
export const nodeTransport: Transport = (req) =>
  new Promise((resolve, reject) => {
    const mod = req.url.protocol === 'https:' ? https : http;
    const r = mod.request(
      req.url,
      { method: req.method, headers: req.headers, lookup: pinnedLookup(req.addresses), signal: req.signal, agent: false },
      (res) => {
        const body = req.method === 'HEAD' ? res : decompress(res);
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body,
          close: () => {
            body.destroy();
            res.destroy();
          },
        });
      },
    );
    r.on('error', reject);
    r.end();
  });

const DEFAULT_ROBOTS_CACHE = new Map<string, RobotsEntry>();

export function clearRobotsCache(): void {
  DEFAULT_ROBOTS_CACHE.clear();
}

type Resolved = Required<Omit<SafeFetchOptions, 'acceptTypes' | 'conditional'>> & {
  acceptTypes: readonly string[] | 'any';
  conditional: SafeFetchOptions['conditional'];
};

function resolveOptions(o: SafeFetchOptions): Resolved {
  return {
    method: o.method ?? 'GET',
    allowlist: o.allowlist ?? INGEST_ALLOWLIST,
    allowHttp: o.allowHttp ?? false,
    timeoutMs: o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: o.maxBytes ?? DEFAULT_MAX_BYTES,
    maxRedirects: o.maxRedirects ?? MAX_REDIRECTS,
    acceptTypes: o.acceptTypes ?? ALLOWED_CONTENT_TYPES,
    readBody: o.readBody ?? true,
    checkRobots: o.checkRobots ?? true,
    robotsCache: o.robotsCache ?? DEFAULT_ROBOTS_CACHE,
    lookup: o.lookup ?? defaultLookup,
    transport: o.transport ?? nodeTransport,
    userAgent: o.userAgent ?? USER_AGENT,
    // Tests inject a fake transport and must not wait; real fetches always share the polite default.
    throttle: o.throttle ?? (o.transport ? noThrottle : defaultThrottle),
    conditional: o.conditional,
  };
}

function timeoutError(url: URL, ms: number): SafeFetchError {
  return new SafeFetchError('TIMEOUT', `Timed out after ${ms} ms: ${url}`, url.toString());
}

async function readCapped(res: TransportResponse, maxBytes: number, signal: AbortSignal, url: URL, ms: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const it = res.body[Symbol.asyncIterator]();
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(timeoutError(url, ms));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => {});
  try {
    for (;;) {
      const r = await Promise.race([it.next(), aborted]);
      if (r.done) break;
      const buf = Buffer.from(r.value);
      total += buf.length;
      if (total > maxBytes) throw new SafeFetchError('TOO_LARGE', `Body is larger than ${maxBytes} bytes: ${url}`, url.toString());
      chunks.push(buf);
    }
  } catch (e) {
    res.close();
    if (e instanceof SafeFetchError) throw e;
    if (signal.aborted) throw timeoutError(url, ms);
    throw new SafeFetchError('NETWORK', `Failed reading ${url}: ${(e as Error).message}`, url.toString());
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
  return Buffer.concat(chunks);
}

async function requestOnce(url: URL, method: 'GET' | 'HEAD', o: Resolved, signal: AbortSignal): Promise<TransportResponse> {
  const addresses = await resolvePublicAddresses(normalizeHost(url.hostname), o.lookup);
  const headers: Record<string, string> = {
    'user-agent': o.userAgent,
    accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
    'accept-language': 'en',
    'accept-encoding': 'gzip, br',
  };
  if (method === 'GET' && o.conditional?.etag) headers['if-none-match'] = o.conditional.etag;
  if (method === 'GET' && o.conditional?.lastModified) headers['if-modified-since'] = o.conditional.lastModified;
  await o.throttle.wait(normalizeHost(url.hostname));
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(timeoutError(url, o.timeoutMs));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  aborted.catch(() => {});
  try {
    return await Promise.race([o.transport({ url, method, headers, addresses, signal }), aborted]);
  } catch (e) {
    if (e instanceof SafeFetchError) throw e;
    if (signal.aborted) throw timeoutError(url, o.timeoutMs);
    throw new SafeFetchError('NETWORK', `Request to ${url.host} failed: ${(e as Error).message}`, url.toString());
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function loadRobots(url: URL, o: Resolved): Promise<RobotsEntry> {
  const robotsUrl = new URL('/robots.txt', url.origin).toString();
  try {
    const r = await safeFetch(robotsUrl, {
      ...o,
      method: 'GET',
      checkRobots: false,
      acceptTypes: 'any',
      readBody: true,
      conditional: undefined,
      maxBytes: ROBOTS_MAX_BYTES,
    });
    if (r.ok) return { kind: 'rules', txt: r.body };
    // RFC 9309: 4xx = no restrictions; 5xx = assume complete disallow.
    if (r.status >= 400 && r.status < 500) return { kind: 'allow-all', reason: `robots.txt HTTP ${r.status}` };
    return { kind: 'disallow-all', reason: `robots.txt HTTP ${r.status}` };
  } catch (e) {
    return { kind: 'disallow-all', reason: `robots.txt unreachable: ${(e as Error).message}` };
  }
}

async function assertRobotsAllow(url: URL, o: Resolved): Promise<void> {
  let entry = o.robotsCache.get(url.origin);
  if (!entry) {
    entry = await loadRobots(url, o);
    o.robotsCache.set(url.origin, entry);
  }
  if (entry.kind === 'disallow-all') {
    throw new SafeFetchError('ROBOTS', `Not fetching ${url}: ${entry.reason}`, url.toString());
  }
  if (entry.kind === 'rules' && !robotsAllows(entry.txt, url.pathname + url.search, ROBOTS_PRODUCT_TOKEN)) {
    throw new SafeFetchError('ROBOTS', `robots.txt disallows ${url.pathname} for ${ROBOTS_PRODUCT_TOKEN}`, url.toString());
  }
}

/** Fetches an allowlisted official page under the safety policy above. Throws SafeFetchError. */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeResponse> {
  const o = resolveOptions(options);
  let url = validateUrl(rawUrl, o);
  let method = o.method;
  const redirects: string[] = [];

  for (let hop = 0; ; hop++) {
    if (o.checkRobots) await assertRobotsAllow(url, o);
    const signal = AbortSignal.timeout(o.timeoutMs);
    const res = await requestOnce(url, method, o, signal);
    const location = headerValue(res.headers, 'location');

    if (REDIRECT_STATUSES.has(res.status) && location) {
      res.close();
      if (hop >= o.maxRedirects) {
        throw new SafeFetchError('TOO_MANY_REDIRECTS', `More than ${o.maxRedirects} redirects from ${rawUrl}`, rawUrl);
      }
      let next: string;
      try {
        next = new URL(location, url).toString();
      } catch {
        throw new SafeFetchError('BAD_REDIRECT', `Invalid redirect target "${location}"`, url.toString());
      }
      url = validateUrl(next, o);
      if (res.status === 303 && method !== 'HEAD') method = 'GET';
      redirects.push(url.toString());
      continue;
    }

    const contentType = headerValue(res.headers, 'content-type') ?? null;
    const ok = res.status >= 200 && res.status < 300;
    const base = {
      requestedUrl: rawUrl,
      url: url.toString(),
      status: res.status,
      ok,
      contentType,
      redirects,
      notModified: res.status === 304,
      etag: headerValue(res.headers, 'etag') ?? null,
      lastModified: headerValue(res.headers, 'last-modified') ?? null,
    };
    if (method === 'HEAD' || !ok || !o.readBody) {
      res.close();
      return { ...base, body: '', bytes: 0 };
    }
    const media = mediaTypeOf(contentType);
    if (o.acceptTypes !== 'any' && (!media || !o.acceptTypes.includes(media))) {
      res.close();
      throw new SafeFetchError('CONTENT_TYPE', `Content type ${media ?? '(none)'} is not allowed: ${url}`, url.toString());
    }
    const declared = Number(headerValue(res.headers, 'content-length'));
    if (Number.isFinite(declared) && declared > o.maxBytes) {
      res.close();
      throw new SafeFetchError('TOO_LARGE', `Body is larger than ${o.maxBytes} bytes: ${url}`, url.toString());
    }
    const buf = await readCapped(res, o.maxBytes, signal, url, o.timeoutMs);
    return { ...base, body: media === 'application/pdf' ? '' : decodeBody(buf, contentType), ...(media === 'application/pdf' ? { raw: buf } : {}), bytes: buf.length };
  }
}
