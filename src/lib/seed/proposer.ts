/**
 * Which model proposes values for ingest, chosen from env vars (offline scripts only; never imported by the app).
 *
 *   INGEST_PROVIDER=xai        xAI Grok over the OpenAI-compatible connector (XAI_API_KEY, XAI_MODEL)
 *   INGEST_PROVIDER=anthropic  Claude (ANTHROPIC_API_KEY, ANTHROPIC_MODEL)
 *   (unset)                    Anthropic when ANTHROPIC_API_KEY is set; otherwise NO model: use the hand workflow
 *                              (scripts/peek-page.ts + data/proposals/verified/*.json + `ingest --verify`)
 *
 * A model only PROPOSES. What is accepted is decided by reviewProposals in ./ingest.ts (verbatim snippet on the
 * official page + schema-valid value), and a second model may only VETO an accepted proposal (./review-pass.ts).
 */
import { createCompatChatModel, type CompatConfig } from '../chat/openai-compat';
import { XAI_BASE_URL } from '../chat/provider';
import { ingestModel, makeClaudeProposer, type ProposeFn } from './claude-proposer';
import type { ExtractionPrompt } from './ingest';

/** First pass: cheap and fast ($1.25 in / $2.50 out per 1M tokens on docs.x.ai/models, checked 27 Nov 2026). */
export const DEFAULT_XAI_INGEST_MODEL = 'grok-4.20-0309-non-reasoning';
/** Second pass: a different model from the first. */
export const DEFAULT_XAI_REVIEW_MODEL = 'grok-4.3';
/** USD per 1M tokens (input, output), for the cost line of the final report. */
export const XAI_PRICES: Record<string, { in: number; out: number }> = {
  'grok-4.20-0309-non-reasoning': { in: 1.25, out: 2.5 },
  'grok-4.20-0309-reasoning': { in: 1.25, out: 2.5 },
  'grok-4.3': { in: 1.25, out: 2.5 },
  'grok-4.5': { in: 2, out: 6 },
  'grok-4.6': { in: 2, out: 6 },
  'grok-4.7': { in: 2, out: 6 },
};

export interface Usage {
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
}

export interface Proposer {
  provider: 'xai' | 'anthropic';
  model: string;
  propose: ProposeFn;
  usage: Usage;
}

export type ProposerChoice = { ok: true; proposer: Proposer; reviewer: Proposer | null } | { ok: false; reason: string };

type Env = Record<string, string | undefined>;

export function newUsage(): Usage {
  return { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0 };
}

export function estimateCostUsd(model: string, u: Usage): number | null {
  const p = XAI_PRICES[model];
  return p ? (u.inputTokens * p.in + u.outputTokens * p.out) / 1_000_000 : null;
}

/** A ProposeFn over any OpenAI-compatible chat API: JSON object answer, 429/5xx backoff, token counting. */
export function makeCompatProposer(opts: {
  apiKey: string;
  model: string;
  baseUrl?: string;
  label?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxTokens?: number;
  maxRetries?: number;
  retryBaseMs?: number;
}): { propose: ProposeFn; usage: Usage } {
  const usage = newUsage();
  const cfg: CompatConfig = {
    baseUrl: opts.baseUrl ?? XAI_BASE_URL,
    apiKey: opts.apiKey,
    model: opts.model,
    label: opts.label ?? 'xAI',
    extraBody: { response_format: { type: 'json_object' } },
    maxRetries: opts.maxRetries ?? 5,
    retryBaseMs: opts.retryBaseMs ?? 2000,
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  };
  const client = createCompatChatModel(cfg, opts.fetchImpl ?? fetch);
  const propose: ProposeFn = async (prompt: ExtractionPrompt) => {
    usage.calls++;
    let text = '';
    try {
      for await (const ev of client.stream({ system: prompt.system, user: prompt.user, maxTokens: opts.maxTokens ?? 4000 })) {
        if (ev.type === 'text') text += ev.text;
        else {
          usage.outputTokens += ev.outputTokens;
          usage.inputTokens += ev.inputTokens ?? 0;
          if (ev.stopReason === 'max_tokens') throw new Error('The model answer was cut off (max_tokens)');
          if (ev.stopReason === 'refusal') throw new Error('The model declined to answer for this page');
        }
      }
    } catch (e) {
      usage.failures++;
      throw e;
    }
    return text;
  };
  return { propose, usage };
}

/** Picks the proposer (and the optional second-pass reviewer). Never throws; says why when there is none. */
export function resolveProposer(env: Env = process.env, fetchImpl?: typeof fetch): ProposerChoice {
  const wanted = env.INGEST_PROVIDER?.trim().toLowerCase();
  if (wanted && wanted !== 'xai' && wanted !== 'anthropic') {
    return { ok: false, reason: `INGEST_PROVIDER="${wanted}" is not supported (use xai or anthropic).` };
  }
  const xaiKey = env.XAI_API_KEY?.trim();
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  if (wanted === 'xai') {
    if (!xaiKey) return { ok: false, reason: 'INGEST_PROVIDER=xai but XAI_API_KEY is not set.' };
    const model = env.XAI_MODEL?.trim() || DEFAULT_XAI_INGEST_MODEL;
    const first = makeCompatProposer({ apiKey: xaiKey, model, fetchImpl });
    const reviewModel = env.XAI_REVIEW_MODEL?.trim() || DEFAULT_XAI_REVIEW_MODEL;
    const reviewer = reviewModel === model ? null : makeCompatProposer({ apiKey: xaiKey, model: reviewModel, fetchImpl });
    return {
      ok: true,
      proposer: { provider: 'xai', model, ...first },
      reviewer: reviewer ? { provider: 'xai', model: reviewModel, ...reviewer } : null,
    };
  }
  if (wanted === 'anthropic' || (!wanted && anthropicKey)) {
    if (!anthropicKey) return { ok: false, reason: 'INGEST_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.' };
    const model = ingestModel(env);
    const usage = newUsage();
    const inner = makeClaudeProposer({ model });
    const propose: ProposeFn = async (p) => {
      usage.calls++;
      try {
        return await inner(p);
      } catch (e) {
        usage.failures++;
        throw e;
      }
    };
    return { ok: true, proposer: { provider: 'anthropic', model, propose, usage }, reviewer: null };
  }
  return {
    ok: false,
    reason: 'No model key (set INGEST_PROVIDER=xai with XAI_API_KEY, or ANTHROPIC_API_KEY). Use the hand-extraction workflow: scripts/peek-page.ts, a proposals file in data/proposals/verified/, then `ingest --verify`.',
  };
}
