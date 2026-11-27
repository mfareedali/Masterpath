/**
 * Contributor / research helper: print the lines of an official page that match a pattern, so you can copy a verbatim
 * snippet. Goes through safeFetch (https, allowlisted host, public IPs, robots.txt, per-host throttle, size caps).
 *
 *   npx tsx scripts/peek-page.ts <https-url> "<regex>" [--context N]   lines matching the regex (+/- N lines)
 *   npx tsx scripts/peek-page.ts <https-url> --head [--chars N]        the title line and the first N characters
 *
 * Fetched text is cached in the OS temp folder for an hour, so several peeks at one page cost one request.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchPageText, describeFetchError } from '../src/lib/seed/page-text';

const CACHE_DIR = join(tmpdir(), 'masterspath-peek');
const CACHE_MS = 60 * 60 * 1000;

async function textOf(url: string): Promise<{ text: string; final: string }> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = join(CACHE_DIR, createHash('sha1').update(url).digest('hex') + '.json');
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < CACHE_MS) return JSON.parse(readFileSync(file, 'utf8'));
  const page = await fetchPageText(url);
  const out = { text: page.text, final: page.url };
  writeFileSync(file, JSON.stringify(out), 'utf8');
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const raw = args[0];
  const head = args.includes('--head');
  const ctxIdx = args.indexOf('--context');
  const ctx = ctxIdx >= 0 ? Math.max(0, Number(args[ctxIdx + 1]) || 0) : 0;
  const charsIdx = args.indexOf('--chars');
  const chars = charsIdx >= 0 ? Number(args[charsIdx + 1]) || 1500 : 1500;
  const pattern = args[1] && !args[1].startsWith('--') ? args[1] : null;
  if (!raw || (!head && !pattern)) {
    console.error('Usage: tsx scripts/peek-page.ts <https-url> "<regex>" [--context N] | <https-url> --head [--chars N]');
    process.exit(2);
  }
  let page;
  try {
    page = await textOf(raw);
  } catch (e) {
    console.error(describeFetchError(e));
    process.exit(3);
  }
  const lines = page.text.split('\n');
  if (page.final !== raw) console.log(`(redirected to ${page.final})`);
  if (head) {
    console.log(`${lines.length} lines, ${page.text.length} characters`);
    console.log(page.text.slice(0, chars));
    return;
  }
  const re = new RegExp(pattern!, 'i');
  const shown = new Set<number>();
  lines.forEach((l, i) => {
    if (!re.test(l)) return;
    for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) shown.add(k);
  });
  if (shown.size === 0) {
    console.log(`No line matches /${pattern}/ (${lines.length} lines, ${page.text.length} characters).`);
    return;
  }
  let prev = -2;
  for (const i of [...shown].sort((a, b) => a - b)) {
    if (i !== prev + 1) console.log('--');
    console.log(lines[i].length > 400 ? `${lines[i].slice(0, 400)}…` : lines[i]);
    prev = i;
  }
}

main();
