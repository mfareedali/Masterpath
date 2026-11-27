/**
 * Adds NEW programs (and, when needed, institutions) from proposal files to data/programs.seed.json, but only after
 * every check passes. Nothing is written without --apply.
 *
 *   npx tsx scripts/add-programs.ts <proposal.json> [more.json ...]           check only
 *   npx tsx scripts/add-programs.ts --apply <proposal.json> [more.json ...]   check, then write data/programs.seed.json
 *
 * Checks, in order:
 *   1. Shape: known institution, unique new id, known fact keys only.
 *   2. The seed validator (src/lib/seed/validate.ts: JSON schemas + evidence rules) on the merged dataset.
 *   3. Live evidence: every evidence_snippet is fetched from its source_url and must appear verbatim on the page
 *      (same matcher as scripts/verify-snippet.ts and the ingestion pipeline).
 *
 * Proposal file format:
 *   {
 *     "institutions": [ ...optional, new Institution objects ],
 *     "programs": [
 *       { "id", "institution_id", "name", "country", "degree", "field", "official_url", "pathway_type",
 *         "status"?: "active", "status_note"?: {...},
 *         "facts": { "<fact key>": { "value", "source_url", "evidence_snippet", "fetched_at", "basis"?, "note"?, "review_note"? } } }
 *     ]
 *   }
 * Fact keys not given become "Not verified yet" ({ value: null, ... }). Never put a value without its evidence.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROGRAM_FACT_FIELDS, INSTITUTION_FACT_FIELDS } from '../src/lib/supabase/mappers';
import { formatReport, validateSeed, type SeedFiles } from '../src/lib/seed/validate';
import { fetchPageText } from '../src/lib/seed/page-text';
import { snippetAppearsIn } from '../src/lib/text/evidence';

const root = process.cwd();
const SEED = join(root, 'data', 'programs.seed.json');

type Obj = Record<string, unknown>;
const empty = () => ({ value: null, source_url: null, evidence_snippet: null, fetched_at: null });

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function sourcesOf(fact: Obj): Obj[] {
  const out: Obj[] = [fact];
  if (Array.isArray(fact.conflicts)) for (const c of fact.conflicts) if (c && typeof c === 'object') out.push(c as Obj);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const files = args.filter((a) => !a.startsWith('--'));
  if (files.length === 0) {
    console.error('Usage: tsx scripts/add-programs.ts [--apply] <proposal.json> [...]');
    process.exit(2);
  }

  const seed = readJson<{ institutions: Obj[]; programs: Obj[] } & Obj>(SEED);
  const institutionIds = new Set(seed.institutions.map((i) => String(i.id)));
  const programIds = new Set(seed.programs.map((p) => String(p.id)));
  const factKeys = new Set<string>(PROGRAM_FACT_FIELDS);
  const problems: string[] = [];
  const newInstitutions: Obj[] = [];
  const newPrograms: Obj[] = [];

  // 1. Shape
  for (const file of files) {
    const prop = readJson<{ institutions?: Obj[]; programs?: Obj[] }>(file);
    for (const inst of prop.institutions ?? []) {
      const id = String(inst.id);
      if (institutionIds.has(id)) continue; // already there: keep the existing row
      const full: Obj = { website: null, notes: null, ...inst };
      for (const k of INSTITUTION_FACT_FIELDS) full[k] = (inst[k] as Obj | undefined) ?? empty();
      newInstitutions.push(full);
      institutionIds.add(id);
    }
    for (const p of prop.programs ?? []) {
      const id = String(p.id);
      if (programIds.has(id)) problems.push(`${file}: program id "${id}" already exists`);
      programIds.add(id);
      if (!institutionIds.has(String(p.institution_id))) problems.push(`${id}: unknown institution_id "${String(p.institution_id)}"`);
      const facts = (p.facts ?? {}) as Record<string, Obj>;
      for (const k of Object.keys(facts)) if (!factKeys.has(k)) problems.push(`${id}: unknown fact key "${k}"`);
      const dates = Object.values(facts).flatMap((f) => sourcesOf(f)).map((s) => s.fetched_at).filter((d): d is string => typeof d === 'string');
      const program: Obj = {
        id,
        institution_id: p.institution_id,
        name: p.name,
        country: p.country,
        degree: p.degree,
        field: p.field,
        official_url: p.official_url ?? null,
        status: p.status ?? 'active',
        pathway_type: p.pathway_type ?? 'direct',
      };
      for (const k of PROGRAM_FACT_FIELDS) program[k] = facts[k] ?? (k === 'status_note' && p.status_note ? p.status_note : empty());
      program.last_checked = dates.length ? dates.sort().at(-1)!.slice(0, 10) : null;
      newPrograms.push(program);
    }
  }

  // 2. Seed validator on the merged dataset (only issues of the new rows are printed in full)
  const merged = { ...seed, institutions: [...seed.institutions, ...newInstitutions], programs: [...seed.programs, ...newPrograms] };
  const seedFiles: SeedFiles = {
    programs: merged,
    countryFacts: readJson(join(root, 'data', 'country_facts.seed.json')),
    conversionRules: readJson(join(root, 'data', 'conversion_rules.seed.json')),
    fxRates: readJson(join(root, 'data', 'fx_rates.seed.json')),
  };
  const report = validateSeed(seedFiles, new Date());
  const firstNew = seed.programs.length;
  const isNew = (path: string) => {
    const m = /^\/programs\/(\d+)/.exec(path);
    return (m && Number(m[1]) >= firstNew) || /^\/institutions\/(\d+)/.test(path) && Number(/^\/institutions\/(\d+)/.exec(path)![1]) >= seed.institutions.length;
  };
  for (const issue of report.issues) {
    if (issue.file !== 'programs.seed.json' || !isNew(issue.path)) continue;
    const prog = /^\/programs\/(\d+)/.exec(issue.path);
    const label = prog ? String(merged.programs[Number(prog[1])].id) + issue.path.replace(/^\/programs\/\d+/, '') : issue.path;
    if (issue.severity === 'error') problems.push(`validator: ${label}: ${issue.message}`);
    else console.log(`  warning: ${label}: ${issue.message}`);
  }
  if (report.errors > 0 && !problems.some((p) => p.startsWith('validator:'))) {
    problems.push('validator: errors outside the new rows:\n' + formatReport({ ...report, issues: report.issues.filter((i) => i.severity === 'error') }));
  }

  // 3. Live evidence check
  const cache = new Map<string, Promise<string>>();
  let checked = 0;
  for (const p of newPrograms) {
    for (const k of PROGRAM_FACT_FIELDS) {
      for (const s of sourcesOf(p[k] as Obj)) {
        const url = typeof s.source_url === 'string' ? s.source_url : null;
        const snippet = typeof s.evidence_snippet === 'string' ? s.evidence_snippet : null;
        if (!url || !snippet) continue;
        if (!cache.has(url)) cache.set(url, fetchPageText(url).then((p) => p.text));
        checked++;
        try {
          const ok = snippetAppearsIn(snippet, await cache.get(url)!);
          console.log(`${ok ? 'FOUND    ' : 'NOT FOUND'}  ${String(p.id)}.${k}`);
          if (!ok) problems.push(`${String(p.id)}.${k}: snippet not found verbatim on ${url}`);
        } catch (e) {
          console.log(`ERROR      ${String(p.id)}.${k}: ${(e as Error).message}`);
          problems.push(`${String(p.id)}.${k}: could not fetch ${url} (${(e as Error).message})`);
        }
      }
    }
  }

  console.log(`\n${newPrograms.length} new program(s), ${newInstitutions.length} new institution(s), ${checked} snippet(s) checked.`);
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  if (!apply) {
    console.log('All checks passed. Nothing written (add --apply to write data/programs.seed.json).');
    return;
  }
  writeFileSync(SEED, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${SEED}.`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
