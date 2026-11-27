/**
 * Manual evidence check used by data contributors and research agents:
 *   npx tsx scripts/verify-snippet.ts <https-url> "<exact snippet>"
 *   npx tsx scripts/verify-snippet.ts --file proposals.json      (array of { source_url, evidence_snippet, ... })
 *
 * Fetches the page through safeFetch (https, allowlisted host, public IPs, robots.txt, throttled, 3MB cap), converts
 * HTML to text and checks the snippet appears verbatim. Exit code 1 if any snippet is NOT found. This never writes to the seed files.
 */
import { readFileSync } from 'node:fs';
import { fetchPageText } from '../src/lib/seed/page-text';
import { snippetAppearsIn } from '../src/lib/text/evidence';

type Item = { source_url: string; evidence_snippet: string; id?: string; field?: string };

async function main() {
  const args = process.argv.slice(2);
  let items: Item[];
  if (args[0] === '--file') {
    const raw = JSON.parse(readFileSync(args[1], 'utf8'));
    items = (Array.isArray(raw) ? raw : raw.proposals) as Item[];
  } else if (args.length >= 2) {
    items = [{ source_url: args[0], evidence_snippet: args.slice(1).join(' ') }];
  } else {
    console.error('Usage: tsx scripts/verify-snippet.ts <url> "<snippet>" | --file proposals.json');
    process.exit(2);
  }

  const cache = new Map<string, Promise<string>>();
  let failed = 0;
  for (const it of items) {
    const label = [it.id, it.field].filter(Boolean).join('.') || it.source_url;
    try {
      if (!cache.has(it.source_url)) cache.set(it.source_url, fetchPageText(it.source_url).then((p) => p.text));
      const text = await cache.get(it.source_url)!;
      const ok = snippetAppearsIn(it.evidence_snippet, text);
      if (!ok) failed++;
      console.log(`${ok ? 'FOUND    ' : 'NOT FOUND'}  ${label}`);
    } catch (e) {
      failed++;
      console.log(`ERROR      ${label}: ${(e as Error).message}`);
    }
  }
  console.log(`\n${items.length - failed}/${items.length} snippets verified verbatim.`);
  process.exit(failed ? 1 : 0);
}

main();
