import { describe, expect, it } from 'vitest';
import type { LookupAddress } from 'node:dns';
import {
  INGEST_ALLOWLIST,
  SafeFetchError,
  decodeBody,
  isAllowedHost,
  pinnedLookup,
  safeFetch,
  validateUrl,
  type RobotsEntry,
  type SafeFetchOptions,
  type Transport,
  type TransportRequest,
} from './safe-fetch';
import { loadSeedDataset } from '../data/seed-source';

const ALLOW = ['fixture.example.edu', 'other.example.org'];

describe('isAllowedHost', () => {
  it('matches exact hosts and subdomains on label boundaries', () => {
    expect(isAllowedHost('fixture.example.edu', ALLOW)).toBe(true);
    expect(isAllowedHost('www.fixture.example.edu', ALLOW)).toBe(true);
    expect(isAllowedHost('a.b.fixture.example.edu', ALLOW)).toBe(true);
    expect(isAllowedHost('FIXTURE.example.EDU.', ALLOW)).toBe(true);
  });
  it('rejects look-alikes', () => {
    expect(isAllowedHost('evil-fixture.example.edu', ALLOW)).toBe(false);
    expect(isAllowedHost('fixture.example.edu.evil.com', ALLOW)).toBe(false);
    expect(isAllowedHost('example.edu', ALLOW)).toBe(false);
    expect(isAllowedHost('xfixture.example.edu', ALLOW)).toBe(false);
  });
  it('rejects IP literals, empty labels and non-ASCII hosts', () => {
    expect(isAllowedHost('127.0.0.1', ['127.0.0.1'])).toBe(false);
    expect(isAllowedHost('[::1]', ['::1'])).toBe(false);
    expect(isAllowedHost('a..fixture.example.edu', ALLOW)).toBe(false);
    expect(isAllowedHost('', ALLOW)).toBe(false);
    expect(isAllowedHost('tüm.de', ['tüm.de'])).toBe(false);
  });
  it('accepts "*." and "." prefixed entries', () => {
    expect(isAllowedHost('www.fixture.example.edu', ['*.fixture.example.edu'])).toBe(true);
    expect(isAllowedHost('www.fixture.example.edu', ['.fixture.example.edu'])).toBe(true);
  });
  it('the shipped allowlist covers every URL in the seed data (every fact source, conflicts included)', () => {
    const ds = loadSeedDataset();
    const urls: string[] = [];
    const isFact = (v: unknown): v is { source_url: string | null; conflicts?: { source_url: string | null }[] } =>
      typeof v === 'object' && v !== null && 'value' in v && 'source_url' in v;
    const addFacts = (row: object) => {
      for (const v of Object.values(row)) {
        if (!isFact(v)) continue;
        if (v.source_url) urls.push(v.source_url);
        for (const c of v.conflicts ?? []) if (c.source_url) urls.push(c.source_url);
      }
    };
    for (const i of ds.institutions) {
      if (i.website) urls.push(i.website);
      addFacts(i);
    }
    for (const p of ds.programs) {
      if (p.official_url) urls.push(p.official_url);
      addFacts(p);
    }
    for (const f of ds.countryFacts) {
      if (f.source_url) urls.push(f.source_url);
      for (const c of f.conflicts ?? []) if (c.source_url) urls.push(c.source_url);
    }
    for (const r of ds.fxRates) addFacts(r);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(isAllowedHost(new URL(u).hostname, INGEST_ALLOWLIST), u).toBe(true);
    expect(isAllowedHost('www.anabin.kmk.org', INGEST_ALLOWLIST)).toBe(true);
    expect(isAllowedHost('www.sbp.org.pk', INGEST_ALLOWLIST)).toBe(true);
  });

  it('the proof-of-funds sources (dhs.gov, diplo.de) are allowed on label boundaries only', () => {
    const ds = loadSeedDataset();
    const fundsHosts = ds.countryFacts.filter((f) => f.key === 'proof_of_funds' && f.source_url).map((f) => new URL(f.source_url!).hostname);
    expect(fundsHosts).toEqual(expect.arrayContaining(['studyinthestates.dhs.gov', 'pakistan.diplo.de']));
    for (const h of fundsHosts) expect(isAllowedHost(h, INGEST_ALLOWLIST), h).toBe(true);
    expect(isAllowedHost('dhs.gov.evil.example.com', INGEST_ALLOWLIST)).toBe(false);
    expect(isAllowedHost('notdhs.gov', INGEST_ALLOWLIST)).toBe(false);
    expect(isAllowedHost('fake-diplo.de', INGEST_ALLOWLIST)).toBe(false);
    expect(isAllowedHost('diplo.de.example.com', INGEST_ALLOWLIST)).toBe(false);
  });
});

