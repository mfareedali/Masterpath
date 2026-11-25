'use client';

/**
 * "Save" toggle for a program. Stores ids in localStorage 'mp_saved' (this device only).
 * Tiny client leaf: everything around it stays a server component.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { buttonClass } from '@/components/ui/button';
import { SAVED_CHANGE_EVENT, SAVED_STORAGE_KEY, parseSavedIds, toggleSavedId } from '@/lib/shortlist/saved';

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SAVED_STORAGE_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(SAVED_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(SAVED_CHANGE_EVENT, onChange);
  };
}

function readRaw(): string {
  try {
    return localStorage.getItem(SAVED_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** null on the server / before hydration (unknown), then the saved ids. */
export function useSavedIds(): string[] | null {
  const raw = useSyncExternalStore<string | null>(subscribe, readRaw, () => null);
  return useMemo(() => (raw === null ? null : parseSavedIds(raw)), [raw]);
}

/** Toggles one id. Returns false when storage is unavailable (e.g. blocked in private mode). */
export function toggleSaved(id: string): boolean {
  try {
    const next = toggleSavedId(parseSavedIds(localStorage.getItem(SAVED_STORAGE_KEY)), id);
    localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(SAVED_CHANGE_EVENT));
  return true;
}

export function SaveButton({
  programId,
  programName,
  className = '',
}: {
  programId: string;
  programName: string;
  className?: string;
}) {
  const ids = useSavedIds();
  const saved = ids?.includes(programId) ?? false;
  const [failed, setFailed] = useState(false);

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        aria-pressed={saved}
        onClick={() => setFailed(!toggleSaved(programId))}
        className={buttonClass(saved ? 'primary' : 'secondary', `px-3 ${className}`)}
      >
        <span aria-hidden="true">{saved ? '★' : '☆'}</span>
        {saved ? 'Saved' : 'Save'}
        <span className="sr-only"> {programName}</span>
      </button>
      {failed ? (
        <span role="status" className="mt-1 text-xs text-muted">
          Could not save on this device.
        </span>
      ) : null}
    </span>
  );
}
