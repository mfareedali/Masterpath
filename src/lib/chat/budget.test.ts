import { describe, expect, it } from 'vitest';
import { ChatBudget, DEFAULT_LIMITS, clientIdFrom, clientIpFrom, estimateTokens, limitsFromEnv } from './budget';

const T0 = new Date('2026-11-24T10:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

describe('rate limit: 8 requests per minute per client', () => {
  it('allows 8, blocks the 9th with a retry-after, and frees up as the window slides', () => {
    const b = new ChatBudget();
    for (let i = 0; i < 8; i++) expect(b.hit('a', at(i * 1000)).ok).toBe(true);
    const ninth = b.hit('a', at(8000));
    expect(ninth).toEqual({ ok: false, retryAfterSeconds: 52 });
    expect(b.hit('b', at(8000)).ok).toBe(true); // other clients are not affected
    expect(b.hit('a', at(60_001)).ok).toBe(true); // first hit left the window
  });

  it('rejected requests are not counted', () => {
    const b = new ChatBudget();
    for (let i = 0; i < 20; i++) b.hit('a', at(0));
    expect(b.hit('a', at(60_000)).ok).toBe(true);
  });
});

describe('token budgets', () => {
  it('per-client daily output budget', () => {
    const b = new ChatBudget({ perClientDailyTokens: 100, globalDailyTokens: 1000, requestsPerMinute: 8 });
    expect(b.canSpend('a', T0)).toBe(true);
    b.record('a', 60, T0);
    expect(b.canSpend('a', T0)).toBe(true);
    b.record('a', 40, T0);
    expect(b.canSpend('a', T0)).toBe(false);
    expect(b.canSpend('b', T0)).toBe(true);
    expect(b.usage('a', T0)).toEqual({ clientUsed: 100, clientRemaining: 0, globalUsed: 100, globalRemaining: 900 });
  });

  it('global daily cap stops everyone', () => {
    const b = new ChatBudget({ perClientDailyTokens: 1000, globalDailyTokens: 150, requestsPerMinute: 8 });
    b.record('a', 100, T0);
    b.record('b', 50, T0);
    expect(b.canSpend('c', T0)).toBe(false);
  });

  it('resets at 00:00 UTC', () => {
    const b = new ChatBudget({ perClientDailyTokens: 10, globalDailyTokens: 10, requestsPerMinute: 8 });
    b.record('a', 10, T0);
    expect(b.canSpend('a', T0)).toBe(false);
    expect(b.canSpend('a', new Date('2026-11-25T00:00:01Z'))).toBe(true);
  });

  it('ignores negative / NaN token counts', () => {
    const b = new ChatBudget();
    b.record('a', -5, T0);
    b.record('a', Number.NaN, T0);
    expect(b.usage('a', T0).clientUsed).toBe(0);
  });

  it('gate() binds a client for answerQuestion', () => {
    const b = new ChatBudget({ perClientDailyTokens: 10, globalDailyTokens: 100, requestsPerMinute: 8 });
    const g = b.gate('a', () => T0);
    expect(g.canSpend()).toBe(true);
    g.record(10);
    expect(g.canSpend()).toBe(false);
  });

  it('bounds memory by forgetting the oldest clients', () => {
    const b = new ChatBudget(DEFAULT_LIMITS, 3);
    for (const id of ['a', 'b', 'c', 'd']) b.record(id, 1, T0);
    expect(b.usage('a', T0).clientUsed).toBe(0);
    expect(b.usage('d', T0).clientUsed).toBe(1);
  });
});

describe('client id', () => {
  it('is a truncated SHA-256 hash that never contains the raw IP', () => {
    const id = clientIdFrom('203.0.113.7', 'salt');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toContain('203');
    expect(clientIdFrom('203.0.113.7', 'salt')).toBe(id);
    expect(clientIdFrom('203.0.113.8', 'salt')).not.toBe(id);
    expect(clientIdFrom('203.0.113.7', 'other-salt')).not.toBe(id); // the per-instance salt still applies
  });

  it('missing IP -> one shared "unknown" bucket', () => {
    expect(clientIdFrom(null, 'salt')).toBe(clientIdFrom('unknown', 'salt'));
    expect(clientIdFrom('  ', 'salt')).toBe(clientIdFrom('unknown', 'salt'));
  });

  it('prefers the platform-set headers: x-vercel-forwarded-for, then x-real-ip', () => {
    const h = new Headers({
      'x-vercel-forwarded-for': '198.51.100.9',
      'x-real-ip': '198.51.100.2',
      'x-forwarded-for': '6.6.6.6, 198.51.100.1',
    });
    expect(clientIpFrom(h)).toBe('198.51.100.9');
    expect(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.2', 'x-forwarded-for': '6.6.6.6' }))).toBe('198.51.100.2');
  });

  it('never trusts the leftmost x-forwarded-for entry: it reads the RIGHTMOST one (added by our own proxy)', () => {
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '6.6.6.6, 198.51.100.1' }))).toBe('198.51.100.1');
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '198.51.100.1' }))).toBe('198.51.100.1');
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '198.51.100.1, ' }))).toBe('198.51.100.1');
    expect(clientIpFrom(new Headers())).toBe('unknown');
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': 'not an ip <script>' }))).toBe('unknown');
  });
});

