import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import type { ModelStreamEvent } from './answer';
import { DEFAULT_CHAT_MODEL, SERVER_SIDE_FALLBACK_BETA, buildStreamParams, chatModelName, createAnthropicChatModel } from './anthropic';
import { buildPrompt } from './prompt';
import type { ChatRow } from './types';

describe('buildStreamParams', () => {
  const params = buildStreamParams({ system: 'SYS', user: 'USER', maxTokens: 1024 }, 'claude-opus-5-5') as unknown as Record<string, unknown>;

  it('low effort, ~1024 tokens, server-side refusal fallback on the beta endpoint', () => {
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1024,
      system: 'SYS',
      output_config: { effort: 'low' },
      betas: [SERVER_SIDE_FALLBACK_BETA],
      fallbacks: 'default',
    });
    expect(SERVER_SIDE_FALLBACK_BETA).toBe('server-side-fallback-2026-07-01');
  });

  it('one user message only: no assistant prefill', () => {
    expect(params.messages).toEqual([{ role: 'user', content: 'USER' }]);
  });

  it('never sends sampling parameters or a thinking config', () => {
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking', 'stream']) expect(params).not.toHaveProperty(k);
  });
});

describe('chatModelName', () => {
  it('defaults to claude-opus-5-5, overridable with ANTHROPIC_MODEL', () => {
    expect(DEFAULT_CHAT_MODEL).toBe('claude-opus-5-5');
    expect(chatModelName({})).toBe('claude-opus-5-5');
    expect(chatModelName({ ANTHROPIC_MODEL: '  ' })).toBe('claude-opus-5-5');
    expect(chatModelName({ ANTHROPIC_MODEL: 'claude-other' })).toBe('claude-other');
  });
});

describe('createAnthropicChatModel (with a fake SDK client)', () => {
  function fakeClient(stopReason: string) {
    const seen: unknown[] = [];
    const client = {
      beta: {
        messages: {
          stream(params: unknown, options: unknown) {
            seen.push({ params, options });
            const events = [
              { type: 'message_start' },
              { type: 'content_block_start', content_block: { type: 'text', text: '' } },
              { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Not verified ' } },
              { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hidden' } },
              { type: 'content_block_delta', delta: { type: 'text_delta', text: 'yet.' } },
              { type: 'message_stop' },
            ];
            return {
              async *[Symbol.asyncIterator]() {
                yield* events;
              },
              finalMessage: async () => ({ stop_reason: stopReason, usage: { output_tokens: 12 } }),
            };
          },
        },
      },
    };
    return { client: client as unknown as Anthropic, seen };
  }

  it('yields only text deltas, then the stop reason and output tokens', async () => {
    const { client, seen } = fakeClient('end_turn');
    const model = createAnthropicChatModel(client, 'claude-opus-5-5');
    const out: ModelStreamEvent[] = [];
    for await (const e of model.stream({ system: 'S', user: 'U', maxTokens: 1024 })) out.push(e);
    expect(out).toEqual([
      { type: 'text', text: 'Not verified ' },
      { type: 'text', text: 'yet.' },
      { type: 'end', stopReason: 'end_turn', outputTokens: 12 },
    ]);
    expect(seen[0]).toMatchObject({ params: { fallbacks: 'default' }, options: { timeout: 30_000, maxRetries: 1 } });
  });

  it("passes stop_reason 'refusal' through", async () => {
    const model = createAnthropicChatModel(fakeClient('refusal').client);
    const out: ModelStreamEvent[] = [];
    for await (const e of model.stream({ system: 'S', user: 'U', maxTokens: 10 })) out.push(e);
    expect(out.at(-1)).toEqual({ type: 'end', stopReason: 'refusal', outputTokens: 12 });
  });
});

describe('the real SDK over a fake fetch (wire format)', () => {
  function sse(events: object[]): string {
    return events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  }

  it('sends the beta header, fallbacks and low effort; parses the SSE stream; key stays in the header', async () => {
    let url = '';
    let headers = new Headers();
    let body: Record<string, unknown> = {};
    const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
      url = String(input);
      headers = new Headers(init?.headers);
      body = JSON.parse(String(init?.body));
      const stream = sse([
        {
          type: 'message_start',
          message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
        },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Not verified yet.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
        { type: 'message_stop' },
      ]);
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const client = new Anthropic({ apiKey: 'sk-fixture', fetch: fakeFetch as unknown as typeof fetch, maxRetries: 0 });
    const model = createAnthropicChatModel(client, 'claude-opus-5-5');
    const out: ModelStreamEvent[] = [];
    for await (const e of model.stream({ system: 'SYS', user: 'USER', maxTokens: 1024 })) out.push(e);

    expect(url).toMatch(/^https:\/\/api\.anthropic\.com\/v1\/messages/);
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    // SDK 1.x sends the key as a bearer token (older versions used x-api-key). Never in the body.
    expect(`${headers.get('authorization') ?? ''} ${headers.get('x-api-key') ?? ''}`).toContain('sk-fixture');
    expect(JSON.stringify(body)).not.toContain('sk-fixture');
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1024,
      stream: true,
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
    });
    expect(body).not.toHaveProperty('betas'); // goes in the header, not the body
    for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) expect(body).not.toHaveProperty(k);
    expect(out).toEqual([
      { type: 'text', text: 'Not verified yet.' },
      { type: 'end', stopReason: 'end_turn', outputTokens: 5 },
    ]);
  });
});

/**
 * Optional live check against the real API (skipped without ANTHROPIC_API_KEY).
 * The guard normally refuses before calling the model when no row is usable; this asks the model DIRECTLY with
 * zero usable rows to prove the system prompt alone also makes it say "not verified" instead of guessing.
 */
describe('live model (optional)', () => {
  it.skipIf(!process.env.ANTHROPIC_API_KEY)(
    'with zero usable rows the model says "not verified" and gives no date',
    async () => {
      const row: ChatRow = {
        id: 'fixture-msc-cs:deadline',
        entity: 'program',
        entity_id: 'fixture-msc-cs',
        entity_name: 'MSc Fixture Computing at Fixture University',
        field: 'deadline',
        label: 'Application deadline',
        value: null,
        confidence: 'Unverified',
        source_url: null,
        evidence_snippet: null,
        fetched_at: null,
        official_url: 'https://fixture.example.edu/program',
      };
      const prompt = buildPrompt('What is the application deadline for Fixture University?', [row]);
      const model = createAnthropicChatModel(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }), chatModelName());
      let text = '';
      let stop: string | null = null;
      for await (const e of model.stream({ ...prompt, maxTokens: 1024 })) {
        if (e.type === 'text') text += e.text;
        else stop = e.stopReason;
      }
      expect(stop).not.toBe('refusal');
      expect(text.toLowerCase()).toContain('not verified');
      expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
    },
    60_000,
  );
});
