/**
 * Proposals #15 / #38: a deadline row carries its status, computed in code, in the row value — "(N days left)",
 * "(closes today)" or "(this date has passed; the next deadline is not verified yet)" — for usable deadlines only.
 * The model, the fallback list and "Sources used" all repeat it; nobody counts days except code.
 * `now` is pinned (24 Nov 2026 and 2 Dec 2026), on today's real seed and on fixtures.
 */
import { describe, expect, it } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import { FIXED_NOW, conflicting, likely, unverified, verified } from '@/lib/test-fixtures';
import type { Fact } from '@/lib/types';
import { collectAnswer, toPublicRow, type AnswerDeps } from './answer';
import { SYSTEM_PROMPT } from './prompt';
import { DEADLINE_PASSED_TEXT, DEADLINE_TODAY_TEXT, daysUntilDeadline, deadlineStatusText, retrieve } from './retrieve';
import { fixtureDataset, mockModel } from './test-helpers';
import { unsupportedFacts } from './verify';

const NOV_24 = new Date('2026-11-24T12:00:00Z');
const DEC_02 = new Date('2026-12-02T12:00:00Z');
const seed = loadSeedDataset();

const valueOf = (q: string, id: string, now: Date) => retrieve(q, {}, seed, now).rows.find((r) => r.id === id)?.value ?? null;

describe('deadlineStatusText (pure, UTC calendar days)', () => {
  it.each([
    ['2026-11-30', NOV_24, '(6 days left)'],
    ['2026-11-25', NOV_24, '(1 day left)'],
    ['2026-11-24', NOV_24, DEADLINE_TODAY_TEXT],
    ['2026-11-30', DEC_02, DEADLINE_PASSED_TEXT],
    ['2026-12-01', DEC_02, DEADLINE_PASSED_TEXT],
    ['2026-12-09', DEC_02, '(7 days left)'],
  ])('%s at %s -> %s', (iso, now, text) => {
    expect(deadlineStatusText(iso, now)).toBe(text);
  });

  it('late in the UTC day is still the same calendar day ("closes today", not "passed")', () => {
    expect(deadlineStatusText('2026-11-30', new Date('2026-11-30T23:59:00Z'))).toBe('(closes today)');
    expect(daysUntilDeadline('2026-11-30', new Date('2026-12-01T00:00:00Z'))).toBe(-1);
  });

  it('a value that is not a date gets no status (never a guessed count)', () => {
    expect(deadlineStatusText('rolling admissions', NOV_24)).toBeNull();
    expect(deadlineStatusText('2026-11-30', new Date(Number.NaN))).toBeNull();
  });

  it('the passed text never invents a next deadline', () => {
    expect(DEADLINE_PASSED_TEXT).toBe('(this date has passed; the next deadline is not verified yet)');
    expect(DEADLINE_PASSED_TEXT).not.toMatch(/\d/);
  });
});

describe('live seed, now pinned', () => {
  it('24 Nov 2026: ETH 6 days left, Toronto 7 days left, TUM 188 days left (date first, then status, then the note)', () => {
    expect(valueOf('ETH deadline?', 'ethz-msc-cs:deadline', NOV_24)).toBe(
      '30 Nov 2026 (6 days left) Note: Applications close at 12:00 noon CET on 30 November 2026. Late applications are not possible.',
    );
    expect(valueOf('Toronto deadline?', 'utoronto-mscac:deadline', NOV_24)).toMatch(/^1 Dec 2026 \(7 days left\) Note: /);
    expect(valueOf('TUM deadline?', 'tum-msc-informatics:deadline', NOV_24)).toMatch(/^31 May 2027 \(188 days left\) Note: /);
  });

  it('2 Dec 2026: ETH, Toronto and UIUC have passed; CMU has 7 days left', () => {
    expect(valueOf('ETH deadline?', 'ethz-msc-cs:deadline', DEC_02)).toBe(
      '30 Nov 2026 (this date has passed; the next deadline is not verified yet) Note: Applications close at 12:00 noon CET on 30 November 2026. Late applications are not possible.',
    );
    expect(valueOf('Toronto deadline?', 'utoronto-mscac:deadline', DEC_02)).toContain(DEADLINE_PASSED_TEXT);
    expect(valueOf('UIUC deadline?', 'uiuc-mscs:deadline', DEC_02)).toContain(DEADLINE_PASSED_TEXT);
    expect(valueOf('CMU deadline?', 'cmu-mscs:deadline', DEC_02)).toMatch(/^9 Dec 2026 \(7 days left\)/);
  });

  it('30 Nov 2026: ETH closes today', () => {
    expect(valueOf('ETH deadline?', 'ethz-msc-cs:deadline', new Date('2026-11-30T08:00:00Z'))).toMatch(/^30 Nov 2026 \(closes today\) Note: /);
  });

  it('"Which deadlines are still open?" on 2 Dec: every usable deadline carries its status, Unverified ones get none', () => {
    const rows = retrieve('Which deadlines are still open?', {}, seed, DEC_02).rows;
    const usable = rows.filter((r) => r.confidence === 'Verified' || r.confidence === 'Likely');
    expect(usable.length).toBeGreaterThan(5);
    for (const r of usable) expect(r.value, r.id).toMatch(/\((\d+ days? left|closes today|this date has passed; the next deadline is not verified yet)\)/);
    expect(rows.filter((r) => r.value?.includes('has passed')).map((r) => r.entity_id).sort()).toEqual(['ethz-msc-cs', 'uiuc-mscs', 'utoronto-mscac']);
    for (const r of rows.filter((x) => x.confidence === 'Unverified')) expect(r.value).toBeNull();
  });

  it('the Imperial refusal demo is unchanged (no deadline in the data, so no status and no date)', async () => {
    const model = mockModel(['The deadline is 6 January 2027.']);
    const r = await collectAnswer({ question: 'What is the deadline for Imperial MSc Computing?' }, { dataset: seed, now: DEC_02, model });
    expect(model.calls).toHaveLength(0);
    expect(r.mode).toBe('refusal');
    expect(r.text).not.toMatch(/days left|has passed|\b20\d\d\b/);
  });
});

