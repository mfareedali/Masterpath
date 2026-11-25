/**
 * Onboarding + Home quick-start form logic. Pure functions, safe on server and client (no DOM, no clock).
 *
 * Form inputs arrive as strings; these helpers turn them into a validated Profile (via profileSchema)
 * or into friendly, per-field error messages. No passport or ID fields — ever.
 */
import { SCALE_MAX } from '../fit';
import { formatPkr } from '../format';
import { parseAmount, parseDecimal } from '../parse';
import { FIELDS, SUPPORTED_COUNTRIES, profileSchema } from '../profile';
import type { CountryCode, Profile, Strengths, StudentScale } from '../types';
import { isDemoStrengths } from './strengths-form';

export const SCALE_OPTIONS: { value: StudentScale; label: string }[] = [
  { value: 'cgpa_4', label: 'Out of 4.0' },
  { value: 'cgpa_5', label: 'Out of 5.0' },
  { value: 'percent', label: 'Percentage' },
];

/** The number parsers live in ../parse (shared with profile.ts without an import cycle); re-exported for callers. */
export { parseAmount, parseDecimal };

export const DEFAULT_SCALE: StudentScale = 'cgpa_4';
export const DEFAULT_FIELD = 'cs';

/** Upper bound for the budget input (mirrors profileSchema). */
export const MAX_BUDGET_PKR = 1_000_000_000;
export const MAX_UNIVERSITY_NAME = 120;
export const MAX_DEGREE = 80;

export type OnboardingField =
  | 'cgpa'
  | 'scale'
  | 'min_pass'
  | 'university_name'
  | 'degree'
  | 'field'
  | 'budget_pkr'
  | 'target_countries';

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

/** Raw onboarding form values (what the inputs hold). */
export interface OnboardingValues {
  cgpa: string;
  scale: string;
  min_pass: string;
  university_name: string;
  degree: string;
  field: string;
  budget_pkr: string;
  target_countries: string[];
}

export interface UniversityOption {
  id: string;
  name: string;
}

export type FormResult<K extends string> = { ok: true; profile: Profile } | { ok: false; errors: FieldErrors<K> };

export function isStudentScale(s: string): s is StudentScale {
  return SCALE_OPTIONS.some((o) => o.value === s);
}

export function isKnownField(slug: string): boolean {
  return FIELDS.some((f) => f.slug === slug);
}

export function scaleMax(scale: string): number {
  return isStudentScale(scale) ? SCALE_MAX[scale] : SCALE_MAX[DEFAULT_SCALE];
}

/** Live helper under the budget input, e.g. "= PKR 6,000,000 (60 lakh)". Null when there is nothing to show. */
export function budgetHelperText(raw: string | null | undefined): string | null {
  const n = parseAmount(raw);
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return `= ${formatPkr(n)}`;
}

/** Keep only supported countries, without duplicates, in the SUPPORTED_COUNTRIES order. */
export function normaliseCountries(list: readonly string[] | null | undefined): CountryCode[] {
  const set = new Set((list ?? []).map((c) => String(c).trim().toUpperCase()));
  return SUPPORTED_COUNTRIES.filter((c) => set.has(c));
}

/** Toggle one country chip on or off. Unsupported codes are ignored. */
export function toggleCountry(list: readonly string[], code: string): CountryCode[] {
  const current = normaliseCountries(list);
  const c = code.trim().toUpperCase();
  if (!(SUPPORTED_COUNTRIES as readonly string[]).includes(c)) return current;
  return current.includes(c) ? current.filter((x) => x !== c) : normaliseCountries([...current, c]);
}

/** Case-, accent- and whitespace-insensitive key for matching university names. */
export function normaliseName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** The id of the university whose name exactly matches what the student typed (ignoring case/spacing). */
export function resolveUniversityId(name: string | null | undefined, options: readonly UniversityOption[]): string | null {
  const key = normaliseName(name);
  if (!key) return null;
  return options.find((o) => normaliseName(o.name) === key)?.id ?? null;
}

