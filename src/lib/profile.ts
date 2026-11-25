/**
 * Student profile: schema, cookie (de)serialisation and demo personas.
 * Safe on server and client (no Node or DOM APIs here; see ./profile-client.ts for the browser side).
 *
 * Privacy: CGPA, scale, field, budget, target countries only. NEVER passport or ID numbers.
 */
import { z } from '@/lib/zod';
import { parseAmount, parseDecimal } from './parse';
import type { Profile, Strengths } from './types';

export const PROFILE_COOKIE = 'mp_profile';
export const PROFILE_STORAGE_KEY = 'mp_profile';
export const STRENGTHS_STORAGE_KEY = 'mp_strengths';
export const PROFILE_COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

export const SUPPORTED_COUNTRIES = ['DE', 'CH', 'UK', 'CA', 'US'] as const;

export const FIELDS = [
  { slug: 'cs', label: 'Computer Science' },
  { slug: 'ds', label: 'Data Science / AI' },
  { slug: 'se', label: 'Software Engineering' },
  { slug: 'ee', label: 'Electrical Engineering' },
  { slug: 'other', label: 'Other' },
] as const;

const SCALE_MAX_FOR = { cgpa_4: 4, cgpa_5: 5, percent: 100 } as const;

/** A blank or missing value is "not given": never 0. */
function blankToUndefined(v: unknown): unknown {
  if (v == null) return undefined;
  if (typeof v === 'string' && v.trim() === '') return undefined;
  return v;
}

/** Grades may arrive as strings from links and forms: "2.5", "2,5". Junk stays NaN, so it fails the schema. */
function gradeInput(v: unknown): unknown {
  const b = blankToUndefined(v);
  return typeof b === 'string' ? (parseDecimal(b) ?? undefined) : b;
}

/**
 * Optional transcript minimum: a blank, junk or non-finite value becomes null (it is optional, so it is dropped rather
 * than rejecting the whole profile). An absent key stays absent.
 */
