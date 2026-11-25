/** Browser-side pure logic: event folding, NDJSON reading, fetch errors, linkify, number verification. */
import { describe, expect, it } from 'vitest';
import { encodeEvent } from './ndjson';
import { startChat, readChatEventBatches } from './client-fetch';
import {
  NETWORK_ERROR_MESSAGE,
  STOPPED_EARLY_MESSAGE,
  applyChatEvent,
  cleanAnswerText,
  finishAnswer,
  httpErrorMessage,
  initialAnswerState,
} from './client-state';
import { allowedUrlKeys, linkifySegments } from './linkify';
import type { ChatEvent, ChatRow } from './types';
import { findDates, numberTokens, unsupportedDates, unsupportedFacts, unsupportedNumbers } from './verify';

const row: ChatRow = {
  id: 'r',
  entity: 'program',
  entity_id: 'p',
  entity_name: 'MSc X at Fixture University',
  field: 'deadline',
  label: 'Application deadline',
  value: '15 Jan 2027',
  confidence: 'Verified',
  source_url: 'https://fixture.example.edu/program',
  evidence_snippet: 'Applications close on 15 January 2027.',
  fetched_at: '2026-11-20',
  official_url: 'https://fixture.example.edu',
};

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

describe('applyChatEvent / finishAnswer', () => {
  it('folds meta, text, reset, done', () => {
    const events: ChatEvent[] = [
      { type: 'meta', mode: 'answer', rows: [row] },
      { type: 'text', delta: 'partial ' },
      { type: 'reset', mode: 'fallback', reason: 'model_error' },
      { type: 'text', delta: 'fallback list' },
      { type: 'done' },
    ];
    const s = events.reduce(applyChatEvent, initialAnswerState());
    expect(s).toMatchObject({ mode: 'fallback', reason: 'model_error', text: 'fallback list', status: 'done', rows: [row] });
  });

  it('a stream that ends without "done" is an error, never a silent cut', () => {
    const s = finishAnswer(applyChatEvent(initialAnswerState(), { type: 'text', delta: 'half' }));
    expect(s).toMatchObject({ status: 'error', error: STOPPED_EARLY_MESSAGE, text: 'half' });
    const done = applyChatEvent(initialAnswerState(), { type: 'done' });
    expect(finishAnswer(done)).toBe(done);
  });

  it('error then done stays an error', () => {
    const s = [{ type: 'error', message: 'x' } as const, { type: 'done' } as const].reduce(applyChatEvent, initialAnswerState());
    expect(s.status).toBe('error');
  });
});

describe('readChatEventBatches', () => {
  it('decodes events split across chunks (including multi-byte characters)', async () => {
    const body = [
      encodeEvent({ type: 'meta', mode: 'refusal', reason: 'not_verified', rows: [] }),
      encodeEvent({ type: 'text', delta: 'Würzburg — not verified' }),
      encodeEvent({ type: 'done' }),
    ].join('');
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 5) c.enqueue(bytes.slice(i, i + 5));
        c.close();
      },
    });
    const events: ChatEvent[] = [];
    for await (const batch of readChatEventBatches(stream)) events.push(...batch);
    expect(events.map((e) => e.type)).toEqual(['meta', 'text', 'done']);
    expect(events[1]).toEqual({ type: 'text', delta: 'Würzburg — not verified' });
  });

  it('a last line without a newline is still read', async () => {
    const events: ChatEvent[] = [];
    for await (const batch of readChatEventBatches(streamOf(['{"type":"done"}']))) events.push(...batch);
    expect(events).toEqual([{ type: 'done' }]);
  });
});

describe('startChat', () => {
  it('posts JSON and returns event batches', async () => {
    let sent: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sent = init;
      return new Response(streamOf([encodeEvent({ type: 'done' })]), { headers: { 'content-type': 'application/x-ndjson' } });
    }) as typeof fetch;
    const res = await startChat({ question: 'Deadline?', programId: 'p' }, { fetchImpl });
    expect(res.ok).toBe(true);
    expect(sent?.method).toBe('POST');
    expect(JSON.parse(String(sent?.body))).toEqual({ question: 'Deadline?', programId: 'p' });
  });

  it('turns HTTP errors into friendly messages', async () => {
    const fetchImpl = (async () => new Response('{}', { status: 429, headers: { 'retry-after': '20' } })) as typeof fetch;
    expect(await startChat({ question: 'q' }, { fetchImpl })).toEqual({
      ok: false,
      message: 'You are asking very fast. Please wait 20 seconds and try again.',
    });
  });

  it('turns network failures into a friendly message, but re-throws aborts', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await startChat({ question: 'q' }, { fetchImpl: failing })).toEqual({ ok: false, message: NETWORK_ERROR_MESSAGE });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(startChat({ question: 'q' }, { fetchImpl: failing, signal: ctrl.signal })).rejects.toThrow();
  });

  it('httpErrorMessage covers the route statuses', () => {
    expect(httpErrorMessage(413)).toMatch(/too long/);
    expect(httpErrorMessage(400)).toMatch(/between 1 and 500/);
    expect(httpErrorMessage(403)).toMatch(/security check/);
    expect(httpErrorMessage(500)).toMatch(/Something went wrong/);
    expect(httpErrorMessage(429)).toMatch(/wait a minute/);
  });
});

