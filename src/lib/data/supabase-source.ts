/**
 * Supabase-backed DataSource: reads the five PUBLIC tables with the anon key (row level security allows SELECT
 * only) and maps rows back to the exact types in ../types.
 *
 * - No cookies and no user session: the result is the same for everyone, so it stays cacheable. Each request
 *   goes through Next's data cache (force-cache + revalidate below, tag DATA_CACHE_TAG for on-demand revalidation).
 * - Any query error throws; ./index.ts then falls back to the seed JSON. An empty programs table also throws
 *   (a database that was never seeded must not show an empty app).
 * - A single broken row is logged and skipped instead of taking the whole database offline.
 */
import { createClient } from '@supabase/supabase-js';
import type { Dataset, DataSource } from './index';
import {
  CONVERSION_RULE_COLUMNS,
  COUNTRY_FACT_COLUMNS,
  FX_RATE_COLUMNS,
  INSTITUTION_COLUMNS,
  PROGRAM_COLUMNS,
  rowToConversionRule,
  rowToCountryFact,
  rowToFxRate,
  rowToInstitution,
  rowToProgram,
  type ConversionRuleRow,
  type CountryFactRow,
  type FxRateRow,
  type InstitutionRow,
  type MapIssue,
  type ProgramRow,
} from '../supabase/mappers';

export {
  rowToConversionRule,
  rowToCountryFact,
  rowToFxRate,
  rowToInstitution,
  rowToProgram,
} from '../supabase/mappers';

/** Seconds a cached copy of the public tables may be served (matches `export const revalidate = 3600` pages). */
export const DATA_REVALIDATE_SECONDS = 3600;
/** Tag for revalidateTag() after a data update. */
export const DATA_CACHE_TAG = 'masterspath-data';
/** PostgREST returns at most this many rows per request by default. */
export const PAGE_SIZE = 1000;

export type PublicTable = 'institutions' | 'programs' | 'country_facts' | 'conversion_rules' | 'fx_rates';

/** Minimal reader so the loader can be unit-tested without a database. */
export interface TableReader {
  readPage(
    table: PublicTable,
    columns: string,
    from: number,
    to: number,
  ): Promise<{ data: unknown[] | null; error: { message: string } | null }>;
}

async function readAll(reader: TableReader, table: PublicTable, columns: readonly string[]): Promise<unknown[]> {
  const rows: unknown[] = [];
  const cols = columns.join(',');
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await reader.readPage(table, cols, from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`[data] Supabase ${table}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

function mapRows<R, T>(rows: unknown[], map: (row: R, issues: MapIssue[]) => T, issues: MapIssue[], table: string): T[] {
  const out: T[] = [];
  for (const row of rows) {
    try {
      out.push(map(row as R, issues));
    } catch (err) {
      issues.push({ table, id: String((row as { id?: unknown })?.id ?? '?'), field: '*', problem: `row skipped: ${(err as Error).message}` });
    }
  }
  return out;
}

/** Loads and maps all public tables. `onIssues` receives data problems (default: console.warn). */
export async function loadDatasetFromReader(
  reader: TableReader,
  onIssues: (issues: MapIssue[]) => void = (issues) => console.warn('[data] Supabase data issues:', issues),
): Promise<Dataset> {
  const [institutionRows, programRows, countryFactRows, ruleRows, fxRows] = await Promise.all([
    readAll(reader, 'institutions', INSTITUTION_COLUMNS),
    readAll(reader, 'programs', PROGRAM_COLUMNS),
    readAll(reader, 'country_facts', COUNTRY_FACT_COLUMNS),
    readAll(reader, 'conversion_rules', CONVERSION_RULE_COLUMNS),
    readAll(reader, 'fx_rates', FX_RATE_COLUMNS),
  ]);

  const issues: MapIssue[] = [];
  const dataset: Dataset = {
    institutions: mapRows<InstitutionRow, Dataset['institutions'][number]>(institutionRows, rowToInstitution, issues, 'institutions'),
    programs: mapRows<ProgramRow, Dataset['programs'][number]>(programRows, rowToProgram, issues, 'programs'),
    countryFacts: mapRows<CountryFactRow, Dataset['countryFacts'][number]>(countryFactRows, rowToCountryFact, issues, 'country_facts'),
    conversionRules: mapRows<ConversionRuleRow, Dataset['conversionRules'][number]>(ruleRows, rowToConversionRule, issues, 'conversion_rules'),
    fxRates: mapRows<FxRateRow, Dataset['fxRates'][number]>(fxRows, rowToFxRate, issues, 'fx_rates'),
  };
  if (issues.length > 0) onIssues(issues);
  if (dataset.programs.length === 0) {
    throw new Error('[data] Supabase has no usable programs. Run `npx tsx scripts/seed-supabase.ts` to load the seed data.');
  }
  return dataset;
}

/**
 * fetch wrapper: cache public-table reads in Next's data cache (ignored outside Next). Caching is opt-in in Next 16
 * and supabase-js sends an Authorization header (the anon key), so `cache: 'force-cache'` is set explicitly;
 * `revalidate` bounds staleness and the tag allows revalidateTag() after a data update.
 */
export const cachedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: 'force-cache',
    next: { revalidate: DATA_REVALIDATE_SECONDS, tags: [DATA_CACHE_TAG] },
  });

function createPublicReader(): TableReader {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('[data] Supabase is not configured.');
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: cachedFetch },
  });
  return {
    async readPage(table, columns, from, to) {
      const { data, error } = await client.from(table).select(columns).order('id', { ascending: true }).range(from, to);
      return { data: (data as unknown[] | null) ?? null, error: error ? { message: error.message } : null };
    },
  };
}

export const supabaseSource: DataSource = {
  name: 'supabase',
  async load() {
    return loadDatasetFromReader(createPublicReader());
  },
};
