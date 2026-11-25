import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, isCrossOrigin, isJsonContentType, parseChatRequest, readBodyLimited } from './request';
import { verifyTurnstile } from './turnstile';

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/chat', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });
}

describe('parseChatRequest (zod)', () => {
  it('accepts a question with optional programId / country / turnstileToken', () => {
    expect(parseChatRequest(JSON.stringify({ question: '  Deadline?  ', programId: 'tum-msc-informatics', country: 'de' }))).toEqual({
      ok: true,
      data: { question: 'Deadline?', programId: 'tum-msc-informatics', country: 'DE' },
    });
  });

  it.each([
    ['not json', 'Body must be JSON.'],
    [JSON.stringify({}), /between 1 and 500/],
    [JSON.stringify({ question: '   ' }), /between 1 and 500/],
    [JSON.stringify({ question: 'x'.repeat(501) }), /between 1 and 500/],
    [JSON.stringify({ question: 'q', programId: '../etc/passwd' }), /between 1 and 500/],
    [JSON.stringify({ question: 'q', country: 'Germany' }), /between 1 and 500/],
    [JSON.stringify({ question: 42 }), /between 1 and 500/],
  ])('rejects %s', (body, msg) => {
    const r = parseChatRequest(body);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });

  it('accepts exactly 500 characters', () => {
    expect(parseChatRequest(JSON.stringify({ question: 'x'.repeat(500) })).ok).toBe(true);
  });
});

describe('isJsonContentType — exact JSON only', () => {
  it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON', 'application/json;charset=UTF-8', ' application/json '])(
    'accepts %j',
    (ct) => {
      expect(isJsonContentType(ct)).toBe(true);
    },
  );

  it.each([
    'text/plain; a=application/json', // reviewer's curl case: CORS-safelisted, so no preflight
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=application/json',
    'application/jsonp',
    'application/json-patch+json',
    'application/json; a=b',
    '',
    null,
    undefined,
  ])('rejects %j', (ct) => {
    expect(isJsonContentType(ct)).toBe(false);
  });
});

describe('isCrossOrigin — other websites may not drive the chat from their visitors’ browsers', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it('same origin (Origin host = Host, with port) is allowed', () => {
    expect(isCrossOrigin(h({ origin: 'https://masterspath.example', host: 'masterspath.example' }))).toBe(false);
    expect(isCrossOrigin(h({ origin: 'http://localhost:3000', host: 'localhost:3000' }))).toBe(false);
    expect(isCrossOrigin(h({ origin: 'https://MastersPath.example', host: 'masterspath.example' }))).toBe(false);
  });

  it('behind a proxy, x-forwarded-host may carry the public host', () => {
    expect(isCrossOrigin(h({ origin: 'https://masterspath.example', host: 'internal:8080', 'x-forwarded-host': 'masterspath.example' }))).toBe(false);
  });

  it('no Origin header (curl, server-to-server) is not cross-origin', () => {
    expect(isCrossOrigin(h({ host: 'masterspath.example' }))).toBe(false);
  });

  it.each([
    ['https://evil.example', 'masterspath.example'],
    ['https://masterspath.example.evil.example', 'masterspath.example'],
    ['http://localhost:4000', 'localhost:3000'], // different port = different origin
    ['null', 'masterspath.example'], // opaque origin (sandboxed iframe)
    ['not a url', 'masterspath.example'],
  ])('Origin %s on host %s -> cross-origin (403)', (origin, host) => {
    expect(isCrossOrigin(h({ origin, host }))).toBe(true);
  });

  it('an Origin with no Host header to compare is cross-origin', () => {
    expect(isCrossOrigin({ get: (n: string) => (n === 'origin' ? 'https://masterspath.example' : null) })).toBe(true);
  });
});

describe('readBodyLimited (4 KB)', () => {
  it('reads a small body', async () => {
    expect(await readBodyLimited(post('{"question":"hi"}'))).toEqual({ ok: true, text: '{"question":"hi"}' });
  });

  it('rejects a body over 4 KB even without content-length', async () => {
    const big = 'x'.repeat(MAX_BODY_BYTES + 1);
    expect(await readBodyLimited(post(big))).toEqual({ ok: false, status: 413 });
  });

  it('rejects early on a large declared content-length', async () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': String(MAX_BODY_BYTES + 100) },
    });
    expect(await readBodyLimited(req)).toEqual({ ok: false, status: 413 });
  });

  it('empty body -> 400', async () => {
    expect(await readBodyLimited(new Request('http://localhost/api/chat', { method: 'POST' }))).toEqual({ ok: false, status: 400 });
  });
});

describe('verifyTurnstile', () => {
  it('true only when Cloudflare says success', async () => {
    let body = '';
    const ok = (async (_u: string, init?: RequestInit) => {
      body = String(init?.body);
      return Response.json({ success: true });
    }) as typeof fetch;
    expect(await verifyTurnstile('tok', 'secret', ok)).toBe(true);
    expect(body).toContain('response=tok');
    expect(body).not.toContain('remoteip'); // the visitor IP is never sent
    const no = (async () => Response.json({ success: false })) as typeof fetch;
    expect(await verifyTurnstile('tok', 'secret', no)).toBe(false);
  });

  it('missing token or network failure -> false', async () => {
    const boom = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    expect(await verifyTurnstile(undefined, 'secret', boom)).toBe(false);
    expect(await verifyTurnstile('tok', 'secret', boom)).toBe(false);
  });
});
