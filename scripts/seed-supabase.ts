/**
 * Loads data/*.seed.json into Supabase (idempotent upsert by id; safe to run again and again).
 *
 *   npx tsx scripts/seed-supabase.ts            # validate, then upsert everything
 *   npx tsx scripts/seed-supabase.ts --dry-run  # validate only, no network, no keys needed
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from the environment or .env.local).
 * The service-role key bypasses row level security: run this only on a trusted machine, never in the browser.
 * Rows that exist in the database but not in the seed files are left alone (nothing is deleted).
 * Run the migration in supabase/migrations first.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { buildSeedRows, validateSeedRows, type SeedRows } from '../src/lib/supabase/mappers';
import type { ConversionRule, CountryFact, FxRate, Institution, Program } from '../src/lib/types';

const root = process.cwd();

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(root, 'data', file), 'utf8')) as T;
}

function loadEnvLocal(): void {
  for (const name of ['.env.local', '.env']) {
    const file = join(root, name);
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
    } catch {
      /* ignore unreadable env files; real env vars still apply */
    }
  }
}

function loadSeed() {
  const programs = readJson<{ institutions: Institution[]; programs: Program[] }>('programs.seed.json');
  const countryFacts = readJson<{ country_facts: CountryFact[] }>('country_facts.seed.json');
  const rules = readJson<{ conversion_rules: ConversionRule[] }>('conversion_rules.seed.json');
  const fx = readJson<{ fx_rates: FxRate[] }>('fx_rates.seed.json');
  return {
    institutions: programs.institutions,
    programs: programs.programs,
    countryFacts: countryFacts.country_facts,
    conversionRules: rules.conversion_rules,
    fxRates: fx.fx_rates,
  };
}

/** Upsert order respects foreign keys (programs reference institutions). */
const TABLE_ORDER: (keyof SeedRows)[] = ['institutions', 'programs', 'country_facts', 'conversion_rules', 'fx_rates'];
const BATCH = 500;

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const rows = buildSeedRows(loadSeed(), new Date());
  const problems = validateSeedRows(rows);
  if (problems.length > 0) {
    console.error(`seed-supabase: ${problems.length} problem(s) in data/*.seed.json:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  const counts = TABLE_ORDER.map((t) => `${t}: ${rows[t].length}`).join(', ');
  if (dryRun) {
    console.log(`seed-supabase: dry run OK (${counts}). Nothing was written.`);
    return;
  }

  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    console.error(
      [
        'seed-supabase: missing environment variables.',
        `  NEXT_PUBLIC_SUPABASE_URL:  ${url ? 'set' : 'MISSING'}`,
        `  SUPABASE_SERVICE_ROLE_KEY: ${serviceKey ? 'set' : 'MISSING'}`,
        'Add them to .env.local (see .env.example) or export them, then run again.',
        'Tip: `npx tsx scripts/seed-supabase.ts --dry-run` checks the seed files without any keys.',
      ].join('\n'),
    );
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  for (const table of TABLE_ORDER) {
    const list = rows[table] as unknown as Record<string, unknown>[];
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'id' });
      if (error) {
        console.error(`seed-supabase: upsert into ${table} failed: ${error.message}`);
        if (error.code === '42P01') console.error('  The table does not exist. Run supabase/migrations/*_init.sql first.');
        process.exit(1);
      }
    }
    console.log(`seed-supabase: ${table}: ${list.length} row(s) upserted`);
  }
  console.log('seed-supabase: done.');
}

main().catch((err) => {
  console.error('seed-supabase: failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
