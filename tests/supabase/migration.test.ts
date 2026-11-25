/**
 * Static checks on supabase/migrations/*.sql (no database needed).
 * They keep the security model from drifting: RLS on every table, owner-only personal data, no ID numbers,
 * and every column the app reads actually exists.
 */
import { describe, expect, it } from 'vitest';
import {
  CONVERSION_RULE_COLUMNS,
  COUNTRY_FACT_COLUMNS,
  FX_RATE_COLUMNS,
  INSTITUTION_COLUMNS,
  INSTITUTION_FACT_FIELDS,
  PROGRAM_COLUMNS,
  PROGRAM_FACT_FIELDS,
} from '@/lib/supabase/mappers';
import { PROFILE_ROW_COLUMNS, STRENGTHS_ROW_COLUMNS } from '@/lib/supabase/profile-rows';
import { createdTables, migrationFiles, migrationSql, migrationSqlWithComments, policies, tableColumns } from './pg-sim';

const sql = migrationSql();
const tables = createdTables(sql);
const allPolicies = policies(sql);

const PUBLIC_TABLES = ['institutions', 'programs', 'country_facts', 'conversion_rules', 'fx_rates'];
const OWNER_TABLES = ['profiles', 'profile_strengths'];
const EXPECTED_TABLES = [...PUBLIC_TABLES, ...OWNER_TABLES, 'reports', 'chat_usage'];

/** auth.uid() = user_id, optionally wrapped as (select auth.uid()) for per-statement caching. */
const OWNER_CHECK = /\(\s*(?:\(\s*select\s+auth\.uid\(\)\s*\)|auth\.uid\(\))\s*=\s*user_id\s*\)/i;
const ID_DOCUMENT = /passport|cnic|nicop|national_?id|id_?number|identity_?(?:card|number|document)|ssn|social_security/i;

describe('migration files', () => {
  it('include the init migration', () => {
    expect(migrationFiles()).toContain('20261124000000_init.sql');
  });

  it('create every table the app needs', () => {
    for (const t of EXPECTED_TABLES) expect(tables).toContain(t);
  });

  it('are parsed for real (guards against checks that pass on nothing)', () => {
    // 5 public read + 4 profiles + 4 profile_strengths (reports and chat_usage have none)
    expect(allPolicies.length).toBeGreaterThanOrEqual(13);
    expect(tableColumns(sql, 'programs').size).toBe(9 + PROGRAM_FACT_FIELDS.length + 2);
    expect(tableColumns(sql, 'institutions').get('id')).toMatch(/^id text primary key/);
  });
});

