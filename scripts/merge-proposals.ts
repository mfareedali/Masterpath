/**
 * Merge reviewed proposals into the seed files and write a human review checklist.
 *
 *   npx tsx scripts/merge-proposals.ts [--dry-run] [--date 2026-11-24] [files...]
 *
 * Default input: every data/proposals/verified/*.json. Output: updated data/*.seed.json and
 * data/proposals/REVIEW.md. Run `npm run validate:seed` afterwards. Undo: git checkout -- data/*.seed.json
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { mergeProposals, reviewMarkdown, type ProposalFile, type SeedBundle } from '../src/lib/proposals/merge';

const root = process.cwd();
const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const dateIdx = args.indexOf('--date');
const date = dateIdx >= 0 ? args[dateIdx + 1] : new Date().toISOString().slice(0, 10);
let files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--date');
if (files.length === 0) {
  const dir = join(root, 'data', 'proposals', 'verified');
  files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)) : [];
}
if (files.length === 0) {
  console.log('No proposal files found.');
  process.exit(0);
}

const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const seed: SeedBundle = {
  programs: read('data/programs.seed.json'),
  countryFacts: read('data/country_facts.seed.json'),
  conversionRules: read('data/conversion_rules.seed.json'),
  fxRates: read('data/fx_rates.seed.json'),
};
const proposalFiles: ProposalFile[] = files.map((f) => JSON.parse(readFileSync(f, 'utf8')));
const { seed: merged, changes } = mergeProposals(seed, proposalFiles, date);

const counts = changes.reduce<Record<string, number>>((acc, c) => ((acc[c.kind] = (acc[c.kind] ?? 0) + 1), acc), {});
console.log(`Merged from ${files.length} file(s):`, counts);
for (const c of changes.filter((x) => x.kind === 'skipped')) console.log(`  skipped ${c.target}:${c.id}.${c.field} — ${c.reason}`);

if (!dry) {
  const write = (p: string, v: unknown) => writeFileSync(join(root, p), JSON.stringify(v, null, 2) + '\n', 'utf8');
  write('data/programs.seed.json', merged.programs);
  write('data/country_facts.seed.json', merged.countryFacts);
  write('data/conversion_rules.seed.json', merged.conversionRules);
  write('data/fx_rates.seed.json', merged.fxRates);
  writeFileSync(join(root, 'data', 'proposals', 'REVIEW.md'), reviewMarkdown(changes, date), 'utf8');
  console.log('Wrote seed files and data/proposals/REVIEW.md');
}
