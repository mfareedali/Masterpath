/**
 * Mapping between the student's Profile / Strengths (src/lib/types.ts) and the `profiles` /
 * `profile_strengths` rows. Pure; validated with zod on the way in AND out.
 *
 * Privacy: only the fields below are ever stored. No passport or ID numbers, no demo persona marker.
 */
import { z } from '@/lib/zod';
import { parseProfile } from '../profile';
import type { Profile, Strengths } from '../types';

export interface ProfileRow {
  user_id: string;
  cgpa: number;
  scale: Profile['scale'];
  min_pass: number | null;
  university_id: string | null;
  university_name: string | null;
  degree: string | null;
  field: string;
  budget_pkr: number | null;
  target_countries: string[];
  updated_at?: string;
}

export interface StrengthsRow {
  user_id: string;
  publications: Strengths['publications'];
  research: Strengths['research'];
  collaborators: string[];
  code_data_links: string[];
  other: string[];
  free_text: string | null;
  updated_at?: string;
}

export const PROFILE_ROW_COLUMNS =
  'user_id, cgpa, scale, min_pass, university_id, university_name, degree, field, budget_pkr, target_countries, updated_at';
export const STRENGTHS_ROW_COLUMNS =
  'user_id, publications, research, collaborators, code_data_links, other, free_text, updated_at';

const uuid = z.uuid();

/** Profile -> row. Returns null if the profile is invalid. The demo persona marker is not stored. */
export function profileToRow(profile: unknown, userId: string): ProfileRow | null {
  const p = parseProfile(profile);
  if (!p || !uuid.safeParse(userId).success) return null;
  return {
    user_id: userId,
    cgpa: p.cgpa,
    scale: p.scale,
    min_pass: p.min_pass ?? null,
    university_id: p.university_id ?? null,
    university_name: p.university_name ?? null,
    degree: p.degree ?? null,
    field: p.field,
    budget_pkr: p.budget_pkr ?? null,
    target_countries: [...p.target_countries],
  };
}

/** Postgres `numeric` can arrive as a string from some clients; accept both. */
function num(v: unknown): unknown {
  return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;
}

/** Row -> Profile (validated). Returns null if the row is not a valid profile. */
export function rowToProfile(row: unknown): Profile | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  return parseProfile({
    cgpa: num(r.cgpa),
    scale: r.scale,
    min_pass: num(r.min_pass) ?? null,
    university_id: r.university_id ?? null,
    university_name: r.university_name ?? null,
    degree: r.degree ?? null,
    field: r.field,
    budget_pkr: num(r.budget_pkr) ?? null,
    target_countries: Array.isArray(r.target_countries) ? r.target_countries : [],
  });
}

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullish();
const list = (max: number) => z.array(text(500)).max(max);

export const publicationSchema = z.object({
  title: text(300).min(1),
  venue: optText(200),
  year: z.number().int().min(1950).max(2100).nullish(),
  status: z.enum(['published', 'accepted', 'preprint', 'under_review']),
  author_position: z.enum(['first', 'co-first', 'middle', 'last']).nullish(),
  link: optText(500),
});

export const researchSchema = z.object({
  lab: optText(200),
  supervisor: optText(200),
  institution: optText(200),
  link: optText(500),
  role: optText(200),
  dates: optText(100),
  note: optText(1000),
});

export const strengthsSchema = z.object({
  publications: z.array(publicationSchema).max(30).default([]),
  research: z.array(researchSchema).max(30).default([]),
  collaborators: list(30).optional(),
  code_data_links: list(30).optional(),
  other: list(30).optional(),
  free_text: optText(4000),
});

export function parseStrengths(input: unknown): Strengths | null {
  const r = strengthsSchema.safeParse(input);
  return r.success ? (r.data as Strengths) : null;
}

export function strengthsToRow(strengths: unknown, userId: string): StrengthsRow | null {
  const s = parseStrengths(strengths);
  if (!s || !uuid.safeParse(userId).success) return null;
  return {
    user_id: userId,
    publications: s.publications,
    research: s.research,
    collaborators: s.collaborators ?? [],
    code_data_links: s.code_data_links ?? [],
    other: s.other ?? [],
    free_text: s.free_text ?? null,
  };
}

export function rowToStrengths(row: unknown): Strengths | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  return parseStrengths({
    publications: r.publications ?? [],
    research: r.research ?? [],
    collaborators: r.collaborators ?? [],
    code_data_links: r.code_data_links ?? [],
    other: r.other ?? [],
    free_text: r.free_text ?? null,
  });
}

/** True when the strengths object has nothing worth saving. */
export function strengthsAreEmpty(s: Strengths | null | undefined): boolean {
  if (!s) return true;
  return (
    s.publications.length === 0 &&
    s.research.length === 0 &&
    (s.collaborators?.length ?? 0) === 0 &&
    (s.code_data_links?.length ?? 0) === 0 &&
    (s.other?.length ?? 0) === 0 &&
    !s.free_text?.trim()
  );
}
