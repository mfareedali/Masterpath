/**
 * Typed Supabase queries. SERVER ONLY.
 *
 * Three kinds of access, each with the narrowest key that works:
 *
 *  1. Public reference data (rankings, programs, facts, conflicts): the public anon key, NO cookies. The answer is
 *     the same for every visitor, so it goes through Next's data cache (revalidated hourly, tag DATA_CACHE_TAG)
 *     like the rest of the data layer. One query per call, never one per row.
 *  2. The signed-in student's own data (profile, strengths): the cookie-bound server client. Every call verifies the
 *     session with Supabase Auth (getUser) and row level security ((select auth.uid()) = user_id) applies.
 *  3. Data reports: service role, only after /api/report has validated, rate-limited and same-origin-checked the
 *     report. The reports table is service-role only (deny-all for anon/authenticated), so a direct PostgREST insert
 *     with the public key can never skip those checks.
 *
 * Rules kept from the rest of the app:
 *  - Ranking SQL (public.rank_programs / rank_countries) ranks only Verified/Likely values; rows without one come last
 *    with rank null and dataMissing true. "Rank by fit" is NOT here: it needs the student's grade and stays in app
 *    code (src/lib/fit, src/lib/shortlist). The fit label comes from that engine, never from the database or the AI.
 *  - Confidence is computed (in SQL views here, src/lib/confidence.ts in the app), never read from a stored value.
 *  - Reviewer notes (review_note) never leave the server.
 */
import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/types/supabase';
import { stripInternal } from './data';
import { cachedFetch } from './data/supabase-source';
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from './supabase/env';
import {
  INSTITUTION_COLUMNS,
  PROGRAM_COLUMNS,
  rowToInstitution,
  rowToProgram,
  type InstitutionRow,
  type MapIssue,
  type ProgramRow,
} from './supabase/mappers';
import {
  PROFILE_ROW_COLUMNS,
  STRENGTHS_ROW_COLUMNS,
  parseStrengths,
  profileToRow,
  rowToProfile,
  rowToStrengths,
  strengthsAreEmpty,
  strengthsToRow,
  type StrengthsRow,
} from './supabase/profile-rows';
import { createSupabaseAdminClient } from './supabase/admin';
import { createSupabaseServerClient, type TypedSupabaseClient } from './supabase/server';
import type { Confidence, Institution, Profile, Program, Strengths } from './types';

/* ------------------------------------------------------------------ */
/* Shared                                                              */
/* ------------------------------------------------------------------ */

export type SortDirection = 'asc' | 'desc';

/** Thrown when Supabase is not configured or a query fails. Callers fall back to the seed data or show an error. */
export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryError';
  }
}

let publicClient: TypedSupabaseClient | null = null;

/** Anon key, no session, cached fetch. Safe for public data only. */
function getPublicClient(): TypedSupabaseClient {
  if (publicClient) return publicClient;
  const url = supabaseUrl();
  const key = supabaseAnonKey();
  if (!url || !key) throw new QueryError('Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).');
  publicClient = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: cachedFetch },
  });
  return publicClient;
}

/**
 * "Today" for the ranking SQL. Only sent when MASTERSPATH_NOW pins it for a recorded demo; otherwise the database
 * uses now(), which keeps the request URL (and so the cache key) stable.
 */
function pinnedNow(): string | undefined {
  const pinned = process.env.MASTERSPATH_NOW;
  if (!pinned) return undefined;
  const t = Date.parse(pinned);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function asConfidence(v: string | null | undefined): Confidence {
  return v === 'Verified' || v === 'Likely' || v === 'Conflict' ? v : 'Unverified';
}

/** Drops undefined values: supabase-js sends GET rpc arguments as text, and a null would arrive as the string "null". */
function definedArgs<T extends Record<string, unknown>>(args: T): T {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== null)) as T;
}

/* ------------------------------------------------------------------ */
/* 1. Public data                                                      */
/* ------------------------------------------------------------------ */

/** Keys public.rank_programs ranks by. Fit is ranked in app code. */
export const PROGRAM_SORT_KEYS = ['tuition_per_year', 'living_cost_per_year', 'total_cost', 'study_months', 'deadline'] as const;
export type ProgramSortKey = (typeof PROGRAM_SORT_KEYS)[number];

