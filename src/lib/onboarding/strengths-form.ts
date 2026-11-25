/**
 * Strengths (P1) form logic: publications, research experience, other strengths and free text.
 * Pure functions, safe on server and client.
 *
 * Strengths NEVER change the fit label (see src/lib/fit). They only feed research-led routes and SOP help.
 * Everything is plain text; links are kept only when they are http(s) (checked with safeHref).
 */
import { valuesEqual } from '../confidence';
import { safeHref } from '../format';
import { PERSONA_B_STRENGTHS } from '../profile';
import type { Publication, ResearchExperience, Strengths } from '../types';

export const STRENGTH_LIMITS = {
  rows: 10,
  title: 300,
  venue: 200,
  short: 120,
  institution: 160,
  dates: 60,
  link: 500,
  listItems: 20,
  listItem: 200,
  freeText: 2000,
  yearMin: 1950,
  yearMax: 2100,
} as const;

export const PUBLICATION_STATUSES: { value: Publication['status']; label: string }[] = [
  { value: 'published', label: 'Published' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'under_review', label: 'Under review' },
  { value: 'preprint', label: 'Preprint' },
];

export const AUTHOR_POSITIONS: { value: NonNullable<Publication['author_position']>; label: string }[] = [
  { value: 'first', label: 'First author' },
  { value: 'co-first', label: 'Co-first author' },
  { value: 'middle', label: 'Middle author' },
  { value: 'last', label: 'Last author' },
];

export interface PublicationRow {
  title: string;
  venue: string;
  year: string;
  status: string;
  author_position: string;
  link: string;
}

export interface ResearchRow {
  lab: string;
  supervisor: string;
  institution: string;
  link: string;
  role: string;
  dates: string;
  /** Not editable in the form; carried through so a saved note (e.g. "Fictional demo data.") survives a save. */
  note?: string;
}

export interface StrengthsValues {
  publications: PublicationRow[];
  research: ResearchRow[];
  /** One strength per line: jobs, awards, certifications, test scores, recommenders. */
  other: string;
  free_text: string;
}

export const EMPTY_STRENGTHS: Strengths = {
  publications: [],
  research: [],
  collaborators: [],
  code_data_links: [],
  other: [],
  free_text: null,
};

export function emptyPublicationRow(): PublicationRow {
  return { title: '', venue: '', year: '', status: '', author_position: '', link: '' };
}

export function emptyResearchRow(): ResearchRow {
  return { lab: '', supervisor: '', institution: '', link: '', role: '', dates: '' };
}

// Control characters except tab (\x09) and newline (\x0A).
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

/** Single-line text: strip control characters, collapse whitespace, trim, cap length. Empty -> null. */
export function cleanLine(v: unknown, max: number): string | null {
  const s = str(v).replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return s === '' ? null : s;
}

/** Multi-line text: keep line breaks, strip other control characters, trim, cap length. Empty -> null. */
export function cleanMultiline(v: unknown, max: number): string | null {
  const s = str(v)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
    .trim();
  return s === '' ? null : s;
}

const BARE_DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d+)?([/?#]|$)/i;

/**
 * Normalise a link typed by the student. Only http(s) links are kept; a bare domain such as
 * "arxiv.org/abs/1234" gets "https://" in front. Anything else (javascript:, data:, mailto:...) -> null.
 */
export function normaliseLink(v: unknown): string | null {
  const s = str(v).trim();
  if (s === '' || s.length > STRENGTH_LIMITS.link || /\s/.test(s)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  const candidate = hasScheme ? s : BARE_DOMAIN.test(s) ? `https://${s}` : null;
  if (!candidate) return null;
  const href = safeHref(candidate);
  if (!href) return null;
  try {
    const u = new URL(href);
    if (u.username || u.password) return null;
  } catch {
    return null;
  }
  return href.length <= STRENGTH_LIMITS.link ? href : null;
}

/** Parse a year field. Null when empty, NaN when invalid. */
export function parseYear(v: unknown): number | null {
  const s = str(v).trim();
  if (s === '') return null;
  if (!/^\d{4}$/.test(s)) return NaN;
  const n = Number(s);
  return n >= STRENGTH_LIMITS.yearMin && n <= STRENGTH_LIMITS.yearMax ? n : NaN;
}

/** Split a "one per line" textarea into clean, unique, non-empty items. */
export function splitLines(v: unknown, maxItems: number = STRENGTH_LIMITS.listItems): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of str(v).split(/\r?\n/)) {
    const item = cleanLine(line, STRENGTH_LIMITS.listItem);
    if (!item) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= maxItems) break;
  }
  return out;
}