function minPassInput(v: unknown): unknown {
  if (v === undefined) return undefined;
  const b = blankToUndefined(v);
  if (b === undefined) return null;
  const n = typeof b === 'string' ? parseDecimal(b) : b;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Rupee amounts may arrive as "6,000,000", "60,00,000" or "PKR 6,000,000". Junk stays NaN and fails the schema. */
function budgetInput(v: unknown): unknown {
  if (v === undefined) return undefined;
  const b = blankToUndefined(v);
  if (b === undefined) return null;
  return typeof b === 'string' ? parseAmount(b) : b;
}

/** Upper-case country codes; "GB" is the ISO code for the country we call "UK". Duplicates removed, order kept. */
export function normaliseCountryCodes(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const c = raw.trim().toUpperCase();
    const code = c === 'GB' ? 'UK' : c;
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * The transcript minimum pass grade is kept only when it can be true: 0 <= min_pass <= cgpa and min_pass below the
 * scale maximum (a student can pass exactly at the minimum). Otherwise it is dropped to null, never the whole profile.
 */
export function validMinPass(p: { cgpa: number; scale: keyof typeof SCALE_MAX_FOR; min_pass?: number | null }): number | null {
  const mp = p.min_pass;
  if (mp == null || !Number.isFinite(mp)) return null;
  return mp >= 0 && mp <= p.cgpa && mp < SCALE_MAX_FOR[p.scale] ? mp : null;
}

export const profileSchema = z
  .object({
    cgpa: z.preprocess(gradeInput, z.number().min(0).max(100)),
    scale: z.enum(['cgpa_4', 'cgpa_5', 'percent']),
    min_pass: z.preprocess(minPassInput, z.number().nullish()),
    university_name: z.string().trim().max(120).nullish(),
    university_id: z.string().trim().max(80).nullish(),
    degree: z.string().trim().max(80).nullish(),
    field: z.string().trim().toLowerCase().min(1).max(40).default('cs'),
    budget_pkr: z.preprocess(budgetInput, z.number().min(0).max(1_000_000_000).nullish()),
    target_countries: z.array(z.string().trim().min(2).max(3)).max(10).default([]).transform(normaliseCountryCodes),
    persona: z.enum(['A', 'B']).nullish(),
  })
  .refine((p) => p.cgpa <= SCALE_MAX_FOR[p.scale], {
    message: 'CGPA is above the maximum for this scale',
    path: ['cgpa'],
  })
  // A budget of 0 means "no budget set" everywhere (Shortlist, Plan B, the profile summary), decided once here.
  .transform((p) => {
    const out = { ...p };
    if (p.min_pass != null) out.min_pass = validMinPass(p);
    if (p.budget_pkr === 0) out.budget_pkr = null;
    return out;
  });

/** Parse anything (cookie JSON, form data object, query params) into a Profile, or null if invalid. */
export function parseProfile(input: unknown): Profile | null {
  const r = profileSchema.safeParse(input);
  return r.success ? (r.data as Profile) : null;
}

export function serializeProfile(p: Profile): string {
  return encodeURIComponent(JSON.stringify(p));
}

export function deserializeProfile(raw: string | null | undefined): Profile | null {
  if (!raw) return null;
  try {
    return parseProfile(JSON.parse(decodeURIComponent(raw)));
  } catch {
    return null;
  }
}

type SearchParamsRecord = Record<string, string | string[] | undefined>;

function firstParam(sp: SearchParamsRecord, k: string): string | undefined {
  const v = sp[k];
  return Array.isArray(v) ? v[0] : v;
}

/** True when the link carries a profile (both cgpa and scale are present, even if blank or invalid). */
export function hasProfileParams(sp: SearchParamsRecord): boolean {
  return firstParam(sp, 'cgpa') != null && firstParam(sp, 'scale') != null;
}

/**
 * Read a profile from URL search params (shareable links, e.g. /shortlist?cgpa=2.5&scale=cgpa_4&field=cs&countries=DE,UK).
 * Returns null when cgpa/scale are absent or the profile is invalid (a blank CGPA is invalid, never 0).
 * Normalises what people type or paste: "2,5" -> 2.5, "6,000,000" / "60,00,000" -> 6000000, "de,gb" -> DE, UK,
 * "CS" -> cs. An impossible transcript minimum is dropped to null; a budget of 0 means no budget.
 */
export function profileFromSearchParams(sp: SearchParamsRecord): Profile | null {
  if (!hasProfileParams(sp)) return null;
  const countries = firstParam(sp, 'countries');
  return parseProfile({
    cgpa: firstParam(sp, 'cgpa'),
    scale: firstParam(sp, 'scale')?.trim().toLowerCase(),
    min_pass: firstParam(sp, 'min_pass') ?? null,
    field: firstParam(sp, 'field')?.trim() || 'cs',
    budget_pkr: firstParam(sp, 'budget') ?? null,
    target_countries: countries ? countries.split(',').map((c) => c.trim()).filter(Boolean) : [],
  });
}

/**
 * Where the profile for a request comes from:
 *  - 'none': the link has no profile;
 *  - 'ok': the link has a valid profile;
 *  - 'rejected': the link has cgpa and scale but they could not be read. Pages that then fall back to the profile saved
 *    on this device should say so ("We could not read the profile in this link, so we show the profile saved on this
 *    device."), never swap profiles silently.
 */
export type ProfileLinkStatus = 'none' | 'ok' | 'rejected';

export function profileLinkStatus(sp: SearchParamsRecord): ProfileLinkStatus {
  if (!hasProfileParams(sp)) return 'none';
  return profileFromSearchParams(sp) ? 'ok' : 'rejected';
}

/** Demo persona A: CGPA 2.5/4, CS, mid-ranked private university, limited budget. */
export const PERSONA_A: Profile = {
  cgpa: 2.5,
  scale: 'cgpa_4',
  min_pass: null,
  university_name: 'Demo Private University (fictional, for the demo persona)',
  university_id: 'demo-private-university',
  degree: 'BS Computer Science',
  field: 'cs',
  budget_pkr: 6_000_000,
  target_countries: ['DE', 'UK', 'CA', 'US'],
  persona: 'A',
};

/** Demo persona B (P1): same as A plus one preprint and a supervisor link (research-led route). */
export const PERSONA_B: Profile = { ...PERSONA_A, persona: 'B' };

export const PERSONA_B_STRENGTHS: Strengths = {
  publications: [
    {
      title: 'Demo preprint: lightweight Urdu text classification (fictional)',
      venue: 'arXiv (demo, fictional)',
      year: 2026,
      status: 'preprint',
      author_position: 'first',
      link: null,
    },
  ],
  research: [
    {
      lab: 'Demo NLP Lab (fictional)',
      supervisor: 'Demo supervisor (fictional)',
      institution: 'Demo Private University (fictional)',
      link: null,
      role: 'Undergraduate research assistant',
      dates: '2025–2026',
      note: 'Fictional demo data.',
    },
  ],
  collaborators: [],
  code_data_links: [],
  other: [],
  free_text: null,
};
