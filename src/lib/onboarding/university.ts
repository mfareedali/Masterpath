/**
 * Home-university lookup for the University context card and the onboarding datalist.
 * Pure functions over dataset rows (pass institutions in; never import '@/lib/data' here).
 */
import type { Institution, RecognitionStatus } from '../types';
import { normaliseName, type UniversityOption } from './profile-form';

/** Official domain roots only (no invented deep links). */
export const HEC_URL = 'https://www.hec.gov.pk';
export const ANABIN_URL = 'https://anabin.kmk.org';

export const RECOGNITION_LABEL: Record<RecognitionStatus, string> = {
  listed: 'Listed',
  not_listed: 'Not listed',
};

export function recognitionLabel(v: RecognitionStatus | string): string {
  return RECOGNITION_LABEL[v as RecognitionStatus] ?? String(v);
}

/** Pakistani (home) universities, sorted by name, for the onboarding datalist. */
export function homeUniversityOptions(institutions: readonly Institution[]): UniversityOption[] {
  return institutions
    .filter((i) => i.kind === 'home')
    .map((i) => ({ id: i.id, name: i.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/**
 * Find the student's home university: by id first, then by a case/spacing/accent-insensitive name match.
 * Only 'home' institutions are considered.
 */
export function findHomeInstitution(
  institutions: readonly Institution[],
  query: { universityId?: string | null; universityName?: string | null },
): Institution | null {
  const homes = institutions.filter((i) => i.kind === 'home');
  const id = query.universityId?.trim();
  if (id) {
    const byId = homes.find((i) => i.id === id);
    if (byId) return byId;
  }
  const key = normaliseName(query.universityName);
  if (!key) return null;
  return homes.find((i) => normaliseName(i.name) === key) ?? null;
}
