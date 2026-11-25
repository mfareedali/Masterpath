/**
 * Seed validator CLI (CI runs it as `npm run validate:seed`).
 *
 *   npx tsx scripts/validate-seed.ts            validate data/*.seed.json against the schemas and evidence rules
 *   npx tsx scripts/validate-seed.ts --quiet    print errors and the coverage summary only
 *
 * The rules live in src/lib/seed/validate.ts (unit-tested). Exit code 1 when there is at least one error;
 * warnings never fail the build. Read-only: this script never writes to the seed files.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatReport, validateSeed, type SeedFiles } from '../src/lib/seed/validate';

function readJson(name: string): unknown {
  const path = join(process.cwd(), 'data', name);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`Could not read data/${name}: ${(e as Error).message}`);
    process.exit(1);
  }
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const files: SeedFiles = {
    programs: readJson('programs.seed.json'),
    countryFacts: readJson('country_facts.seed.json'),
    conversionRules: readJson('conversion_rules.seed.json'),
    fxRates: readJson('fx_rates.seed.json'),
  };
  // The validator is pure; the real clock is read here, once.
  const report = validateSeed(files, new Date());
  const shown = quiet ? { ...report, issues: report.issues.filter((i) => i.severity === 'error') } : report;
  console.log(formatReport(shown));
  process.exit(report.errors > 0 ? 1 : 0);
}

main();
