/**
 * Data access layer. The DATABASE is the source of truth; the seed JSON is the offline/default source.
 *
 * - If Supabase env vars are set (and DATA_SOURCE !== 'seed'), rows are read from Supabase (see ./supabase-source.ts).
 * - Otherwise rows come from /data/*.seed.json, bundled at build time (fast, edge-cacheable, works offline).
 *
 * All search, filtering, ranking and fit run as plain code over these rows. No AI call per search.
 * Server-only: do not import this module from client components.
 */
import 'server-only';
import { cache } from 'react';
import type { ConversionRule, CountryFact, CountryFactKey, FxRate, Institution, Program } from '../types';
import { seedSource } from './seed-source';

export interface Dataset {
  programs: Program[];
  institutions: Institution[];
  countryFacts: CountryFact[];
  conversionRules: ConversionRule[];
  fxRates: FxRate[];
}

export interface DataSource {
  name: 'seed' | 'supabase';
  load(): Promise<Dataset>;
}

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.DATA_SOURCE !== 'seed',
  );
}

async function pickSource(): Promise<DataSource> {
  if (supabaseConfigured()) {
    try {
      const mod = await import('./supabase-source');
      return mod.supabaseSource;
    } catch (err) {
      console.error('[data] Supabase source unavailable, falling back to seed JSON:', err);
    }
  }
  return seedSource;
}

/**
 * Removes internal-only fields (`review_note`: reviewer provenance) from everything the app serves.
 * They are never shown to students, and dropping them keeps props passed to client islands small.
 */
export function stripInternal<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripInternal) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'review_note') continue;
      out[k] = stripInternal(v);
    }
    return out as T;
  }
  return value;
}

/** Loads the whole dataset once per request (React cache). Falls back to seed data on any DB error. */
export const getDataset = cache(async (): Promise<Dataset> => {
  const source = await pickSource();
  try {
    return stripInternal(await source.load());
  } catch (err) {
    if (source.name === 'seed') throw err;
    console.error('[data] Supabase load failed, falling back to seed JSON:', err);
    return stripInternal(await seedSource.load());
  }
});

export async function getPrograms(): Promise<Program[]> {
  return (await getDataset()).programs;
}

/** Field slugs that have at least one active program (for the profile pickers). */
export async function getFieldsWithPrograms(): Promise<string[]> {
  return [...new Set((await getDataset()).programs.filter((p) => p.status === 'active').map((p) => p.field))].sort();
}

export async function getProgram(id: string): Promise<Program | null> {
  return (await getDataset()).programs.find((p) => p.id === id) ?? null;
}

export async function getInstitutions(): Promise<Institution[]> {
  return (await getDataset()).institutions;
}

export async function getInstitutionMap(): Promise<Map<string, Institution>> {
  return new Map((await getDataset()).institutions.map((i) => [i.id, i]));
}

export async function getInstitution(id: string): Promise<Institution | null> {
  return (await getInstitutionMap()).get(id) ?? null;
}

export async function getCountryFacts(): Promise<CountryFact[]> {
  return (await getDataset()).countryFacts;
}

export async function getCountryFact(country: string, key: CountryFactKey): Promise<CountryFact | null> {
  return (await getDataset()).countryFacts.find((f) => f.country === country && f.key === key) ?? null;
}

export async function getConversionRules(): Promise<ConversionRule[]> {
  return (await getDataset()).conversionRules;
}

export async function getFxRates(): Promise<FxRate[]> {
  return (await getDataset()).fxRates;
}
