import { describe, expect, it, vi } from 'vitest';
import type { ModelStreamEvent } from './answer';
import { chatProvider } from './provider';
import { buildXaiBody, createXaiChatModel, mapFinishReason, xaiModelName, XAI_BASE_URL } from './xai';

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

describe('chatProvider', () => {
  it('xAI wins when its key is set; Anthropic next; none means no AI', () => {
    expect(chatProvider({ XAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'a' })).toBe('xai');
    expect(chatProvider({ ANTHROPIC_API_KEY: 'a' })).toBe('anthropic');
    expect(chatProvider({ XAI_API_KEY: '  ' })).toBeNull();
    expect(chatProvider({})).toBeNull();
  });
});

describe('xAI request', () => {
  it('model from XAI_MODEL with a default', () => {
    expect(xaiModelName({})).toBe('grok-4');
    expect(xaiModelName({ XAI_MODEL: ' grok-4.5 ' })).toBe('grok-4.5');
  });

  it('body: system + user messages, streaming with usage, max_tokens', () => {
    const b = buildXaiBody(REQ, 'grok-4');
    expect(b.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'question' },
    ]);
    expect(b.stream).toBe(true);
    expect(b.stream_options).toEqual({ include_usage: true });
    expect(b.max_tokens).toBe(300);
  });

  it('maps finish reasons to the stop reasons answerQuestion understands', () => {
    expect(mapFinishReason('stop')).toBe('end_turn');
    expect(mapFinishReason('length')).toBe('max_tokens');
    expect(mapFinishReason('content_filter')).toBe('refusal');
    expect(mapFinishReason(null)).toBeNull();
  });
});

describe('xAI stream', () => {
  it('streams text deltas, then end with the stop reason and output tokens; sends the key only as a bearer header', async () => {
    const fetchMock = vi.fn(async () =>
      sse([
        JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }),
        JSON.stringify({ choices: [{ delta: { content: ' world' } }] }),
        JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        JSON.stringify({ choices: [], usage: { completion_tokens: 7 } }),
        '[DONE]',
      ]),
    );
    const events = await collect(createXaiChatModel('secret-key', 'grok-4', fetchMock as unknown as typeof fetch).stream(REQ));
    expect(events).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' },
      { type: 'end', stopReason: 'end_turn', outputTokens: 7 },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${XAI_BASE_URL}/chat/completions`);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret-key');
    expect(String(init.body)).not.toContain('secret-key');
  });

  it('a content filter becomes a refusal (the caller then shows the no-AI answer)', async () => {
    const fetchMock = vi.fn(async () => sse([JSON.stringify({ choices: [{ delta: {}, finish_reason: 'content_filter' }] }), '[DONE]']));
    const events = await collect(createXaiChatModel('k', 'grok-4', fetchMock as unknown as typeof fetch).stream(REQ));
    expect(events.at(-1)).toEqual({ type: 'end', stopReason: 'refusal', outputTokens: 0 });
  });

  it('retries once on 5xx, then throws; never retries a 401', async () => {
    const fail = vi.fn(async () => new Response('down', { status: 503 }));
    await expect(collect(createXaiChatModel('k', 'grok-4', fail as unknown as typeof fetch).stream(REQ))).rejects.toThrow('503');
    expect(fail).toHaveBeenCalledTimes(2);

    const unauth = vi.fn(async () => new Response('no', { status: 401 }));
    await expect(collect(createXaiChatModel('k', 'grok-4', unauth as unknown as typeof fetch).stream(REQ))).rejects.toThrow('401');
    expect(unauth).toHaveBeenCalledTimes(1);
  });
});
