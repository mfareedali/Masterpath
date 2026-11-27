/**
 * Per-host politeness throttle for the offline fetchers. Pure apart from the injected clock.
 *
 * At most one request per `minIntervalMs` per host (default 1.5 s). Callers for the same host are served strictly in
 * order, so even concurrent callers cannot hit one host faster than that. The clock is injectable so tests never wait.
 */
export const DEFAULT_MIN_INTERVAL_MS = 1500;

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface Throttle {
  /** Resolves when a request to `host` may be sent. */
  wait(host: string): Promise<void>;
}

export const noThrottle: Throttle = { wait: async () => undefined };

export function createHostThrottle(opts: { minIntervalMs?: number; clock?: Clock } = {}): Throttle {
  const interval = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const clock = opts.clock ?? realClock;
  const lastStart = new Map<string, number>();
  const tails = new Map<string, Promise<void>>();

  return {
    wait(host) {
      const key = host.trim().toLowerCase();
      const prev = tails.get(key) ?? Promise.resolve();
      const mine = prev.then(async () => {
        const last = lastStart.get(key);
        if (last !== undefined) {
          const remaining = last + interval - clock.now();
          if (remaining > 0) await clock.sleep(remaining);
        }
        lastStart.set(key, clock.now());
      });
      tails.set(key, mine);
      return mine;
    },
  };
}

/** Shared by every fetch in one process (ingest, verify, link checker). */
export const defaultThrottle: Throttle = createHostThrottle();
