'use client';

/**
 * Offline banner (audit proposal #39). The service worker (public/sw.js) can answer a navigation with a copy of the
 * page saved earlier, with no marker. Those copies hold computed text such as 'N days left', 'Date has passed' and
 * confidence badges, which may be out of date. When the browser reports that it is offline, this strip says so.
 *
 * - Client leaf mounted once in src/app/layout.tsx. No service-worker change.
 * - useSyncExternalStore on the window 'online'/'offline' events. The server snapshot is "online", so the server HTML
 *   and hydration agree and nothing is painted while online (the status region is empty: zero height, no layout shift).
 * - The role="status" region is always in the DOM, so screen readers announce the message when it appears.
 * - Known gap, on purpose: the slow-network cache fallback (sw.js NAV_TIMEOUT_MS) while still online is not detected.
 */
import { useSyncExternalStore } from 'react';

export const OFFLINE_LEAD = 'You are offline.';
export const OFFLINE_DETAIL =
  'You may be seeing a copy saved on this phone earlier. Deadlines, days left and badges can be out of date. Check the official page when you are back online.';

type ConnectionEvents = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Subscribes to connection changes. `target` defaults to window; tests pass their own EventTarget. */
export function subscribeToConnection(onChange: () => void, target?: ConnectionEvents): () => void {
  const t: ConnectionEvents = target ?? window;
  t.addEventListener('online', onChange);
  t.addEventListener('offline', onChange);
  return () => {
    t.removeEventListener('online', onChange);
    t.removeEventListener('offline', onChange);
  };
}

/**
 * True unless the browser says it is offline. navigator.onLine === false is reliable; true only means "maybe online",
 * so anything other than an explicit false counts as online (no banner).
 */
export function readOnline(nav?: { onLine?: boolean } | null): boolean {
  const n = nav === undefined ? (typeof navigator === 'undefined' ? null : navigator) : nav;
  return n?.onLine !== false;
}

const subscribe = (onChange: () => void) => subscribeToConnection(onChange);
const getSnapshot = () => readOnline();
const getServerSnapshot = () => true;

/** Presentation only (render-tested without a DOM). Empty status region when online. */
export function OfflineBannerView({ offline }: { offline: boolean }) {
  return (
    <div role="status" data-offline-banner={offline ? 'offline' : 'online'}>
      {offline ? (
        <div className="border-b border-line bg-accent-soft text-on-accent-soft">
          <p className="mx-auto max-w-5xl px-4 py-2 text-sm">
            <strong>{OFFLINE_LEAD}</strong> {OFFLINE_DETAIL}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return <OfflineBannerView offline={!online} />;
}
