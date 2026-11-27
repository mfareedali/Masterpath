/**
 * Which AI provider the chat uses, decided from server env vars only (keys never reach the browser).
 * xAI (Grok) wins when XAI_API_KEY is set; otherwise Anthropic (Claude) when ANTHROPIC_API_KEY is set; otherwise
 * no AI: the chat answers with the deterministic fallback built from the same rows.
 * The privacy page uses providerLabel() so it always names the company that actually receives questions.
 */
export type ChatProvider = 'xai' | 'anthropic';

export function chatProvider(env: Record<string, string | undefined> = process.env): ChatProvider | null {
  if (env.XAI_API_KEY?.trim()) return 'xai';
  if (env.ANTHROPIC_API_KEY?.trim()) return 'anthropic';
  return null;
}

export const PROVIDER_LABEL: Record<ChatProvider, { company: string; model: string }> = {
  xai: { company: 'xAI', model: 'Grok' },
  anthropic: { company: 'Anthropic', model: 'Claude' },
};
