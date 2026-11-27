/**
 * Which AI provider the chat uses, decided from server env vars only (keys never reach the browser).
 *
 * Order: Groq (GROQ_API_KEY) -> xAI Grok (XAI_API_KEY) -> Anthropic Claude (ANTHROPIC_API_KEY) -> no AI (the
 * deterministic answer built from the same rows).
 * Groq and Grok are easy to mix up, so a Groq key (prefix "gsk_") saved under XAI_API_KEY is treated as Groq, and
 * an xAI key (prefix "xai-") saved under GROQ_API_KEY as xAI.
 * The privacy page uses PROVIDER_LABEL so it always names the company that actually receives questions.
 */
export type ChatProvider = 'groq' | 'xai' | 'anthropic';

export interface ResolvedProvider {
  provider: ChatProvider;
  apiKey: string;
  model: string;
}

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const XAI_BASE_URL = 'https://api.x.ai/v1';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';
export const DEFAULT_XAI_MODEL = 'grok-4';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5';

type Env = Record<string, string | undefined>;

function keyKind(key: string): 'groq' | 'xai' | null {
  if (key.startsWith('gsk_')) return 'groq';
  if (key.startsWith('xai-')) return 'xai';
  return null;
}

export function resolveChatProvider(env: Env = process.env): ResolvedProvider | null {
  const groqVar = env.GROQ_API_KEY?.trim();
  const xaiVar = env.XAI_API_KEY?.trim();
  const candidates: { key: string; declared: 'groq' | 'xai' }[] = [];
  if (groqVar) candidates.push({ key: groqVar, declared: 'groq' });
  if (xaiVar) candidates.push({ key: xaiVar, declared: 'xai' });
  // A key's own prefix beats the variable it was saved under; Groq first when both exist.
  const typed = candidates.map((c) => ({ key: c.key, kind: keyKind(c.key) ?? c.declared }));
  const pick = typed.find((c) => c.kind === 'groq') ?? typed.find((c) => c.kind === 'xai');
  if (pick?.kind === 'groq') {
    return { provider: 'groq', apiKey: pick.key, model: env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL };
  }
  if (pick?.kind === 'xai') {
    return { provider: 'xai', apiKey: pick.key, model: env.XAI_MODEL?.trim() || DEFAULT_XAI_MODEL };
  }
  const anthropic = env.ANTHROPIC_API_KEY?.trim();
  if (anthropic) {
    return { provider: 'anthropic', apiKey: anthropic, model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL };
  }
  return null;
}

export function chatProvider(env: Env = process.env): ChatProvider | null {
  return resolveChatProvider(env)?.provider ?? null;
}

/** For the privacy page: "…to <company>'s API. <writer> uses them to write the answer." */
export const PROVIDER_LABEL: Record<ChatProvider, { company: string; writer: string }> = {
  groq: { company: 'Groq', writer: 'An open model hosted by Groq' },
  xai: { company: 'xAI', writer: 'xAI’s model, Grok,' },
  anthropic: { company: 'Anthropic', writer: 'Anthropic’s model, Claude,' },
};
