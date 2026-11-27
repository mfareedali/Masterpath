/**
 * answerQuestion: retrieve -> guard -> (model | deterministic fallback), as a stream of ChatEvents.
 *
 * Code decides, the model explains:
 *  - When the rows can answer, the model only explains them (answer mode), with the number/date post-check.
 *  - When they cannot (no data, not verified, conflict, prediction, legal, greeting…), the model answers from
 *    general knowledge (general mode, labelled in the UI). Fraud help ('dishonest') never reaches the model.
 *    With no model or budget, or if that call fails, the guard's own reply is shown (refusal mode).
 *  - The model only sees the selected rows, inside an untrusted <rows> block.
 *  - No API key, no budget, an API error, a model refusal, or an answer containing a number or date that is not
 *    in the rows -> the deterministic fallback list (fallback mode), which never adds facts.
 *
 * Everything is injectable (dataset, now, model client, budget) so this is fully testable without a server.
 */
import { isUsable } from '@/lib/confidence';
import type { TokenBudgetGate } from './budget';
import { formatFallbackAnswer } from './fallback';
import { guard } from './guard';
import { buildGeneralPrompt, buildPrompt, truncateSnippet } from './prompt';
import { retrieve, type ChatDataset } from './retrieve';
import type { ChatEvent, ChatRow, FallbackReason } from './types';
import { unsupportedFacts } from './verify';

export interface ModelStreamRequest {
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export type ModelStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'end'; stopReason: string | null; outputTokens: number };

/** The only thing answerQuestion needs from an LLM. See ./anthropic.ts for the real implementation. */
export interface ChatModelClient {
  stream(req: ModelStreamRequest): AsyncIterable<ModelStreamEvent>;
}

export interface AnswerInput {
  question: string;
  programId?: string;
  country?: string;
  /** The student's field from their profile (null = unknown: the default field is used). */
  field?: string | null;
}

export interface AnswerDeps {
  dataset: ChatDataset;
  now: Date;
  /** null = no API key configured -> deterministic fallback. */
  model: ChatModelClient | null;
  budget?: TokenBudgetGate;
  signal?: AbortSignal;
  maxTokens?: number;
  log?: (message: string, err?: unknown) => void;
  /**
   * Answer what the rows cannot from the model's general knowledge ('general' mode). On in the route unless
   * CHAT_GENERAL_KNOWLEDGE=0; off by default here so the strict, data-only behaviour stays tested.
   */
  generalKnowledge?: boolean;
}

export const DEFAULT_MAX_TOKENS = 1024;

/**
 * Rows as sent to the browser: evidence snippets truncated to 300 characters, and Unverified values withheld
 * (the UI shows "Not verified yet" for them, so an unproven value never travels to the page).
 */
export function toPublicRow(r: ChatRow): ChatRow {
  const withheld = !isUsable(r.confidence) && r.confidence !== 'Conflict';
  return {
    ...r,
    value: withheld ? null : r.value,
    evidence_snippet: withheld ? null : truncateSnippet(r.evidence_snippet),
    sources: r.sources?.map((s) => ({ ...s, evidence_snippet: truncateSnippet(s.evidence_snippet) })),
  };
}

