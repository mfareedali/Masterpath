/**
 * Request validation for POST /api/chat (pure, testable): exact JSON content type, same-origin check,
 * size limit + zod schema.
 */
import { z } from '@/lib/zod';
import { MAX_BODY_BYTES, MAX_QUESTION_CHARS } from './limits';
import type { ChatRequest } from './types';

export { MAX_BODY_BYTES, MAX_QUESTION_CHARS };

export const chatRequestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  programId: z
    .string()
    .regex(/^[a-z0-9-]{1,100}$/)
    .optional(),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .transform((c) => c.toUpperCase())
    .optional(),
  turnstileToken: z.string().min(1).max(2048).optional(),
});

export type ParsedChatRequest = z.infer<typeof chatRequestSchema> & ChatRequest;

/**
 * Exactly "application/json", optionally with a charset. A value such as "text/plain; a=application/json" is a
 * CORS-safelisted type, so another website could send it with no preflight; it is rejected.
 */
export function isJsonContentType(contentType: string | null | undefined): boolean {
  return /^application\/json\s*(;\s*charset\s*=\s*"?[a-z0-9_-]+"?\s*)?$/i.test((contentType ?? '').trim());
}

type HeaderGetter = { get(name: string): string | null };

function firstValue(v: string | null): string | null {
  const first = v?.split(',')[0]?.trim().toLowerCase();
  return first ? first : null;
}

/**
 * True when the browser says the request comes from another website: an Origin header is present and its host
 * (with port) matches neither the Host header nor x-forwarded-host (set by a proxy in front of the app).
 * No Origin header (curl, server-to-server, older same-origin GETs) is not treated as cross-origin; the rate
 * limit still applies. "Origin: null" (sandboxed frames, opaque origins) is cross-origin.
 */
export function isCrossOrigin(headers: HeaderGetter): boolean {
  const origin = headers.get('origin');
  if (origin == null || origin.trim() === '') return false;
  let originHost: string;
  try {
    const url = new URL(origin.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return true;
    originHost = url.host.toLowerCase();
  } catch {
    return true;
  }
  const hosts = [firstValue(headers.get('host')), firstValue(headers.get('x-forwarded-host'))].filter(
    (h): h is string => h != null,
  );
  return !hosts.includes(originHost);
}

export type BodyResult = { ok: true; text: string } | { ok: false; status: 400 | 413 };

/** Read the body but stop as soon as it exceeds `limit` bytes (no unbounded buffering). */
export async function readBodyLimited(req: Request, limit = MAX_BODY_BYTES): Promise<BodyResult> {
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) return { ok: false, status: 413 };
  if (!req.body) return { ok: false, status: 400 };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(all) };
}

export type ParseResult = { ok: true; data: ParsedChatRequest } | { ok: false; error: string };

export function parseChatRequest(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Body must be JSON.' };
  }
  const parsed = chatRequestSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: 'Please send a question between 1 and 500 characters.' };
  return { ok: true, data: parsed.data };
}
