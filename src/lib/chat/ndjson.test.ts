import { describe, expect, it } from 'vitest';
import { NDJSON_CONTENT_TYPE, NdjsonDecoder, encodeEvent, eventsToStream, parseChatEvent } from './ndjson';
import type { ChatEvent } from './types';

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

async function* gen(events: ChatEvent[], failAfter?: number): AsyncGenerator<ChatEvent> {
  let i = 0;
  for (const e of events) {
    if (failAfter !== undefined && i === failAfter) throw new Error('boom');
    i++;
    yield e;
  }
}

const EVENTS: ChatEvent[] = [
  { type: 'meta', mode: 'refusal', reason: 'not_verified', rows: [] },
  { type: 'text', delta: 'line one\nline "two"' },
  { type: 'done' },
];

describe('encodeEvent', () => {
  it('one JSON object per line, newlines inside strings escaped', () => {
    const line = encodeEvent({ type: 'text', delta: 'a\nb' });
    expect(line).toBe('{"type":"text","delta":"a\\nb"}\n');
    expect(line.split('\n')).toHaveLength(2);
  });

  it('content type', () => {
    expect(NDJSON_CONTENT_TYPE).toMatch(/^application\/x-ndjson/);
  });
});

describe('eventsToStream', () => {
  it('meta -> text -> done, one line each', async () => {
    const body = await readAll(eventsToStream(gen(EVENTS)));
    const lines = body.trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => JSON.parse(l))).toEqual(EVENTS);
  });

  it('an exception becomes an error event followed by done (the client never hangs)', async () => {
    const errors: unknown[] = [];
    const body = await readAll(eventsToStream(gen(EVENTS, 1), (e) => errors.push(e)));
    const types = body.trimEnd().split('\n').map((l) => JSON.parse(l).type);
    expect(types).toEqual(['meta', 'error', 'done']);
    expect(errors).toHaveLength(1);
  });

  it('cancel stops the generator', async () => {
    let finished = false;
    async function* g(): AsyncGenerator<ChatEvent> {
      try {
        yield { type: 'text', delta: 'a' };
        yield { type: 'text', delta: 'b' };
      } finally {
        finished = true;
      }
    }
    const reader = eventsToStream(g()).getReader();
    await reader.read();
    await reader.cancel();
    expect(finished).toBe(true);
  });
});

describe('NdjsonDecoder', () => {
  it('handles lines split across chunks', () => {
    const d = new NdjsonDecoder();
    const full = EVENTS.map(encodeEvent).join('');
    const out: ChatEvent[] = [];
    for (let i = 0; i < full.length; i += 7) out.push(...d.push(full.slice(i, i + 7)));
    out.push(...d.flush());
    expect(out).toEqual(EVENTS);
  });

  it('skips malformed and unknown lines', () => {
    const d = new NdjsonDecoder();
    const out = d.push('not json\n{"type":"weird"}\n{"type":"text","delta":1}\n{"type":"done"}\n');
    expect(out).toEqual([{ type: 'done' }]);
  });

  it('parseChatEvent validates modes and normalises reset/error', () => {
    expect(parseChatEvent({ type: 'meta', mode: 'hack', rows: [] })).toBeNull();
    expect(parseChatEvent({ type: 'reset', reason: 'nonsense' })).toEqual({ type: 'reset', mode: 'fallback', reason: 'model_error' });
    expect(parseChatEvent({ type: 'error' })).toEqual({ type: 'error', message: 'Something went wrong.' });
    expect(parseChatEvent(null)).toBeNull();
  });
});