/** Country rules public.rank_countries ranks by (their number of months). */
export const COUNTRY_RANK_KEYS = ['citizenship_rule', 'post_study_work', 'pr_route'] as const;
export type CountryRankKey = (typeof COUNTRY_RANK_KEYS)[number];

export const SHORTLIST_PAGE_SIZE = 20;

export interface ShortlistRow {
  programId: string;
  programName: string;
  institutionName: string;
  country: string;
  field: string;
  pathwayType: string;
  /**
   * The normalised ranking number: USD per year (tuition_per_year, living_cost_per_year), USD for the whole
   * programme (total_cost), months (study_months), or days since 1970-01-01 (deadline). Null when data is missing.
   */
  sortValue: number | null;
  confidence: Confidence;
  /** 1-based position among ranked rows; null when the row is not ranked. */
  rank: number | null;
  dataMissing: boolean;
  /** Why the row is not ranked, in plain words (e.g. "Tuition not verified yet"). */
  missingReason: string | null;
}

export interface ShortlistPage {
  sortKey: ProgramSortKey;
  direction: SortDirection;
  country: string | null;
  page: number;
  pageSize: number;
  /** Rows matching the filters (ranked + not ranked). */
  total: number;
  pageCount: number;
  rows: ShortlistRow[];
}

/**
 * One page of active programs ranked by a key (public.rank_programs). Ranked rows first, then the
 * "Not ranked: data missing" rows with their reason. Ruled-out programs are not included.
 */
export async function getShortlist(
  sortKey: ProgramSortKey,
  direction: SortDirection = 'asc',
  country: string | null = null,
  page = 1,
  options: { field?: string | null; pageSize?: number } = {},
): Promise<ShortlistPage> {
  if (!PROGRAM_SORT_KEYS.includes(sortKey)) throw new QueryError(`Unknown sort key: ${String(sortKey)}`);
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize ?? SHORTLIST_PAGE_SIZE), 1), 100);
  const safePage = Math.max(Math.trunc(page) || 1, 1);
  const { data, error } = await getPublicClient().rpc(
    'rank_programs',
    definedArgs({
      p_sort_key: sortKey,
      p_direction: direction === 'desc' ? 'desc' : 'asc',
      p_country: country ?? undefined,
      p_field: options.field ?? undefined,
      p_limit: pageSize,
      p_offset: (safePage - 1) * pageSize,
      p_now: pinnedNow(),
    }),
    { get: true },
  );
  if (error) throw new QueryError(`rank_programs: ${error.message}`);
  const rows = (data ?? []).map(
    (r): ShortlistRow => ({
      programId: r.program_id,
      programName: r.program_name,
      institutionName: r.institution_name,
      country: r.country,
      field: r.field,
      pathwayType: r.pathway_type,
      sortValue: r.sort_value ?? null,
      confidence: asConfidence(r.confidence),
      rank: r.rank ?? null,
      dataMissing: r.data_missing,
      missingReason: r.missing_reason ?? null,
    }),
  );
  const total = data?.[0]?.total_count ?? 0;
  return {
    sortKey,
    direction,
    country,
    page: safePage,
    pageSize,
    total,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
    rows,
  };
}

export interface CountryRankingRow {
  country: string;
  /** The rule itself, as the source states it. Show this, not the number. */
  rule: string | null;
  /** The months number the rule is ranked by (a sort key, not the law). Null when data is missing. */
  rankValue: number | null;
  confidence: Confidence;
  sourceUrl: string | null;
  evidenceSnippet: string | null;
  fetchedAt: string | null;
  rank: number | null;
  dataMissing: boolean;
  missingReason: string | null;
}

