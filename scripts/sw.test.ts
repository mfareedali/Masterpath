/**
 * Behaviour tests for public/sw.js: the worker runs in a node:vm sandbox with a fake Cache Storage and a fake network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const ORIGIN = 'https://app.test';
const SW_SOURCE = readFileSync(join(process.cwd(), 'public', 'sw.js'), 'utf8');

type Listener = (event: unknown) => void;

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
  cache: string;
}

function keyOf(req: string | Request | FakeRequest): string {
  return typeof req === 'string' ? new URL(req, ORIGIN).toString() : req.url;
}

class FakeCache {
  readonly entries = new Map<string, Response>();
  constructor(private readonly net: FakeNet) {}
  async match(req: string | Request | FakeRequest) {
    return this.entries.get(keyOf(req))?.clone();
  }
  async put(req: string | Request | FakeRequest, res: Response) {
    this.entries.set(keyOf(req), res);
  }
  async add(req: string | Request) {
    const res = await this.net.fetch(req);
    if (!res.ok) throw new Error('add failed');
    this.entries.set(keyOf(req), res);
  }
  async keys() {
    return [...this.entries.keys()].map((u) => new Request(u));
  }
  async delete(req: string | Request) {
    return this.entries.delete(keyOf(req));
  }
}

class FakeCaches {
  readonly stores = new Map<string, FakeCache>();
  constructor(private readonly net: FakeNet) {}
  async open(name: string) {
    let c = this.stores.get(name);
    if (!c) {
      c = new FakeCache(this.net);
      this.stores.set(name, c);
    }
    return c;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match(req: string | Request | FakeRequest) {
    for (const c of this.stores.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

interface Route {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  redirected?: boolean;
  /** Never answers (slow network). */
  hang?: boolean;
}

class FakeNet {
  online = true;
  routes = new Map<string, Route>();
  calls: string[] = [];
  fetch = async (req: string | Request | FakeRequest): Promise<Response> => {
    const url = keyOf(req);
    this.calls.push(url);
    if (!this.online) throw new TypeError('Failed to fetch');
    const r = this.routes.get(url) ?? { status: 404, body: 'not found' };
    if (r.hang) return new Promise<Response>(() => undefined);
    const res = new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers ?? { 'content-type': 'text/html' } });
    if (r.redirected) Object.defineProperty(res, 'redirected', { value: true });
    return res;
  };
}

