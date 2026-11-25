'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js in production only (dev would cache stale bundles), after the page has loaded so it never
 * competes with first paint. The worker keeps saved shortlists, checklists and visited pages usable offline.
 */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () =>
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
        // Registration is a progressive enhancement; the site works without it.
      });
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
