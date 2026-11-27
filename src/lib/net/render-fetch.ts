/**
 * Fetch for JAVASCRIPT-RENDERED official pages (Playwright + Chromium). OFFLINE scripts only; never used by the app.
 * Used as a fallback after safeFetch returns (almost) no text, or when a source in data/sources.json has "render": true.
 *
 * It applies the same policy as safeFetch:
 *  - validateUrl + allowlist before navigating, and again for the final URL, every redirect hop and EVERY sub-request
 *    (page.route): a request to a non-allowlisted host, an IP-literal host, a non-https URL (http only with the test-only
 *    allowHttp), a credentialed URL or a host that resolves to a non-public address is aborted
 *  - robots.txt (same parser, same user agent with the contact URL, same cache) for every page navigation
 *  - the shared per-host throttle for every page navigation
 *  - hard limits: 20 s total for navigation + network idle, 3 MB of text; images, media, fonts and trackers are blocked
 *  - a fresh browser and context per call: no cookies, storage or cache carried over; downloads, pop-ups and service
 *    workers are off; after the first load the page may not navigate away
 *  - NO stealth, NO fingerprint changes, NO CAPTCHA or bot-challenge workarounds: when a challenge is served we stop
 *    with BLOCKED_BY_CHALLENGE
 *
 * The body it returns is the page's VISIBLE text (innerText, plus the panels of collapsed accordions and tabs),
 * normalised like htmlToText (one trimmed line per block, blank lines dropped), as text/plain, so the verbatim-snippet
 * check runs against exactly the text that produced the snippet.
 *
 * Known limit: Chromium does its own DNS lookup. We resolve and check every host right before the first request to it
 * (private answers are refused), but unlike safeFetch the connection is not pinned to the checked addresses.
 */
import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Browser, Page, Request as PwRequest, Route } from 'playwright';
import { normalizeHost } from './hosts';
import {
  INGEST_ALLOWLIST,
  MAX_REDIRECTS,
  SafeFetchError,
  USER_AGENT,
  assertRobotsAllowed,
  resolvePublicAddresses,
  validateUrl,
  type LookupAllFn,
  type RobotsEntry,
  type SafeResponse,
  type Transport,
} from './safe-fetch';
import { defaultThrottle, noThrottle, type Throttle } from './throttle';

export const RENDER_TIMEOUT_MS = 20_000;
export const RENDER_MAX_BYTES = 3 * 1024 * 1024;
export const RENDER_SETTLE_MS = 500;
/** A static fetch with less text than this is treated as "needs JavaScript" and retried with renderFetch. */
export const MIN_STATIC_TEXT_CHARS = 200;
const MAX_EXPANSIONS = 40;
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'ping', 'beacon', 'websocket', 'eventsource', 'manifest']);

export interface RenderFetchOptions {
  allowlist?: readonly string[];
  /** Tests only: also allow http:// and non-default ports. */
  allowHttp?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  settleMs?: number;
  checkRobots?: boolean;
  robotsCache?: Map<string, RobotsEntry>;
  lookup?: LookupAllFn;
  /** Used for robots.txt only (same meaning as in safeFetch). */
  transport?: Transport;
  userAgent?: string;
  throttle?: Throttle;
}

export type RenderResponse = SafeResponse;

/* ---------------- pure helpers ---------------- */

/** Bot-challenge pages we recognise. Matching means STOP; we never try to get past one. */
const CHALLENGE_PATTERNS: readonly RegExp[] = [
  /just a moment\.\.\./i,
  /checking (?:if the site connection is secure|your browser before accessing)/i,
  /attention required! \| cloudflare/i,
  /enable javascript and cookies to continue/i,
  /verify(?:ing)? (?:that )?you are (?:a )?human/i,
  /radware bot manager/i,
  /perfdrive\.com|shieldsquare/i,
  /pardon our interruption/i,
  /incapsula incident id/i,
  /request unsuccessful\. incapsula/i,
  /_incapsula_resource/i,
  /\bcaptcha\b.{0,80}\b(?:challenge|verification|security check)\b/i,
  /access denied.{0,80}reference #\d/i,
];

/** Returns a short reason when `text` / `title` / headers look like a bot challenge, otherwise null. */
export function detectChallenge(input: { status: number; title: string; text: string; headers?: Record<string, string> }): string | null {
  const h = input.headers ?? {};
  if ((h['cf-mitigated'] ?? '').toLowerCase() === 'challenge') return 'Cloudflare challenge (cf-mitigated header)';
  const head = `${input.title}\n${input.text.slice(0, 3000)}`;
  for (const re of CHALLENGE_PATTERNS) {
    if (re.test(head)) return `bot challenge page (matched /${re.source.slice(0, 40)}/)`;
  }
  // A challenge is a short page; a long article that merely mentions "captcha" is not one.
  if ([403, 429, 503].includes(input.status) && input.text.length < 600 && /captcha|challenge|bot|robot/i.test(head)) {
    return `HTTP ${input.status} with a short bot-check page`;
  }
  return null;
}

