import { describe, expect, it } from 'vitest';
import { clientIp, createRateLimiter, hashIp } from './rate-limit';

describe('createRateLimiter', () => {
  it('allows 5 requests per minute per key, then blocks', () => {
    const rl = createRateLimiter({ limit: 5, windowMs: 60_000 });
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) {
      const r = rl.check('a', t0 + i * 1000);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(4 - i);
    }
    const blocked = rl.check('a', t0 + 10_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(50);
  });

  it('frees a slot when the oldest request leaves the window', () => {
    const rl = createRateLimiter({ limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i++) rl.check('a', i * 1000);
    expect(rl.check('a', 59_999).ok).toBe(false);
    expect(rl.check('a', 60_001).ok).toBe(true);
  });

  it('keeps keys independent', () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.check('a', 0).ok).toBe(true);
    expect(rl.check('a', 1).ok).toBe(false);
    expect(rl.check('b', 1).ok).toBe(true);
  });

  it('does not grow without bound', () => {
    const rl = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 1000; i++) rl.check(`k${i}`, i);
    expect(rl.size()).toBeLessThanOrEqual(100);
  });
});

describe('clientIp', () => {
  it('never trusts the client-controlled leftmost x-forwarded-for entry', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('10.0.0.1');
    expect(clientIp(new Headers({ 'x-vercel-forwarded-for': '198.51.100.9', 'x-forwarded-for': '1.2.3.4' }))).toBe('198.51.100.9');
  });
  it('falls back to x-real-ip, then "unknown"', () => {
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIp(new Headers())).toBe('unknown');
  });
});

describe('hashIp', () => {
  it('is stable, salted and does not contain the IP', () => {
    const a = hashIp('203.0.113.7');
    expect(a).toBe(hashIp('203.0.113.7'));
    expect(a).toHaveLength(32);
    expect(a).not.toContain('203.0.113.7');
    expect(hashIp('203.0.113.7', 'salt')).not.toBe(a);
    expect(hashIp('203.0.113.8')).not.toBe(a);
  });
});
