/**
 * Contributor helper: print the lines of an official page that match a pattern, so you can copy a verbatim snippet.
 *   npx tsx scripts/peek-page.ts <https-url> "<regex>"
 * Honest User-Agent, robots.txt respected (refuses if the path is disallowed), https only, 15s timeout, 3MB cap.
 */
import { htmlToText } from '../src/lib/text/evidence';
import { robotsAllows } from '../src/lib/net/robots';

const UA = 'MastersPathEvidenceCheck/0.1 (open-source evidence verification)';

async function get(url: URL): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': UA, accept: 'text/html,text/plain' } });
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const [raw, pattern] = process.argv.slice(2);
  if (!raw || !pattern) {
    console.error('Usage: tsx scripts/peek-page.ts <https-url> "<regex>"');
    process.exit(2);
  }
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Only https URLs');
  const robots = await get(new URL('/robots.txt', url.origin)).catch(() => null);
  const robotsTxt = robots && robots.ok ? await robots.text() : '';
  if (!robotsAllows(robotsTxt, url.pathname + url.search, 'MastersPathEvidenceCheck')) {
    console.error(`robots.txt disallows ${url.pathname} for automated access. Check this page by hand in a browser.`);
    process.exit(3);
  }
  const res = await get(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > 3 * 1024 * 1024) throw new Error('Page too large');
  const text = htmlToText(buf.toString('utf8'));
  const re = new RegExp(pattern, 'i');
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    if (re.test(l)) console.log(`${String(i).padStart(4)}: ${[lines[i - 1], l, lines[i + 1]].filter(Boolean).join(' ⏎ ').slice(0, 600)}`);
  });
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