/** Destination countries ranked by a country rule (public.rank_countries). No usable rule = listed last. */
export async function getCountryRanking(key: CountryRankKey, direction: SortDirection = 'asc'): Promise<CountryRankingRow[]> {
  if (!COUNTRY_RANK_KEYS.includes(key)) throw new QueryError(`Unknown country key: ${String(key)}`);
  const { data, error } = await getPublicClient().rpc(
    'rank_countries',
    definedArgs({ p_key: key, p_direction: direction === 'desc' ? 'desc' : 'asc', p_now: pinnedNow() }),
    { get: true },
  );
  if (error) throw new QueryError(`rank_countries: ${error.message}`);
  return (data ?? []).map((r) => ({
    country: r.country,
    rule: r.value_text ?? null,
    rankValue: r.rank_value ?? null,
    confidence: asConfidence(r.confidence),
    sourceUrl: r.source_url ?? null,
    evidenceSnippet: r.evidence_snippet ?? null,
    fetchedAt: r.fetched_at ?? null,
    rank: r.rank ?? null,
    dataMissing: r.data_missing,
    missingReason: r.missing_reason ?? null,
  }));
}

/** One source of one program fact, with its computed confidence (public.program_facts_computed). */
export interface ProgramFactRow {
  key: string;
  /** 0 = the primary source; 1, 2, ... = other sources of the same fact. */
  sourceIndex: number;
  value: Json | null;
  valueText: string | null;
  sourceUrl: string | null;
  evidenceSnippet: string | null;
  fetchedAt: string | null;
  basis: string | null;
  note: string | null;
  /** Confidence of this source alone. */
  sourceConfidence: Confidence;
  /** Confidence of the whole fact (Conflict when sourced values disagree). */
  confidence: Confidence;
  inConflict: boolean;
}

export interface ProgramWithFacts {
  /** The program in the app's own type, for the existing components and the fit engine. */
  program: Program;
  institution: Institution | null;
  /** Every fact source as a row, ordered by key then source. */
  facts: ProgramFactRow[];
}

type ProgramWithInstitutionRow = ProgramRow & { institutions: InstitutionRow | null };

/** A program, its institution and every fact with its evidence. Two queries in parallel; null if no such program. */
export async function getProgramWithFacts(id: string): Promise<ProgramWithFacts | null> {
  const client = getPublicClient();
  const [programRes, factsRes] = await Promise.all([
    client
      .from('programs')
      .select(`${PROGRAM_COLUMNS.join(',')},institutions(${INSTITUTION_COLUMNS.join(',')})`)
      .eq('id', id)
      .maybeSingle(),
    client
      .from('program_facts_computed')
      .select('key,source_index,value,value_text,source_url,evidence_snippet,fetched_at,basis,note,source_confidence,confidence,in_conflict')
      .eq('program_id', id)
      .order('key', { ascending: true })
      .order('source_index', { ascending: true }),
  ]);
  if (programRes.error) throw new QueryError(`programs: ${programRes.error.message}`);
  if (factsRes.error) throw new QueryError(`program_facts_computed: ${factsRes.error.message}`);
  const row = programRes.data as unknown as ProgramWithInstitutionRow | null;
  if (!row) return null;

  const issues: MapIssue[] = [];
  const program = rowToProgram(row, issues);
  const institution = row.institutions ? rowToInstitution(row.institutions, issues) : null;
  if (issues.length > 0) console.warn('[queries] program data issues:', issues);

  const facts = (factsRes.data ?? []).map(
    (f): ProgramFactRow => ({
      key: f.key ?? '',
      sourceIndex: f.source_index ?? 0,
      value: f.value,
      valueText: f.value_text,
      sourceUrl: f.source_url,
      evidenceSnippet: f.evidence_snippet,
      fetchedAt: f.fetched_at,
      basis: f.basis,
      note: f.note,
      sourceConfidence: asConfidence(f.source_confidence),
      confidence: asConfidence(f.confidence),
      inConflict: f.in_conflict ?? false,
    }),
  );
  return stripInternal({ program, institution, facts });
}

export interface FactConflict {
  key: string;
  distinctValues: number;
  /** Every sourced value, primary first, with the link it came from (same order). */
  values: string[];
  sources: (string | null)[];
}

