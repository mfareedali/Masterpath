/**
 * Contributor helper (hand-extraction workflow): fetch official pages through the same pipeline (safeFetch, renderFetch
 * fallback) and print the lines that look like each field, so a human can copy a verbatim snippet.
 *
 *   npx tsx scripts/scan-pages.ts <url>... [--fields tuition,deadline,...] [--max N]
 *   npx tsx scripts/scan-pages.ts --program <program-id> [--fields ...]    (every registry page of that program)
 *
 * Nothing is proposed or written here.
 */
import './load-env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeFetchError, fetchPageText } from '../src/lib/seed/page-text';

const PATTERNS: Record<string, RegExp> = {
  tuition: /tuition|fees?\b|per (?:year|credit|semester)|£\s?\d|\$\s?\d{2}|€\s?\d|CHF\s?\d|international (?:student|rate)/i,
  min_gpa_rule: /gpa|grade point|cgpa|2:1|2:2|first[- ]class|honours|upper second|minimum (?:grade|average|mark)|average of|\b[1-4]\.\d+\b.{0,30}(?:scale|out of)/i,
  language_req: /ielts|toefl|pte|duolingo|english (?:language )?(?:proficiency|requirement)|cefr/i,
  deadline: /deadline|apply by|applications? (?:close|open)|closing date|before \d{1,2}|must be received|due (?:date|on|by)/i,
  intake: /intake|start date|starts? in|begins? in|commenc|fall|spring|autumn|winter semester|summer semester|september|january|october/i,
  duration_months: /duration|\b\d+ (?:months?|years?|semesters?|terms?)\b|full[- ]time|credit hours|ECTS/i,
  admissions_email: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/,
};

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const fields = (flag('--fields') ?? Object.keys(PATTERNS).join(',')).split(',').filter((f) => PATTERNS[f]);
const max = Number(flag('--max') ?? 6);
let urls = args.filter((a, i) => a.startsWith('https://') && !args[i - 1]?.startsWith('--'));
const prog = flag('--program');
if (prog) {
  const s = JSON.parse(readFileSync(join(process.cwd(), 'data', 'sources.json'), 'utf8')) as { pages: { url: string; target: { id?: string } }[] };
  urls = [...urls, ...s.pages.filter((p) => p.target.id === prog).map((p) => p.url)];
}

(async () => {
  for (const url of urls) {
    console.log(`\n=== ${url}`);
    let page;
    try {
      page = await fetchPageText(url);
    } catch (e) {
      console.log(`  FETCH FAILED: ${describeFetchError(e)}`);
      continue;
    }
    const lines = page.text.split('\n');
    console.log(`  (${lines.length} lines, ${page.text.length} chars, method ${page.method ?? 'static'}${page.url !== url ? `, redirected to ${page.url}` : ''})`);
    for (const f of fields) {
      const hits = lines.map((l, i) => ({ l, i })).filter(({ l }) => PATTERNS[f].test(l) && l.length >= 12 && l.length <= 400);
      if (!hits.length) continue;
      console.log(`  [${f}] ${hits.length} line(s)`);
      for (const h of hits.slice(0, max)) console.log(`    ${h.i}: ${h.l.slice(0, 240)}`);
    }
  }
})();
