/**
 * The ONLY place the ingestion script talks to Claude. Offline use only (scripts/ingest.ts); never imported by the app.
 * The model proposes values; src/lib/seed/ingest.ts decides what is accepted. No tools are given to the model.
 */
import Anthropic from '@anthropic-ai/sdk';
import { proposalOutputSchema, type ExtractionPrompt } from './ingest';

export const DEFAULT_INGEST_MODEL = 'claude-opus-5-5';

/** Turns a prompt into the model's raw text answer. Injectable so tests never call the API. */
export type ProposeFn = (prompt: ExtractionPrompt) => Promise<string>;

/** The slice of the SDK client we use (lets tests pass a fake). */
export interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

export function ingestModel(env: Record<string, string | undefined> = process.env): string {
  return env.ANTHROPIC_MODEL?.trim() || DEFAULT_INGEST_MODEL;
}

function textOf(message: Anthropic.Message): string {
  if (message.stop_reason === 'refusal') throw new Error('The model declined to answer for this page');
  if (message.stop_reason === 'max_tokens') throw new Error('The model answer was cut off (max_tokens)');
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function isBadRequest(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 400;
}

/**
 * Claude proposer: low effort, JSON only, no tools. Uses structured output (output_config.format); if the chosen
 * model rejects it (HTTP 400), retries once with the same JSON instructions and no format (the answer is parsed
 * defensively either way).
 */
export function makeClaudeProposer(opts: { model: string; client?: MessagesClient; maxTokens?: number }): ProposeFn {
  const client: MessagesClient = opts.client ?? new Anthropic();
  const maxTokens = opts.maxTokens ?? 8000;
  return async (prompt) => {
    const base: Anthropic.MessageCreateParamsNonStreaming = {
      model: opts.model,
      max_tokens: maxTokens,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      output_config: { effort: 'low' },
    };
    try {
      return textOf(
        await client.messages.create({
          ...base,
          output_config: { effort: 'low', format: { type: 'json_schema', schema: proposalOutputSchema(prompt.fields) } },
        }),
      );
    } catch (e) {
      if (!isBadRequest(e)) throw e;
      return textOf(await client.messages.create(base));
    }
  };
}