describe('client id cannot be rotated by the client (reviewer curl cases)', () => {
  // Request i: a new User-Agent and a new leftmost X-Forwarded-For every time, same real client behind our proxy.
  const spoofed = (i: number) =>
    new Headers({
      'user-agent': `Mozilla/5.0 rotating-${i}`,
      'x-forwarded-for': `10.0.${i}.1, 203.0.113.7`,
    });

  it('rotating User-Agent / leftmost X-Forwarded-For gives the SAME client id', () => {
    const ids = new Set(Array.from({ length: 10 }, (_, i) => clientIdFrom(clientIpFrom(spoofed(i)), 'salt')));
    expect(ids.size).toBe(1);
  });

  it('so the 9th request in a minute is rate limited and the token budget is shared', () => {
    const b = new ChatBudget({ perClientDailyTokens: 100, globalDailyTokens: 10_000, requestsPerMinute: 8 });
    const results = Array.from({ length: 10 }, (_, i) => b.hit(clientIdFrom(clientIpFrom(spoofed(i)), 'salt'), at(i * 100)).ok);
    expect(results).toEqual([true, true, true, true, true, true, true, true, false, false]);
    b.record(clientIdFrom(clientIpFrom(spoofed(0)), 'salt'), 100, T0);
    expect(b.canSpend(clientIdFrom(clientIpFrom(spoofed(5)), 'salt'), T0)).toBe(false);
  });
});

describe('limitsFromEnv', () => {
  it('defaults: 20,000 per client, 500,000 global, 8 per minute', () => {
    expect(limitsFromEnv({})).toEqual({ perClientDailyTokens: 20_000, globalDailyTokens: 500_000, requestsPerMinute: 8 });
  });

  it('reads CHAT_DAILY_TOKEN_BUDGET and CHAT_GLOBAL_DAILY_TOKEN_CAP, ignoring junk', () => {
    expect(limitsFromEnv({ CHAT_DAILY_TOKEN_BUDGET: '5000', CHAT_GLOBAL_DAILY_TOKEN_CAP: '0' })).toMatchObject({
      perClientDailyTokens: 5000,
      globalDailyTokens: 0,
    });
    expect(limitsFromEnv({ CHAT_DAILY_TOKEN_BUDGET: 'lots', CHAT_GLOBAL_DAILY_TOKEN_CAP: '-1' })).toMatchObject({
      perClientDailyTokens: 20_000,
      globalDailyTokens: 500_000,
    });
  });
});

it('estimateTokens ~ 4 characters per token', () => {
  expect(estimateTokens('abcdefgh')).toBe(2);
  expect(estimateTokens('')).toBe(0);
});
