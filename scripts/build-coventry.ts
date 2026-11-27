/**
 * Builds an add-programs proposal for Coventry University postgraduate courses from the live official pages,
 * using the deterministic parser (src/lib/seed/parsers/coventry.ts). Nothing is written to the seed here.
 *   npx tsx scripts/build-coventry.ts            then: npx tsx scripts/add-programs.ts data/proposals/scrape-2026-11-27/coventry.add.json
 */
import { writeFileSync } from 'node:fs';
import { fetchPageText, describeFetchError } from '../src/lib/seed/page-text';
import { parseCoventryCourse } from '../src/lib/seed/parsers/coventry';

const COURSES = [
  { id: 'coventry-msc-cs', name: 'MSc Computer Science', field: 'cs', url: 'https://www.coventry.ac.uk/course-structure/pg/ees/computer-science-msc/' },
  { id: 'coventry-msc-data-science', name: 'MSc Data Science', field: 'ds', url: 'https://www.coventry.ac.uk/course-structure/pg/ees/data-science-msc/' },
  { id: 'coventry-msc-electrical-electronic-engineering', name: 'MSc Electrical and Electronic Engineering', field: 'ee', url: 'https://www.coventry.ac.uk/course-structure/pg/ees/electrical-and-electronic-engineering-msc/' },
];
const TODAY = new Date().toISOString().slice(0, 10);

async function main() {
  const programs: unknown[] = [];
  for (const c of COURSES) {
    let page;
    try {
      page = await fetchPageText(c.url);
    } catch (e) {
      console.log(`${c.id}: skipped (${describeFetchError(e)})`);
      continue;
    }
    const p = parseCoventryCourse(page.text);
    const src = page.url;
    const fact = (value: unknown, snippet: string) => ({ value, source_url: src, evidence_snippet: snippet, fetched_at: TODAY });
    const facts: Record<string, unknown> = {};
    if (p.intake) facts.intake = fact(p.intake.value, p.intake.evidence_snippet);
    if (p.duration_months) facts.duration_months = fact(p.duration_months.value, p.duration_months.evidence_snippet);
    if (p.language_req) facts.language_req = fact(p.language_req.value, p.language_req.evidence_snippet);
    if (p.tuition_international) facts.tuition = fact(p.tuition_international.value, p.tuition_international.evidence_snippet);
    if (p.entry_requirement) facts.eligibility_note = fact(p.entry_requirement.value, p.entry_requirement.evidence_snippet);
    console.log(`${c.id}: ${Object.keys(facts).join(', ') || 'no facts'}`);
    programs.push({ id: c.id, institution_id: 'coventry', name: c.name, country: 'UK', degree: 'MSc', field: c.field, official_url: src, pathway_type: 'direct', status: 'active', facts });
  }
  const institutions = [{ id: 'coventry', name: 'Coventry University', country: 'UK', kind: 'destination', website: 'https://www.coventry.ac.uk' }];
  writeFileSync('data/proposals/scrape-2026-11-27/coventry.add.json', JSON.stringify({ institutions, programs }, null, 2) + '\n');
}
main();
