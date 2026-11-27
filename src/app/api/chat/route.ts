/**
 * POST /api/chat — answers ONLY from MastersPath database rows, streamed as NDJSON:
 *   {"type":"meta","mode":"refusal"|"answer"|"fallback","rows":[...]}  then  {"type":"text","delta":"..."}*  then  {"type":"done"}
 *
 * Pipeline (see src/lib/chat/answer.ts): retrieve -> guard (refuses before any model call) -> model or fallback.
 * AI provider (src/lib/chat/provider.ts): xAI Grok when XAI_API_KEY is set, else Anthropic Claude when
 * ANTHROPIC_API_KEY is set. Keys stay on the server. With neither, the chat still works (deterministic answers).
 * Rate limits and token budgets are in memory per server instance (see src/lib/chat/budget.ts).
 */
import Anthropic from '@anthropic-ai/sdk';
import { getDataset } from '@/lib/data';
import { getNow, getRequestProfile } from '@/lib/profile-server';
import { createAnthropicChatModel, chatModelName } from '@/lib/chat/anthropic';
import { chatProvider } from '@/lib/chat/provider';
import { createXaiChatModel, xaiModelName } from '@/lib/chat/xai';
import { answerQuestion, type ChatModelClient } from '@/lib/chat/answer';
import { ChatBudget, clientIdFrom, clientIpFrom, limitsFromEnv } from '@/lib/chat/budget';
import { NDJSON_CONTENT_TYPE, eventsToStream } from '@/lib/chat/ndjson';
import { isCrossOrigin, isJsonContentType, parseChatRequest, readBodyLimited } from '@/lib/chat/request';
import { verifyTurnstile } from '@/lib/chat/turnstile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const budget = new ChatBudget(limitsFromEnv());

let cachedModel: { key: string; model: ChatModelClient } | null = null;

function getModel(): ChatModelClient | null {
  const provider = chatProvider();
  if (!provider) return null;
  const apiKey = (provider === 'xai' ? process.env.XAI_API_KEY : process.env.ANTHROPIC_API_KEY)?.trim() ?? '';
  const name = provider === 'xai' ? xaiModelName() : chatModelName();
  const cacheKey = `${provider}|${name}|${apiKey.slice(-6)}`;
  if (!cachedModel || cachedModel.key !== cacheKey) {
    const model =
      provider === 'xai' ? createXaiChatModel(apiKey, name) : createAnthropicChatModel(new Anthropic({ apiKey }), name);
    cachedModel = { key: cacheKey, model };
  }
  return cachedModel.model;
}

function jsonError(status: number, message: string, extraHeaders: Record<string, string> = {}): Response {
  return Response.json({ error: message }, { status, headers: { 'cache-control': 'no-store', ...extraHeaders } });
}

export async function POST(request: Request): Promise<Response> {
  // Another website's page may not drive this endpoint from its visitors' browsers.
  if (isCrossOrigin(request.headers)) {
    return jsonError(403, 'Requests from other websites are not allowed.');
  }
  // Exact JSON only: "text/plain; a=application/json" would skip the CORS preflight.
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return jsonError(415, 'Send the question as JSON.');
  }

  const body = await readBodyLimited(request);
  if (!body.ok) {
    return jsonError(body.status, body.status === 413 ? 'Request too large.' : 'Empty request.');
  }
  const parsed = parseChatRequest(body.text);
  if (!parsed.ok) return jsonError(400, parsed.error);

  // IP from a platform-set header only (never the User-Agent or the leftmost X-Forwarded-For entry).
  const clientId = clientIdFrom(clientIpFrom(request.headers));
  const rate = budget.hit(clientId, new Date());
  if (!rate.ok) {
    return jsonError(429, 'Too many questions. Please wait a minute.', { 'retry-after': String(rate.retryAfterSeconds) });
  }

  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (turnstileSecret && !(await verifyTurnstile(parsed.data.turnstileToken, turnstileSecret))) {
    return jsonError(403, 'Security check failed. Please try again.');
  }

  let dataset: Awaited<ReturnType<typeof getDataset>>;
  try {
    dataset = await getDataset();
  } catch (err) {
    console.error('[chat] dataset unavailable', err);
    return jsonError(503, 'MastersPath data is not available right now. Please try again.');
  }
  // The student's field (profile cookie on this device), so "Imperial deadline?" means the course in their field.
  const field = (await getRequestProfile())?.field ?? null;
  const events = answerQuestion(
    { question: parsed.data.question, programId: parsed.data.programId, country: parsed.data.country, field },
    {
      dataset,
      now: getNow(),
      model: getModel(),
      budget: budget.gate(clientId, () => new Date()),
      signal: request.signal,
      log: (message, err) => console.error(message, err instanceof Error ? err.message : (err ?? '')),
    },
  );

  return new Response(
    eventsToStream(events, (err) => console.error('[chat] stream failed', err)),
    {
      status: 200,
      headers: {
        'content-type': NDJSON_CONTENT_TYPE,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    },
  );
}
