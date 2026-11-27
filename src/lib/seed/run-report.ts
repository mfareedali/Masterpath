/**
 * Run reports for the offline pipeline (ingest, verify, check-links). Pure: scripts pass timestamps in and write the
 * JSON to data/proposals/reports/ themselves (scripts/report-io.ts).
 */
import { SafeFetchError } from '../net/safe-fetch';

export type EntryKind = 'page' | 'snippet' | 'link';

/**
 * ok          fetched and processed
 * unchanged   content hash equal to the last run: skipped without calling the model
 * not_modified  server answered 304
 * found / not_found   a stored snippet is (not) on the page any more
 * http_error  the server answered with an error status
 * robots      robots.txt (or an unreachable robots.txt) forbids the fetch
 * blocked     refused by our own policy, or the site blocks bots (401/403/429)
 * error       network, timeout, size or content-type problem
 * skipped     not fetched (for example the host is not on the allowlist)
 */
export type Outcome = 'ok' | 'unchanged' | 'not_modified' | 'found' | 'not_found' | 'http_error' | 'robots' | 'blocked' | 'error' | 'skipped';

export interface RunEntry {
  kind: EntryKind;
  /** What was being processed: a page id, "program.field", or a link. */
  ref: string;
  url: string | null;
  outcome: Outcome;
  http_status: number | null;
  detail: string | null;
  duration_ms: number;
}

export interface RunRejection {
  ref: string;
  field: string | null;
  reasons: string[];
}

export interface RunReport {
  tool: 'ingest' | 'verify' | 'check-links';
  mode: string;
  args: string[];
  user_agent: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  summary: { entries: number; by_outcome: Partial<Record<Outcome, number>>; accepted: number; rejected: number };
  accepted: { ref: string; field: string; source_url: string }[];
  rejections: RunRejection[];
  entries: RunEntry[];
  notes: string[];
}

export class RunRecorder {
  readonly entries: RunEntry[] = [];
  readonly accepted: RunReport['accepted'] = [];
  readonly rejections: RunRejection[] = [];
  readonly notes: string[] = [];
  private readonly startedAt: number;

  constructor(
    private readonly tool: RunReport['tool'],
    private readonly mode: string,
    private readonly args: readonly string[],
    private readonly userAgent: string,
    private readonly clock: () => number = Date.now,
  ) {
    this.startedAt = clock();
  }

  entry(e: RunEntry): void {
    this.entries.push(e);
  }

  finish(): RunReport {
    const end = this.clock();
    const by: Partial<Record<Outcome, number>> = {};
    for (const e of this.entries) by[e.outcome] = (by[e.outcome] ?? 0) + 1;
    return {
      tool: this.tool,
      mode: this.mode,
      args: [...this.args],
      user_agent: this.userAgent,
      started_at: new Date(this.startedAt).toISOString(),
      finished_at: new Date(end).toISOString(),
      duration_ms: end - this.startedAt,
      summary: { entries: this.entries.length, by_outcome: by, accepted: this.accepted.length, rejected: this.rejections.length },
      accepted: this.accepted,
      rejections: this.rejections,
      entries: this.entries,
      notes: this.notes,
    };
  }
}

/** Maps a thrown fetch error to a report outcome and a short detail. */
export function outcomeOfError(e: unknown): { outcome: Outcome; http_status: number | null; detail: string } {
  if (e instanceof SafeFetchError) {
    if (e.code === 'ROBOTS') return { outcome: 'robots', http_status: null, detail: e.message };
    if (['HOST_NOT_ALLOWED', 'PRIVATE_ADDRESS', 'PROTOCOL', 'CREDENTIALS', 'BAD_URL', 'BAD_REDIRECT'].includes(e.code)) {
      return { outcome: 'blocked', http_status: null, detail: `${e.code}: ${e.message}` };
    }
    return { outcome: 'error', http_status: null, detail: `${e.code}: ${e.message}` };
  }
  const msg = e instanceof Error ? e.message : String(e);
  const http = /^HTTP (\d{3})$/.exec(msg);
  if (http) return outcomeOfStatus(Number(http[1]));
  return { outcome: 'error', http_status: null, detail: msg };
}

export function outcomeOfStatus(status: number): { outcome: Outcome; http_status: number; detail: string } {
  if (status === 401 || status === 403 || status === 429) return { outcome: 'blocked', http_status: status, detail: `HTTP ${status}: the site blocks bots` };
  return { outcome: 'http_error', http_status: status, detail: `HTTP ${status}` };
}

export function reportFileName(tool: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${tool}-${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}.json`;
}

/** Plain-text summary for the terminal and the GitHub step summary. */
export function formatRunSummary(r: RunReport): string {
  const counts = Object.entries(r.summary.by_outcome).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing processed';
  const lines = [
    `${r.tool} (${r.mode}): ${r.summary.entries} item(s) in ${(r.duration_ms / 1000).toFixed(1)} s: ${counts}.`,
  ];
  if (r.tool === 'ingest') lines.push(`Proposals: ${r.summary.accepted} accepted, ${r.summary.rejected} rejected.`);
  for (const n of r.notes) lines.push(`note: ${n}`);
  return lines.join('\n');
}
