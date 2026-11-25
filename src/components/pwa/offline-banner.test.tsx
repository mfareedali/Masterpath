/**
 * Offline banner (proposal #39): server-rendered without a DOM library. The view is checked in both states, the
 * connection subscription with a plain EventTarget, and the root layout for the mount point (empty while online).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import RootLayout from '@/app/layout';
import {
  OFFLINE_DETAIL,
  OFFLINE_LEAD,
  OfflineBanner,
  OfflineBannerView,
  readOnline,
  subscribeToConnection,
} from './offline-banner';

const WORDING =
  'You are offline. You may be seeing a copy saved on this phone earlier. Deadlines, days left and badges can be out of date. Check the official page when you are back online.';

/** Visible copy only. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
}

describe('OfflineBannerView', () => {
  it('offline: one status strip with the exact wording from the proposal', () => {
    const html = renderToStaticMarkup(createElement(OfflineBannerView, { offline: true }));
    expect(`${OFFLINE_LEAD} ${OFFLINE_DETAIL}`).toBe(WORDING);
    expect(text(html)).toBe(WORDING);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toContain('data-offline-banner="offline"');
    // Token classes only, and no blue (blue = official source).
    expect(html).toMatch(/bg-accent-soft/);
    expect(html).not.toMatch(/\b(?:text|bg|border)-(?:blue|red|green|gray|slate|link|evidence)/);
    // States limits only: no links, no numbers, no promises.
    expect(html).not.toMatch(/<a[\s>]/);
    expect(text(html)).not.toMatch(/\d|guarantee|chance/i);
  });

  it('online: the status region is in the DOM but empty (zero height, nothing to shift)', () => {
    const html = renderToStaticMarkup(createElement(OfflineBannerView, { offline: false }));
    expect(html).toBe('<div role="status" data-offline-banner="online"></div>');
  });
});

describe('OfflineBanner (hook)', () => {
  it('renders the online state on the server, so hydration matches and nothing is painted', () => {
    const html = renderToStaticMarkup(createElement(OfflineBanner));
    expect(html).toBe('<div role="status" data-offline-banner="online"></div>');
  });
});

describe('connection helpers', () => {
  it('readOnline is false only when the browser explicitly says it is offline', () => {
    expect(readOnline({ onLine: false })).toBe(false);
    expect(readOnline({ onLine: true })).toBe(true);
    expect(readOnline({})).toBe(true);
    expect(readOnline(null)).toBe(true);
  });

  it('readOnline with no argument reads the global navigator (none in node = online)', () => {
    expect(readOnline()).toBe(true);
    vi.stubGlobal('navigator', { onLine: false });
    try {
      expect(readOnline()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('subscribeToConnection listens to online and offline, and unsubscribes cleanly', () => {
    const target = new EventTarget();
    const onChange = vi.fn();
    const unsubscribe = subscribeToConnection(onChange, target);
    target.dispatchEvent(new Event('offline'));
    target.dispatchEvent(new Event('online'));
    target.dispatchEvent(new Event('storage'));
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
    target.dispatchEvent(new Event('offline'));
    target.dispatchEvent(new Event('online'));
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('root layout', () => {
  const html = renderToStaticMarkup(<RootLayout><p>page body</p></RootLayout>);

  it('mounts the banner once, after the header and before <main>, empty while online', () => {
    expect(html.match(/data-offline-banner=/g)).toHaveLength(1);
    const banner = html.indexOf('data-offline-banner="online"');
    expect(banner).toBeGreaterThan(html.indexOf('</header>'));
    expect(banner).toBeLessThan(html.indexOf('<main'));
    expect(html).not.toContain(OFFLINE_LEAD);
  });
});
