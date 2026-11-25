'use client';

/**
 * Tiny island: shows its (server-rendered) children only when this device has research strengths saved
 * (publications or research experience, via loadStrengths()). The server cannot read localStorage.
 * Strengths never change the fit label or the order of routes — this only reveals a note.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import { hasResearchStrengths } from '@/lib/planb/strengths';
import { loadStrengths } from '@/lib/profile-client';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

function getSnapshot(): boolean {
  return hasResearchStrengths(loadStrengths());
}

function getServerSnapshot(): boolean {
  return false;
}

export function ResearchHint({ children }: { children: ReactNode }) {
  const show = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return <div aria-live="polite">{show ? children : null}</div>;
}
