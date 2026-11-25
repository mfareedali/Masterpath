/**
 * Simple in-memory sliding-window rate limiter (per server instance) and IP hashing.
 * Good enough to stop accidental floods on a hackathon deployment; not a security boundary.
 * The clock is passed in so the limiter is deterministic in tests.
 */
import { createHash } from 'node:crypto';

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the next request would be allowed (0 when ok). */
  retryAfterSec: number;
}

export interface RateLimiter {
  check(key: string, nowMs: number): RateLimitResult;
  /** Number of keys currently tracked (for tests). */
  size(): number;
}

export function createRateLimiter(opts: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const { limit, windowMs } = opts;
  const maxKeys = opts.maxKeys ?? 10_000;
  const hits = new Map<string, number[]>();

  function prune(nowMs: number) {
    for (const [k, times] of hits) {
      if (times.length === 0 || times[times.length - 1] <= nowMs - windowMs) hits.delete(k);
    }
    // Still too many keys: drop the oldest-inserted ones.
    while (hits.size > maxKeys) {
      const first = hits.keys().next();
      if (first.done) break;
      hits.delete(first.value);
    }
  }

  return {
    check(key, nowMs) {
      const recent = (hits.get(key) ?? []).filter((t) => t > nowMs - windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        const retryAfterSec = Math.max(1, Math.ceil((recent[0] + windowMs - nowMs) / 1000));
        return { ok: false, remaining: 0, retryAfterSec };
      }
      recent.push(nowMs);
      hits.delete(key); // re-insert so Map order tracks recency
      hits.set(key, recent);
      if (hits.size > maxKeys) prune(nowMs);
      return { ok: true, remaining: limit - recent.length, retryAfterSec: 0 };
    },
    size() {
      return hits.size;
    },
  };
}

/**
 * The client IP from headers the platform sets: x-vercel-forwarded-for, then x-real-ip, then the RIGHTMOST
 * x-forwarded-for entry (the hop our own proxy added). Never the leftmost entry, which the client controls.
 * Same order as the chat limiter (src/lib/chat/budget.ts). 'unknown' if absent.
 */
export { clientIpFrom as clientIp } from '@/lib/chat/budget';

/** One-way hash of an IP so raw IPs are never kept in memory or logs. */
export function hashIp(ip: string, salt = ''): string {
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32);
}