function isStatus(s: string): s is Publication['status'] {
  return PUBLICATION_STATUSES.some((o) => o.value === s);
}

function isAuthorPosition(s: string): s is NonNullable<Publication['author_position']> {
  return AUTHOR_POSITIONS.some((o) => o.value === s);
}

function publicationRowIsBlank(r: PublicationRow): boolean {
  return [r.title, r.venue, r.year, r.link].every((x) => str(x).trim() === '');
}

function researchRowIsBlank(r: ResearchRow): boolean {
  return [r.lab, r.supervisor, r.institution, r.link, r.role, r.dates].every((x) => str(x).trim() === '');
}

const LINK_ERROR = 'Enter a full link, for example https://arxiv.org/abs/…';

/**
 * Inline errors for the strengths form, keyed by path, e.g. "publications.0.title".
 * Blank rows are fine (they are dropped on save).
 */
export function validateStrengths(values: StrengthsValues): Record<string, string> {
  const errors: Record<string, string> = {};
  values.publications.forEach((r, i) => {
    if (publicationRowIsBlank(r)) return;
    if (!cleanLine(r.title, STRENGTH_LIMITS.title)) errors[`publications.${i}.title`] = 'Add the title, or remove this row.';
    if (!isStatus(str(r.status))) errors[`publications.${i}.status`] = 'Choose a status.';
    const y = parseYear(r.year);
    if (y != null && !Number.isFinite(y)) {
      errors[`publications.${i}.year`] = `Enter a 4-digit year from ${STRENGTH_LIMITS.yearMin} to ${STRENGTH_LIMITS.yearMax}.`;
    }
    if (str(r.link).trim() !== '' && !normaliseLink(r.link)) errors[`publications.${i}.link`] = LINK_ERROR;
  });
  values.research.forEach((r, i) => {
    if (researchRowIsBlank(r)) return;
    if (str(r.link).trim() !== '' && !normaliseLink(r.link)) errors[`research.${i}.link`] = LINK_ERROR;
  });
  const otherCount = str(values.other)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '').length;
  if (otherCount > STRENGTH_LIMITS.listItems) {
    errors.other = `Please keep this to ${STRENGTH_LIMITS.listItems} lines.`;
  }
  return errors;
}

function sanitizePublication(r: Partial<PublicationRow> | Publication): Publication | null {
  const raw = r as Record<string, unknown>;
  const title = cleanLine(raw.title, STRENGTH_LIMITS.title);
  const status = str(raw.status);
  if (!title || !isStatus(status)) return null;
  const year = parseYear(raw.year);
  const pos = str(raw.author_position);
  return {
    title,
    venue: cleanLine(raw.venue, STRENGTH_LIMITS.venue),
    year: year != null && Number.isFinite(year) ? year : null,
    status,
    author_position: isAuthorPosition(pos) ? pos : null,
    link: normaliseLink(raw.link),
  };
}

