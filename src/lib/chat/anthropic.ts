/**
 * The real model client for answerQuestion, using the official Anthropic SDK (streaming, beta messages endpoint).
 *
 *  - Model: ANTHROPIC_MODEL or 'claude-opus-5-5'. Low effort: the model only explains rows.
 *  - Server-side refusal fallback: beta 'server-side-fallback-2026-07-01' + fallbacks: 'default'.
 *  - No temperature/top_p/top_k, no thinking config (Opus 5.5 always runs adaptive thinking), no assistant prefill.
 *  - stop_reason 'refusal' is passed through; answerQuestion then shows the deterministic fallback.
 *
 * The client instance is created in the route (server only) so the API key never reaches the browser.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { ChatModelClient, ModelStreamEvent, ModelStreamRequest } from './answer';

export const DEFAULT_CHAT_MODEL = 'claude-opus-5-5';
export const SERVER_SIDE_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Per-attempt HTTP timeout and retries. Short: a slow answer falls back to the deterministic list. */
export const MODEL_TIMEOUT_MS = 30_000;
export const MODEL_MAX_RETRIES = 1;

export function chatModelName(env: Record<string, string | undefined> = process.env): string {
  return env.ANTHROPIC_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

type StreamParams = Parameters<Anthropic['beta']['messages']['stream']>[0];

export function buildStreamParams(req: Pick<ModelStreamRequest, 'system' | 'user' | 'maxTokens'>, model: string): StreamParams {
  return {
    model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: [{ role: 'user', content: req.user }],
    output_config: { effort: 'low' },
    betas: [SERVER_SIDE_FALLBACK_BETA],
    fallbacks: 'default',
  };
}

export function createAnthropicChatModel(client: Anthropic, model: string = chatModelName()): ChatModelClient {
  return {
    async *stream(req: ModelStreamRequest): AsyncGenerator<ModelStreamEvent> {
      const stream = client.beta.messages.stream(buildStreamParams(req, model), {
        signal: req.signal,
        timeout: MODEL_TIMEOUT_MS,
        maxRetries: MODEL_MAX_RETRIES,
      });
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }
      const final = await stream.finalMessage();
      yield { type: 'end', stopReason: final.stop_reason, outputTokens: final.usage?.output_tokens ?? 0 };
    },
  };
}