describe('row level security', () => {
  it('is enabled on EVERY created table', () => {
    expect(tables.length).toBeGreaterThanOrEqual(EXPECTED_TABLES.length);
    for (const t of tables) {
      expect(sql, `public.${t} must enable row level security`).toMatch(
        new RegExp(`alter\\s+table\\s+(?:only\\s+)?public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, 'i'),
      );
    }
  });

  it('never disables it again', () => {
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/no\s+force\s+row\s+level\s+security/i);
  });

  it('public data: SELECT for anon + authenticated, and no write policies', () => {
    for (const t of PUBLIC_TABLES) {
      const ps = allPolicies.filter((p) => p.table === t);
      expect(ps.some((p) => p.command === 'select' && /anon/.test(p.roles) && /authenticated/.test(p.roles))).toBe(true);
      expect(ps.filter((p) => p.command !== 'select')).toEqual([]);
      expect(sql).not.toMatch(new RegExp(`grant\\s+[^;]*\\b(insert|update|delete|all)\\b[^;]*\\bon\\s+[^;]*public\\.${t}\\b[^;]*\\bto\\s+[^;]*\\b(anon|authenticated)\\b`, 'i'));
    }
  });

  it.each(OWNER_TABLES)('%s: select/insert/update/delete only when auth.uid() = user_id', (t) => {
    const ps = allPolicies.filter((p) => p.table === t);
    for (const cmd of ['select', 'insert', 'update', 'delete']) {
      const p = ps.find((x) => x.command === cmd);
      expect(p, `${t} needs a ${cmd} policy`).toBeDefined();
      expect(p!.roles).toBe('authenticated');
      if (cmd === 'insert') expect(p!.text).toMatch(new RegExp(`with\\s+check\\s*${OWNER_CHECK.source}`, 'i'));
      else expect(p!.text).toMatch(new RegExp(`using\\s*${OWNER_CHECK.source}`, 'i'));
      if (cmd === 'update') expect(p!.text).toMatch(new RegExp(`with\\s+check\\s*${OWNER_CHECK.source}`, 'i'));
    }
    expect(ps.some((p) => p.command === 'all' || /\busing\s*\(\s*true\s*\)/i.test(p.text))).toBe(false);
    expect(ps.some((p) => /anon/.test(p.roles))).toBe(false);
  });

  it('owner tables cascade-delete with the auth user (hard delete)', () => {
    for (const t of OWNER_TABLES) {
      expect(tableColumns(sql, t).get('user_id')).toMatch(/uuid primary key references auth\.users \(id\) on delete cascade/i);
    }
    const commented = migrationSqlWithComments();
    expect(commented).toMatch(/auth\.admin\.deleteUser/);
    expect(commented).toMatch(/\/api\/account\/delete/);
  });

  it('reports: service role only (no direct PostgREST inserts with the public anon key)', () => {
    // Review finding: anon/authenticated could INSERT straight into public.reports, skipping every check in
    // /api/report (Origin, rate limit, known program id and field, control-character stripping).
    expect(allPolicies.filter((p) => p.table === 'reports')).toEqual([]);
    expect(sql).not.toMatch(/grant\s+[^;]*\bon\s+(?:table\s+)?[^;]*public\.reports\b[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i);
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.reports\s+from\s+anon,\s*authenticated/i);
    // Re-running the file on a database made from the old version removes the old insert policy.
    expect(sql).toMatch(/drop\s+policy\s+if\s+exists\s+"Anyone can report"\s+on\s+public\.reports/i);
    expect(sql).toMatch(/grant\s+all\s+on\s+[^;]*public\.reports\b[^;]*\bto\s+service_role/i);
    expect(tableColumns(sql, 'reports').get('status')).toMatch(/default 'open'/i);
    expect(tableColumns(sql, 'reports').get('message')).toMatch(/char_length\(message\) between 10 and 1000/i);
  });

  it('chat_usage: no policies at all (service role only)', () => {
    expect(allPolicies.filter((p) => p.table === 'chat_usage')).toEqual([]);
    expect(sql).toMatch(/revoke\s+all\s+on\s+public\.chat_usage\s+from\s+anon,\s*authenticated/i);
    expect(sql).toMatch(/primary key \(client_id, day\)/i);
  });
});

describe('privacy', () => {
  it('no column is named like a passport / CNIC / national ID / ID number', () => {
    for (const t of tables) {
      for (const name of tableColumns(sql, t).keys()) {
        expect(name, `public.${t}.${name}`).not.toMatch(ID_DOCUMENT);
      }
    }
    expect(sql).not.toMatch(ID_DOCUMENT); // not even in a later "alter table add column"
  });

  it('profiles only hold the documented fields', () => {
    expect([...tableColumns(sql, 'profiles').keys()].sort()).toEqual(
      ['budget_pkr', 'cgpa', 'degree', 'field', 'min_pass', 'scale', 'target_countries', 'university_id', 'university_name', 'updated_at', 'user_id'].sort(),
    );
  });
});

describe('facts are jsonb with the well-formed CHECK', () => {
  it('fact_is_well_formed(jsonb) exists and is immutable', () => {
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.fact_is_well_formed\(\s*f\s+jsonb\s*\)[\s\S]*?\bimmutable\b/i);
  });

  it('every Program fact field has its own jsonb column with the CHECK', () => {
    const cols = tableColumns(sql, 'programs');
    for (const f of PROGRAM_FACT_FIELDS) {
      expect(cols.get(f), `programs.${f}`).toMatch(new RegExp(`^${f} jsonb .*check \\(public\\.fact_is_well_formed\\(${f}\\)\\)`, 'i'));
    }
  });

  it('every Institution fact and fx_rates.pkr_per_unit has the CHECK', () => {
    const cols = tableColumns(sql, 'institutions');
    for (const f of INSTITUTION_FACT_FIELDS) {
      expect(cols.get(f)).toMatch(new RegExp(`check \\(public\\.fact_is_well_formed\\(${f}\\)\\)`, 'i'));
    }
    expect(tableColumns(sql, 'fx_rates').get('pkr_per_unit')).toMatch(/check \(public\.fact_is_well_formed\(pkr_per_unit\)\)/i);
  });

  it('country_facts.confidence is documented as a cache only', () => {
    expect(tableColumns(sql, 'country_facts').get('confidence')).toBeDefined();
    expect(migrationSqlWithComments()).toMatch(/comment on column public\.country_facts\.confidence is\s*'Cache only/i);
    expect(sql).toMatch(/unique \(country, key\)/i);
  });
});

describe('the app only reads columns that exist', () => {
  const cases: [string, readonly string[]][] = [
    ['institutions', INSTITUTION_COLUMNS],
    ['programs', PROGRAM_COLUMNS],
    ['country_facts', COUNTRY_FACT_COLUMNS],
    ['conversion_rules', CONVERSION_RULE_COLUMNS],
    ['fx_rates', FX_RATE_COLUMNS],
    ['profiles', PROFILE_ROW_COLUMNS.split(',').map((c) => c.trim())],
    ['profile_strengths', STRENGTHS_ROW_COLUMNS.split(',').map((c) => c.trim())],
  ];
  it.each(cases)('%s', (table, columns) => {
    const cols = tableColumns(sql, table);
    for (const c of columns) expect(cols.has(c), `${table}.${c}`).toBe(true);
  });
});
