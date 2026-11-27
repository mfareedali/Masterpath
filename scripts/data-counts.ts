/**
 * Fact counts per confidence level (read-only). Reads the seed files from a directory (default ./data), so a baseline
 * can be compared: `git show main:data/programs.seed.json > /tmp/base/programs.seed.json` (etc.), then --dir /tmp/base.
 *
 *   npx tsx scripts/data-counts.ts [--dir <data-dir>] [--now 2026-11-27] [--json]
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { computeConfidence } from '../src/lib/confidence';

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const dir = resolve(flag('--dir') ?? 'data');
const now = new Date(`${flag('--now') ?? new Date().toISOString().slice(0, 10)}T12:00:00Z`);
const read = (f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8'));

const isFact = (v: unknown): boolean => !!v && typeof v === 'object' && 'value' in (v as object) && 'source_url' in (v as object) && 'evidence_snippet' in (v as object);
const tally = (facts: unknown[]) => {
  const t: Record<string, number> = { Verified: 0, Likely: 0, Unverified: 0, Conflict: 0 };
  for (const f of facts) t[computeConfidence(f as never, now)]++;
  return { ...t, total: facts.length };
};

const pf = read('programs.seed.json');
const programs: Record<string, unknown>[] = pf.programs ?? pf;
const institutions: Record<string, unknown>[] = pf.institutions ?? read('institutions.seed.json');
const programFacts = programs.flatMap((p) => Object.values(p).filter(isFact));
const instFacts = institutions.flatMap((p) => Object.values(p).filter(isFact));
const countryFacts = (read('country_facts.seed.json').country_facts as Record<string, unknown>[]).map((f) => ({
  value: f.value, source_url: f.source_url, evidence_snippet: f.evidence_snippet, fetched_at: f.fetched_at, basis: f.basis, conflicts: f.conflicts,
}));
const fx = (read('fx_rates.seed.json').fx_rates as Record<string, unknown>[]).map((r) => r.pkr_per_unit);
const rules = read('conversion_rules.seed.json');
const ruleList = (rules.conversion_rules ?? rules.rules ?? []) as Record<string, unknown>[];

const out = {
  programs: programs.length,
  institutions: institutions.length,
  program_facts: tally(programFacts),
  institution_facts: tally(instFacts),
  country_facts: tally(countryFacts),
  fx_rates: tally(fx),
  conversion_rules: { total: ruleList.length, with_source: ruleList.filter((r) => r.source_url && r.evidence_snippet).length },
};
console.log(JSON.stringify(out, null, 2));
