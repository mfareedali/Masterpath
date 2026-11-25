/**
 * Reads data/*.seed.json into the domain types. Shared by scripts/seed-supabase.ts (upsert through the API) and
 * scripts/build-seed-sql.ts (the SQL seed migration), so both always load exactly the same rows.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatasetLike } from '../src/lib/supabase/mappers';
import type { ConversionRule, CountryFact, FxRate, Institution, Program } from '../src/lib/types';

function readJson<T>(root: string, file: string): T {
  return JSON.parse(readFileSync(join(root, 'data', file), 'utf8')) as T;
}

export function loadSeedFiles(root: string = process.cwd()): DatasetLike {
  const programs = readJson<{ institutions: Institution[]; programs: Program[] }>(root, 'programs.seed.json');
  const countryFacts = readJson<{ country_facts: CountryFact[] }>(root, 'country_facts.seed.json');
  const rules = readJson<{ conversion_rules: ConversionRule[] }>(root, 'conversion_rules.seed.json');
  const fx = readJson<{ fx_rates: FxRate[] }>(root, 'fx_rates.seed.json');
  return {
    institutions: programs.institutions,
    programs: programs.programs,
    countryFacts: countryFacts.country_facts,
    conversionRules: rules.conversion_rules,
    fxRates: fx.fx_rates,
  };
}
