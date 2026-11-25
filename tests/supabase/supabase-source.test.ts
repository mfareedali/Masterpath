/**
 * The Supabase DataSource loader, against a fake PostgREST that serves seed rows exactly as Postgres would
 * return them (pg-sim) and only knows the columns declared in the migration.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSeedDataset } from '@/lib/data/seed-source';
import {
  DATA_CACHE_TAG,
  DATA_REVALIDATE_SECONDS,
  PAGE_SIZE,
  cachedFetch,
  loadDatasetFromReader,
  supabaseSource,
  type PublicTable,
  type TableReader,
} from '@/lib/data/supabase-source';
import { buildSeedRows, type MapIssue, type SeedRows } from '@/lib/supabase/mappers';
import { FIXED_NOW } from '@/lib/test-fixtures';
import type { CountryFact } from '@/lib/types';
import { migrationSql, selectColumns, tableColumns, throughPostgres } from './pg-sim';

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * country_facts.note and review_note are flat nullable columns: an explicit null and an absent key are both stored as
 * NULL and both mean "no note", so the loader returns them absent. This is the only normalisation in the comparison.
 */
function nullNotesAsAbsent(facts: CountryFact[]): CountryFact[] {
  return facts.map((f) => {
    const out = { ...f };
    if (out.note === null) delete out.note;
    if (out.review_note === null) delete out.review_note;
    return out;
  });
}
const sql = migrationSql();
const TABLES: PublicTable[] = ['institutions', 'programs', 'country_facts', 'conversion_rules', 'fx_rates'];

function fakeDb(rows: SeedRows, opts: { failTable?: PublicTable } = {}) {
  const stored = Object.fromEntries(
    TABLES.map((t) => [t, (rows[t] as Record<string, unknown>[]).map((r) => throughPostgres(t, r)).sort((a, b) => String(a.id).localeCompare(String(b.id)))]),
  ) as Record<PublicTable, Record<string, unknown>[]>;
  const columns = Object.fromEntries(TABLES.map((t) => [t, [...tableColumns(sql, t).keys()]])) as Record<PublicTable, string[]>;
  const calls: { table: PublicTable; from: number; to: number }[] = [];
  const reader: TableReader = {
    async readPage(table, cols, from, to) {
      calls.push({ table, from, to });
      if (opts.failTable === table) return { data: null, error: { message: 'permission denied' } };
      const res = selectColumns(stored[table], cols, columns[table]);
      return res.error ? res : { data: res.data!.slice(from, to + 1), error: null };
    },
  };
  return { reader, calls };
}

describe('loadDatasetFromReader', () => {
  const seed = loadSeedDataset();

  it('loads the seeded database back to exactly the seed dataset', async () => {
    const { reader } = fakeDb(buildSeedRows(seed, FIXED_NOW));
    const onIssues = vi.fn();
    const d = await loadDatasetFromReader(reader, onIssues);
    const byId = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => x.id.localeCompare(y.id));
    expect(byId(d.programs)).toEqual(byId(json(seed.programs)));
    expect(byId(d.institutions)).toEqual(byId(json(seed.institutions)));
    expect(byId(d.countryFacts)).toEqual(byId(nullNotesAsAbsent(json(seed.countryFacts))));
    expect(byId(d.conversionRules)).toEqual(byId(json(seed.conversionRules)));
    expect(byId(d.fxRates)).toEqual(byId(json(seed.fxRates)));
    expect(onIssues).not.toHaveBeenCalled();
    // The new fields arrive through the real column list (PROGRAM_COLUMNS / COUNTRY_FACT_COLUMNS), not only the mappers.
    const brookes = d.programs.find((p) => p.id === 'brookes-msc-cs');
    expect(brookes?.min_gpa_rule.value?.alternatives).toEqual([{ scale: 'percent', min: 60 }]);
    expect(d.programs.filter((p) => p.conditional_admission.value != null).map((p) => p.id).sort()).toEqual(
      seed.programs.filter((p) => p.conditional_admission.value != null).map((p) => p.id).sort(),
    );
    expect(d.programs.filter((p) => p.language_waiver.value != null)).toHaveLength(
      seed.programs.filter((p) => p.language_waiver.value != null).length,
    );
    expect(d.countryFacts.filter((f) => f.key === 'proof_of_funds')).toHaveLength(
      seed.countryFacts.filter((f) => f.key === 'proof_of_funds').length,
    );
  });

  it('reads every page (PostgREST returns at most PAGE_SIZE rows per request)', async () => {
    const rows = buildSeedRows(seed);
    const many = Array.from({ length: PAGE_SIZE * 2 + 5 }, (_, i) => ({
      id: `x${String(i).padStart(4, '0')}-pkr`,
      currency: 'XTS',
      pkr_per_unit: { value: null, source_url: null, evidence_snippet: null, fetched_at: null },
    }));
    const { reader, calls } = fakeDb({ ...rows, fx_rates: many });
    const d = await loadDatasetFromReader(reader, () => {});
    expect(d.fxRates).toHaveLength(many.length);
    expect(calls.filter((c) => c.table === 'fx_rates').map((c) => c.from)).toEqual([0, PAGE_SIZE, PAGE_SIZE * 2]);
  });

  it('throws on a query error (the data layer then falls back to seed JSON)', async () => {
    const { reader } = fakeDb(buildSeedRows(seed), { failTable: 'country_facts' });
    await expect(loadDatasetFromReader(reader, () => {})).rejects.toThrow(/country_facts: permission denied/);
  });

  it('throws when the database was never seeded (never shows an empty app)', async () => {
    const empty: SeedRows = { institutions: [], programs: [], country_facts: [], conversion_rules: [], fx_rates: [] };
    await expect(loadDatasetFromReader(fakeDb(empty).reader, () => {})).rejects.toThrow(/no usable programs/);
  });

  it('skips a broken row, keeps the rest, and reports it', async () => {
    const rows = buildSeedRows(seed);
    const broken = { ...rows.programs[0], id: 'zz-broken', status: 'open' };
    const { reader } = fakeDb({ ...rows, programs: [...rows.programs, broken] });
    let issues: MapIssue[] = [];
    const d = await loadDatasetFromReader(reader, (i) => (issues = i));
    expect(d.programs).toHaveLength(seed.programs.length);
    expect(issues).toEqual([expect.objectContaining({ table: 'programs', id: 'zz-broken', field: '*' })]);
  });
});

describe('cachedFetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opts public reads into the Next data cache (revalidate + tag), keeping the caller options', async () => {
    const spy = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', spy);
    await cachedFetch('https://fixture.supabase.co/rest/v1/programs', { method: 'GET', headers: { apikey: 'anon' } });
    const init = (spy.mock.calls[0] as unknown as [string, RequestInit & { next?: unknown }])[1];
    expect(init.cache).toBe('force-cache');
    expect(init.next).toEqual({ revalidate: DATA_REVALIDATE_SECONDS, tags: [DATA_CACHE_TAG] });
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ apikey: 'anon' });
  });
});

describe('supabaseSource', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses to load without Supabase env vars (no network call)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    await expect(supabaseSource.load()).rejects.toThrow(/not configured/);
  });
});
