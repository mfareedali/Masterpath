import { describe, expect, it } from 'vitest';
import { createHostThrottle, type Clock } from './throttle';
import { buildUserAgent } from './safe-fetch';

function fakeClock(): Clock & { t: number; slept: number[] } {
  const c = {
    t: 1000,
    slept: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.slept.push(ms);
      c.t += ms;
    },
  };
  return c;
}

describe('createHostThrottle', () => {
  it('spaces requests to one host by the interval and never waits for the first one', async () => {
    const clock = fakeClock();
    const th = createHostThrottle({ minIntervalMs: 1500, clock });
    await th.wait('a.edu');
    await th.wait('a.edu');
    await th.wait('a.edu');
    expect(clock.slept).toEqual([1500, 1500]);
  });

  it('does not delay a different host and counts time already passed', async () => {
    const clock = fakeClock();
    const th = createHostThrottle({ minIntervalMs: 1500, clock });
    await th.wait('a.edu');
    await th.wait('b.edu');
    expect(clock.slept).toEqual([]);
    clock.t += 1000;
    await th.wait('a.edu');
    expect(clock.slept).toEqual([500]);
  });

  it('serves concurrent callers for one host one after another', async () => {
    const clock = fakeClock();
    const th = createHostThrottle({ minIntervalMs: 1500, clock });
    await Promise.all([th.wait('a.edu'), th.wait('a.edu'), th.wait('a.edu')]);
    expect(clock.slept).toEqual([1500, 1500]);
  });
});

describe('buildUserAgent', () => {
  it('puts the contact URL in the user agent when configured', () => {
    expect(buildUserAgent({ INGEST_CONTACT_URL: 'https://example.org/bot' })).toContain('+https://example.org/bot');
  });
  it('never invents a contact URL and ignores non-https values', () => {
    expect(buildUserAgent({})).toContain('contact URL not configured');
    expect(buildUserAgent({ INGEST_CONTACT_URL: 'javascript:alert(1)' })).toContain('not configured');
  });
});
