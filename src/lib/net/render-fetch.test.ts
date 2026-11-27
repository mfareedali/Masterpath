/**
 * renderFetch: pure policy helpers always run; the browser tests use a local fixture server (test-only allowHttp) and
 * are skipped when Chromium is not installed (normal CI does not download browsers; the weekly workflow does).
 * No real site is contacted.
 */
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  detectChallenge,
  isChallengeHost,
  judgeRequest,
  mergeExtraLines,
  normalizeVisibleText,
  renderAvailable,
  renderFetch,
  type RenderFetchOptions,
} from './render-fetch';
import { SafeFetchError, nodeTransport, type LookupAllFn, type Transport } from './safe-fetch';

const publicLookup: LookupAllFn = async () => [{ address: '93.184.216.34', family: 4 }];
const privateLookup: LookupAllFn = async () => [{ address: '10.0.0.5', family: 4 }];

describe('judgeRequest (the policy applied to every sub-request)', () => {
  const base = { allowlist: ['example.edu'], allowHttp: false, lookup: publicLookup };
  const judge = (url: string, type = 'xhr', o: Partial<typeof base> = {}) =>
    judgeRequest(url, type, { ...base, ...o, resolved: new Map() });

  it('allows an allowlisted https host and its subdomains', async () => {
    expect((await judge('https://example.edu/a.js', 'script')).allow).toBe(true);
    expect((await judge('https://www.example.edu/api/x')).allow).toBe(true);
  });
  it('aborts non-allowlisted hosts, http, IP literals and credentials', async () => {
    expect((await judge('https://tracker.example.net/p')).allow).toBe(false);
    expect((await judge('http://example.edu/a')).allow).toBe(false);
    expect((await judge('https://93.184.216.34/a')).allow).toBe(false);
    expect((await judge('https://user:pw@example.edu/a')).allow).toBe(false);
    expect((await judge('https://example.edu:8443/a')).allow).toBe(false);
  });
  it('aborts a host that resolves to a private address', async () => {
    const v = await judge('https://example.edu/a', 'xhr', { lookup: privateLookup });
    expect(v.allow).toBe(false);
  });
  it('blocks images, media and fonts even on an allowed host', async () => {
    for (const t of ['image', 'media', 'font']) expect((await judge('https://example.edu/x', t)).allow).toBe(false);
  });
  it('allows data: URLs (inline, no network)', async () => {
    expect((await judge('data:text/plain,hi')).allow).toBe(true);
  });
});

describe('detectChallenge', () => {
  it('recognises common bot-check pages', () => {
    expect(detectChallenge({ status: 403, title: 'Just a moment...', text: 'Checking your browser before accessing x' })).toMatch(/challenge/);
    expect(detectChallenge({ status: 200, title: '', text: 'Radware Bot Manager Captcha' })).not.toBeNull();
    expect(detectChallenge({ status: 200, title: 'Pardon Our Interruption', text: '' })).not.toBeNull();
    expect(detectChallenge({ status: 200, title: 'x', text: '', headers: { 'cf-mitigated': 'challenge' } })).not.toBeNull();
    expect(detectChallenge({ status: 403, title: 'Blocked', text: 'Please solve the captcha' })).not.toBeNull();
  });
  it('does not flag an ordinary page', () => {
    expect(detectChallenge({ status: 200, title: 'MSc Computer Science', text: 'Tuition fees 20,000 per year. Apply by 31 January.' })).toBeNull();
    expect(detectChallenge({ status: 404, title: 'Not found', text: 'No such page' })).toBeNull();
  });
});

describe('isChallengeHost', () => {
  it('a redirect to a challenge service is a challenge (the Radware case), not a plain unknown host', () => {
    expect(isChallengeHost('https://validate.perfdrive.com/abc/?ssa=1')).toBe(true);
    expect(isChallengeHost('https://challenges.cloudflare.com/x')).toBe(true);
    expect(isChallengeHost('https://www.example.edu/')).toBe(false);
    expect(isChallengeHost('not a url')).toBe(false);
  });
});

describe('text normalisation (same line rules as htmlToText)', () => {
  it('collapses spaces, trims and drops blank lines', () => {
    expect(normalizeVisibleText('  Tuition \t fee  \n\n  €1,500   per semester \r\n')).toBe('Tuition fee\n€1,500 per semester');
  });
  it('appends only panel lines that are not already present', () => {
    expect(mergeExtraLines('A\nB', ['B\nC', 'C\nD'])).toBe('A\nB\nC\nD');
  });
});

/* ---------------- browser tests (local fixture server) ---------------- */

// Browser tests run only where Chromium is installed on purpose: always locally when it is there, in CI only with
// RUN_BROWSER_TESTS=1 (normal CI never downloads a browser, and a missing or half-installed one must not stall the job).
const available = process.env.CI && process.env.RUN_BROWSER_TESTS !== '1' ? false : await renderAvailable();
const FIXTURE: Record<string, { status?: number; type?: string; delayMs?: number; body: string; headers?: Record<string, string> }> = {};
let server: http.Server;
let origin = '';
const hits: string[] = [];

function opts(extra: RenderFetchOptions = {}): RenderFetchOptions {
  const transport: Transport = (req) => nodeTransport({ ...req, addresses: [{ address: '127.0.0.1', family: 4 }] });
  return { allowlist: ['localhost'], allowHttp: true, lookup: publicLookup, transport, robotsCache: new Map(), settleMs: 50, ...extra };
}