/** The facts of a program whose sources disagree (public.program_fact_conflicts). Show every value with its link. */
export async function getConflicts(programId: string): Promise<FactConflict[]> {
  const { data, error } = await getPublicClient()
    .from('program_fact_conflicts')
    .select('key,distinct_values,value_texts,sources')
    .eq('program_id', programId)
    .order('key', { ascending: true });
  if (error) throw new QueryError(`program_fact_conflicts: ${error.message}`);
  return (data ?? []).map((c) => ({
    key: c.key ?? '',
    distinctValues: c.distinct_values ?? 0,
    values: (c.value_texts ?? []).map((v) => v ?? ''),
    sources: c.sources ?? [],
  }));
}

/* ------------------------------------------------------------------ */
/* 2. The signed-in student's own data (RLS applies)                   */
/* ------------------------------------------------------------------ */

export interface UserSession {
  supabase: TypedSupabaseClient;
  userId: string;
}

export type MutationResult = { ok: true } | { ok: false; error: string };

const SIGNED_OUT = 'You are signed out. Please sign in again.';

/** The verified session (Supabase Auth getUser, never a cookie we trust blindly), or null when signed out. */
export async function getUserSession(): Promise<UserSession | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, userId: data.user.id };
}

async function sessionOr(session?: UserSession | null): Promise<UserSession | null> {
  return session ?? (await getUserSession());
}

/** jsonb columns take plain JSON: one JSON round trip gives the typed Json value (and drops undefined keys). */
function toJson(v: unknown): Json {
  return JSON.parse(JSON.stringify(v ?? null)) as Json;
}

function strengthsInsert(row: StrengthsRow): Database['public']['Tables']['profile_strengths']['Insert'] {
  return {
    user_id: row.user_id,
    publications: toJson(row.publications),
    research: toJson(row.research),
    collaborators: toJson(row.collaborators),
    code_data_links: toJson(row.code_data_links),
    other: toJson(row.other),
    free_text: row.free_text,
  };
}

/** Saves the student's profile into their own row. The profile is validated first; nothing else is stored. */
export async function upsertProfile(profile: unknown, session?: UserSession | null): Promise<MutationResult> {
  const s = await sessionOr(session);
  if (!s) return { ok: false, error: SIGNED_OUT };
  const row = profileToRow(profile, s.userId);
  if (!row) return { ok: false, error: 'There is no complete profile to save yet. Fill in your profile first.' };
  const { error } = await s.supabase.from('profiles').upsert(row, { onConflict: 'user_id' });
  if (error) {
    console.error('[queries] profile save failed:', error.message);
    return { ok: false, error: 'We could not save your profile. Please try again.' };
  }
  return { ok: true };
}

/** The student's own saved profile and strengths (null when nothing is saved). */
export async function getOwnProfile(
  session?: UserSession | null,
): Promise<{ ok: true; profile: Profile | null; strengths: Strengths | null } | { ok: false; error: string }> {
  const s = await sessionOr(session);
  if (!s) return { ok: false, error: SIGNED_OUT };
  const [p, st] = await Promise.all([
    s.supabase.from('profiles').select(PROFILE_ROW_COLUMNS).eq('user_id', s.userId).maybeSingle(),
    s.supabase.from('profile_strengths').select(STRENGTHS_ROW_COLUMNS).eq('user_id', s.userId).maybeSingle(),
  ]);
  if (p.error || st.error) return { ok: false, error: 'We could not load your saved profile. Please try again.' };
  return { ok: true, profile: rowToProfile(p.data), strengths: rowToStrengths(st.data) };
}

async function readStrengths(s: UserSession): Promise<{ ok: true; strengths: Strengths } | { ok: false; error: string }> {
  const { data, error } = await s.supabase
    .from('profile_strengths')
    .select(STRENGTHS_ROW_COLUMNS)
    .eq('user_id', s.userId)
    .maybeSingle();
  if (error) return { ok: false, error: 'We could not load your strengths. Please try again.' };
  return { ok: true, strengths: rowToStrengths(data) ?? { publications: [], research: [] } };
}

