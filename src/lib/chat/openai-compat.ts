/**
 * Model client for answerQuestion over any OpenAI-compatible chat-completions API, streamed as SSE.
 * Used for Groq (api.groq.com) and xAI Grok (api.x.ai). Plain fetch, no SDK. Server only: the key is read in the
 * route (see provider.ts) and never reaches the browser.
 *
 *  - Low temperature: the model only explains rows (see prompt.ts). Provider-specific extras via `extraBody`.
 *  - finish_reason is mapped to the stop reasons answerQuestion already understands:
 *      'stop' -> 'end_turn', 'length' -> 'max_tokens', 'content_filter' -> 'refusal' (shows the no-AI answer).
 *  - Output tokens for the daily budget come from `usage` (stream_options.include_usage) or Groq's `x_groq.usage`.
 *  - Only `delta.content` is shown; reasoning deltas (some models stream them separately) are ignored.
 *  - 30 s timeout per attempt, 1 retry on network errors / 429 / 5xx, then the caller falls back. Offline callers (ingest)
 *    can raise `maxRetries` and set `retryBaseMs`: exponential backoff, and a Retry-After header is honoured.
 */
import type { ChatModelClient, ModelStreamEvent, ModelStreamRequest } from './answer';

export const COMPAT_TIMEOUT_MS = 30_000;
export const COMPAT_MAX_RETRIES = 1;

export interface CompatConfig {
  /** e.g. https://api.groq.com/openai/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Name used in error messages / logs, e.g. "Groq". */
  label: string;
  /** Provider-specific request fields, e.g. { reasoning_effort: 'low' }. */
  extraBody?: Record<string, unknown>;
  /** Default COMPAT_MAX_RETRIES. */
  maxRetries?: number;
  /** Backoff base in ms (doubles each retry). Default 0 = retry at once (the chat path). */
  retryBaseMs?: number;
  /** Test seam for the backoff wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** Seconds or an HTTP date in Retry-After -> ms (capped at 60 s); null when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const secs = Number(header);
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 60_000) : null;
}

export function buildCompatBody(
  req: Pick<ModelStreamRequest, 'system' | 'user' | 'maxTokens'>,
  model: string,
  extraBody: Record<string, unknown> = {},
) {
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
    ...extraBody,
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

interface CompatChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { completion_tokens?: number; prompt_tokens?: number } | null;
  x_groq?: { usage?: { completion_tokens?: number } | null } | null;
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

export function createCompatChatModel(cfg: CompatConfig, fetchImpl: typeof fetch = fetch): ChatModelClient {
  async function open(req: ModelStreamRequest): Promise<Response> {
    let lastError: unknown;
    const maxRetries = cfg.maxRetries ?? COMPAT_MAX_RETRIES;
    const wait = cfg.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let nextDelay = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0 && nextDelay > 0) await wait(nextDelay);
      nextDelay = (cfg.retryBaseMs ?? 0) * 2 ** attempt;
      const timeout = AbortSignal.timeout(COMPAT_TIMEOUT_MS);
      const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
      try {
        const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(buildCompatBody(req, cfg.model, cfg.extraBody)),
          signal,
        });
        if (res.ok && res.body) return res;
        // The provider's own short reason (no credits, unknown model, bad key…) helps diagnose from the server logs.
        // The request key is never echoed back in the response; trimmed and length-capped anyway.
        const reason = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 300);
        lastError = new Error(`${cfg.label} API returned ${res.status}${reason ? `: ${reason}` : ''}`);
        if (!retryable(res.status)) break;
        nextDelay = retryAfterMs(res.headers.get('retry-after')) ?? nextDelay;
      } catch (err) {
        if (req.signal?.aborted) throw err;
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${cfg.label} API request failed`);
  }

  return {
    async *stream(req: ModelStreamRequest): AsyncGenerator<ModelStreamEvent> {
      const res = await open(req);
      let stopReason: string | null = null;
      let outputTokens = 0;
      let inputTokens: number | undefined;
      for await (const data of sseData(res.body as ReadableStream<Uint8Array>)) {
        if (data === '[DONE]') break;
        let chunk: CompatChunk;
        try {
          chunk = JSON.parse(data) as CompatChunk;
        } catch {
          continue; // keep-alive or partial noise
        }
        const choice = chunk.choices?.[0];
        const text = choice?.delta?.content;
        if (text) yield { type: 'text', text };
        if (choice?.finish_reason) stopReason = mapFinishReason(choice.finish_reason);
        const used = chunk.usage?.completion_tokens ?? chunk.x_groq?.usage?.completion_tokens;
        if (used != null) outputTokens = used;
        if (chunk.usage?.prompt_tokens != null) inputTokens = chunk.usage.prompt_tokens;
      }
      yield { type: 'end', stopReason, outputTokens, ...(inputTokens !== undefined ? { inputTokens } : {}) };
    },
  };
}