describe('cleanAnswerText', () => {
  it('strips markdown markers so they never show as symbols', () => {
    expect(cleanAnswerText('**Deadline**: x\n# Title\n* item')).toBe('Deadline: x\nTitle\n- item');
  });
});

describe('linkify — only links from the rows are clickable', () => {
  const allowed = allowedUrlKeys([row]);

  it('a row URL becomes a link (trailing slash and punctuation tolerated)', () => {
    const segs = linkifySegments('See https://fixture.example.edu/program. Or https://fixture.example.edu/', allowed);
    expect(segs).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'link', text: 'https://fixture.example.edu/program', href: 'https://fixture.example.edu/program' },
      { type: 'text', text: '. Or ' },
      { type: 'link', text: 'https://fixture.example.edu/', href: 'https://fixture.example.edu/' },
    ]);
  });

  it('any other URL stays plain text', () => {
    const segs = linkifySegments('Pay at https://evil.example/pay now', allowed);
    expect(segs).toEqual([{ type: 'text', text: 'Pay at https://evil.example/pay now' }]);
  });

  it('javascript: and other schemes are never links', () => {
    const keys = allowedUrlKeys([{ ...row, source_url: 'javascript:alert(1)', official_url: null }]);
    expect(keys.size).toBe(0);
    expect(linkifySegments('javascript:alert(1)', keys)).toEqual([{ type: 'text', text: 'javascript:alert(1)' }]);
  });
});

describe('unsupportedNumbers — the model may not invent numbers', () => {
  it('numbers from rows, dates, URLs and the question are allowed', () => {
    expect(unsupportedNumbers('The deadline is 15 January 2027 (Verified, checked 2026-11-20).', [row])).toEqual([]);
    expect(unsupportedNumbers('With a 2.5 CGPA, see the row.', [row], 'I have 2.5 CGPA')).toEqual([]);
  });

  it('a new number is flagged', () => {
    expect(unsupportedNumbers('The deadline is 15 March 2030.', [row])).toEqual(['2030']);
    expect(unsupportedNumbers('You have a 70% chance.', [row])).toEqual(['70']);
  });

  it('a date is checked as a whole: 20 March 2027 is invented even though 20, 3 and 2027 appear in the row', () => {
    // 20 and 2027 are in the row (fetched_at 2026-11-20, value 15 Jan 2027) so the number check alone passes it.
    expect(unsupportedNumbers('The deadline is 20 March 2027.', [row])).toEqual([]);
    expect(unsupportedDates('The deadline is 20 March 2027.', [row])).toEqual(['20 march 2027']);
    expect(unsupportedFacts('The deadline is 20 March 2027.', [row])).toEqual(['20 march 2027']);
  });

  it('dates written any common way match the row date', () => {
    for (const a of ['15 January 2027', 'January 15, 2027', '15th of Jan 2027', '2027-01-15', 'Jan 15', '15 January']) {
      expect(unsupportedDates(`The deadline is ${a}.`, [row]), a).toEqual([]);
    }
    expect(unsupportedDates('Apply by 16 January.', [row])).toEqual(['16 january']);
  });

  it('findDates normalises dates', () => {
    expect(findDates('Closes 15 Jan 2027; opens March 3, 2026; checked 2026-11-20T10:00Z; and 1 Feb').map((d) => d.key)).toEqual([
      '2026-11-20',
      '2027-01-15',
      '2026-03-03',
      '--02-01',
    ]);
  });

  it('values withheld from the model (Unverified) do not count as support', () => {
    const hidden: ChatRow = { ...row, confidence: 'Unverified', value: '9 Sep 2027', evidence_snippet: null, fetched_at: null };
    expect(unsupportedFacts('The deadline is 9 Sep 2027.', [hidden])).not.toEqual([]);
  });

  it('list markers are not facts; thousands separators are normalised', () => {
    expect(unsupportedNumbers('1. The deadline is 15 Jan 2027', [row])).toEqual([]);
    expect(numberTokens('1,095 days')).toEqual(['1095']);
  });
});