async function writeStrengths(s: UserSession, strengths: Strengths): Promise<MutationResult> {
  if (strengthsAreEmpty(strengths)) {
    // Nothing worth keeping: the account copy should not hold an empty row.
    const { error } = await s.supabase.from('profile_strengths').delete().eq('user_id', s.userId);
    return error ? { ok: false, error: 'We could not update your strengths. Please try again.' } : { ok: true };
  }
  const row = strengthsToRow(strengths, s.userId);
  if (!row) return { ok: false, error: 'Some strengths are not valid (too long, or too many). Please check them.' };
  const { error } = await s.supabase.from('profile_strengths').upsert(strengthsInsert(row), { onConflict: 'user_id' });
  if (error) {
    console.error('[queries] strengths save failed:', error.message);
    return { ok: false, error: 'We could not save your strengths. Please try again.' };
  }
  return { ok: true };
}

/** Replaces all of the student's saved strengths (e.g. copying this device's list to the account). */
export async function replaceStrengths(strengths: unknown, session?: UserSession | null): Promise<MutationResult> {
  const s = await sessionOr(session);
  if (!s) return { ok: false, error: SIGNED_OUT };
  const parsed = strengths == null ? { publications: [], research: [] } : parseStrengths(strengths);
  if (!parsed) return { ok: false, error: 'Some strengths are not valid (too long, or too many). Please check them.' };
  return writeStrengths(s, parsed);
}

/** The lists a strength can be added to. */
export const STRENGTH_KINDS = ['publications', 'research', 'collaborators', 'code_data_links', 'other'] as const;
export type StrengthKind = (typeof STRENGTH_KINDS)[number];

/** Adds one item (a publication, a research role, a collaborator, a link, or another strength) to the student's own list. */
export async function addStrength(kind: StrengthKind, item: unknown, session?: UserSession | null): Promise<MutationResult> {
  if (!STRENGTH_KINDS.includes(kind)) return { ok: false, error: 'Unknown kind of strength.' };
  const s = await sessionOr(session);
  if (!s) return { ok: false, error: SIGNED_OUT };
  const current = await readStrengths(s);
  if (!current.ok) return current;
  const list = [...((current.strengths[kind] as unknown[] | undefined) ?? []), item];
  // Validated as a whole (field lengths, at most 30 per list) before anything is written.
  const next = parseStrengths({ ...current.strengths, [kind]: list });
  if (!next) return { ok: false, error: 'That strength is not valid (too long, missing a title, or the list is full).' };
  return writeStrengths(s, next);
}

/** Removes the item at `index` from one of the student's own strength lists. */
export async function deleteStrength(kind: StrengthKind, index: number, session?: UserSession | null): Promise<MutationResult> {
  if (!STRENGTH_KINDS.includes(kind)) return { ok: false, error: 'Unknown kind of strength.' };
  const s = await sessionOr(session);
  if (!s) return { ok: false, error: SIGNED_OUT };
  const current = await readStrengths(s);
  if (!current.ok) return current;
  const list = [...((current.strengths[kind] as unknown[] | undefined) ?? [])];
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return { ok: false, error: 'That strength no longer exists.' };
  list.splice(index, 1);
  const next = parseStrengths({ ...current.strengths, [kind]: list });
  if (!next) return { ok: false, error: 'We could not update your strengths. Please try again.' };
  return writeStrengths(s, next);
}

/* ------------------------------------------------------------------ */
/* 3. Data reports (service role, after validation)                    */
/* ------------------------------------------------------------------ */

export interface ValidatedReport {
  program_id: string;
  field: string;
  message: string;
}

export type CreateReportResult = { stored: true } | { stored: false; reason: 'not_configured' | 'failed' };

/**
 * Stores a data report. Call ONLY with a report that /api/report has already validated (known program id and fact
 * field, 10-1000 characters, control characters stripped, same origin, rate limited). Uses the service role
 * because public.reports accepts no writes from the anon or authenticated roles. Never logs the message.
 */
export async function createReport(report: ValidatedReport): Promise<CreateReportResult> {
  const url = supabaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return { stored: false, reason: 'not_configured' };
  try {
    const { error } = await createSupabaseAdminClient()
      .from('reports')
      .insert({ program_id: report.program_id, field: report.field, message: report.message, status: 'open' });
    if (error) throw new Error(error.message);
    return { stored: true };
  } catch (err) {
    console.error('[queries] report insert failed:', err instanceof Error ? err.message : 'unknown error');
    return { stored: false, reason: 'failed' };
  }
}
