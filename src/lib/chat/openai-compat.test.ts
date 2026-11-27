import { describe, expect, it, vi } from 'vitest';
import type { ModelStreamEvent } from './answer';
import { buildCompatBody, createCompatChatModel, mapFinishReason } from './openai-compat';
import { chatProvider, DEFAULT_GROQ_MODEL, GROQ_BASE_URL, resolveChatProvider } from './provider';

function sse(lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // Split mid-line on purpose: the parser must buffer partial events.
      const text = lines.map((l) => `data: ${l}\n\n`).join('');
      c.enqueue(enc.encode(text.slice(0, 17)));
      c.enqueue(enc.encode(text.slice(17)));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(it: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const out: ModelStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const REQ = { system: 'sys', user: 'question', maxTokens: 300 };
const cfg = (fetchLabel = 'Groq') => ({ baseUrl: GROQ_BASE_URL, apiKey: 'secret-key', model: 'm', label: fetchLabel });

describe('resolveChatProvider', () => {
  it('Groq first, then xAI, then Anthropic; none means no AI', () => {
    expect(chatProvider({ GROQ_API_KEY: 'gsk_a', XAI_API_KEY: 'xai-b', ANTHROPIC_API_KEY: 'c' })).toBe('groq');
    expect(chatProvider({ XAI_API_KEY: 'xai-b', ANTHROPIC_API_KEY: 'c' })).toBe('xai');
    expect(chatProvider({ ANTHROPIC_API_KEY: 'c' })).toBe('anthropic');
    expect(chatProvider({ GROQ_API_KEY: '  ' })).toBeNull();
    expect(chatProvider({})).toBeNull();
  });

  it('a Groq key saved as XAI_API_KEY is used as Groq (and the reverse)', () => {
    expect(resolveChatProvider({ XAI_API_KEY: 'gsk_abc' })).toEqual({ provider: 'groq', apiKey: 'gsk_abc', model: DEFAULT_GROQ_MODEL });
    expect(resolveChatProvider({ GROQ_API_KEY: 'xai-abc' })?.provider).toBe('xai');
  });

  it('models from GROQ_MODEL / XAI_MODEL with defaults', () => {
    expect(resolveChatProvider({ GROQ_API_KEY: 'gsk_a' })?.model).toBe('openai/gpt-oss-20b');
    expect(resolveChatProvider({ GROQ_API_KEY: 'gsk_a', GROQ_MODEL: ' openai/gpt-oss-120b ' })?.model).toBe('openai/gpt-oss-120b');
    expect(resolveChatProvider({ XAI_API_KEY: 'xai-a' })?.model).toBe('grok-4');
  });
});

describe('request body', () => {
  it('system + user messages, streaming with usage, max_tokens, provider extras', () => {
    const b = buildCompatBody(REQ, 'm', { reasoning_effort: 'low' });
    expect(b.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'question' },
    ]);
    expect(b.stream).toBe(true);
    expect(b.stream_options).toEqual({ include_usage: true });
    expect(b.max_tokens).toBe(300);
    expect((b as Record<string, unknown>).reasoning_effort).toBe('low');
  });

  it('maps finish reasons to the stop reasons answerQuestion understands', () => {
    expect(mapFinishReason('stop')).toBe('end_turn');
    expect(mapFinishReason('length')).toBe('max_tokens');
    expect(mapFinishReason('content_filter')).toBe('refusal');
    expect(mapFinishReason(null)).toBeNull();
  });
});

describe('stream', () => {
  it('streams text, then end with stop reason and output tokens; key only in the bearer header', async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }),
        JSON.stringify({ choices: [{ delta: { reasoning: 'thinking…' } }] }), // never shown
        JSON.stringify({ choices: [{ delta: { content: ' world' } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], x_groq: { usage: { completion_tokens: 7 } } }),
        '[DONE]',
      ]),
    );
    const events = await collect(createCompatChatModel(cfg(), fetchMock as unknown as typeof fetch).stream(REQ));
    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'end', stopReason: 'end_turn', outputTokens: 7 },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GROQ_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-key');
    expect(String(init.body)).not.toContain('secret-key');
  });

  it('a content filter becomes a refusal (the caller then shows the no-AI answer)', async () => {
    const fetchMock = vi.fn(async () => sse([JSON.stringify({ choices: [{ delta: {}, finish_reason: 'content_filter' }] }), '[DONE]']));
    const events = await collect(createCompatChatModel(cfg(), fetchMock as unknown as typeof fetch).stream(REQ));
    expect(events.at(-1)).toEqual({ type: 'end', stopReason: 'refusal', outputTokens: 0 });
  });

  it("retries once on 5xx, then throws with the provider's reason; never retries a 401", async () => {
    const fail = vi.fn(async () => new Response('down', { status: 503 }));
    await expect(collect(createCompatChatModel(cfg(), fail as unknown as typeof fetch).stream(REQ))).rejects.toThrow(
      'Groq API returned 503: down',
    );
    expect(fail).toHaveBeenCalledTimes(2);

    const unauth = vi.fn(async () => new Response('{"error":"Invalid API Key"}', { status: 401 }));
    await expect(collect(createCompatChatModel(cfg('xAI'), unauth as unknown as typeof fetch).stream(REQ))).rejects.toThrow(
      'xAI API returned 401: {"error":"Invalid API Key"}',
    );
    expect(unauth).toHaveBeenCalledTimes(1);
  });
});
