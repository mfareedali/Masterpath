/**
 * NDJSON (one JSON object per line) encoding for the chat stream, plus a tolerant decoder for the browser.
 * JSON.stringify escapes newlines inside strings, so one event is always exactly one line.
 */
import type { ChatEvent, FallbackReason, RefusalReason } from './types';

export const NDJSON_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';

export function encodeEvent(event: ChatEvent): string {
  return JSON.stringify(event) + '\n';
}

/** Turn an async iterable of events into a byte stream. Stops pulling when the client cancels. */
export function eventsToStream(events: AsyncIterable<ChatEvent>, onError?: (err: unknown) => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const it = events[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(encodeEvent(value)));
      } catch (err) {
        onError?.(err);
        controller.enqueue(encoder.encode(encodeEvent({ type: 'error', message: 'Something went wrong. Please try again.' })));
        controller.enqueue(encoder.encode(encodeEvent({ type: 'done' })));
        controller.close();
      }
    },
    async cancel() {
      await it.return?.();
    },
  });
}

const MODES = new Set(['refusal', 'answer', 'fallback', 'general']);
const REFUSAL_REASONS = new Set<RefusalReason>([
  'not_verified',
  'conflict',
  'no_data',
  'prediction',
  'legal',
  'dishonest',
  'unknown_name',
  'getting_started',
]);
const FALLBACK_REASONS = new Set<FallbackReason>(['no_model', 'budget', 'model_error', 'model_refusal', 'unsupported_numbers', 'empty']);

/** Validate one decoded line. Unknown or malformed events are dropped (returns null). */
export function parseChatEvent(raw: unknown): ChatEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  switch (e.type) {
    case 'meta':
      if (typeof e.mode !== 'string' || !MODES.has(e.mode) || !Array.isArray(e.rows)) return null;
      return e as unknown as ChatEvent;
    case 'text':
      return typeof e.delta === 'string' ? (e as unknown as ChatEvent) : null;
    case 'reset':
      // A general answer that failed is replaced by the rules' reply (refusal); anything else is a fallback.
      if (e.mode === 'refusal' && REFUSAL_REASONS.has(e.reason as RefusalReason)) {
        return { type: 'reset', mode: 'refusal', reason: e.reason as RefusalReason };
      }
      return {
        type: 'reset',
        mode: 'fallback',
        reason: FALLBACK_REASONS.has(e.reason as FallbackReason) ? (e.reason as FallbackReason) : 'model_error',
      };
    case 'error':
      return { type: 'error', message: typeof e.message === 'string' ? e.message : 'Something went wrong.' };
    case 'done':
      return { type: 'done' };
    default:
      return null;
  }
}

/** Incremental line decoder: push text chunks as they arrive, get complete events back. */
export class NdjsonDecoder {
  private buffer = '';

  push(chunk: string): ChatEvent[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.flatMap((l) => this.parseLine(l));
  }

  flush(): ChatEvent[] {
    const rest = this.buffer;
    this.buffer = '';
    return this.parseLine(rest);
  }

  private parseLine(line: string): ChatEvent[] {
    const t = line.trim();
    if (!t) return [];
    try {
      const ev = parseChatEvent(JSON.parse(t));
      return ev ? [ev] : [];
    } catch {
      return [];
    }
  }
}