function collapse(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Grade checks shared by the Home quick-start and the full onboarding form. */
function checkGrade(cgpaRaw: string, scaleRaw: string, errors: FieldErrors<OnboardingField>) {
  let scale: StudentScale | null = null;
  if (isStudentScale(scaleRaw)) scale = scaleRaw;
  else errors.scale = 'Choose how your grade is shown.';

  const max = scaleMax(scaleRaw);
  const cgpa = parseDecimal(cgpaRaw);
  let validCgpa: number | null = null;
  if (cgpa == null) {
    errors.cgpa = scaleRaw === 'percent' ? 'Enter your percentage.' : 'Enter your CGPA.';
  } else if (!Number.isFinite(cgpa)) {
    errors.cgpa = 'Use digits only, for example 2.75.';
  } else if (cgpa < 0 || cgpa > max) {
    errors.cgpa = `Enter a number from 0 to ${max}.`;
  } else {
    validCgpa = cgpa;
  }
  return { scale, cgpa: validCgpa, max };
}

function checkField(fieldRaw: string, errors: FieldErrors<OnboardingField>): string | null {
  const field = fieldRaw.trim();
  if (!isKnownField(field)) {
    errors.field = 'Choose a field.';
    return null;
  }
  return field;
}

/** Final gate: everything we save must pass the shared profileSchema. */
function finalise<K extends string>(candidate: Profile): FormResult<K> {
  const r = profileSchema.safeParse(candidate);
  if (r.success) return { ok: true, profile: r.data as Profile };
  const errors: FieldErrors<K> = {};
  for (const issue of r.error.issues) {
    const key = String(issue.path[0] ?? 'cgpa') as K;
    if (!errors[key]) errors[key] = 'Please check this value.';
  }
  return { ok: false, errors };
}

/** Validate the full onboarding form and build the Profile to save. Clears any demo persona marker. */
export function validateOnboarding(
  values: OnboardingValues,
  universities: readonly UniversityOption[] = [],
): FormResult<OnboardingField> {
  const errors: FieldErrors<OnboardingField> = {};
  const { scale, cgpa, max } = checkGrade(values.cgpa, values.scale, errors);

  let minPass: number | null = null;
  const mp = parseDecimal(values.min_pass);
  if (mp != null) {
    if (!Number.isFinite(mp) || mp < 0) {
      errors.min_pass = 'Use digits only, or leave this blank.';
    } else if (mp >= max) {
      errors.min_pass = `It must be lower than ${max}. Leave blank if unsure.`;
    } else if (cgpa != null && mp > cgpa) {
      errors.min_pass = 'This is higher than your CGPA. Check it, or leave it blank.';
    } else {
      minPass = mp;
    }
  }

  const universityName = collapse(values.university_name);
  if (universityName.length > MAX_UNIVERSITY_NAME) {
    errors.university_name = `Please shorten this to ${MAX_UNIVERSITY_NAME} characters.`;
  }
  const degree = collapse(values.degree);
  if (degree.length > MAX_DEGREE) errors.degree = `Please shorten this to ${MAX_DEGREE} characters.`;

  const field = checkField(values.field, errors);

  let budget: number | null = null;
  const b = parseAmount(values.budget_pkr);
  if (b != null) {
    if (!Number.isFinite(b) || b < 0) {
      errors.budget_pkr = 'Enter the amount in rupees using digits, or leave it blank.';
    } else if (b > MAX_BUDGET_PKR) {
      errors.budget_pkr = 'That is more than PKR 100 crore. Please check the zeros.';
    } else {
      budget = b;
    }
  }

  if (Object.keys(errors).length > 0 || scale == null || cgpa == null || field == null) {
    return { ok: false, errors };
  }

  return finalise<OnboardingField>({
    cgpa,
    scale,
    min_pass: minPass,
    university_name: universityName || null,
    university_id: resolveUniversityId(universityName, universities),
    degree: degree || null,
    field,
    budget_pkr: budget,
    target_countries: normaliseCountries(values.target_countries),
    persona: null,
  });
}

export type QuickStartField = 'cgpa' | 'scale' | 'field';

export interface QuickStartValues {
  cgpa: string;
  scale: string;
  field: string;
}

/**
 * Home quick-start: validate CGPA + scale + field and merge them into any profile already on this device
 * (keeping target countries, budget, university...). A demo persona is NOT merged: real input starts a
 * clean profile, so fictional demo values never mix with the student's own.
 * `resetDemoStrengths` is true when the fictional persona B strengths are on this device and should be cleared.
 */
export function validateQuickStart(
  values: QuickStartValues,
  existing: Profile | null,
  currentStrengths: Strengths | null = null,
): FormResult<QuickStartField> & { resetDemoStrengths: boolean } {
  const errors: FieldErrors<OnboardingField> = {};
  const { scale, cgpa } = checkGrade(values.cgpa, values.scale, errors);
  const field = checkField(values.field, errors);
  const resetDemoStrengths = existing?.persona === 'B' || isDemoStrengths(currentStrengths);

  if (Object.keys(errors).length > 0 || scale == null || cgpa == null || field == null) {
    return { ok: false, errors: errors as FieldErrors<QuickStartField>, resetDemoStrengths };
  }

  const own = existing && !existing.persona ? existing : null;
  const base: Profile = own ? { ...own } : { cgpa, scale, field, target_countries: [], persona: null };
  // A transcript minimum only makes sense on the same scale and at or below the grade.
  const minPass = own && own.scale === scale && own.min_pass != null && own.min_pass <= cgpa ? own.min_pass : null;

  const result = finalise<QuickStartField>({
    ...base,
    cgpa,
    scale,
    field,
    min_pass: minPass,
    persona: null,
  });
  return { ...result, resetDemoStrengths };
}

/**
 * Shareable /shortlist link for a profile, in the query format profileFromSearchParams reads
 * (cgpa, scale, field, min_pass, budget, countries). University and degree are never put in the URL.
 * Used when cookies/storage are blocked and as the no-JavaScript fallback for the demo buttons.
 */
export function shortlistHref(p: Pick<Profile, 'cgpa' | 'scale' | 'field'> & Partial<Profile>): string {
  const qs = new URLSearchParams({ cgpa: String(p.cgpa), scale: p.scale, field: p.field });
  if (p.min_pass != null && Number.isFinite(p.min_pass)) qs.set('min_pass', String(p.min_pass));
  if (p.budget_pkr != null && Number.isFinite(p.budget_pkr)) qs.set('budget', String(Math.round(p.budget_pkr)));
  const countries = normaliseCountries(p.target_countries);
  if (countries.length) qs.set('countries', countries.join(','));
  return `/shortlist?${qs.toString()}`;
}

export function emptyOnboardingValues(): OnboardingValues {
  return {
    cgpa: '',
    scale: DEFAULT_SCALE,
    min_pass: '',
    university_name: '',
    degree: '',
    field: DEFAULT_FIELD,
    budget_pkr: '',
    target_countries: [],
  };
}

/** Prefill the onboarding form from a saved profile. */
export function profileToValues(p: Profile | null | undefined): OnboardingValues {
  if (!p) return emptyOnboardingValues();
  return {
    cgpa: Number.isFinite(p.cgpa) ? String(p.cgpa) : '',
    scale: isStudentScale(p.scale) ? p.scale : DEFAULT_SCALE,
    min_pass: p.min_pass != null && Number.isFinite(p.min_pass) ? String(p.min_pass) : '',
    university_name: p.university_name ?? '',
    degree: p.degree ?? '',
    field: isKnownField(p.field) ? p.field : 'other',
    budget_pkr: p.budget_pkr != null && Number.isFinite(p.budget_pkr) ? String(Math.round(p.budget_pkr)) : '',
    target_countries: normaliseCountries(p.target_countries),
  };
}
