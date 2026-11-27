/** Writes run reports to data/proposals/reports/ (shared by ingest, verify and check-links). */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { formatRunSummary, reportFileName, type RunReport } from '../src/lib/seed/run-report';

export const REPORTS_DIR = resolve(process.cwd(), 'data', 'proposals', 'reports');

export function writeRunReport(report: RunReport, now: Date = new Date()): string {
  mkdirSync(REPORTS_DIR, { recursive: true });
  let out = join(REPORTS_DIR, reportFileName(report.tool, now));
  if (!out.startsWith(REPORTS_DIR + sep)) throw new Error('Refusing to write outside data/proposals/reports/.');
  for (let n = 2; existsSync(out); n++) out = join(REPORTS_DIR, reportFileName(report.tool, now).replace('.json', `-${n}.json`));
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`\n${formatRunSummary(report)}`);
  console.log(`Run report: ${relative(process.cwd(), out)}`);
  return out;
}