/** htmlToText's line normalisation applied to innerText: collapse spaces, trim, drop blank lines. */
export function normalizeVisibleText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t\f\v ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Merges extra panel lines after the base text, skipping lines that are already there. */
export function mergeExtraLines(base: string, extras: readonly string[]): string {
  const have = new Set(base.split('\n'));
  const add: string[] = [];
  for (const block of extras) {
    for (const line of normalizeVisibleText(block).split('\n')) {
      if (line && !have.has(line)) {
        have.add(line);
        add.push(line);
      }
    }
  }
  return add.length ? `${base}\n${add.join('\n')}` : base;
}

export type RequestVerdict = { allow: true } | { allow: false; reason: string };

/** Decides whether the browser may send a request. Pure apart from the injected lookup. */
export async function judgeRequest(
  rawUrl: string,
  resourceType: string,
  opts: { allowlist: readonly string[]; allowHttp: boolean; lookup: LookupAllFn; resolved: Map<string, Promise<void>> },
): Promise<RequestVerdict> {
  if (rawUrl.startsWith('data:') || rawUrl.startsWith('blob:') || rawUrl === 'about:blank') return { allow: true };
  if (BLOCKED_RESOURCE_TYPES.has(resourceType)) return { allow: false, reason: `resource type ${resourceType} is blocked` };
  let u: URL;
  try {
    u = validateUrl(rawUrl, { allowlist: opts.allowlist, allowHttp: opts.allowHttp });
  } catch (e) {
    return { allow: false, reason: e instanceof SafeFetchError ? `${e.code}: ${e.message}` : String(e) };
  }
  const host = normalizeHost(u.hostname);
  if (isIP(host) !== 0) return { allow: false, reason: 'IP-literal host' };
  let check = opts.resolved.get(host);
  if (!check) {
    check = resolvePublicAddresses(host, opts.lookup).then(() => undefined);
    opts.resolved.set(host, check);
  }
  try {
    await check;
  } catch (e) {
    return { allow: false, reason: e instanceof SafeFetchError ? `${e.code}: ${e.message}` : String(e) };
  }
  return { allow: true };
}

/* ---------------- browser I/O ---------------- */

const defaultLookup: LookupAllFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true }) as Promise<LookupAddress[]>;

async function launchChromium(): Promise<Browser> {
  let pw: typeof import('playwright');
  try {
    pw = await import('playwright');
  } catch {
    throw new SafeFetchError('RENDER_UNAVAILABLE', 'The playwright package is not installed (npm install).');
  }
  try {
    return await pw.chromium.launch({ headless: true, timeout: 15_000 });
  } catch (e) {
    throw new SafeFetchError(
      'RENDER_UNAVAILABLE',
      `Chromium could not start (run: npx playwright install chromium). ${(e as Error).message.split('\n')[0]}`,
    );
  }
}

/** True when Chromium can be started here (used by tests to skip, and by scripts for a clear message). */
export async function renderAvailable(): Promise<boolean> {
  try {
    const b = await launchChromium();
    await b.close();
    return true;
  } catch {
    return false;
  }
}

/** Opens <details> and clicks collapsed accordions (aria-expanded=false buttons). Links are never clicked. */
async function expandAccordions(page: Page): Promise<void> {
  await page
    .evaluate((max) => {
      document.querySelectorAll('details:not([open])').forEach((d) => d.setAttribute('open', ''));
      const sel = 'button[aria-expanded="false"], [role="button"][aria-expanded="false"]';
      let n = 0;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        if (n >= max) break;
        if (el.closest('a[href]') || el.tagName === 'A') continue;
        try {
          el.click();
          n++;
        } catch {
          /* ignore */
        }
      }
    }, MAX_EXPANSIONS)
    .catch(() => undefined);
  await page.waitForTimeout(150).catch(() => undefined);
}

/** Only one tab panel is visible at a time: click each other tab and read the panel it controls. */
async function collectTabPanels(page: Page): Promise<string[]> {
  // Tabs: only one panel is visible at a time, so click each tab and read the panel it controls.
  const panels: string[] = [];
  const tabs = await page.$$('[role="tab"]:not([aria-selected="true"])').catch(() => []);
  for (const tab of tabs.slice(0, 20)) {
    try {
      const controls = await tab.getAttribute('aria-controls');
      await tab.click({ timeout: 1000 });
      await page.waitForTimeout(100);
      const text = controls
        ? await page.evaluate((id) => (document.getElementById(id) as HTMLElement | null)?.innerText ?? '', controls)
        : '';
      if (text) panels.push(text);
    } catch {
      /* a tab that cannot be clicked is skipped */
    }
  }
  return panels;
}