beforeAll(async () => {
  FIXTURE['/robots.txt'] = { type: 'text/plain', body: 'User-agent: *\nDisallow: /private\n' };
  FIXTURE['/js'] = {
    body: `<!doctype html><html><head><title>Course</title></head><body>
<div id="app">Loading…</div><div id="probe"></div>
<img src="http://localhost:1/never.png">
<script>
setTimeout(() => { document.getElementById('app').innerHTML = '<h1>MSc Computer Science</h1><p>Tuition fee: £21,000 per year.</p>'; }, 150);
fetch('http://tracker.example.net/collect').then(
  () => { document.getElementById('probe').textContent = 'tracker-reached'; },
  () => { document.getElementById('probe').textContent = 'tracker-blocked'; });
</script></body></html>`,
  };
  FIXTURE['/static'] = { body: '<html><body><p>Plain static text with the fee 5,000 EUR.</p></body></html>' };
  FIXTURE['/accordion'] = {
    body: `<html><body><h1>Admissions</h1>
<details><summary>Language</summary><p>IELTS 6.5 overall is required.</p></details>
<button aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.getElementById('d').hidden=false">Deadlines</button>
<div id="d" hidden>Applications close on 15 May 2027.</div>
<div role="tablist"><button role="tab" aria-selected="true" aria-controls="p1">Fees</button><button role="tab" aria-selected="false" aria-controls="p2" onclick="document.getElementById('p1').hidden=true;document.getElementById('p2').hidden=false">Funding</button></div>
<div id="p1" role="tabpanel">Fees are 9,000 EUR.</div><div id="p2" role="tabpanel" hidden>Funding: a DAAD scholarship exists.</div>
</body></html>`,
  };
  FIXTURE['/private'] = { body: '<html><body>Private page</body></html>' };
  FIXTURE['/slow'] = { delayMs: 4000, body: '<html><body>too late</body></html>' };
  FIXTURE['/challenge'] = { status: 403, body: '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing the site.</body></html>' };
  FIXTURE['/hop'] = { status: 302, headers: { location: '/js' }, body: '' };
  FIXTURE['/offsite'] = { status: 302, headers: { location: 'http://other.example.net/page' }, body: '' };
  server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    hits.push(path);
    const f = FIXTURE[path];
    const send = () => {
      if (!f) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(f.status ?? 200, { 'content-type': f.type ?? 'text/html; charset=utf-8', ...(f.headers ?? {}) }).end(f.body);
    };
    if (f?.delayMs) setTimeout(send, f.delayMs);
    else send();
  });
  await new Promise<void>((r) => server.listen(0, r));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server?.closeAllConnections?.();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

describe.skipIf(!available)('renderFetch in Chromium (local fixture)', () => {
  it('returns text that only exists after JavaScript ran, shaped like a SafeResponse', async () => {
    const r = await renderFetch(`${origin}/js`, opts());
    expect(r).toMatchObject({ status: 200, ok: true, contentType: 'text/plain; charset=utf-8', redirects: [], notModified: false });
    expect(r.requestedUrl).toBe(`${origin}/js`);
    expect(r.url).toBe(`${origin}/js`);
    expect(r.body).toContain('MSc Computer Science');
    expect(r.body).toContain('Tuition fee: £21,000 per year.');
    expect(r.bytes).toBe(Buffer.byteLength(r.body, 'utf8'));
  });

  it('aborts a sub-request to a non-allowlisted host', async () => {
    const r = await renderFetch(`${origin}/js`, opts());
    expect(r.body).toContain('tracker-blocked');
    expect(r.body).not.toContain('tracker-reached');
  });

  it('blocks a redirect to a non-allowlisted host', async () => {
    await expect(renderFetch(`${origin}/offsite`, opts())).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  });

  it('follows a redirect inside the allowlist one validated hop at a time and reports it', async () => {
    const r = await renderFetch(`${origin}/hop`, opts());
    expect(r.requestedUrl).toBe(`${origin}/hop`);
    expect(r.url).toBe(`${origin}/js`);
    expect(r.redirects).toEqual([`${origin}/js`]);
    expect(r.body).toContain('MSc Computer Science');
  });

  it('refuses a non-allowlisted start URL before any browser starts', async () => {
    await expect(renderFetch('https://not-allowed.example.net/', opts())).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  });

  it('honours robots.txt and never requests the disallowed page', async () => {
    hits.length = 0;
    await expect(renderFetch(`${origin}/private`, opts())).rejects.toMatchObject({ code: 'ROBOTS' });
    expect(hits).not.toContain('/private');
  });

  it('times out slow pages with TIMEOUT', async () => {
    await expect(renderFetch(`${origin}/slow`, opts({ timeoutMs: 1000 }))).rejects.toMatchObject({ code: 'TIMEOUT' });
  }, 15_000);

  it('expands details, aria-expanded buttons and tabs so hidden text is included', async () => {
    const r = await renderFetch(`${origin}/accordion`, opts());
    expect(r.body).toContain('IELTS 6.5 overall is required.');
    expect(r.body).toContain('Applications close on 15 May 2027.');
    expect(r.body).toContain('Fees are 9,000 EUR.');
    expect(r.body).toContain('Funding: a DAAD scholarship exists.');
  });

  it('stops at a bot challenge: BLOCKED_BY_CHALLENGE, no workaround', async () => {
    const e = await renderFetch(`${origin}/challenge`, opts()).catch((x) => x);
    expect(e).toBeInstanceOf(SafeFetchError);
    expect(e.code).toBe('BLOCKED_BY_CHALLENGE');
  });

  it('a snippet copied from the rendered text passes the same verbatim check as static text', async () => {
    const { snippetAppearsIn } = await import('../text/evidence');
    const r = await renderFetch(`${origin}/js`, opts());
    expect(snippetAppearsIn('Tuition fee: £21,000 per year.', r.body)).toBe(true);
  });

  it('too large text is refused', async () => {
    await expect(renderFetch(`${origin}/js`, opts({ maxBytes: 20 }))).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });
});
