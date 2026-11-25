/**
 * Browser side of the chat stream: POST /api/chat and decode the NDJSON response in batches
 * (one batch per network chunk, so the UI re-renders once per chunk, not once per token).
 * No React here, so it is unit-testable with plain Response objects.
 */
import { NETWORK_ERROR_MESSAGE, httpErrorMessage } from './client-state';
import { NdjsonDecoder } from './ndjson';
import type { ChatEvent, ChatRequest } from './types';

export const CHAT_ENDPOINT = '/api/chat';

export type StartChatResult = { ok: true; batches: AsyncGenerator<ChatEvent[]> } | { ok: false; message: string };

/** Read an NDJSON body as batches of events. Malformed lines are skipped by the decoder. */
export async function* readChatEventBatches(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent[]> {
  const reader = body.getReader();
  const text = new TextDecoder();
  const lines = new NdjsonDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const batch = lines.push(text.decode(value, { stream: true }));
      if (batch.length > 0) yield batch;
    }
    const rest = [...lines.push(text.decode()), ...lines.flush()];
    if (rest.length > 0) yield rest;
  } finally {
    reader.releaseLock();
  }
}

function retryAfterSeconds(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/**
 * Send one question. Network failures and non-OK statuses become a friendly message (never thrown),
 * except an abort, which is re-thrown so the caller can ignore it.
 */
export async function startChat(
  payload: ChatRequest,
  opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; endpoint?: string } = {},
): Promise<StartChatResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(opts.endpoint ?? CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify(payload),
      signal: opts.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    return { ok: false, message: NETWORK_ERROR_MESSAGE };
  }
  if (!res.ok || !res.body) {
    return { ok: false, message: httpErrorMessage(res.status, retryAfterSeconds(res)) };
  }
  return { ok: true, batches: readChatEventBatches(res.body) };
}
