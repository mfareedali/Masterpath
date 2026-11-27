/**
 * Model client for answerQuestion using xAI's Grok (OpenAI-compatible chat completions, streamed as SSE).
 * Plain fetch, no SDK. Server only: the key is read in the route and never reaches the browser.
 *
 *  - Model: XAI_MODEL or 'grok-4'. Low temperature: the model only explains rows (see prompt.ts).
 *  - finish_reason is mapped to the stop reasons answerQuestion already understands:
 *      'stop' -> 'end_turn', 'length' -> 'max_tokens', 'content_filter' -> 'refusal' (shows the no-AI answer).
 *  - Output tokens come from the final usage chunk (stream_options.include_usage) for the daily budget.
 *  - 30 s timeout per attempt, 1 retry on network errors / 429 / 5xx, then the caller falls back.
 */
import type { ChatModelClient, ModelStreamEvent, ModelStreamRequest } from './answer';

export const XAI_BASE_URL = 'https://api.x.ai/v1';
export const DEFAULT_XAI_MODEL = 'grok-4';
export const XAI_TIMEOUT_MS = 30_000;
export const XAI_MAX_RETRIES = 1;

export function xaiModelName(env: Record<string, string | undefined> = process.env): string {
  return env.XAI_MODEL?.trim() || DEFAULT_XAI_MODEL;
}

export function buildXaiBody(req: Pick<ModelStreamRequest, 'system' | 'user' | 'maxTokens'>, model: string) {
  return {
    model,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: req.maxTokens,
    temperature: 0.2,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
  };
}

const FINISH_TO_STOP: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  content_filter: 'refusal',
};

export function mapFinishReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return FINISH_TO_STOP[reason] ?? reason;
}

interface XaiChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { completion_tokens?: number } | null;
}

/** Splits an SSE byte stream into `data:` payloads (one per event). */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trimStart();
      }
    }
    const last = buf.trim();
    if (last.startsWith('data:')) yield last.slice(5).trimStart();
  } finally {
    reader.releaseLock();
  }
}

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export function createXaiChatModel(
  apiKey: string,
  model: string = xaiModelName(),
  fetchImpl: typeof fetch = fetch,
): ChatModelClient {
  async function open(req: ModelStreamRequest): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= XAI_MAX_RETRIES; attempt++) {
      const timeout = AbortSignal.timeout(XAI_TIMEOUT_MS);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      try {
        const res = await fetchImpl(`${XAI_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(buildXaiBody(req, model)),
          signal,
        });
        if (res.ok && res.body) return res;
        // Never log the key; the status is enough to diagnose.
        lastError = new Error(`xAI API returned ${res.status}`);
        if (!retryable(res.status)) break;
      } catch (err) {
        if (req.signal?.aborted) throw err;
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('xAI API request failed');
  }

  return {
    async *stream(req: ModelStreamRequest): AsyncGenerator<ModelStreamEvent> {
      const res = await open(req);
      let stopReason: string | null = null;
      let outputTokens = 0;
      for await (const data of sseData(res.body as ReadableStream<Uint8Array>)) {
        if (data === '[DONE]') break;
        let chunk: XaiChunk;
        try {
          chunk = JSON.parse(data) as XaiChunk;
        } catch {
          continue; // keep-alive or partial noise
        }
        const choice = chunk.choices?.[0];
        const text = choice?.delta?.content;
        if (text) yield { type: 'text', text };
        if (choice?.finish_reason) stopReason = mapFinishReason(choice.finish_reason);
        if (chunk.usage?.completion_tokens != null) outputTokens = chunk.usage.completion_tokens;
      }
      yield { type: 'end', stopReason, outputTokens };
    },
  };
}
