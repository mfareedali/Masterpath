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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkLinks, collectSeedLinks, formatLinkTable } from '../src/lib/seed/links';

const SEED_FILES = ['programs.seed.json', 'country_facts.seed.json', 'conversion_rules.seed.json', 'fx_rates.seed.json'];

async function main() {
  const strict = process.argv.includes('--strict');
  const verbose = process.argv.includes('--verbose');
  const files: Record<string, unknown> = {};
  for (const name of SEED_FILES) {
    files[name] = JSON.parse(readFileSync(join(process.cwd(), 'data', name), 'utf8'));
  }
  const links = collectSeedLinks(files);
  console.log(`Checking ${links.length} link(s) from data/*.seed.json ...\n`);
  const results = await checkLinks(links, { concurrency: 4 });
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

  const broken = results.filter((r) => r.status === 'broken').length;
  if (strict && broken > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
