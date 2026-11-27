/**
 * Coverage audit (read-only): per program, which fields still have no value, and which registry pages are registered
 * for them. Prints a table; with --json writes data/proposals/audit.json. Uses the seed files only (no network).
 *
 *   npx tsx scripts/audit-coverage.ts [--json]
 */
import './load-env';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (f: string) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const programsFile = read('data/programs.seed.json');
const programs: Record<string, unknown>[] = programsFile.programs ?? programsFile;
const institutions: Record<string, unknown>[] = programsFile.institutions ?? read('data/institutions.seed.json');
const sources: { pages: { id: string; url: string; target: { type: string; id?: string }; fields: string[] }[] } = read('data/sources.json');

const PRIORITY = ['tuition', 'min_gpa_rule', 'language_req', 'deadline', 'intake', 'duration_months', 'admissions_email'];
const PAGE_TYPE: Record<string, string> = {
  tuition: 'tuition & fees / bursar page (international rate)',
  min_gpa_rule: 'programme page or graduate admissions requirements',
  language_req: 'international applicant / English-language requirements page',
  deadline: 'programme page or graduate admissions deadlines page',
  intake: 'programme page or admissions calendar',
  duration_months: 'programme page or graduate catalog',
  admissions_email: 'programme page contact box or graduate admissions office page',
};

const isFact = (v: unknown): v is { value: unknown; source_url?: string | null; evidence_snippet?: string | null } =>
  !!v && typeof v === 'object' && 'value' in (v as object) && 'evidence_snippet' in (v as object);
const empty = (f: { value: unknown }) => f.value === null || f.value === undefined;

const rows = programs.map((p) => {
  const missing: string[] = [];
  const unsourced: string[] = [];
  for (const k of PRIORITY) {
    const f = p[k];
    if (!isFact(f)) continue;
    if (empty(f)) missing.push(k);
    else if (!f.source_url || !f.evidence_snippet) unsourced.push(k);
  }
  const pages = sources.pages.filter((s) => s.target.type === 'program' && s.target.id === p.id).map((s) => s.url);
  return { id: p.id as string, country: p.country as string, missing, unsourced, pages: pages.length };
});

let total = 0;
for (const r of rows) total += r.missing.length;
console.log(`${programs.length} programmes, ${institutions.length} institutions. Missing priority facts: ${total} of ${programs.length * PRIORITY.length}.\n`);
for (const r of rows) console.log(`${r.id.padEnd(46)} ${r.country}  pages:${r.pages}  missing(${r.missing.length}): ${r.missing.join(', ') || '-'}${r.unsourced.length ? `  UNSOURCED: ${r.unsourced.join(', ')}` : ''}`);
console.log('\nWhere each field is usually published:');
for (const k of PRIORITY) console.log(`  ${k.padEnd(18)} ${PAGE_TYPE[k]}`);
if (process.argv.includes('--json')) {
  writeFileSync(join(root, 'data/proposals/audit.json'), JSON.stringify({ priority: PRIORITY, page_types: PAGE_TYPE, programs: rows }, null, 2) + '\n');
}