function estimate(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function* answerQuestion(input: AnswerInput, deps: AnswerDeps): AsyncGenerator<ChatEvent> {
  const retrieval = retrieve(
    input.question,
    { programId: input.programId, country: input.country, field: input.field },
    deps.dataset,
    deps.now,
  );
  const decision = guard(input.question, retrieval);

  if (decision.mode === 'refusal') {
    // "Answer everything" (owner's decision): the model answers from general knowledge, labelled as such in the UI.
    // Fraud help is never sent to the model. Without a model or budget, or if the call fails, the rules' reply stays.
    const canGeneral =
      deps.generalKnowledge === true && decision.reason !== 'dishonest' && deps.model && (!deps.budget || deps.budget.canSpend());
    if (canGeneral && deps.model) {
      yield* generalAnswer(input.question, decision, deps.model, deps);
      return;
    }
    yield* refusalEvents(decision, false);
    return;
  }

  const rows = decision.rows;
  const publicRows = rows.map(toPublicRow);

  function* fallback(reason: FallbackReason, afterStart: boolean): Generator<ChatEvent> {
    if (afterStart) yield { type: 'reset', mode: 'fallback', reason };
    else yield { type: 'meta', mode: 'fallback', reason, rows: publicRows };
    yield { type: 'text', delta: formatFallbackAnswer(rows, reason) };
    yield { type: 'done' };
  }

  if (!deps.model) {
    yield* fallback('no_model', false);
    return;
  }
  if (deps.budget && !deps.budget.canSpend()) {
    yield* fallback('budget', false);
    return;
  }

  const prompt = buildPrompt(input.question, rows, { generalAdvice: deps.generalKnowledge === true });
  let text = '';
  let stopReason: string | null = null;
  let outputTokens = 0;

  // Rows first: the browser can show "Sources used" while the model is still thinking (slow 4G, cold starts).
  yield { type: 'meta', mode: 'answer', rows: publicRows };

  try {
    for await (const ev of deps.model.stream({ ...prompt, maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS, signal: deps.signal })) {
      if (ev.type === 'text') {
        if (!ev.text) continue;
        text += ev.text;
        yield { type: 'text', delta: ev.text };
      } else {
        stopReason = ev.stopReason;
        outputTokens = ev.outputTokens;
      }
    }
  } catch (err) {
    deps.budget?.record(estimate(text));
    if (deps.signal?.aborted) return; // the browser went away; nobody is listening
    deps.log?.('[chat] model call failed, using deterministic fallback', err);
    yield* fallback('model_error', true);
    return;
  }

  deps.budget?.record(outputTokens > 0 ? outputTokens : estimate(text));

  if (stopReason === 'refusal') {
    // The whole fallback chain declined (or a mid-stream decline was not rescued): discard the partial text.
    yield* fallback('model_refusal', true);
    return;
  }
  if (text.trim() === '') {
    yield* fallback('empty', true);
    return;
  }
  const invented = unsupportedFacts(text, rows, input.question);
  if (invented.length > 0) {
    deps.log?.(`[chat] answer contained numbers or dates not in the rows (${invented.join(', ')}), using deterministic fallback`);
    yield* fallback('unsupported_numbers', true);
    return;
  }
  if (stopReason === 'max_tokens') yield { type: 'text', delta: '…' };
  yield { type: 'done' };
}

type RefusalDecision = Extract<ReturnType<typeof guard>, { mode: 'refusal' }>;

/** The rules' own reply. `afterStart`: replaces general-mode text that was already streamed. */
function* refusalEvents(decision: RefusalDecision, afterStart: boolean): Generator<ChatEvent> {
  if (afterStart) {
    yield { type: 'reset', mode: 'refusal', reason: decision.reason };
  } else {
    yield {
      type: 'meta',
      mode: 'refusal',
      reason: decision.reason,
      rows: decision.rows.map(toPublicRow),
      pointers: decision.pointers,
      ...(decision.suggestion ? { suggestion: decision.suggestion } : {}),
    };
  }
  yield { type: 'text', delta: decision.text };
  yield { type: 'done' };
}

/**
 * General-knowledge answer for a question the rows cannot answer. Any reference rows (e.g. a not-verified
 * deadline with its official page) are passed along so the model can cite the official link. The meta carries the
 * rules' reason so the UI can say why this is not a sourced answer.
 */
async function* generalAnswer(
  question: string,
  decision: RefusalDecision,
  model: ChatModelClient,
  deps: AnswerDeps,
): AsyncGenerator<ChatEvent> {
  yield { type: 'meta', mode: 'general', reason: decision.reason, rows: decision.rows.map(toPublicRow), pointers: decision.pointers };
  const prompt = buildGeneralPrompt(question, decision.rows);
  let text = '';
  let stopReason: string | null = null;
  let outputTokens = 0;
  try {
    for await (const ev of model.stream({ ...prompt, maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS, signal: deps.signal })) {
      if (ev.type === 'text') {
        if (!ev.text) continue;
        text += ev.text;
        yield { type: 'text', delta: ev.text };
      } else {
        stopReason = ev.stopReason;
        outputTokens = ev.outputTokens;
      }
    }
  } catch (err) {
    deps.budget?.record(estimate(text));
    if (deps.signal?.aborted) return;
    deps.log?.('[chat] general answer failed, showing the rules reply', err);
    yield* refusalEvents(decision, true);
    return;
  }
  deps.budget?.record(outputTokens > 0 ? outputTokens : estimate(text));
  if (stopReason === 'refusal' || text.trim() === '') {
    yield* refusalEvents(decision, true);
    return;
  }
  if (stopReason === 'max_tokens') yield { type: 'text', delta: '…' };
  yield { type: 'done' };
}

/** Test/helper: run answerQuestion to completion and fold the events like the browser does. */
export async function collectAnswer(
  input: AnswerInput,
  deps: AnswerDeps,
): Promise<{ events: ChatEvent[]; mode: string | null; reason: string | undefined; text: string; rows: ChatRow[] }> {
  const events: ChatEvent[] = [];
  let mode: string | null = null;
  let reason: string | undefined;
  let text = '';
  let rows: ChatRow[] = [];
  for await (const ev of answerQuestion(input, deps)) {
    events.push(ev);
    if (ev.type === 'meta') {
      mode = ev.mode;
      reason = ev.reason;
      rows = ev.rows;
    } else if (ev.type === 'text') text += ev.delta;
    else if (ev.type === 'reset') {
      mode = ev.mode;
      reason = ev.reason;
      text = '';
    }
  }
  return { events, mode, reason, text, rows };
}
