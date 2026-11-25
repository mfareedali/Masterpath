/**
 * Test helper (not a test file): mimics what a row looks like after a trip through Postgres + PostgREST,
 * so mapper tests check the real read path instead of handing the seed objects straight back.
 *
 *  - jsonb: JSON round trip (undefined keys vanish, key order may change).
 *  - timestamptz: PostgREST returns e.g. "2026-11-23T00:00:00+00:00" for an input of "2026-11-23".
 *  - date: "YYYY-MM-DD".
 *  - select(columns): only the requested columns come back; an unknown column is an error (like PostgREST).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SeedRows } from '@/lib/supabase/mappers';

export function pgJsonb<T>(v: T): T {
  return v === null || v === undefined ? (null as T) : (JSON.parse(JSON.stringify(v)) as T);
}

/** PostgREST's JSON rendering of a timestamptz in a UTC session. */
export function pgTimestamptz(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = Date.parse(String(v));
  if (Number.isNaN(t)) throw new Error(`invalid timestamptz input: ${String(v)}`);
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})\.(\d{3})Z$/.exec(new Date(t).toISOString());
  if (!m) throw new Error(`unexpected ISO string for ${String(v)}`);
  const frac = m[3].replace(/0+$/, '');
  return `${m[1]}T${m[2]}${frac ? `.${frac}` : ''}+00:00`;
}

export function pgDate(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = Date.parse(String(v));
  if (Number.isNaN(t)) throw new Error(`invalid date input: ${String(v)}`);
  return new Date(t).toISOString().slice(0, 10);
}

type Row = Record<string, unknown>;

const JSONB_COLUMNS: Record<keyof SeedRows, readonly string[] | 'all-objects'> = {
  institutions: 'all-objects',
  programs: 'all-objects',
  country_facts: ['value', 'conflicts'],
  conversion_rules: ['params'],
  fx_rates: ['pkr_per_unit'],
};
const TIMESTAMPTZ_COLUMNS: Record<keyof SeedRows, readonly string[]> = {
  institutions: [],
  programs: [],
  country_facts: ['fetched_at'],
  conversion_rules: ['fetched_at'],
  fx_rates: [],
};
const DATE_COLUMNS: Record<keyof SeedRows, readonly string[]> = {
  institutions: [],
  programs: ['last_checked'],
  country_facts: [],
  conversion_rules: [],
  fx_rates: [],
};

/**
 * One row as it would be stored and read back (all columns, plus updated_at like the real table).
 * Typed as the input row type: the shape is the same, only the encodings change.
 */
export function throughPostgres<T extends object>(table: keyof SeedRows, row: T): T {
  return throughPostgresRaw(table, row) as unknown as T;
}

function throughPostgresRaw(table: keyof SeedRows, row: object): Row {
  const out: Row = {};
  const jsonb = JSONB_COLUMNS[table];
  for (const [k, v] of Object.entries(row)) {
    if (v === undefined) continue; // not sent -> column default (null for these)
    if (TIMESTAMPTZ_COLUMNS[table].includes(k)) out[k] = pgTimestamptz(v);
    else if (DATE_COLUMNS[table].includes(k)) out[k] = pgDate(v);
    else if (jsonb === 'all-objects' ? typeof v === 'object' && v !== null : jsonb.includes(k)) out[k] = pgJsonb(v);
    else out[k] = v;
  }
  out.updated_at = '2026-11-24T10:00:00+00:00';
  return out;
}

/** PostgREST `select=a,b,c`: only those columns; an unknown column is an error. */
export function selectColumns(rows: Row[], columns: string, tableColumns: readonly string[]): { data: Row[] | null; error: { message: string } | null } {
  const cols = columns.split(',').map((c) => c.trim());
  const unknown = cols.filter((c) => !tableColumns.includes(c));
  if (unknown.length > 0) return { data: null, error: { message: `column ${unknown.join(', ')} does not exist` } };
  return { data: rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))), error: null };
}

/* ------------------------------------------------------------------ */
/* Migration SQL helpers                                               */
/* ------------------------------------------------------------------ */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** All migrations concatenated, with `--` comments removed (so comments never satisfy or break a check). */
export function migrationSql(): string {
  return migrationFiles()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

/** Raw SQL including comments (for checking that required explanations are written down). */
export function migrationSqlWithComments(): string {
  return migrationFiles()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

/** Body of `create table ... public.<name> ( ... );` (balanced parentheses). */
export function createTableBody(sql: string, table: string): string | null {
  const re = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${table}\\s*\\(`, 'i');
  const m = re.exec(sql);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < sql.length && depth > 0; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')') depth--;
  }
  return sql.slice(start, i - 1);
}

/** Splits a table body at top-level commas into column / constraint definitions. */
export function tableItems(body: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = '';
  for (const ch of body) {
    if (ch === "'") quote = !quote;
    if (!quote) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        items.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

/** Column name -> definition text (constraints such as `primary key (...)`, `constraint x ...` are skipped). */
export function tableColumns(sql: string, table: string): Map<string, string> {
  const body = createTableBody(sql, table);
  if (body === null) throw new Error(`table public.${table} not found in migrations`);
  const cols = new Map<string, string>();
  for (const item of tableItems(body)) {
    const name = item.split(/\s+/)[0].toLowerCase();
    if (['constraint', 'primary', 'unique', 'check', 'foreign', 'exclude'].includes(name)) continue;
    cols.set(name, item.replace(/\s+/g, ' '));
  }
  return cols;
}

export function createdTables(sql: string): string[] {
  return [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase());
}

export interface PolicyDef {
  name: string;
  table: string;
  command: string;
  roles: string;
  text: string;
}

export function policies(sql: string): PolicyDef[] {
  const out: PolicyDef[] = [];
  const re = /create\s+policy\s+"([^"]+)"\s+on\s+public\.([a-z_][a-z0-9_]*)([\s\S]*?);/gi;
  for (const m of sql.matchAll(re)) {
    const rest = m[3];
    const command = /\bfor\s+(select|insert|update|delete|all)\b/i.exec(rest)?.[1]?.toLowerCase() ?? 'all';
    const roles = /\bto\s+([a-z_,\s]+?)(?:\s+using|\s+with\s+check|$)/i.exec(rest)?.[1]?.trim().toLowerCase() ?? 'public';
    out.push({ name: m[1], table: m[2].toLowerCase(), command, roles, text: rest.replace(/\s+/g, ' ') });
  }
  return out;
}
