/**
 * POST /api/report — "Report incorrect data" on a program page.
 *
 * Body (JSON, max 4 KB): { program_id, field, message }.
 * - program_id must exist in the dataset, field must be a known program fact field, message is 10–1000 chars.
 * - Same-origin only: the browser's Origin header must match the Host (CSRF guard, like /api/account/delete); 403
 *   otherwise, checked before the rate limit so a foreign page cannot use up a visitor's quota.
 * - 5 reports per minute per IP (in memory, keyed by a hash of the IP).
 * - Stored in Supabase table `reports` when NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set;
 *   otherwise 202 { stored: false }.
 * Responses are JSON with fixed text only: the message is never echoed back.
 */
import { createClient } from '@supabase/supabase-js';
import { isSameOrigin } from '@/lib/supabase/auth';
import { getPrograms } from '@/lib/data';
import { clientIp, createRateLimiter, hashIp } from '@/lib/program/rate-limit';
import { isJsonContentType, parseReportBody, readBodyWithLimit } from '@/lib/program/report';
import {
  REPORT_ERRORS,
  REPORT_MAX_BYTES,
  REPORT_NOT_STORED_MESSAGE,
  REPORT_RATE_LIMIT,
  REPORT_RATE_WINDOW_MS,
  REPORT_STORED_MESSAGE,
} from '@/lib/program/report-constants';

export const runtime = 'nodejs';

/** Fixed text (never echoes anything from the request). */
const BAD_ORIGIN_ERROR = 'We could not accept this report. Please reload the page and try again.';

const limiter = createRateLimiter({ limit: REPORT_RATE_LIMIT, windowMs: REPORT_RATE_WINDOW_MS });

function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin((name) => request.headers.get(name))) {
    return json(403, { stored: false, error: BAD_ORIGIN_ERROR });
  }

  const ipKey = hashIp(clientIp(request.headers), process.env.REPORT_IP_SALT ?? '');
  const rl = limiter.check(ipKey, Date.now());
  if (!rl.ok) {
    return json(429, { stored: false, error: REPORT_ERRORS.rateLimited }, { 'Retry-After': String(rl.retryAfterSec) });
  }

  if (!isJsonContentType(request.headers.get('content-type'))) {
    return json(415, { stored: false, error: REPORT_ERRORS.notJson });
  }

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > REPORT_MAX_BYTES) {
    return json(413, { stored: false, error: REPORT_ERRORS.tooLarge });
  }

  let raw: string | null;
  try {
    raw = await readBodyWithLimit(request.body, REPORT_MAX_BYTES);
  } catch {
    return json(400, { stored: false, error: REPORT_ERRORS.notJson });
  }
  if (raw === null) return json(413, { stored: false, error: REPORT_ERRORS.tooLarge });

  const programIds = new Set((await getPrograms()).map((p) => p.id));
  const result = parseReportBody(raw, programIds);
  if (!result.ok) return json(result.status, { stored: false, error: result.error });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return json(202, { stored: false, message: REPORT_NOT_STORED_MESSAGE });
  }

  try {
    const supabase = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { program_id, field, message } = result.data;
    const { error } = await supabase.from('reports').insert({ program_id, field, message, status: 'open' });
    if (error) throw new Error(error.message);
  } catch (err) {
    // Never log the report text or the IP.
    console.error('[api/report] insert failed:', err instanceof Error ? err.message : 'unknown error');
    return json(503, { stored: false, error: REPORT_ERRORS.storeFailed });
  }

  return json(201, { stored: true, message: REPORT_STORED_MESSAGE });
}