function loadWorker(net: FakeNet, opts: { navigationPreload?: boolean } = {}) {
  const listeners = new Map<string, Listener>();
  const caches = new FakeCaches(net);
  const preloadEnabled = { value: false };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    registration: {
      navigationPreload: opts.navigationPreload
        ? {
            enable: async () => {
              preloadEnabled.value = true;
            },
          }
        : undefined,
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  const context = vm.createContext({
    self,
    caches,
    fetch: net.fetch,
    Request,
    Response,
    URL,
    setTimeout: (fn: () => void, ms: number, ...args: unknown[]) => setTimeout(fn, ms, ...args),
    console,
  });
  vm.runInContext(SW_SOURCE, context, { filename: 'sw.js' });

  async function lifecycle(type: 'install' | 'activate') {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }

  function dispatchFetch(path: string, init: { mode?: string; method?: string; origin?: string } = {}) {
    const request: FakeRequest = {
      url: new URL(path, init.origin ?? ORIGIN).toString(),
      method: init.method ?? 'GET',
      mode: init.mode ?? 'no-cors',
      cache: 'default',
    };
    let response: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    listeners.get('fetch')!({
      request,
      preloadResponse: Promise.resolve(undefined),
      respondWith: (p: Promise<Response>) => {
        response = Promise.resolve(p);
      },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    return {
      intercepted: response !== null,
      async response() {
        const res = await response!;
        await Promise.all(waits);
        return res;
      },
    };
  }

  return { caches, self, lifecycle, dispatchFetch, preloadEnabled };
}

const PAGE_HTML = (title: string) =>
  `<html><head><link rel="stylesheet" href="/_next/static/css/app.css"><script src="/_next/static/chunks/main.js" async=""></script></head><body>${title}</body></html>`;

function onlineNet(): FakeNet {
  const net = new FakeNet();
  net.routes.set(`${ORIGIN}/`, { body: PAGE_HTML('home') });
  net.routes.set(`${ORIGIN}/offline`, { body: PAGE_HTML('offline page') });
  net.routes.set(`${ORIGIN}/saved`, { body: PAGE_HTML('saved') });
  net.routes.set(`${ORIGIN}/manifest.webmanifest`, { body: '{}', headers: { 'content-type': 'application/manifest+json' } });
  for (const icon of ['icon-192.png', 'icon-512.png', 'maskable-512.png']) {
    net.routes.set(`${ORIGIN}/icons/${icon}`, { body: 'png', headers: { 'content-type': 'image/png' } });
  }
  net.routes.set(`${ORIGIN}/_next/static/css/app.css`, { body: 'css', headers: { 'content-type': 'text/css' } });
  net.routes.set(`${ORIGIN}/_next/static/chunks/main.js`, { body: 'js', headers: { 'content-type': 'text/javascript' } });
  return net;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('service worker lifecycle', () => {
  it('install precaches pages, manifest, icons and the static files the pages use, then skips waiting', async () => {
    const net = onlineNet();
    const sw = loadWorker(net);
    await sw.lifecycle('install');
    const pre = sw.caches.stores.get('masterspath-precache-v2')!;
    expect([...pre.entries.keys()].sort()).toEqual(
      [
        `${ORIGIN}/`,
        `${ORIGIN}/offline`,
        `${ORIGIN}/saved`,
        `${ORIGIN}/manifest.webmanifest`,
        `${ORIGIN}/icons/icon-192.png`,
        `${ORIGIN}/icons/icon-512.png`,
        `${ORIGIN}/icons/maskable-512.png`,
      ].sort(),
    );
    const stat = sw.caches.stores.get('masterspath-static-v2')!;
    expect([...stat.entries.keys()].sort()).toEqual([`${ORIGIN}/_next/static/chunks/main.js`, `${ORIGIN}/_next/static/css/app.css`]);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it('install survives a missing page and never stores a redirected response', async () => {
    const net = onlineNet();
    net.routes.set(`${ORIGIN}/`, { body: 'x', redirected: true });
    net.routes.delete(`${ORIGIN}/saved`);
    const sw = loadWorker(net);
    await sw.lifecycle('install');
    const pre = sw.caches.stores.get('masterspath-precache-v2')!;
    expect(pre.entries.has(`${ORIGIN}/`)).toBe(false);
    expect(pre.entries.has(`${ORIGIN}/saved`)).toBe(false);
    expect(pre.entries.has(`${ORIGIN}/offline`)).toBe(true);
  });

  it('activate deletes old MastersPath caches only, enables navigation preload and claims clients', async () => {
    const net = onlineNet();
    const sw = loadWorker(net, { navigationPreload: true });
    await sw.caches.open('masterspath-pages-v1');
    await sw.caches.open('masterspath-pages-v2');
    await sw.caches.open('someone-else');
    await sw.lifecycle('activate');
    expect((await sw.caches.keys()).sort()).toEqual(['masterspath-pages-v2', 'someone-else']);
    expect(sw.preloadEnabled.value).toBe(true);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });
});

describe('service worker fetch routing', () => {
  it('never intercepts /api, other origins or non-GET requests', () => {
    const sw = loadWorker(onlineNet());
    expect(sw.dispatchFetch('/api/chat').intercepted).toBe(false);
    expect(sw.dispatchFetch('/api/chat', { mode: 'navigate' }).intercepted).toBe(false);
    expect(sw.dispatchFetch('/x.js', { origin: 'https://cdn.example.org' }).intercepted).toBe(false);
    expect(sw.dispatchFetch('/saved', { method: 'POST', mode: 'navigate' }).intercepted).toBe(false);
    expect(sw.dispatchFetch('/program/x?_rsc=abc').intercepted).toBe(false);
  });

  it('serves /_next/static cache-first', async () => {
    const net = onlineNet();
    const sw = loadWorker(net);
    const first = await sw.dispatchFetch('/_next/static/chunks/main.js').response();
    expect(await first.text()).toBe('js');
    net.online = false;
    const second = await sw.dispatchFetch('/_next/static/chunks/main.js').response();
    expect(await second.text()).toBe('js');
    expect(net.calls.filter((u) => u.endsWith('main.js'))).toHaveLength(1);
  });

  it('navigations are network-first, stored, and served from the cache when offline', async () => {
    const net = onlineNet();
    net.routes.set(`${ORIGIN}/program/fixture`, { body: 'fresh page' });
    const sw = loadWorker(net);
    expect(await (await sw.dispatchFetch('/program/fixture', { mode: 'navigate' }).response()).text()).toBe('fresh page');
    net.online = false;
    expect(await (await sw.dispatchFetch('/program/fixture', { mode: 'navigate' }).response()).text()).toBe('fresh page');
  });

  it('prefers the network copy over the install-time copy when offline', async () => {
    const net = onlineNet();
    const sw = loadWorker(net);
    await sw.lifecycle('install');
    net.routes.set(`${ORIGIN}/saved`, { body: 'newer saved page' });
    await sw.dispatchFetch('/saved', { mode: 'navigate' }).response();
    net.online = false;
    expect(await (await sw.dispatchFetch('/saved', { mode: 'navigate' }).response()).text()).toBe('newer saved page');
  });

  it('falls back to /offline for unknown pages when offline', async () => {
    const net = onlineNet();
    const sw = loadWorker(net);
    await sw.lifecycle('install');
    net.online = false;
    const res = await sw.dispatchFetch('/shortlist?cgpa=3', { mode: 'navigate' }).response();
    expect(await res.text()).toContain('offline page');
  });

  it('never stores account pages or no-store responses', async () => {
    const net = onlineNet();
    net.routes.set(`${ORIGIN}/account`, { body: 'my account' });
    net.routes.set(`${ORIGIN}/private-page`, { body: 'secret', headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } });
    const sw = loadWorker(net);
    await sw.lifecycle('install');
    await sw.dispatchFetch('/account', { mode: 'navigate' }).response();
    await sw.dispatchFetch('/private-page', { mode: 'navigate' }).response();
    net.online = false;
    expect(await (await sw.dispatchFetch('/account', { mode: 'navigate' }).response()).text()).toContain('offline page');
    expect(await (await sw.dispatchFetch('/private-page', { mode: 'navigate' }).response()).text()).toContain('offline page');
  });

  it('answers from the cache when the network is too slow', async () => {
    const net = onlineNet();
    net.routes.set(`${ORIGIN}/program/slow`, { body: 'cached copy' });
    const sw = loadWorker(net);
    await sw.dispatchFetch('/program/slow', { mode: 'navigate' }).response();
    net.routes.set(`${ORIGIN}/program/slow`, { hang: true });
    vi.useFakeTimers();
    const pending = sw.dispatchFetch('/program/slow', { mode: 'navigate' });
    const res = pending.response();
    await vi.advanceTimersByTimeAsync(6500);
    vi.useRealTimers();
    // The hanging network request never settles, so only the response is awaited (not waitUntil).
    expect(pending.intercepted).toBe(true);
    expect(await Promise.race([res.then((r) => r.text()), new Promise((r) => setTimeout(r, 200, 'timeout'))])).toBe('cached copy');
  });

  it('serves the manifest and icons from the precache', async () => {
    const net = onlineNet();
    const sw = loadWorker(net);
    await sw.lifecycle('install');
    net.online = false;
    const res = await sw.dispatchFetch('/icons/icon-192.png').response();
    expect(await res.text()).toBe('png');
  });
});
