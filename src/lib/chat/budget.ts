/**
 * Chat cost and abuse limits, in memory.
 *
 *  - Per-client daily OUTPUT-token budget (CHAT_DAILY_TOKEN_BUDGET, default 20,000).
 *  - Per-client rate limit (8 requests per minute).
 *  - Global daily output-token cap (CHAT_GLOBAL_DAILY_TOKEN_CAP, default 500,000).
 *
 * Client id = SHA-256 of (per-instance random salt + IP), truncated. Raw IPs are never stored. The IP comes from a
 * header the platform sets (see clientIpFrom), never from the client-controlled User-Agent or leftmost X-Forwarded-For.
 *
 * IMPORTANT: these limits live in the memory of ONE server instance. On serverless hosting every instance
 * (and every cold start) has its own counters, so the real ceiling is "limit x number of instances", and counters
 * reset when an instance is recycled. Days roll over at 00:00 UTC. For hard limits, move the counters to a shared
 * store (e.g. a Supabase table or a KV store) behind the same interface.
 */
import { createHash, randomBytes } from 'node:crypto';

export interface BudgetLimits {
  perClientDailyTokens: number;
  globalDailyTokens: number;
  requestsPerMinute: number;
}

export const DEFAULT_LIMITS: BudgetLimits = {
  perClientDailyTokens: 20_000,
  globalDailyTokens: 500_000,
  requestsPerMinute: 8,
};

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function limitsFromEnv(env: Record<string, string | undefined> = process.env): BudgetLimits {
  return {
    perClientDailyTokens: positiveInt(env.CHAT_DAILY_TOKEN_BUDGET, DEFAULT_LIMITS.perClientDailyTokens),
    globalDailyTokens: positiveInt(env.CHAT_GLOBAL_DAILY_TOKEN_CAP, DEFAULT_LIMITS.globalDailyTokens),
    requestsPerMinute: DEFAULT_LIMITS.requestsPerMinute,
  };
}

/** Random per-process salt: ids cannot be reversed to an IP, and are only comparable within this instance. */
const INSTANCE_SALT = randomBytes(16).toString('hex');

/**
 * Anonymous client id: first 32 hex chars of SHA-256(salt | ip).
 * The User-Agent is NOT part of it: the client chooses its User-Agent, so a new one per request would mean a
 * fresh rate limit and token budget per request.
 */
export function clientIdFrom(ip: string | null | undefined, salt = INSTANCE_SALT): string {
  return createHash('sha256')
    .update(`${salt}|${(ip ?? '').trim() || 'unknown'}`)
    .digest('hex')
    .slice(0, 32);
}

/** An IPv4 / IPv6 address (with an optional port or zone), nothing else. Anything else is ignored. */
const IP_LIKE = /^[0-9a-f:.[\]%]{2,64}$/i;

/** The last non-empty entry of a comma-separated header. */
function rightmost(value: string | null): string | null {
  if (!value) return null;
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1];
  return last && IP_LIKE.test(last) ? last : null;
}

/**
 * The client IP, used only as hash input. Never the LEFTMOST x-forwarded-for entry: the client can write anything
 * there and each proxy only appends to it.
 *  1. x-vercel-forwarded-for, then x-real-ip: set (overwritten) by the hosting platform / our own proxy.
 *  2. Otherwise the RIGHTMOST x-forwarded-for entry: the address our own proxy saw.
 *  3. Otherwise 'unknown' (all such requests share one bucket).
 */
export function clientIpFrom(headers: { get(name: string): string | null }): string {
  return (
    rightmost(headers.get('x-vercel-forwarded-for')) ??
    rightmost(headers.get('x-real-ip')) ??
    rightmost(headers.get('x-forwarded-for')) ??
    'unknown'
  );
}

export type RateResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/** What answerQuestion needs: may the model be called, and how much did it spend. */
export interface TokenBudgetGate {
  canSpend(): boolean;
  record(outputTokens: number): void;
}

interface ClientState {
  used: number;
  hits: number[];
}

const MINUTE_MS = 60_000;

export class ChatBudget {
  private day = '';
  private globalUsed = 0;
  private readonly clients = new Map<string, ClientState>();

  constructor(
    readonly limits: BudgetLimits = DEFAULT_LIMITS,
    private readonly maxClients = 5_000,
  ) {}

  private roll(now: Date): void {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.globalUsed = 0;
      this.clients.clear();
    }
  }

  private client(id: string): ClientState {
    let c = this.clients.get(id);
    if (!c) {
      c = { used: 0, hits: [] };
      this.clients.set(id, c);
      // Bound memory: forget the oldest clients (the global cap still applies to everyone).
      while (this.clients.size > this.maxClients) {
        const oldest = this.clients.keys().next().value;
        if (oldest === undefined) break;
        this.clients.delete(oldest);
      }
    }
    return c;
  }

  /** Count one request against the per-minute limit. Rejected requests are not counted. */
  hit(id: string, now: Date): RateResult {
    this.roll(now);
    const c = this.client(id);
    const t = now.getTime();
    c.hits = c.hits.filter((h) => t - h < MINUTE_MS);
    if (c.hits.length >= this.limits.requestsPerMinute) {
      const retry = Math.max(1, Math.ceil((MINUTE_MS - (t - c.hits[0])) / 1000));
      return { ok: false, retryAfterSeconds: retry };
    }
    c.hits.push(t);
    return { ok: true };
  }

  /** True while both this client's daily budget and the global daily cap have tokens left. */
  canSpend(id: string, now: Date): boolean {
    this.roll(now);
    const used = this.clients.get(id)?.used ?? 0;
    return used < this.limits.perClientDailyTokens && this.globalUsed < this.limits.globalDailyTokens;
  }

  record(id: string, outputTokens: number, now: Date): void {
    this.roll(now);
    const n = Number.isFinite(outputTokens) && outputTokens > 0 ? Math.ceil(outputTokens) : 0;
    this.client(id).used += n;
    this.globalUsed += n;
  }

  usage(id: string, now: Date): { clientUsed: number; clientRemaining: number; globalUsed: number; globalRemaining: number } {
    this.roll(now);
    const clientUsed = this.clients.get(id)?.used ?? 0;
    return {
      clientUsed,
      clientRemaining: Math.max(0, this.limits.perClientDailyTokens - clientUsed),
      globalUsed: this.globalUsed,
      globalRemaining: Math.max(0, this.limits.globalDailyTokens - this.globalUsed),
    };
  }

  /** Bind to one client for answerQuestion. `now` is read at call time. */
  gate(id: string, now: () => Date): TokenBudgetGate {
    return {
      canSpend: () => this.canSpend(id, now()),
      record: (tokens) => this.record(id, tokens, now()),
    };
  }
}

/** Rough token estimate when the API did not report usage (about 4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
