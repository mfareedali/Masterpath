// Usage: node scripts/shoot.mjs <outDir> [baseUrl]. Screenshots the main routes at 360x800 and 1280x800 (dev tool, not part of CI).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:3055';
const q = '?cgpa=2.5&scale=cgpa_4&field=cs&countries=DE,UK,CA,US';
const routes = {
  home: '/', onboarding: '/onboarding', shortlist: '/shortlist' + q, program: '/program/tum-msc-informatics' + q,
  'plan-b': '/plan-b' + q, citizenship: '/citizenship', check: '/check', saved: '/saved',
};
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [w, h] of [[360, 800], [1280, 800]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  for (const [name, path] of Object.entries(routes)) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: true });
    console.log(w, name, overflow > 0 ? `HORIZONTAL OVERFLOW ${overflow}px` : 'ok');
  }
  await ctx.close();
}
await browser.close();
