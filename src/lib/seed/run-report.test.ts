import { describe, expect, it } from 'vitest';
import { SafeFetchError } from '../net/safe-fetch';
import { RunRecorder, formatRunSummary, outcomeOfError, outcomeOfStatus, reportFileName } from './run-report';

describe('run report', () => {
  it('counts outcomes and records timing', () => {
    let t = 1_000_000;
    const rec = new RunRecorder('ingest', 'all', ['--all'], 'UA', () => t);
    rec.entry({ kind: 'page', ref: 'a', url: 'https://x.org/a', outcome: 'ok', http_status: 200, detail: null, duration_ms: 10 });
    rec.entry({ kind: 'page', ref: 'b', url: 'https://x.org/b', outcome: 'robots', http_status: null, detail: 'no', duration_ms: 1 });
    rec.entry({ kind: 'page', ref: 'c', url: 'https://x.org/c', outcome: 'ok', http_status: 200, detail: null, duration_ms: 1 });
    rec.accepted.push({ ref: 'a', field: 'deadline', source_url: 'https://x.org/a' });
    rec.rejections.push({ ref: 'a', field: 'tuition', reasons: ['snippet not on page'] });
    t += 5000;
    const r = rec.finish();
    expect(r.duration_ms).toBe(5000);
    expect(r.summary.by_outcome).toEqual({ ok: 2, robots: 1 });
    expect(r.summary).toMatchObject({ entries: 3, accepted: 1, rejected: 1 });
    expect(formatRunSummary(r)).toMatch(/ok 2, robots 1/);
  });

  it('classifies robots refusals, policy blocks, bot blocking and plain HTTP errors', () => {
    expect(outcomeOfError(new SafeFetchError('ROBOTS', 'nope')).outcome).toBe('robots');
    expect(outcomeOfError(new SafeFetchError('HOST_NOT_ALLOWED', 'nope')).outcome).toBe('blocked');
    expect(outcomeOfError(new SafeFetchError('TIMEOUT', 'slow')).outcome).toBe('error');
    expect(outcomeOfError(new Error('HTTP 404'))).toMatchObject({ outcome: 'http_error', http_status: 404 });
    expect(outcomeOfStatus(403).outcome).toBe('blocked');
    expect(outcomeOfStatus(500).outcome).toBe('http_error');
  });

  it('names report files by tool and UTC time', () => {
    expect(reportFileName('verify', new Date('2026-11-27T05:07:09Z'))).toBe('verify-20261127-050709.json');
  });
});