describe('validateUrl', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return (e as SafeFetchError).code;
    }
    return 'OK';
  };
  it('enforces https, credentials, ports, IP literals and the allowlist', () => {
    expect(code(() => validateUrl('https://fixture.example.edu/p', { allowlist: ALLOW }))).toBe('OK');
    expect(code(() => validateUrl('http://fixture.example.edu/p', { allowlist: ALLOW }))).toBe('PROTOCOL');
    expect(code(() => validateUrl('http://fixture.example.edu/p', { allowlist: ALLOW, allowHttp: true }))).toBe('OK');
    expect(code(() => validateUrl('ftp://fixture.example.edu/p', { allowlist: ALLOW, allowHttp: true }))).toBe('PROTOCOL');
    expect(code(() => validateUrl('file:///etc/passwd', { allowlist: ALLOW }))).toBe('PROTOCOL');
    expect(code(() => validateUrl('https://user:pw@fixture.example.edu/', { allowlist: ALLOW }))).toBe('CREDENTIALS');
    expect(code(() => validateUrl('https://fixture.example.edu:8443/', { allowlist: ALLOW }))).toBe('BAD_URL');
    expect(code(() => validateUrl('https://127.0.0.1/', { allowlist: ['127.0.0.1'] }))).toBe('HOST_NOT_ALLOWED');
    expect(code(() => validateUrl('https://[::1]/', { allowlist: ALLOW }))).toBe('HOST_NOT_ALLOWED');
    expect(code(() => validateUrl('https://0x7f.1/', { allowlist: ALLOW }))).toBe('HOST_NOT_ALLOWED');
    expect(code(() => validateUrl('https://evil.example.com/', { allowlist: ALLOW }))).toBe('HOST_NOT_ALLOWED');
    expect(code(() => validateUrl('not a url', { allowlist: ALLOW }))).toBe('BAD_URL');
  });
  it('drops the fragment', () => {
    expect(validateUrl('https://fixture.example.edu/p#x', { allowlist: ALLOW }).toString()).toBe('https://fixture.example.edu/p');
  });
});

describe('pinnedLookup', () => {
  const addrs: LookupAddress[] = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ];
  it('returns only the validated addresses, honouring all/family', () => {
    const lookup = pinnedLookup(addrs);
    lookup('ignored.example', { all: true }, (err, result) => {
      expect(err).toBeNull();
      expect(result).toEqual(addrs);
    });
    lookup('ignored.example', { family: 6 }, (err, address, family) => {
      expect(address).toBe(addrs[1].address);
      expect(family).toBe(6);
    });
    lookup('ignored.example', {}, (_err, address) => {
      expect(address).toBe(addrs[0].address);
    });
  });
});

describe('decodeBody', () => {
  it('uses the charset from the content type', () => {
    expect(decodeBody(Buffer.from([0x47, 0x72, 0xfc, 0xdf, 0x65]), 'text/html; charset=ISO-8859-1')).toBe('Grüße');
    expect(decodeBody(Buffer.from('Grüße', 'utf8'), 'text/html')).toBe('Grüße');
    expect(decodeBody(Buffer.from('ok', 'utf8'), 'text/html; charset=bogus-charset')).toBe('ok');
  });
});

/* ---------------- safeFetch with a fake network ---------------- */

interface FakeRoute {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer[];
  /** Never respond (to test timeouts). */
  hang?: boolean;
}

function fakeNetwork(routes: Record<string, FakeRoute>, dns: Record<string, string[]> = {}) {
  const requests: TransportRequest[] = [];
  const transport: Transport = async (req) => {
    requests.push(req);
    const route = routes[req.url.toString()];
    if (!route) return { status: 404, headers: { 'content-type': 'text/plain' }, body: (async function* () {})(), close() {} };
    if (route.hang) {
      return new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    const chunks = typeof route.body === 'string' ? [Buffer.from(route.body)] : (route.body ?? []);
    return {
      status: route.status ?? 200,
      headers: Object.fromEntries(Object.entries(route.headers ?? { 'content-type': 'text/html' }).map(([k, v]) => [k.toLowerCase(), v])),
      body: (async function* () {
        for (const c of chunks) yield c;
      })(),
      close() {},
    };
  };
  const lookup = async (host: string): Promise<LookupAddress[]> => {
    const ips = dns[host] ?? ['93.184.216.34'];
    return ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return { transport, lookup, requests };
}

function opts(net: ReturnType<typeof fakeNetwork>, extra: SafeFetchOptions = {}): SafeFetchOptions {
  return {
    allowlist: ALLOW,
    transport: net.transport,
    lookup: net.lookup,
    robotsCache: new Map<string, RobotsEntry>(),
    ...extra,
  };
}

async function errCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return e instanceof SafeFetchError ? e.code : `UNEXPECTED: ${(e as Error).message}`;
  }
}