function sanitizeResearch(r: Partial<ResearchRow> | ResearchExperience): ResearchExperience | null {
  const raw = r as Record<string, unknown>;
  const out: ResearchExperience = {
    lab: cleanLine(raw.lab, STRENGTH_LIMITS.institution),
    supervisor: cleanLine(raw.supervisor, STRENGTH_LIMITS.short),
    institution: cleanLine(raw.institution, STRENGTH_LIMITS.institution),
    link: normaliseLink(raw.link),
    role: cleanLine(raw.role, STRENGTH_LIMITS.short),
    dates: cleanLine(raw.dates, STRENGTH_LIMITS.dates),
  };
  // A row with only a hidden note (every visible field blank) is an empty row: drop it.
  if (!Object.values(out).some((v) => v != null)) return null;
  const note = cleanLine(raw.note, STRENGTH_LIMITS.listItem);
  if (note) out.note = note;
  return out;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function sanitizeLinkList(v: unknown): string[] {
  const out: string[] = [];
  for (const item of asArray(v)) {
    const href = normaliseLink(item);
    if (href && !out.includes(href)) out.push(href);
    if (out.length >= STRENGTH_LIMITS.listItems) break;
  }
  return out;
}

function sanitizeTextList(v: unknown): string[] {
  return splitLines(asArray(v).map(str).join('\n'));
}

/**
 * Turn the form values into Strengths: trims, caps lengths, drops empty rows, keeps only http(s) links.
 * `previous` supplies the lists this form does not edit (collaborators, code/data links), sanitised too.
 */
export function sanitizeStrengths(values: StrengthsValues, previous?: Strengths | null): Strengths {
  const prev = (previous ?? {}) as Partial<Record<keyof Strengths, unknown>>;
  return {
    publications: values.publications
      .map(sanitizePublication)
      .filter((p): p is Publication => p !== null)
      .slice(0, STRENGTH_LIMITS.rows),
    research: values.research
      .map(sanitizeResearch)
      .filter((r): r is ResearchExperience => r !== null)
      .slice(0, STRENGTH_LIMITS.rows),
    collaborators: sanitizeTextList(prev.collaborators),
    code_data_links: sanitizeLinkList(prev.code_data_links),
    other: splitLines(values.other),
    free_text: cleanMultiline(values.free_text, STRENGTH_LIMITS.freeText),
  };
}

/**
 * Sanitise strengths read back from browser storage (untrusted JSON). Returns null for anything unusable.
 */
export function sanitizeStoredStrengths(input: unknown): Strengths | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const s = input as Record<string, unknown>;
  return {
    publications: asArray(s.publications)
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => sanitizePublication(p as Partial<PublicationRow>))
      .filter((p): p is Publication => p !== null)
      .slice(0, STRENGTH_LIMITS.rows),
    research: asArray(s.research)
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => sanitizeResearch(r as Partial<ResearchRow>))
      .filter((r): r is ResearchExperience => r !== null)
      .slice(0, STRENGTH_LIMITS.rows),
    collaborators: sanitizeTextList(s.collaborators),
    code_data_links: sanitizeLinkList(s.code_data_links),
    other: sanitizeTextList(s.other),
    free_text: cleanMultiline(s.free_text, STRENGTH_LIMITS.freeText),
  };
}

/** Prefill the strengths form from saved strengths (always at least one empty row of each kind). */
export function strengthsToValues(s: Strengths | null | undefined): StrengthsValues {
  const clean = sanitizeStoredStrengths(s);
  const pubs: PublicationRow[] = (clean?.publications ?? []).map((p) => ({
    title: p.title,
    venue: p.venue ?? '',
    year: p.year != null ? String(p.year) : '',
    status: p.status,
    author_position: p.author_position ?? '',
    link: p.link ?? '',
  }));
  const research: ResearchRow[] = (clean?.research ?? []).map((r) => ({
    lab: r.lab ?? '',
    supervisor: r.supervisor ?? '',
    institution: r.institution ?? '',
    link: r.link ?? '',
    role: r.role ?? '',
    dates: r.dates ?? '',
    ...(r.note ? { note: r.note } : {}),
  }));
  return {
    publications: pubs.length ? pubs : [emptyPublicationRow()],
    research: research.length ? research : [emptyResearchRow()],
    other: (clean?.other ?? []).join('\n'),
    free_text: clean?.free_text ?? '',
  };
}

export function hasAnyStrengths(s: Strengths | null | undefined): boolean {
  if (!s) return false;
  return (
    (s.publications?.length ?? 0) > 0 ||
    (s.research?.length ?? 0) > 0 ||
    (s.collaborators?.length ?? 0) > 0 ||
    (s.code_data_links?.length ?? 0) > 0 ||
    (s.other?.length ?? 0) > 0 ||
    !!(s.free_text && s.free_text.trim())
  );
}

/** True when the stored strengths are exactly the fictional demo persona B strengths. */
export function isDemoStrengths(s: Strengths | null | undefined): boolean {
  return !!s && valuesEqual(s, PERSONA_B_STRENGTHS);
}

/** Add a row (up to the limit). */
export function addRow<T>(rows: readonly T[], row: T, max: number = STRENGTH_LIMITS.rows): T[] {
  return rows.length >= max ? [...rows] : [...rows, row];
}

/** Remove a row; keeps one empty row so the form never shows an empty group. */
export function removeRow<T>(rows: readonly T[], index: number, empty: () => T): T[] {
  const next = rows.filter((_, i) => i !== index);
  return next.length ? next : [empty()];
}

/** Update one field of one row immutably. */
export function updateRow<T extends object, K extends keyof T>(rows: readonly T[], index: number, key: K, value: T[K]): T[] {
  return rows.map((r, i) => (i === index ? { ...r, [key]: value } : r));
}
