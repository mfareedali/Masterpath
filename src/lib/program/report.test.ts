import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import {
  byteLength,
  charCount,
  cleanMessage,
  isJsonContentType,
  parseReportBody,
  readBodyWithLimit,
  reportSchema,
  validateReport,
} from './report';
import { REPORT_ERRORS, REPORT_MAX_BYTES } from './report-constants';

const ids = new Set(loadSeedDataset().programs.map((p) => p.id));
const good = { program_id: 'tum-msc-informatics', field: 'deadline', message: 'The deadline on the official page is different.' };

describe('validateReport', () => {
  it('accepts a valid report for a program in the dataset', () => {
    const r = validateReport(good, ids);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual(good);
  });

  it('accepts an array of ids as well as a Set', () => {
    expect(validateReport(good, [...ids]).ok).toBe(true);
  });

  it('trims the message and strips control characters', () => {
    const r = validateReport({ ...good, message: '  \u0007Wrong deadline\r\nsee page\u0000  ' }, ids);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.message).toBe('Wrong deadline\nsee page');
  });

  it('rejects an unknown program id', () => {
    expect(validateReport({ ...good, program_id: 'no-such-program' }, ids)).toEqual({
      ok: false,
      status: 400,
      error: REPORT_ERRORS.badProgram,
    });
    expect(validateReport({ ...good, program_id: '../etc/passwd' }, ids)).toMatchObject({ ok: false, error: REPORT_ERRORS.badProgram });
    expect(validateReport({ ...good, program_id: 42 }, ids)).toMatchObject({ ok: false, error: REPORT_ERRORS.badProgram });
  });

  it('rejects a field that is not a program fact field', () => {
    expect(validateReport({ ...good, field: 'name' }, ids)).toMatchObject({ ok: false, error: REPORT_ERRORS.badField });
    expect(validateReport({ ...good, field: undefined }, ids)).toMatchObject({ ok: false, error: REPORT_ERRORS.badField });
  });

  it('accepts every program fact field', () => {
    for (const field of ['status_note', 'min_gpa_rule', 'admissions_email', 'progression_guaranteed']) {
      expect(validateReport({ ...good, field }, ids).ok).toBe(true);
    }
  });

  it('enforces 10–1000 characters after trimming', () => {
    expect(validateReport({ ...good, message: '   too short   ' }, ids)).toMatchObject({ ok: false, error: REPORT_ERRORS.tooShort });
    expect(validateReport({ ...good, message: '1234567890' }, ids).ok).toBe(true);
    expect(validateReport({ ...good, message: 'x'.repeat(1000) }, ids).ok).toBe(true);
    expect(validateReport({ ...good, message: 'x'.repeat(1001) }, ids)).toMatchObject({ ok: false, error: REPORT_ERRORS.tooLong });
    expect(validateReport({ ...good, message: 12345678901 }, ids)).toMatchObject({ ok: false, error: REPORT_ERRORS.tooShort });
  });

  it('counts characters like the database (code points, not UTF-16 units)', () => {
    expect(charCount('😀😀')).toBe(2);
    // 5 emoji = 10 UTF-16 units but only 5 characters: too short for the reports table check.
    expect(validateReport({ ...good, message: '😀'.repeat(5) }, ids)).toMatchObject({ ok: false, error: REPORT_ERRORS.tooShort });
    expect(validateReport({ ...good, message: '😀'.repeat(10) }, ids).ok).toBe(true);
    // 600 emoji = 1200 UTF-16 units but 600 characters: allowed.
    expect(validateReport({ ...good, message: '😀'.repeat(600) }, ids).ok).toBe(true);
  });

  it('drops unknown keys', () => {
    const r = reportSchema.safeParse({ ...good, status: 'fixed', extra: '<b>x</b>' });
    expect(r.success).toBe(true);
    if (r.success) expect(Object.keys(r.data).sort()).toEqual(['field', 'message', 'program_id']);
  });
});

describe('parseReportBody', () => {
  it('parses JSON and validates', () => {
    expect(parseReportBody(JSON.stringify(good), ids).ok).toBe(true);
  });

  it('rejects bodies larger than 4KB', () => {
    const big = JSON.stringify({ ...good, message: 'x'.repeat(REPORT_MAX_BYTES) });
    expect(parseReportBody(big, ids)).toEqual({ ok: false, status: 413, error: REPORT_ERRORS.tooLarge });
  });

  it('counts bytes, not characters', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('اردو')).toBe(8);
    // 1000 Urdu characters (2 bytes each in UTF-8) still fit in the 4KB body limit.
    const urdu = JSON.stringify({ ...good, message: 'ب'.repeat(999) + '.' });
    expect(byteLength(urdu)).toBeLessThan(REPORT_MAX_BYTES);
    expect(parseReportBody(urdu, ids).ok).toBe(true);
  });

  it('rejects invalid JSON and non-object bodies', () => {
    expect(parseReportBody('{not json', ids)).toEqual({ ok: false, status: 400, error: REPORT_ERRORS.notJson });
    expect(parseReportBody('[]', ids)).toMatchObject({ ok: false, status: 400 });
    expect(parseReportBody('null', ids)).toMatchObject({ ok: false, status: 400 });
    expect(parseReportBody('"text"', ids)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('cleanMessage', () => {
  it('keeps tabs and newlines, removes other control characters', () => {
    expect(cleanMessage('a\tb\nc\u001bd\u007f')).toBe('a\tb\ncd');
  });
});

describe('readBodyWithLimit', () => {
  function streamOf(text: string): ReadableStream<Uint8Array> {
    return new Request('http://localhost/api/report', { method: 'POST', body: text }).body!;
  }

  it('reads a small body', async () => {
    expect(await readBodyWithLimit(streamOf('{"a":1}'), 100)).toBe('{"a":1}');
  });

  it('returns null as soon as the body is too large', async () => {
    expect(await readBodyWithLimit(streamOf('x'.repeat(5000)), 4096)).toBeNull();
  });

  it('returns an empty string when there is no body', async () => {
    expect(await readBodyWithLimit(null)).toBe('');
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = new TextEncoder().encode('اردو');
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 3));
        c.enqueue(bytes.slice(3));
        c.close();
      },
    });
    expect(await readBodyWithLimit(stream, 100)).toBe('اردو');
  });
});

describe('isJsonContentType', () => {
  it('accepts application/json with parameters only', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('Application/JSON')).toBe(true);
    expect(isJsonContentType('text/plain')).toBe(false);
    expect(isJsonContentType('application/x-www-form-urlencoded')).toBe(false);
    expect(isJsonContentType('application/jsonp')).toBe(false);
    expect(isJsonContentType(null)).toBe(false);
  });
});
