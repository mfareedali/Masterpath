/*
 * MastersPath service worker. Plain JS, no build step. Registered in production only by
 * src/components/pwa/sw-register.tsx. Served with Cache-Control: no-cache (next.config.ts), so edits ship on the next visit.
 *
 * Strategy:
 *  - install: precache '/', '/offline', '/saved', the manifest and the icons, plus the /_next/static files those pages use
 *  - /_next/static/*: cache-first (file names are content-hashed)
 *  - page navigations: network-first; on failure (or after NAV_TIMEOUT_MS on a slow network) the cached copy of that
 *    exact URL, then '/offline'
 *  - /api/*: never intercepted, never cached. /account and /auth pages are never cached either.
 *  - activate: delete old MastersPath caches, enable navigation preload, take control of open tabs.
 * Bump VERSION to drop every cache on the next visit.
 */
'use strict';

const VERSION = 'v2';
const PREFIX = 'masterspath-';
const PRECACHE = `${PREFIX}precache-${VERSION}`;
const STATIC_CACHE = `${PREFIX}static-${VERSION}`;
const PAGES_CACHE = `${PREFIX}pages-${VERSION}`;
const CURRENT_CACHES = [PRECACHE, STATIC_CACHE, PAGES_CACHE];

const OFFLINE_URL = '/offline';
const PRECACHE_PAGES = ['/', OFFLINE_URL, '/saved'];
const PRECACHE_FILES = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'];
/** Pages that may show account data: network only, never stored. */
const NEVER_STORE_PAGES = [/^\/account(\/|$)/, /^\/auth(\/|$)/];
const MAX_PAGES = 40;
const MAX_STATIC = 200;
const NAV_TIMEOUT_MS = 6000;

/** Absolute URL on this origin (relative URLs would also work in browsers; absolute keeps cache keys uniform). */
function abs(path) {
  return new URL(path, self.location.origin).toString();
}

/** /_next/static URLs referenced by a page's HTML (scripts, styles, fonts). */
function staticAssetsIn(html) {
  const found = new Set();
  const re = /(?:src|href)="(\/_next\/static\/[^"?#\s]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) found.add(m[1]);
  return [...found];
}

/** Only plain, successful, same-origin, storable responses. Redirected responses cannot answer a navigation. */
function isStorable(res) {
  if (!res || !res.ok || res.redirected || (res.type !== 'basic' && res.type !== 'default')) return false;
  return !/no-store|private/i.test(res.headers.get('Cache-Control') || '');
}

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const pre = await caches.open(PRECACHE);
      const stat = await caches.open(STATIC_CACHE);
      await Promise.all(PRECACHE_FILES.map((url) => pre.add(new Request(abs(url), { cache: 'reload' })).catch(() => undefined)));
      await Promise.all(
        PRECACHE_PAGES.map(async (url) => {
          try {
            const res = await fetch(new Request(abs(url), { cache: 'reload', credentials: 'same-origin' }));
            if (!isStorable(res)) return;
            await pre.put(abs(url), res.clone());
            const assets = staticAssetsIn(await res.text()).map(abs);
            await Promise.all(assets.map((a) => stat.match(a).then((hit) => hit || stat.add(a)).catch(() => undefined)));
          } catch {
            // Offline during install: the page will be cached on the next successful visit.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && !CURRENT_CACHES.includes(k)).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {
          // Not supported: plain fetch is used.
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  // "Delete my data": drop stored pages (they may contain grades from shortlist URLs).
  if (type === 'CLEAR_PAGES') event.waitUntil(caches.delete(PAGES_CACHE));
});

async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (isStorable(res)) {
    await cache.put(request, res.clone());
    if (max) trimCache(cacheName, max).catch(() => undefined);
  }
  return res;
}

async function fromNetwork(event, store) {
  const preloaded = await event.preloadResponse;
  const res = preloaded || (await fetch(event.request));
  if (store && isStorable(res)) {
    const copy = res.clone();
    event.waitUntil(
      caches
        .open(PAGES_CACHE)
        .then((cache) => cache.put(event.request, copy))
        .then(() => trimCache(PAGES_CACHE, MAX_PAGES))
        .catch(() => undefined),
    );
  }
  return res;
}

/** The freshest stored copy of this exact URL: pages cache first, then the install-time precache. */
async function cachedPage(request) {
  const pages = await caches.open(PAGES_CACHE);
  return (await pages.match(request, { ignoreVary: true })) || (await caches.match(request, { ignoreVary: true }));
}

function offlinePage() {
  return caches.match(abs(OFFLINE_URL), { ignoreVary: true });
}

async function networkFirstPage(event, store) {
  const network = fromNetwork(event, store);
  network.catch(() => undefined);
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS, 'timeout'));
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== 'timeout') return first;
    // Slow network: answer from the cache if we can; the network copy still updates the cache in the background.
    const cached = store ? await cachedPage(event.request) : undefined;
    if (cached) return cached;
    return await network;
  } catch {
    const cached = store ? await cachedPage(event.request) : undefined;
    return cached || (await offlinePage()) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never cache the API

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE, MAX_STATIC));
    return;
  }
  if (request.mode === 'navigate') {
    const store = !NEVER_STORE_PAGES.some((re) => re.test(url.pathname));
    event.respondWith(networkFirstPage(event, store));
    return;
  }
  if (PRECACHE_FILES.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, PRECACHE));
  }
  // Everything else (RSC payloads, images, other files) uses the browser's normal behaviour.
});
