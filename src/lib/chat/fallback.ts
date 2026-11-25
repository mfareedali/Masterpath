/**
 * Deterministic, no-AI answer: a short plain-text list of the retrieved rows.
 * Used when ANTHROPIC_API_KEY is missing, the token budget is used up, the API fails or the model declines.
 * It NEVER adds facts: every value, label and link comes straight from the rows.
 */
import { isUsable } from '@/lib/confidence';
import type { ChatRow, FallbackReason } from './types';

const INTRO: Record<FallbackReason, string> = {
  no_model: 'Here are the facts from MastersPath:',
  budget: 'AI summaries are paused for today, so here are the facts from MastersPath:',
  model_error: 'The AI summary is not available right now, so here are the facts from MastersPath:',
  model_refusal: 'Here are the facts from MastersPath:',
  unsupported_numbers: 'Here are the facts from MastersPath, exactly as stored:',
  empty: 'Here are the facts from MastersPath:',
};

export const FALLBACK_OUTRO = 'Always check the official page before you apply or pay anyone.';

/** Added when any row is about visas, work rights, residence or citizenship. */
export const NOT_ADVICE_LINE = 'This is not legal or immigration advice.';

const IMMIGRATION_FIELDS = new Set<ChatRow['field']>([
  'citizenship_rule',
  'citizenship_update',
  'dual_nationality_destination',
  'pakistan_dual_nationality',
  'post_study_work',
  'pr_route',
  'proof_of_funds',
]);

function rowLine(r: ChatRow): string {
  const head = `- ${r.label} (${r.entity_name})`;
  if (r.confidence === 'Conflict' && r.sources && r.sources.length > 0) {
    const both = r.sources.map((s, i) => `source ${i + 1} says ${s.value ?? 'no value'} (${s.source_url ?? 'no link'})`).join('; ');
    return `${head}: Sources disagree: ${both} — Conflict`;
  }
  if (!isUsable(r.confidence) || r.value == null) {
    return r.official_url ? `${head}: Not verified yet — Official page: ${r.official_url}` : `${head}: Not verified yet`;
  }
  const source = r.source_url ? ` — Source: ${r.source_url}` : '';
  return `${head}: ${r.value} — ${r.confidence}${source}`;
}

export function formatFallbackAnswer(rows: ChatRow[], reason: FallbackReason = 'no_model'): string {
  if (rows.length === 0) {
    return "I can only answer from verified data in MastersPath, and I don't have data on that yet.";
  }
  const immigration = rows.some((r) => IMMIGRATION_FIELDS.has(r.field));
  return [INTRO[reason], ...rows.map(rowLine), FALLBACK_OUTRO, ...(immigration ? [NOT_ADVICE_LINE] : [])].join('\n');
}
