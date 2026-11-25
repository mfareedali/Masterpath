/**
 * Test helpers ONLY (never import from app code). Fixture institutions/programs are fictional
 * ("Fixture University") so tests never encode real requirement values.
 */
import { emptyFact } from './confidence';
import type { Dataset } from './data/index';
import type { ConversionRule, CountryFact, Fact, FxRate, Institution, Program } from './types';
import emptyPrograms from '../../tests/fixtures/seed-empty/programs.json';
import emptyCountryFacts from '../../tests/fixtures/seed-empty/country_facts.json';
import emptyConversionRules from '../../tests/fixtures/seed-empty/conversion_rules.json';
import emptyFxRates from '../../tests/fixtures/seed-empty/fx_rates.json';

/**
 * The seed exactly as it was on 24 Nov 2026 BEFORE any evidence was merged (every program fact Unverified,
 * a few Likely country facts). Tests about "behaviour with empty data" use this frozen copy, so adding real
 * data to /data never breaks them. Tests about today's real data use loadSeedDataset() instead.
 */
export function loadEmptySeedDataset(): Dataset {
  return JSON.parse(
    JSON.stringify({
      programs: emptyPrograms.programs as unknown as Program[],
      institutions: emptyPrograms.institutions as unknown as Institution[],
      countryFacts: emptyCountryFacts.country_facts as unknown as CountryFact[],
      conversionRules: emptyConversionRules.conversion_rules as unknown as ConversionRule[],
      fxRates: emptyFxRates.fx_rates as unknown as FxRate[],
    }),
  ) as Dataset;
}

export const FIXED_NOW = new Date('2026-11-24T12:00:00Z');

export function daysAgo(n: number, now: Date = FIXED_NOW): string {
  return new Date(now.getTime() - n * 86_400_000).toISOString();
}

/** A Verified fact (verbatim snippet, fetched `ageDays` ago). */
export function verified<T>(value: T, ageDays = 1, url = 'https://fixture.example.edu/program'): Fact<T> {
  return { value, source_url: url, evidence_snippet: `Fixture snippet for ${JSON.stringify(value)}`, fetched_at: daysAgo(ageDays) };
}

/** A Likely fact (summary of an official page). */
export function likely<T>(value: T, url = 'https://fixture.example.edu/summary'): Fact<T> {
  return { value, source_url: url, evidence_snippet: null, fetched_at: daysAgo(2), basis: 'summary' };
}

/** A value with no evidence (Unverified). */
export function unverified<T>(value: T | null = null): Fact<T> {
  return { value, source_url: null, evidence_snippet: null, fetched_at: null };
}

/** Two sources that disagree (Conflict). */
export function conflicting<T>(a: T, b: T): Fact<T> {
  return {
    ...verified(a, 1, 'https://fixture.example.edu/page-a'),
    conflicts: [verified(b, 1, 'https://fixture.example.edu/page-b')],
  };
}

export function makeProgram(overrides: Partial<Program> = {}): Program {
  return {
    id: 'fixture-msc-cs',
    institution_id: 'fixture-uni',
    name: 'MSc Fixture Computing',
    country: 'UK',
    degree: 'MSc',
    field: 'cs',
    official_url: 'https://fixture.example.edu/program',
    status: 'active',
    status_note: emptyFact(),
    pathway_type: 'direct',
    intake: emptyFact(),
    deadline: emptyFact(),
    min_gpa_rule: emptyFact(),
    language_req: emptyFact(),
    tuition: emptyFact(),
    living_cost: emptyFact(),
    duration_months: emptyFact(),
    scholarship_info: emptyFact(),
    sop_requirements: emptyFact(),
    lor_count: emptyFact(),
    cv_requirements: emptyFact(),
    tests_required: emptyFact(),
    research_considered: emptyFact(),
    progression_guaranteed: emptyFact(),
    progression_requirement: emptyFact(),
    eligibility_note: emptyFact(),
    conditional_admission: emptyFact(),
    language_waiver: emptyFact(),
    admissions_email: emptyFact(),
    last_checked: null,
    ...overrides,
  };
}

export function makeInstitution(overrides: Partial<Institution> = {}): Institution {
  return {
    id: 'fixture-uni',
    name: 'Fixture University',
    country: 'UK',
    kind: 'destination',
    website: 'https://fixture.example.edu',
    hec_status: emptyFact(),
    pqr_status: emptyFact(),
    anabin_status: emptyFact(),
    recognition_list_status: emptyFact(),
    notes: null,
    ...overrides,
  };
}
