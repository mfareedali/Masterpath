/**
 * Link checker for the seed data. Usage (no npm script needed):
 *
 *   npx tsx scripts/check-links.ts            check every official_url / website / source_url, print a table, exit 0
 *   npx tsx scripts/check-links.ts --strict   same, but exit 1 when any link is broken (warnings never fail)
 *
 * Each URL goes through the SSRF-safe fetcher (src/lib/net/safe-fetch.ts): https only, allowlisted hosts
 * (data/ingest.allowlist.json), public IPs only, robots.txt honoured, HEAD first then GET without reading the body.
 * Hosts that are not on the allowlist are NOT fetched; they are listed as warnings for a human to check.
 * Read-only: never edits the seed files. Logic lives in src/lib/seed/links.ts (unit-tested).
 */
import './load-env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { USER_AGENT } from '../src/lib/net/safe-fetch';
import { checkLinks, collectSeedLinks, formatLinkTable, type LinkResult } from '../src/lib/seed/links';
import { RunRecorder, outcomeOfStatus, type Outcome } from '../src/lib/seed/run-report';
import { writeRunReport } from './report-io';

const SEED_FILES = ['programs.seed.json', 'country_facts.seed.json', 'conversion_rules.seed.json', 'fx_rates.seed.json'];

/** Maps a link result to a run-report outcome. */
function outcomeOf(r: LinkResult): { outcome: Outcome; http_status: number | null; detail: string } {
  if (r.status === 'ok' || r.status === 'redirected') return { outcome: 'ok', http_status: r.httpStatus, detail: r.note };
  if (r.status === 'warning') {
    if (r.note.startsWith('robots.txt')) return { outcome: 'robots', http_status: r.httpStatus, detail: r.note };
    if (r.httpStatus !== null) return { ...outcomeOfStatus(r.httpStatus), detail: r.note };
    return { outcome: 'skipped', http_status: null, detail: r.note };
  }
  return r.httpStatus !== null ? { ...outcomeOfStatus(r.httpStatus), detail: r.note } : { outcome: 'error', http_status: null, detail: r.note };
}

async function main() {
  const rec = new RunRecorder('check-links', process.argv.includes('--strict') ? 'strict' : 'default', process.argv.slice(2), USER_AGENT);
  const strict = process.argv.includes('--strict');
  const verbose = process.argv.includes('--verbose');
  const files: Record<string, unknown> = {};
  for (const name of SEED_FILES) {
    files[name] = JSON.parse(readFileSync(join(process.cwd(), 'data', name), 'utf8'));
  }
  // The source registry's pages are checked too (they are what ingestion reads).
  const sources = JSON.parse(readFileSync(join(process.cwd(), 'data', 'sources.json'), 'utf8')) as { pages: { id: string; url: string }[] };
  files['sources.json'] = { pages: sources.pages.map((p) => ({ id: p.id, source_url: p.url })) };
  const links = collectSeedLinks(files);
  console.log(`Checking ${links.length} link(s) from data/*.seed.json ...\n`);
  const t0 = Date.now();
  const results = await checkLinks(links, { concurrency: 4 });
  const each = Math.round((Date.now() - t0) / Math.max(1, results.length));
  console.log(formatLinkTable(results));

  const attention = results.filter((r) => r.status !== 'ok');
  if (attention.length && verbose) {
    console.log('\nWhere these links are used:');
    for (const r of attention) {
      console.log(`  ${r.url}`);
      for (const ref of r.refs) console.log(`    - ${ref}`);
    }
  } else if (attention.length) {
    console.log('Run with --verbose to see where each link is used.');
  }

  results.forEach((r) => rec.entry({ kind: 'link', ref: r.refs[0] ?? r.url, url: r.url, ...outcomeOf(r), duration_ms: each }));
  const broken = results.filter((r) => r.status === 'broken').length;
  rec.notes.push(`durations are the run average per link (${each} ms); requests are throttled to one per host every 1.5 s`);
  writeRunReport(rec.finish());
  if (strict && broken > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
