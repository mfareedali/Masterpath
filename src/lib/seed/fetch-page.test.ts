/** fetchPage chooses between safeFetch and renderFetch. Both are mocked: no network, no browser. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reviewProposals, verifyItemsFrom, verifyItemsFromSeed } from './ingest';

const safe = vi.hoisted(() => ({ safeFetch: vi.fn() }));
const render = vi.hoisted(() => ({ renderFetch: vi.fn() }));
vi.mock('../net/safe-fetch', async (orig) => ({ ...(await orig<typeof import('../net/safe-fetch')>()), safeFetch: safe.safeFetch }));
vi.mock('../net/render-fetch', async (orig) => ({ ...(await orig<typeof import('../net/render-fetch')>()), renderFetch: render.renderFetch }));

import { SafeFetchError } from '../net/safe-fetch';
import { fetchPage } from './page-text';

const resp = (body: string, extra: object = {}) => ({
  requestedUrl: 'https://x.edu/p', url: 'https://x.edu/p', status: 200, ok: true, contentType: 'text/html', body, bytes: body.length,
  redirects: [], notModified: false, etag: null, lastModified: null, ...extra,
});
const LONG = `<html><body><p>${'Real static content about the programme. '.repeat(10)}</p></body></html>`;
const rendered = (text: string) => resp(text, { contentType: 'text/plain; charset=utf-8' });

beforeEach(() => {
  safe.safeFetch.mockReset();
  render.renderFetch.mockReset();
});

describe('fetchPage', () => {
  it('uses the static result when it has enough text (renderer never starts)', async () => {
    safe.safeFetch.mockResolvedValue(resp(LONG));
    const f = await fetchPage('https://x.edu/p');
    expect(f.method).toBe('static');
    expect(render.renderFetch).not.toHaveBeenCalled();
  });

  it('falls back to the renderer when the static page has under 200 characters of text', async () => {
    safe.safeFetch.mockResolvedValue(resp('<html><body><div id="app"></div></body></html>'));
    render.renderFetch.mockResolvedValue(rendered(`MSc Computer Science\n${'Tuition fee: 20,000 per year.\n'.repeat(10)}`));
    const f = await fetchPage('https://x.edu/p');
    expect(f.method).toBe('render');
    expect(f.text).toContain('Tuition fee: 20,000 per year.');
  });

  it('render: true skips the static fetch entirely', async () => {
    render.renderFetch.mockResolvedValue(rendered('x'.repeat(300)));
    const f = await fetchPage('https://x.edu/p', { render: true });
    expect(f.method).toBe('render');
    expect(safe.safeFetch).not.toHaveBeenCalled();
  });

  it("fetchMethod 'static' never falls back, even for an empty page (re-verification uses the recorded method)", async () => {
    safe.safeFetch.mockResolvedValue(resp('<html><body></body></html>'));
    const f = await fetchPage('https://x.edu/p', { fetchMethod: 'static' });
    expect(f.method).toBe('static');
    expect(render.renderFetch).not.toHaveBeenCalled();
  });

  it('INGEST_RENDER=0 switches the automatic fallback off', async () => {
    vi.stubEnv('INGEST_RENDER', '0');
    try {
      safe.safeFetch.mockResolvedValue(resp('<html></html>'));
      const f = await fetchPage('https://x.edu/p');
      expect(f.method).toBe('static');
      expect(render.renderFetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a bot challenge from the renderer is reported, not hidden behind the empty static page', async () => {
    safe.safeFetch.mockResolvedValue(resp('<html></html>'));
    render.renderFetch.mockRejectedValue(new SafeFetchError('BLOCKED_BY_CHALLENGE', 'challenge'));
    await expect(fetchPage('https://x.edu/p')).rejects.toMatchObject({ code: 'BLOCKED_BY_CHALLENGE' });
  });

  it('an unavailable browser keeps the static result and says why', async () => {
    safe.safeFetch.mockResolvedValue(resp('<html></html>'));
    render.renderFetch.mockRejectedValue(new SafeFetchError('RENDER_UNAVAILABLE', 'no chromium'));
    const f = await fetchPage('https://x.edu/p');
    expect(f.method).toBe('static');
    expect(f.renderNote).toMatch(/RENDER_UNAVAILABLE/);
  });

  it('PDF rate sheets get a 30 s timeout, other pages the default', async () => {
    safe.safeFetch.mockResolvedValue(resp(LONG));
    await fetchPage('https://www.sbp.org.pk/rates/MTM_Rates_2026.pdf');
    expect(safe.safeFetch.mock.calls[0][1]).toMatchObject({ timeoutMs: 30_000 });
    await fetchPage('https://x.edu/p');
    expect(safe.safeFetch.mock.calls[1][1]).not.toHaveProperty('timeoutMs');
  });

  it('a 304 or an HTTP error never triggers the renderer', async () => {
    safe.safeFetch.mockResolvedValue(resp('', { status: 304, ok: false, notModified: true }));
    await fetchPage('https://x.edu/p');
    safe.safeFetch.mockResolvedValue(resp('', { status: 404, ok: false }));
    await fetchPage('https://x.edu/p');
    expect(render.renderFetch).not.toHaveBeenCalled();
  });
});

describe('fetch_method is recorded and read back', () => {
  const CTX = { pageText: 'The application deadline is 15 January 2027.', sourceUrl: 'https://x.edu/p', fetchedAt: '2026-11-27T00:00:00Z', fields: ['deadline' as const] };
  const raw = [{ field: 'deadline', value: '2027-01-15', evidence_snippet: 'The application deadline is 15 January 2027.' }];

  it('reviewProposals stamps accepted proposals with the method that produced the text', () => {
    expect(reviewProposals(raw, { ...CTX, fetchMethod: 'render' }).accepted[0].fetch_method).toBe('render');
    expect(reviewProposals(raw, CTX).accepted[0]).not.toHaveProperty('fetch_method');
  });

  it('verify items carry it from proposal files and the seed; junk values are dropped', () => {
    const fromFile = verifyItemsFrom({ accepted: [{ field: 'deadline', source_url: 'https://x.edu/p', evidence_snippet: 'The application deadline is 15 January 2027.', fetch_method: 'render' }] });
    expect(fromFile.items[0].fetch_method).toBe('render');
    const junk = verifyItemsFrom([{ source_url: 'https://x.edu/p', evidence_snippet: 'The application deadline is 15 January 2027.', fetch_method: 'telepathy' }]);
    expect(junk.items[0]).not.toHaveProperty('fetch_method');
    const seed = verifyItemsFromSeed({ 'a.seed.json': [{ value: 1, source_url: 'https://x.edu/p', evidence_snippet: 'The application deadline is 15 January 2027.', fetch_method: 'static' }] });
    expect(seed[0].fetch_method).toBe('static');
  });
});
