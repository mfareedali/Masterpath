/**
 * Saved programs: a JSON array of program ids in localStorage key 'mp_saved' (this device only, no account).
 * Pure helpers here; the browser read/write lives in src/components/shortlist/save-button.tsx.
 */

export const SAVED_STORAGE_KEY = 'mp_saved';
/** Same-tab change notification (the 'storage' event only fires in other tabs). */
export const SAVED_CHANGE_EVENT = 'mp-saved-change';

const MAX_SAVED = 200;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

/** Parses the stored value. Anything malformed becomes an empty list; invalid ids are dropped. */
export function parseSavedIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const v of data) {
    if (typeof v === 'string' && ID_RE.test(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_SAVED) break;
  }
  return out;
}

/** Adds the id if absent, removes it if present. Newest saves go first. */
export function toggleSavedId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [id, ...ids].slice(0, MAX_SAVED);
}

export interface SavedProgramSummary {
  id: string;
  name: string;
  institutionName: string;
  country: string;
  status: 'active' | 'ruled_out';
}

/** Saved ids resolved against the current program list, in saved order; unknown ids are counted. */
export function resolveSaved(
  ids: readonly string[],
  programs: readonly SavedProgramSummary[],
): { saved: SavedProgramSummary[]; missing: number } {
  const byId = new Map(programs.map((p) => [p.id, p]));
  const saved: SavedProgramSummary[] = [];
  let missing = 0;
  for (const id of ids) {
    const p = byId.get(id);
    if (p) saved.push(p);
    else missing++;
  }
  return { saved, missing };
}
