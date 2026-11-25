/**
 * Requirements checklist for one program. Built from data rows only: when a requirement is not usable
 * (Verified/Likely) the item says "not verified yet" instead of inventing a number.
 * Pure functions; `now` is passed in. Checkbox state is stored by the client component in localStorage.
 */
import { computeConfidence, isUsable } from '@/lib/confidence';
import type { Confidence, Fact, Program } from '@/lib/types';
import { languageReqLines, lorCountText } from './render';

export interface ChecklistItem {
  id: 'sop' | 'lor' | 'cv' | 'language' | 'tests' | 'transcript';
  label: string;
  detail: string;
  confidence: Confidence;
}

export const CHECKLIST_KEY_PREFIX = 'mp_checklist_';

export function checklistStorageKey(programId: string): string {
  return `${CHECKLIST_KEY_PREFIX}${programId}`;
}

function describe<T>(
  fact: Fact<T> | null | undefined,
  now: Date,
  toText: (v: T) => string,
  missing: string,
  conflict: string,
): { detail: string; confidence: Confidence; value: T | null } {
  const confidence = computeConfidence(fact, now);
  if (confidence === 'Conflict') return { detail: conflict, confidence, value: null };
  if (fact && isUsable(confidence) && fact.value != null) return { detail: toText(fact.value), confidence, value: fact.value };
  return { detail: missing, confidence, value: null };
}

export function buildChecklist(p: Program, now: Date): ChecklistItem[] {
  const sop = describe(
    p.sop_requirements,
    now,
    (v) => v,
    'SOP requirements not verified yet',
    'Sources disagree about the SOP. See "Application documents".',
  );
  const lor = describe(
    p.lor_count,
    now,
    (v) => `Number from the source: ${lorCountText(v)}`,
    'Number of LORs not verified yet',
    'Sources disagree about the number of LORs. See "Application documents".',
  );
  const cv = describe(
    p.cv_requirements,
    now,
    (v) => v,
    'CV requirements not verified yet',
    'Sources disagree about the CV. See "Application documents".',
  );
  const language = describe(
    p.language_req,
    now,
    (v) => languageReqLines(v).join('; '),
    'English test requirement not verified yet',
    'Sources disagree about the English test. See "Entry requirements".',
  );
  const tests = describe(
    p.tests_required,
    now,
    (v) => v,
    'Other test requirements not verified yet',
    'Sources disagree about other tests. See "Entry requirements".',
  );

  return [
    { id: 'sop', label: 'Statement of purpose (SOP)', detail: sop.detail, confidence: sop.confidence },
    {
      id: 'lor',
      label: lor.value != null ? `Letters of recommendation: ${lorCountText(lor.value)}` : 'Letters of recommendation (LORs)',
      detail: lor.detail,
      confidence: lor.confidence,
    },
    { id: 'cv', label: 'CV', detail: cv.detail, confidence: cv.confidence },
    { id: 'language', label: 'English test result', detail: language.detail, confidence: language.confidence },
    { id: 'tests', label: 'Other tests (only if required)', detail: tests.detail, confidence: tests.confidence },
    {
      id: 'transcript',
      label: 'Transcript and degree documents',
      detail: 'How to send them, and whether attested copies are needed, is not verified yet. Check the official page.',
      // No data row backs this item yet, so it is always Unverified.
      confidence: 'Unverified',
    },
  ];
}

/** Reads the stored checked ids (JSON array), keeping only ids that exist in the checklist. Never throws. */
export function parseChecked(raw: string | null | undefined, validIds: readonly string[]): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid = new Set(validIds);
    return validIds.filter((id) => parsed.includes(id) && valid.has(id));
  } catch {
    return [];
  }
}

export function toggleChecked(checked: readonly string[], id: string): string[] {
  return checked.includes(id) ? checked.filter((x) => x !== id) : [...checked, id];
}

export function serializeChecked(checked: readonly string[]): string {
  return JSON.stringify([...new Set(checked)]);
}

/** "2 of 6 done" */
export function progressText(done: number, total: number): string {
  return `${done} of ${total} done`;
}