const PAGE = 'https://fixture.example.edu/program';

describe('safeFetch', () => {
  it('fetches an allowlisted page, sends the bot user agent and checks robots.txt once per origin', async () => {
    const net = fakeNetwork({
      [PAGE]: { body: '<p>Fixture page</p>' },
      'https://fixture.example.edu/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /private' },
    });
    const o = opts(net);
    const res = await safeFetch(PAGE, o);
    expect(res.ok).toBe(true);
    expect(res.body).toBe('<p>Fixture page</p>');
    await safeFetch(PAGE, o);
    const robotsHits = net.requests.filter((r) => r.url.pathname === '/robots.txt').length;
    expect(robotsHits).toBe(1);
    expect(net.requests[0].headers['user-agent']).toMatch(/^MastersPathIngest\/0\.2 \(open-source evidence bot; /);
  });

  it('sends If-None-Match / If-Modified-Since and reports a 304 as notModified (robots.txt is never conditional)', async () => {
    const net = fakeNetwork({
      [PAGE]: { status: 304, body: '', headers: { etag: '"v2"', 'content-type': 'text/html' } },
      'https://fixture.example.edu/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /' },
    });
    const res = await safeFetch(PAGE, opts(net, { conditional: { etag: '"v1"', lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' } }));
    expect(res.notModified).toBe(true);
    expect(res.ok).toBe(false);
    expect(res.etag).toBe('"v2"');
    const page = net.requests.find((r) => r.url.pathname === '/program')!;
    expect(page.headers['if-none-match']).toBe('"v1"');
    expect(page.headers['if-modified-since']).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
    const robots = net.requests.find((r) => r.url.pathname === '/robots.txt')!;
    expect(robots.headers['if-none-match']).toBeUndefined();
  });

  it('refuses paths disallowed by robots.txt', async () => {
    const net = fakeNetwork({
      'https://fixture.example.edu/private/x': { body: 'secret' },
      'https://fixture.example.edu/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /private' },
    });
    expect(await errCode(safeFetch('https://fixture.example.edu/private/x', opts(net)))).toBe('ROBOTS');
  });

  it('treats a missing robots.txt (4xx) as allow-all and a 5xx as disallow-all', async () => {
    const ok = fakeNetwork({ [PAGE]: { body: 'hi there' } });
    expect((await safeFetch(PAGE, opts(ok))).ok).toBe(true);
    const down = fakeNetwork({ [PAGE]: { body: 'hi' }, 'https://fixture.example.edu/robots.txt': { status: 503, body: '' } });
    expect(await errCode(safeFetch(PAGE, opts(down)))).toBe('ROBOTS');
  });

  it('blocks hosts that resolve to private addresses (any of them)', async () => {
    const net = fakeNetwork({ [PAGE]: { body: 'x' } }, { 'fixture.example.edu': ['93.184.216.34', '10.0.0.5'] });
    expect(await errCode(safeFetch(PAGE, opts(net, { checkRobots: false })))).toBe('PRIVATE_ADDRESS');
    const mapped = fakeNetwork({ [PAGE]: { body: 'x' } }, { 'fixture.example.edu': ['::ffff:169.254.169.254'] });
    expect(await errCode(safeFetch(PAGE, opts(mapped, { checkRobots: false })))).toBe('PRIVATE_ADDRESS');
    expect(net.requests.length).toBe(0);
  });

  it('passes the validated addresses to the transport (connection pinning)', async () => {
    const net = fakeNetwork({ [PAGE]: { body: 'x' } }, { 'fixture.example.edu': ['93.184.216.34'] });
    await safeFetch(PAGE, opts(net, { checkRobots: false }));
    expect(net.requests[0].addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('follows redirects manually and re-validates every hop', async () => {
    const net = fakeNetwork({
      [PAGE]: { status: 301, headers: { location: '/program-new' } },
      'https://fixture.example.edu/program-new': { status: 302, headers: { location: 'https://www.fixture.example.edu/final' } },
      'https://www.fixture.example.edu/final': { body: 'final page' },
    });
    const res = await safeFetch(PAGE, opts(net, { checkRobots: false }));
    expect(res.url).toBe('https://www.fixture.example.edu/final');
    expect(res.redirects).toHaveLength(2);
    expect(res.body).toBe('final page');
  });

  it('refuses redirects to non-allowlisted hosts, http, or private addresses', async () => {
    const offList = fakeNetwork({ [PAGE]: { status: 302, headers: { location: 'https://evil.example.com/' } } });
    expect(await errCode(safeFetch(PAGE, opts(offList, { checkRobots: false })))).toBe('HOST_NOT_ALLOWED');
    const toHttp = fakeNetwork({ [PAGE]: { status: 302, headers: { location: 'http://fixture.example.edu/x' } } });
    expect(await errCode(safeFetch(PAGE, opts(toHttp, { checkRobots: false })))).toBe('PROTOCOL');
    const toMeta = fakeNetwork({ [PAGE]: { status: 307, headers: { location: 'https://169.254.169.254/latest/meta-data' } } });
    expect(await errCode(safeFetch(PAGE, opts(toMeta, { checkRobots: false })))).toBe('HOST_NOT_ALLOWED');
    const rebind = fakeNetwork(
      { [PAGE]: { status: 302, headers: { location: 'https://other.example.org/x' } } },
      { 'other.example.org': ['127.0.0.1'] },
    );
    expect(await errCode(safeFetch(PAGE, opts(rebind, { checkRobots: false })))).toBe('PRIVATE_ADDRESS');
  });

  it('checks robots.txt on the redirect target host', async () => {
    const net = fakeNetwork({
      [PAGE]: { status: 302, headers: { location: 'https://other.example.org/blocked' } },
      'https://other.example.org/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: MastersPathIngest\nDisallow: /' },
    });
    expect(await errCode(safeFetch(PAGE, opts(net)))).toBe('ROBOTS');
  });

  it('stops after 5 redirects', async () => {
    const routes: Record<string, FakeRoute> = {};
    for (let i = 0; i < 7; i++) {
      routes[`https://fixture.example.edu/r${i}`] = { status: 302, headers: { location: `/r${i + 1}` } };
    }
    routes['https://fixture.example.edu/r5'] = { body: 'reached after 5' };
    expect((await safeFetch('https://fixture.example.edu/r0', opts(fakeNetwork(routes), { checkRobots: false }))).body).toBe(
      'reached after 5',
    );
    routes['https://fixture.example.edu/r5'] = { status: 302, headers: { location: '/r6' } };
    expect(await errCode(safeFetch('https://fixture.example.edu/r0', opts(fakeNetwork(routes), { checkRobots: false })))).toBe(
      'TOO_MANY_REDIRECTS',
    );
  });

  it('enforces the content-type allowlist for GET bodies', async () => {
    const pdf = fakeNetwork({ [PAGE]: { headers: { 'content-type': 'application/pdf' }, body: '%PDF' } });
    expect(await errCode(safeFetch(PAGE, opts(pdf, { checkRobots: false })))).toBe('CONTENT_TYPE');
    const none = fakeNetwork({ [PAGE]: { headers: {}, body: 'x' } });
    expect(await errCode(safeFetch(PAGE, opts(none, { checkRobots: false })))).toBe('CONTENT_TYPE');
    const xhtml = fakeNetwork({ [PAGE]: { headers: { 'content-type': 'application/xhtml+xml; charset=utf-8' }, body: 'x' } });
    expect(await errCode(safeFetch(PAGE, opts(xhtml, { checkRobots: false })))).toBe('OK');
  });

  it('caps the body size (declared and streamed)', async () => {
    const declared = fakeNetwork({ [PAGE]: { headers: { 'content-type': 'text/html', 'content-length': '999999' }, body: 'x' } });
    expect(await errCode(safeFetch(PAGE, opts(declared, { checkRobots: false, maxBytes: 1000 })))).toBe('TOO_LARGE');
    const streamed = fakeNetwork({ [PAGE]: { body: [Buffer.alloc(600), Buffer.alloc(600)] } });
    expect(await errCode(safeFetch(PAGE, opts(streamed, { checkRobots: false, maxBytes: 1000 })))).toBe('TOO_LARGE');
  });

  it('times out', async () => {
    const net = fakeNetwork({ [PAGE]: { hang: true } });
    expect(await errCode(safeFetch(PAGE, opts(net, { checkRobots: false, timeoutMs: 30 })))).toBe('TIMEOUT');
  });

  it('returns non-2xx statuses without reading the body, and supports HEAD', async () => {
    const net = fakeNetwork({ [PAGE]: { status: 410, body: 'gone' } });
    const res = await safeFetch(PAGE, opts(net, { checkRobots: false }));
    expect(res).toMatchObject({ ok: false, status: 410, body: '' });
    const head = fakeNetwork({ [PAGE]: { headers: { 'content-type': 'application/pdf' } } });
    const h = await safeFetch(PAGE, opts(head, { checkRobots: false, method: 'HEAD' }));
    expect(h.ok).toBe(true);
    expect(head.requests[0].method).toBe('HEAD');
  });

  it('rejects unsafe URLs before any network access', async () => {
    const net = fakeNetwork({});
    expect(await errCode(safeFetch('https://localhost/', opts(net)))).toBe('HOST_NOT_ALLOWED');
    expect(await errCode(safeFetch('http://fixture.example.edu/', opts(net)))).toBe('PROTOCOL');
    expect(net.requests.length).toBe(0);
  });
});
