'use client';

import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { clearLocalData } from '@/lib/profile-client';
import { LOCAL_PREFIX, describeLocalData, localDataSnapshot, parseLocalDataSnapshot } from './local-data';

const CHANGED_EVENT = 'mp-local-data-changed';

function readSnapshot(): string {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
  } catch {
    /* storage blocked (private mode) */
  }
  return localDataSnapshot(keys, document.cookie);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener('focus', onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener('focus', onChange);
  };
}

/** clearLocalData() plus session storage and offline page copies (Cache Storage), best effort. */
async function deleteDeviceData(): Promise<void> {
  clearLocalData();
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(LOCAL_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  try {
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/** Shows what MastersPath keeps in this browser right now, with a two-step "delete" button. */
export function LocalDataPanel() {
  const router = useRouter();
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, () => null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const parsed = snapshot === null ? null : parseLocalDataSnapshot(snapshot);
  const items = parsed ? describeLocalData(parsed.keys, parsed.cookies) : null;

  async function onDelete() {
    setBusy(true);
    await deleteDeviceData();
    setBusy(false);
    setConfirming(false);
    setMessage('Done. Nothing from MastersPath is left in this browser.');
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-3">
      <h3 className="text-base font-bold">Found in this browser now</h3>
      {items === null ? (
        <p className="text-sm text-muted">Checking…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">Nothing from MastersPath is stored in this browser.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-button border border-line bg-surface-tint p-3">
              <p className="font-semibold text-ink">
                {item.label}
                {item.count > 1 ? <span className="font-normal text-muted"> ({item.count})</span> : null}
              </p>
              <p className="text-sm text-muted break-words">
                {item.detail} <span className="whitespace-nowrap">Kept in: {item.where.toLowerCase()}.</span>
              </p>
            </li>
          ))}
        </ul>
      )}

      {confirming ? (
        <div className="rounded-card border border-conflict-fg bg-conflict-bg p-3" role="group" aria-label="Confirm delete">
          <p className="mb-3 text-sm text-ink">
            This removes your profile, strengths, saved shortlist, checklists and offline copies from this browser. It
            cannot be undone. If you are signed in, you stay signed in.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" onClick={onDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete it'}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="danger"
          onClick={() => {
            setMessage('');
            setConfirming(true);
          }}
          disabled={items !== null && items.length === 0}
        >
          Delete my data on this device
        </Button>
      )}
      <p aria-live="polite" role="status" className="text-sm font-semibold text-primary-ink">
        {message}
      </p>
    </div>
  );
}
