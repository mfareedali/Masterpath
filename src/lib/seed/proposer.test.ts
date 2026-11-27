/** xAI/OpenAI-compatible proposer: mocked fetch only (no network, no key). */
import { describe, expect, it, vi } from 'vitest';
import { parseModelOutput, type AcceptedProposal } from './ingest';
import { DEFAULT_XAI_INGEST_MODEL, DEFAULT_XAI_REVIEW_MODEL, estimateCostUsd, makeCompatProposer, resolveProposer } from './proposer';
import { applyReview, parseReview, reviewAccepted } from './review-pass';
import { retryAfterMs } from '../chat/openai-compat';

const PROMPT = { system: 's', user: 'u', fields: ['deadline' as const] };

function sse(text: string, usage = { prompt_tokens: 120, completion_tokens: 30 }, finish = 'stop'): Response {
  const enc = new TextEncoder();
  const events = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage })}\n\n`,
    'data: [DONE]\n\n',
  ];
  return new Response(new ReadableStream({ start(c) { events.forEach((e) => c.enqueue(enc.encode(e))); c.close(); } }), { status: 200 });
}
const fail = (status: number, headers: Record<string, string> = {}) => new Response('slow down', { status, headers });
const ANSWER = '{"proposals":[{"field":"deadline","value_json":"\\"2027-01-15\\"","evidence_snippet":"The application deadline is 15 January 2027."}]}';

describe('resolveProposer', () => {
  it('INGEST_PROVIDER=xai without a key says so and gives no proposer', () => {
    const r = resolveProposer({ INGEST_PROVIDER: 'xai' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/XAI_API_KEY is not set/);
  });
  it('xai: first-pass model from XAI_MODEL (default documented), a different second-pass model', () => {
    const r = resolveProposer({ INGEST_PROVIDER: 'xai', XAI_API_KEY: 'k' });
    expect(r.ok && r.proposer.model).toBe(DEFAULT_XAI_INGEST_MODEL);
    expect(r.ok && r.reviewer?.model).toBe(DEFAULT_XAI_REVIEW_MODEL);
    const custom = resolveProposer({ INGEST_PROVIDER: 'xai', XAI_API_KEY: 'k', XAI_MODEL: 'grok-4.7', XAI_REVIEW_MODEL: 'grok-4.7' });
    expect(custom.ok && custom.proposer.model).toBe('grok-4.7');
    expect(custom.ok && custom.reviewer).toBeNull(); // same model twice is not a second opinion
  });
  it('no provider and no key: hand-extraction workflow', () => {
    const r = resolveProposer({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/hand-extraction workflow/);
  });
  it('rejects an unknown provider', () => {
    const r = resolveProposer({ INGEST_PROVIDER: 'openai' });
    expect(r.ok).toBe(false);
  });
  it('the key is never part of the reason text', () => {
    const r = resolveProposer({ INGEST_PROVIDER: 'nope', XAI_API_KEY: 'xai-secret-123' });
    expect(JSON.stringify(r)).not.toContain('xai-secret-123');
  });
});

describe('makeCompatProposer (mocked fetch)', () => {
  it('returns the model text and counts tokens; sends a JSON-object request with the bearer key', async () => {
    const f = vi.fn().mockResolvedValue(sse(ANSWER));
    const { propose, usage } = makeCompatProposer({ apiKey: 'k', model: 'grok-test', fetchImpl: f, sleep: async () => {} });
    const text = await propose(PROMPT);
    expect(parseModelOutput(text).proposals).toHaveLength(1);
    expect(usage).toMatchObject({ calls: 1, failures: 0, inputTokens: 120, outputTokens: 30 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.x.ai/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer k');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'grok-test', response_format: { type: 'json_object' } });
  });

  it('429: backs off exponentially, honours Retry-After, then succeeds', async () => {
    const sleeps: number[] = [];
    const f = vi.fn().mockResolvedValueOnce(fail(429)).mockResolvedValueOnce(fail(429, { 'retry-after': '7' })).mockResolvedValue(sse(ANSWER));
    const { propose } = makeCompatProposer({ apiKey: 'k', model: 'm', fetchImpl: f, sleep: async (ms) => void sleeps.push(ms), retryBaseMs: 2000 });
    await propose(PROMPT);
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([2000, 7000]);
  });

  it('gives up after the retries with a clear error and counts the failure (the caller never crashes the run)', async () => {
    const f = vi.fn().mockImplementation(async () => fail(429));
    const { propose, usage } = makeCompatProposer({ apiKey: 'k', model: 'm', fetchImpl: f, sleep: async () => {}, maxRetries: 2 });
    await expect(propose(PROMPT)).rejects.toThrow(/xAI API returned 429/);
    expect(f).toHaveBeenCalledTimes(3);
    expect(usage.failures).toBe(1);
  });

  it('a 401 is not retried', async () => {
    const f = vi.fn().mockResolvedValue(fail(401));
    const { propose } = makeCompatProposer({ apiKey: 'bad', model: 'm', fetchImpl: f, sleep: async () => {} });
    await expect(propose(PROMPT)).rejects.toThrow(/401/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('malformed JSON becomes a rejection reason, not a crash', async () => {
    const f = vi.fn().mockResolvedValue(sse('Sure! Here are the facts: deadline is soon'));
    const { propose } = makeCompatProposer({ apiKey: 'k', model: 'm', fetchImpl: f, sleep: async () => {} });
    const parsed = parseModelOutput(await propose(PROMPT));
    expect(parsed.proposals).toEqual([]);
    expect(parsed.error).toMatch(/no JSON/);
    const broken = parseModelOutput('{"proposals": [ {"field": "deadline", ');
    expect(broken.error).toMatch(/JSON|no "proposals"/);
  });

  it('a cut-off answer (max_tokens) is an error, not a half-parsed proposal', async () => {
    const f = vi.fn().mockResolvedValue(sse('{"proposals":[', undefined, 'length'));
    const { propose } = makeCompatProposer({ apiKey: 'k', model: 'm', fetchImpl: f, sleep: async () => {} });
    await expect(propose(PROMPT)).rejects.toThrow(/cut off/);
  });

  it('cost estimate from the documented price table', () => {
    expect(estimateCostUsd('grok-4.3', { calls: 1, failures: 0, inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(3.75);
    expect(estimateCostUsd('unknown-model', { calls: 1, failures: 0, inputTokens: 1, outputTokens: 1 })).toBeNull();
  });
});

describe('retryAfterMs', () => {
  it('reads seconds and dates, caps at 60 s, ignores junk', () => {
    expect(retryAfterMs('3')).toBe(3000);
    expect(retryAfterMs('999')).toBe(60_000);
    expect(retryAfterMs('soon')).toBeNull();
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs(new Date(5000).toUTCString(), 2000)).toBe(3000);
  });
});

describe('second pass can only veto', () => {
  const acc = (field: string, value: unknown, snip: string): AcceptedProposal => ({
    field: field as AcceptedProposal['field'], value, source_url: 'https://x.edu/p', evidence_snippet: snip, fetched_at: '2026-11-27T00:00:00Z',
    basis: 'verbatim', review_notes: [], flags: [],
  });
  const A = [acc('deadline', '2027-01-15', 'The application deadline is 15 January 2027.'), acc('tuition', { amount: 9000 }, 'Fees: 9,000 per year (UK students).')];

  it('keeps confirmed items and vetoes rejected ones with the reason', () => {
    const { kept, vetoed } = applyReview(A, [{ index: 0, verdict: 'confirm', reason: '' }, { index: 1, verdict: 'reject', reason: 'home fee, not international' }], 'grok-4.3', null);
    expect(kept.map((k) => k.field)).toEqual(['deadline']);
    expect(kept[0].review_notes.join()).toMatch(/second pass \(grok-4.3\): confirmed/);
    expect(vetoed[0].reasons[0]).toMatch(/home fee, not international/);
  });
  it('fails closed: a missing verdict or a broken answer vetoes', () => {
    expect(applyReview(A, [], 'm', 'The reviewer answer contained no JSON').kept).toEqual([]);
    expect(parseReview('nonsense').error).toMatch(/no JSON/);
    expect(parseReview('{"reviews": [{"index": 0, "verdict": "maybe"}]}').verdicts).toEqual([]);
  });
  it('a failing review call vetoes everything instead of crashing', async () => {
    const r = await reviewAccepted({ programName: 'P', institutionName: 'I', accepted: A }, async () => { throw new Error('boom'); }, 'm');
    expect(r.kept).toEqual([]);
    expect(r.vetoed).toHaveLength(2);
    expect(r.vetoed[0].reasons[0]).toMatch(/review call failed: boom/);
  });
  it('the reviewer cannot change a value', async () => {
    const r = await reviewAccepted({ programName: 'P', institutionName: 'I', accepted: A }, async () => '{"reviews":[{"index":0,"verdict":"confirm","value":"1999-01-01"},{"index":1,"verdict":"confirm"}]}', 'm');
    expect(r.kept.map((k) => k.value)).toEqual(['2027-01-15', { amount: 9000 }]);
  });
});
