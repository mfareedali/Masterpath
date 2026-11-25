/**
 * POST /api/report: cross-origin requests are refused with 403 (CSRF guard, like /api/account/delete), before the
 * rate limiter, the body or the database are touched. Data and Supabase are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const insert = vi.fn(async () => ({ error: null }));
const getPrograms = vi.fn(async () => [{ id: 'brookes-msc-cs' }]);

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data', () => ({ getPrograms, stripInternal: <T>(v: T) => v }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => ({ insert }) }) }));

const { POST } = await import('./route');

const VALID = JSON.stringify({ program_id: 'brookes-msc-cs', field: 'tuition', message: 'The fee on the official page is different.' });

let ipCounter = 0;

function report(headers: Record<string, string>, body = VALID): Request {
  ipCounter += 1;
  return new Request('https://app.example/api/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `203.0.113.${ipCounter}`, ...headers },
    body,
  });
}

describe('POST /api/report rejects cross-origin requests', () => {
  beforeEach(() => {
    insert.mockClear();
    getPrograms.mockClear();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service');
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['a foreign Origin', { origin: 'https://evil.example', host: 'app.example' }],
    ['a look-alike Origin', { origin: 'https://app.example.evil.example', host: 'app.example' }],
    ['no Origin at all', { host: 'app.example' }],
    ['a malformed Origin', { origin: 'null', host: 'app.example' }],
  ])('%s gets 403 and nothing is stored', async (_label, headers) => {
    const res = await POST(report(headers));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { stored: boolean; error: string };
    expect(body.stored).toBe(false);
    expect(body.error).toMatch(/reload the page/);
    expect(getPrograms).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('cross-origin attempts do not use up the visitor rate limit', async () => {
    const headers = { origin: 'https://evil.example', host: 'app.example', 'x-forwarded-for': '198.51.100.7' };
    for (let i = 0; i < 10; i++) expect((await POST(report(headers))).status).toBe(403);
    const ok = await POST(report({ origin: 'https://app.example', host: 'app.example', 'x-forwarded-for': '198.51.100.7' }));
    expect(ok.status).toBe(201);
  });

  it('a same-origin report is still accepted (direct host and behind a proxy)', async () => {
    const direct = await POST(report({ origin: 'https://app.example', host: 'app.example' }));
    expect(direct.status).toBe(201);
    expect(await direct.json()).toMatchObject({ stored: true });
    const proxied = await POST(report({ origin: 'https://app.example', host: 'internal:3000', 'x-forwarded-host': 'app.example' }));
    expect(proxied.status).toBe(201);
    const laptop = await POST(report({ origin: 'http://192.168.1.20:3000', host: '192.168.1.20:3000' }));
    expect(laptop.status).toBe(201);
    expect(insert).toHaveBeenCalledTimes(3);
    expect(insert).toHaveBeenCalledWith({
      program_id: 'brookes-msc-cs',
      field: 'tuition',
      message: 'The fee on the official page is different.',
      status: 'open',
    });
  });
});
