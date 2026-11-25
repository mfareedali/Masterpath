'use client';

/**
 * Tiny localStorage hooks for client islands on the program page.
 * Uses useSyncExternalStore so the server render and hydration agree (server snapshot = null),
 * and falls back to memory when storage is blocked (private mode), so the UI still works for the session.
 */
import { useSyncExternalStore } from 'react';

const CHANGE_EVENT = 'mp-local-change';
const memory = new Map<string, string>();

export function readLocal(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    memory.set(key, value);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** The stored string for `key`; null on the server, during hydration, or when nothing is stored. */
export function useLocalString(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readLocal(key),
    () => null,
  );
}

/**
 * A value derived from browser state. `read` must return a primitive (e.g. a JSON string) so snapshots compare equal.
 * Returns `undefined` on the server and during hydration.
 */
export function useBrowserSnapshot<T extends string | number | boolean | null>(read: () => T): T | undefined {
  return useSyncExternalStore<T | undefined>(subscribe, read, () => undefined);
}

const noopSubscribe = () => () => {};

/** False on the server and during hydration, true once the component runs in the browser. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
