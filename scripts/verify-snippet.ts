/**
 * Manual evidence check used by data contributors and research agents:
 *   npx tsx scripts/verify-snippet.ts <https-url> "<exact snippet>"
 *   npx tsx scripts/verify-snippet.ts --file proposals.json      (array of { source_url, evidence_snippet, ... })
 *
 * Fetches the page (https only, 15s timeout, 3MB cap), converts HTML to text and checks the snippet appears
 * verbatim. Exit code 1 if any snippet is NOT found. This never writes to the seed files.
 */
import { readFileSync } from 'node:fs';
import { htmlToText, snippetAppearsIn } from '../src/lib/text/evidence';

const MAX_BYTES = 3 * 1024 * 1024;

async function fetchText(url: string): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('Only https URLs are allowed');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(u, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'MastersPathEvidenceCheck/0.1 (+open-source; evidence verification)', accept: 'text/html,text/plain' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) throw new Error('Page too large');
    const body = buf.toString('utf8');
    const type = res.headers.get('content-type') ?? '';
    return type.includes('html') ? htmlToText(body) : body;
  } finally {
    clearTimeout(timer);
  }
}

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
      if (!cache.has(it.source_url)) cache.set(it.source_url, fetchText(it.source_url));
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