/** Fetches a JavaScript-rendered official page and returns its visible text. Throws SafeFetchError. */
export async function renderFetch(rawUrl: string, options: RenderFetchOptions = {}): Promise<RenderResponse> {
  const allowlist = options.allowlist ?? INGEST_ALLOWLIST;
  const allowHttp = options.allowHttp ?? false;
  const timeoutMs = options.timeoutMs ?? RENDER_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? RENDER_MAX_BYTES;
  const settleMs = options.settleMs ?? RENDER_SETTLE_MS;
  const lookup = options.lookup ?? defaultLookup;
  const userAgent = options.userAgent ?? USER_AGENT;
  const throttle = options.throttle ?? (options.transport ? noThrottle : defaultThrottle);
  const robotsOptions = {
    allowlist,
    allowHttp,
    lookup,
    userAgent,
    throttle,
    ...(options.transport ? { transport: options.transport } : {}),
    ...(options.robotsCache ? { robotsCache: options.robotsCache } : {}),
  };

  const start = validateUrl(rawUrl, { allowlist, allowHttp });
  await judgeOrThrow(start.toString(), 'document', { allowlist, allowHttp, lookup, resolved: new Map() });

  const checkNavigation = async (u: URL): Promise<void> => {
    if (options.checkRobots !== false) await assertRobotsAllowed(u, robotsOptions);
    await throttle.wait(normalizeHost(u.hostname));
  };
  await checkNavigation(start);

  const browser = await launchChromium();
  const resolved = new Map<string, Promise<void>>();
  const redirects: string[] = [];
  let navigationOpen = true;
  const checkedNav = new Set<string>();
  const deadline = Date.now() + timeoutMs;
  let policyError: SafeFetchError | null = null;
  try {
    const context = await browser.newContext({
      userAgent,
      locale: 'en',
      acceptDownloads: false,
      serviceWorkers: 'block',
      javaScriptEnabled: true,
    });
    let main: Page | null = null;
    context.on('page', (p) => {
      // Pop-ups and new tabs are never wanted (the first page fires this event before `main` is set).
      if (main && p !== main) void p.close().catch(() => undefined);
    });
    const page = await context.newPage();
    main = page;
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);

    // Redirects are followed by US, one validated hop at a time: the browser is never allowed to follow one on its own.
    // (Chromium does not route redirect hops through page.route, so a redirect to another host would skip every check.)
    let pendingNext: URL | null = null;
    let finalNav: URL = start;
    const SUBREQUEST_MAX_BYTES = 10 * 1024 * 1024;

    await page.route('**/*', async (route: Route, req: PwRequest) => {
      try {
        const isNav = req.isNavigationRequest();
        const isMainNav = isNav && req.frame().parentFrame() === null;
        let url = new URL(req.url());
        for (let hop = 0; ; hop++) {
          const verdict = await judgeRequest(url.toString(), req.resourceType(), { allowlist, allowHttp, lookup, resolved });
          if (!verdict.allow) {
            if (isMainNav && !policyError) policyError = policyErrorFor(url.toString(), verdict.reason);
            return await route.abort('blockedbyclient');
          }
          if (isNav && !navigationOpen) return await route.abort('blockedbyclient'); // the page may not move on after loading
          if (isMainNav && url.toString() !== start.toString() && !checkedNav.has(url.toString())) {
            checkedNav.add(url.toString());
            await checkNavigation(url);
          }
          if (url.protocol === 'data:' || url.protocol === 'blob:') return await route.continue();
          const res = await route.fetch({ url: url.toString(), maxRedirects: 0, timeout: Math.max(1000, deadline - Date.now()) });
          const location = res.headers()['location'];
          if (res.status() >= 300 && res.status() < 400 && location) {
            if (hop >= MAX_REDIRECTS) throw new SafeFetchError('TOO_MANY_REDIRECTS', `More than ${MAX_REDIRECTS} redirects from ${rawUrl}`, rawUrl);
            const next = new URL(location, url);
            if (isMainNav) {
              // validate the hop, then let the outer loop navigate to it (so the page URL and routing stay correct)
              const v = await judgeRequest(next.toString(), 'document', { allowlist, allowHttp, lookup, resolved });
              if (!v.allow) {
                policyError ??= policyErrorFor(next.toString(), v.reason);
              } else {
                pendingNext = validateUrl(next.toString(), { allowlist, allowHttp });
                redirects.push(pendingNext.toString());
              }
              return await route.abort('blockedbyclient');
            }
            url = next;
            continue;
          }
          const body = await res.body();
          if (body.length > SUBREQUEST_MAX_BYTES) return await route.abort('blockedbyclient');
          if (isMainNav) finalNav = url;
          return await route.fulfill({ response: res, body });
        }
      } catch (e) {
        policyError ??= e instanceof SafeFetchError ? e : new SafeFetchError('NETWORK', (e as Error).message, req.url());
        return route.abort('blockedbyclient').catch(() => undefined);
      }
    });

    let response;
    let interruptions = 0;
    let target: URL = start;
    for (let hop = 0; ; hop++) {
      pendingNext = null;
      try {
        response = await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: Math.max(1, deadline - Date.now()) });
        break;
      } catch (e) {
        if (policyError) throw policyError;
        const next: URL | null = pendingNext;
        if (next) {
          if (hop >= MAX_REDIRECTS) throw new SafeFetchError('TOO_MANY_REDIRECTS', `More than ${MAX_REDIRECTS} redirects from ${rawUrl}`, rawUrl);
          target = next;
          await page.waitForTimeout(100); // let the aborted hop's error page settle before the next navigation
          continue;
        }
        // The aborted hop can still be replaced by Chromium's error page; the same URL is then simply tried again.
        if (/interrupted by another navigation/i.test((e as Error).message) && interruptions++ < 3) {
          hop--;
          continue;
        }
        if (/timeout/i.test((e as Error).message)) throw new SafeFetchError('TIMEOUT', `Timed out after ${timeoutMs} ms: ${rawUrl}`, rawUrl);
        throw new SafeFetchError('NETWORK', `Rendering ${start.host} failed: ${(e as Error).message.split('\n')[0]}`, rawUrl);
      }
    }
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.max(1, deadline - Date.now()) });
    } catch {
      // A page that never goes idle (analytics polling) is still usable once its document has loaded; the budget is spent.
      if (policyError) throw policyError;
    }
    if (policyError) throw policyError;
    if (!response) throw new SafeFetchError('NETWORK', `No response for ${rawUrl}`, rawUrl);
    await page.waitForTimeout(settleMs);
    await expandAccordions(page);
    const raw = await page.evaluate(() => document.body?.innerText ?? '');
    const panels = await collectTabPanels(page);
    await page.waitForTimeout(Math.min(settleMs, 300));
    navigationOpen = false;
    if (policyError) throw policyError;

    const finalUrl = validateUrl(finalNav.toString(), { allowlist, allowHttp });
    const title = await page.title().catch(() => '');
    const text = mergeExtraLines(normalizeVisibleText(raw), panels);
    const headers = await response.allHeaders().catch(() => ({}) as Record<string, string>);
    const challenge = detectChallenge({ status: response.status(), title, text, headers });
    if (challenge) throw new SafeFetchError('BLOCKED_BY_CHALLENGE', `${finalUrl.host}: ${challenge}. Not worked around.`, rawUrl);

    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) throw new SafeFetchError('TOO_LARGE', `Rendered text is larger than ${maxBytes} bytes: ${rawUrl}`, rawUrl);
    const status = response.status();
    return {
      requestedUrl: rawUrl,
      url: finalUrl.toString(),
      status,
      ok: status >= 200 && status < 300,
      contentType: 'text/plain; charset=utf-8',
      body: text,
      bytes,
      redirects,
      notModified: false,
      etag: null,
      lastModified: null,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/** Hosts of bot-challenge services. A redirect to one of them IS a challenge, not an unknown host. */
const CHALLENGE_HOSTS = /(?:^|.)(?:perfdrive.com|shieldsquare.com|captcha-delivery.com|datadome.co|challenges.cloudflare.com|hcaptcha.com|px-cloud.net|perimeterx.net)$/i;

export function isChallengeHost(url: string): boolean {
  try {
    return CHALLENGE_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function policyErrorFor(url: string, reason: string): SafeFetchError {
  if (isChallengeHost(url)) {
    return new SafeFetchError('BLOCKED_BY_CHALLENGE', `Redirected to a bot-challenge service (${new URL(url).host}). Not worked around.`, url);
  }
  const code = /^([A-Z_]+):/.exec(reason)?.[1];
  const known = ['BAD_URL', 'PROTOCOL', 'CREDENTIALS', 'HOST_NOT_ALLOWED', 'PRIVATE_ADDRESS', 'DNS'] as const;
  const c = (known as readonly string[]).includes(code ?? '') ? (code as (typeof known)[number]) : 'HOST_NOT_ALLOWED';
  return new SafeFetchError(c, reason.replace(/^[A-Z_]+: /, ''), url);
}

async function judgeOrThrow(url: string, type: string, o: Parameters<typeof judgeRequest>[2]): Promise<void> {
  const v = await judgeRequest(url, type, o);
  if (!v.allow) throw policyErrorFor(url, v.reason);
}

