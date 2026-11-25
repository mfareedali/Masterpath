/**
 * "Report incorrect data" payload validation. Pure functions (no I/O except reading a request body stream).
 * The message is stored as plain text and never sent back to the client.
 */
import { z } from '@/lib/zod';
import { PROGRAM_FACT_KEYS } from './fields';
import { REPORT_ERRORS, REPORT_MAX_BYTES, REPORT_MESSAGE_MAX, REPORT_MESSAGE_MIN } from './report-constants';

// Control characters except tab (\u0009) and newline (\u000A).
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** Normalises line endings, removes control characters and trims. */
export function cleanMessage(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim();
}

/**
 * Length in Unicode code points (what Postgres char_length counts in the `reports` table check),
 * so "10–1000 characters" means the same thing here and in the database.
 */
export function charCount(s: string): number {
  return Array.from(s).length;
}

export const reportSchema = z.object({
  program_id: z
    .string({ error: REPORT_ERRORS.badProgram })
    .trim()
    .min(1, REPORT_ERRORS.badProgram)
    .max(120, REPORT_ERRORS.badProgram)
    .regex(/^[a-z0-9][a-z0-9-]*$/, REPORT_ERRORS.badProgram),
  field: z.enum(PROGRAM_FACT_KEYS, { error: REPORT_ERRORS.badField }),
  message: z
    .string({ error: REPORT_ERRORS.tooShort })
    .transform(cleanMessage)
    .pipe(
      z
        .string()
        .refine((s) => charCount(s) >= REPORT_MESSAGE_MIN, REPORT_ERRORS.tooShort)
        .refine((s) => charCount(s) <= REPORT_MESSAGE_MAX, REPORT_ERRORS.tooLong),
    ),
});

export type ReportPayload = z.output<typeof reportSchema>;

export type ReportValidation =
  | { ok: true; data: ReportPayload }
  | { ok: false; status: 400 | 413; error: string };

/** Validates a parsed JSON body. `programIds` are the ids in the dataset. */
export function validateReport(input: unknown, programIds: ReadonlySet<string> | readonly string[]): ReportValidation {
  const r = reportSchema.safeParse(input);
  if (!r.success) {
    return { ok: false, status: 400, error: r.error.issues[0]?.message ?? REPORT_ERRORS.notJson };
  }
  const known = programIds instanceof Set ? programIds.has(r.data.program_id) : (programIds as readonly string[]).includes(r.data.program_id);
  if (!known) return { ok: false, status: 400, error: REPORT_ERRORS.badProgram };
  return { ok: true, data: r.data };
}

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Validates a raw request body: size limit, JSON parse, then the schema. */
export function parseReportBody(raw: string, programIds: ReadonlySet<string> | readonly string[]): ReportValidation {
  if (byteLength(raw) > REPORT_MAX_BYTES) return { ok: false, status: 413, error: REPORT_ERRORS.tooLarge };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: REPORT_ERRORS.notJson };
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, status: 400, error: REPORT_ERRORS.notJson };
  }
  return validateReport(json, programIds);
}

/**
 * Reads a body stream but stops as soon as it exceeds `maxBytes` (so a huge body is never fully buffered).
 * Returns null when the body is too large.
 */
export async function readBodyWithLimit(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number = REPORT_MAX_BYTES,
): Promise<string | null> {
  if (!stream) return '';
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** True for "application/json" (with optional parameters such as charset). */
export function isJsonContentType(contentType: string | null | undefined): boolean {
  return /^application\/json\s*(;|$)/i.test((contentType ?? '').trim());
}