describe('the passed status reaches the student first (fallback and model)', () => {
  const deps = (over: Partial<AnswerDeps> = {}): AnswerDeps => ({ dataset: seed, now: DEC_02, model: null, ...over });

  it('fallback list on 2 Dec: "When is the ETH deadline?" says the date has passed', async () => {
    const r = await collectAnswer({ question: 'When is the ETH deadline?' }, deps());
    expect(r.mode).toBe('fallback');
    expect(r.text).toContain('30 Nov 2026 (this date has passed; the next deadline is not verified yet)');
    expect(r.rows[0].value).toContain('has passed');
  });

  it('the model sees the computed status in the row value, and the system prompt tells it to say "passed" first', async () => {
    const model = mockModel(['The ETH deadline of 30 Nov 2026 has passed; the next deadline is not verified yet (Verified).']);
    const r = await collectAnswer({ question: 'When is the ETH deadline?' }, deps({ model }));
    expect(model.calls[0].user).toContain('this date has passed; the next deadline is not verified yet');
    expect(SYSTEM_PROMPT).toMatch(/If a date has passed, say that first/);
    expect(SYSTEM_PROMPT).toMatch(/never count days yourself/);
    expect(r.mode).toBe('answer'); // nothing invented, so no reset
  });

  it('a model quoting "(6 days left)" on 24 Nov is not reset; a count it made up is', async () => {
    const ok = mockModel(['The ETH deadline is 30 Nov 2026 (6 days left), 12:00 noon CET (Verified).']);
    const r1 = await collectAnswer({ question: 'ETH deadline?' }, deps({ now: NOV_24, model: ok }));
    expect(r1.mode).toBe('answer');
    const bad = mockModel(['The ETH deadline is 30 Nov 2026, about 8 days from now (Verified).']);
    const r2 = await collectAnswer({ question: 'ETH deadline?' }, deps({ now: NOV_24, model: bad }));
    expect(r2.mode).toBe('fallback');
    expect(r2.reason).toBe('unsupported_numbers');
  });

  it('the safety net accepts every live deadline row repeated exactly, on both pinned days', () => {
    for (const now of [NOV_24, DEC_02]) {
      const rows = retrieve('Which deadlines are still open?', {}, seed, now).rows;
      for (const r of rows) {
        if (!r.value) continue;
        expect(unsupportedFacts(`The deadline is ${r.value} (${r.confidence}).`, [r]), r.id).toEqual([]);
      }
    }
  });
});

describe('only usable deadlines get a status (fixtures)', () => {
  const ask = (deadline: Fact<string>, now = FIXED_NOW) =>
    retrieve('Deadline at Fixture University?', {}, fixtureDataset({ deadline }), now).rows[0];

  it('Verified and Likely: status added', () => {
    expect(ask(verified('2026-11-30')).value).toBe('30 Nov 2026 (6 days left)');
    expect(ask(likely('2026-11-20')).value).toBe('20 Nov 2026 (this date has passed; the next deadline is not verified yet)');
  });

  it('Unverified: no status in the row, and the browser gets no value at all', () => {
    const row = ask(unverified('2026-11-30'));
    expect(row.confidence).toBe('Unverified');
    expect(row.value).not.toMatch(/left|passed|today/);
    expect(toPublicRow(row).value).toBeNull();
  });

  it('Conflict: both dates shown exactly as stored, with no status on either', () => {
    const row = ask(conflicting('2026-11-20', '2026-12-15'));
    expect(row.confidence).toBe('Conflict');
    expect(row.value).toBe('20 Nov 2026');
    expect(row.sources?.map((s) => s.value)).toEqual(['20 Nov 2026', '15 Dec 2026']);
  });
});
