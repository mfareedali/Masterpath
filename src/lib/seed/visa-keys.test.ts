/** The three visa keys exist everywhere a country-fact key is listed (types, mapper, JSON schema, SQL). */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import schema from '@data/schemas/country_facts.schema.json';
import { COUNTRY_FACT_KEYS } from './fields';

const VISA = ['visa_fee', 'visa_processing_time', 'student_work_rights'];

describe('visa country-fact keys', () => {
  it('are in the TypeScript key list and the JSON schema enum (no drift)', () => {
    for (const k of VISA) expect(COUNTRY_FACT_KEYS).toContain(k);
    expect([...schema.$defs.countryFactKey.enum].sort()).toEqual([...COUNTRY_FACT_KEYS].sort());
  });

  it('the latest migration allows exactly the same keys in the SQL check constraint', () => {
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const file = readdirSync(dir).filter((f) => f.includes('visa_fact_keys')).at(-1)!;
    const sql = readFileSync(join(dir, file), 'utf8');
    const inList = /key in \(([\s\S]*?)\)\s*\)/.exec(sql)![1];
    const keys = [...inList.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...COUNTRY_FACT_KEYS].sort());
  });
});
