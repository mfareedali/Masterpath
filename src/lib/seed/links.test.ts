import { describe, expect, it } from 'vitest';
import type { LookupAddress } from 'node:dns';
import programsSeed from '@data/programs.seed.json';
import countryFactsSeed from '@data/country_facts.seed.json';
import type { RobotsEntry, SafeFetchOptions, Transport, TransportRequest } from '../net/safe-fetch';
import { checkLink, checkLinks, collectSeedLinks, formatLinkTable, type SeedLink } from './links';

const ALLOW = ['fixture.example.edu'];

interface Route {
  status: number;
  headers?: Record<string, string>;
}

/** Fake network keyed by "METHOD url". Unknown routes return 404. */
function fakeNet(routes: Record<string, Route>, dns: Record<string, string[]> = {}) {
  const requests: TransportRequest[] = [];
  const transport: Transport = async (req) => {
    requests.push(req);
    const r = routes[`${req.method} ${req.url.toString()}`] ?? { status: 404 };
    return {
      status: r.status,
      headers: { 'content-type': 'text/html', ...(r.headers ?? {}) },
      body: (async function* () {})(),
      close() {},
    };
  };
  const lookup = async (host: string): Promise<LookupAddress[]> =>
    (dns[host] ?? ['93.184.216.34']).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  const options: SafeFetchOptions = {
    allowlist: ALLOW,
    transport,
    lookup,
    robotsCache: new Map<string, RobotsEntry>([['https://fixture.example.edu', { kind: 'allow-all', reason: 'test' }]]),
  };
  return { requests, options };
}

const link = (url: string): SeedLink => ({ url, kinds: ['official_url'], refs: ['programs.seed.json /programs/0/official_url'] });

describe('collectSeedLinks', () => {
  it('finds official_url, website and source_url anywhere, including conflicts, de-duplicated', () => {
    const links = collectSeedLinks({
      'programs.seed.json': {
        institutions: [{ website: 'https://fixture.example.edu' }],
        programs: [
          {
            official_url: 'https://fixture.example.edu/p',
            deadline: {
              source_url: 'https://fixture.example.edu/p',
              conflicts: [{ source_url: 'https://fixture.example.edu/other' }],
            },
            intake: { source_url: null },
          },
        ],
      },
    });
    expect(links.map((l) => l.url)).toEqual([
      'https://fixture.example.edu',
      'https://fixture.example.edu/p',
      'https://fixture.example.edu/other',
    ]);
    expect(links[1].kinds).toEqual(['official_url', 'source_url']);
    expect(links[1].refs).toEqual([
      'programs.seed.json /programs/0/official_url',
      'programs.seed.json /programs/0/deadline/source_url',
    ]);
  });

  it('collects the URLs of the real seed files', () => {
    const links = collectSeedLinks({ 'programs.seed.json': programsSeed, 'country_facts.seed.json': countryFactsSeed });
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.url.startsWith('https://'))).toBe(true);
  });
});

describe('checkLink', () => {
  it('reports ok after a successful HEAD and never downloads a body', async () => {
    const net = fakeNet({ 'HEAD https://fixture.example.edu/p': { status: 200 } });
    const r = await checkLink(link('https://fixture.example.edu/p'), net.options);
    expect(r).toMatchObject({ status: 'ok', httpStatus: 200, note: 'ok' });
    expect(net.requests.map((q) => q.method)).toEqual(['HEAD']);
  });

  it('falls back to GET when HEAD is rejected', async () => {
    const net = fakeNet({
      'HEAD https://fixture.example.edu/p': { status: 405 },
      'GET https://fixture.example.edu/p': { status: 200, headers: { 'content-type': 'application/pdf' } },
    });
    const r = await checkLink(link('https://fixture.example.edu/p'), net.options);
    expect(r).toMatchObject({ status: 'ok', httpStatus: 200, note: 'ok (GET)' });
    expect(net.requests.map((q) => q.method)).toEqual(['HEAD', 'GET']);
  });

  it('reports broken links and bot blocks', async () => {
    const net = fakeNet({
      'HEAD https://fixture.example.edu/gone': { status: 410 },
      'HEAD https://fixture.example.edu/blocked': { status: 403 },
      'GET https://fixture.example.edu/blocked': { status: 403 },
    });
    expect(await checkLink(link('https://fixture.example.edu/gone'), net.options)).toMatchObject({ status: 'broken', note: 'HTTP 410' });
    expect(await checkLink(link('https://fixture.example.edu/missing'), net.options)).toMatchObject({ status: 'broken', httpStatus: 404 });
    expect(await checkLink(link('https://fixture.example.edu/blocked'), net.options)).toMatchObject({ status: 'warning', httpStatus: 403 });
  });

  it('reports redirects with the final URL', async () => {
    const net = fakeNet({
      'HEAD https://fixture.example.edu/old': { status: 301, headers: { location: '/new' } },
      'HEAD https://fixture.example.edu/new': { status: 200 },
    });
    expect(await checkLink(link('https://fixture.example.edu/old'), net.options)).toMatchObject({
      status: 'redirected',
      finalUrl: 'https://fixture.example.edu/new',
    });
  });

  it('never fetches hosts outside the allowlist (warning only)', async () => {
    const net = fakeNet({});
    const r = await checkLink(link('https://blog.example.com/post'), net.options);
    expect(r).toMatchObject({ status: 'warning' });
    expect(r.note).toMatch(/not on data\/ingest\.allowlist\.json/);
    expect(net.requests).toHaveLength(0);
  });

  it('reports a host that resolves to a private address as broken, without retrying', async () => {
    const net = fakeNet({}, { 'fixture.example.edu': ['10.0.0.5'] });
    const r = await checkLink(link('https://fixture.example.edu/p'), net.options);
    expect(r.status).toBe('broken');
    expect(r.note).toMatch(/PRIVATE_ADDRESS/);
    expect(net.requests).toHaveLength(0);
  });

  it('reports robots.txt refusals as warnings', async () => {
    const net = fakeNet({});
    net.options.robotsCache!.set('https://fixture.example.edu', { kind: 'rules', txt: 'User-agent: *\nDisallow: /' });
    expect(await checkLink(link('https://fixture.example.edu/p'), net.options)).toMatchObject({ status: 'warning' });
  });

  it('reports invalid URLs', async () => {
    expect(await checkLink(link('not a url'), fakeNet({}).options)).toMatchObject({ status: 'broken', note: 'not a valid URL' });
  });
});

describe('checkLinks + formatLinkTable', () => {
  it('keeps input order and prints a summary', async () => {
    const net = fakeNet({
      'HEAD https://fixture.example.edu/a': { status: 200 },
      'HEAD https://fixture.example.edu/b': { status: 410 },
    });
    const results = await checkLinks(
      [link('https://fixture.example.edu/a'), link('https://fixture.example.edu/b'), link('https://elsewhere.example.org/')],
      { ...net.options, concurrency: 2 },
    );
    expect(results.map((r) => r.status)).toEqual(['ok', 'broken', 'warning']);
    const table = formatLinkTable(results);
    expect(table.split('\n')[0]).toMatch(/^STATUS\s+HTTP\s+URL\s+NOTE$/);
    expect(table).toMatch(/3 link\(s\): 1 ok, 0 redirected, 1 warning\(s\), 1 broken\./);
  });
});
