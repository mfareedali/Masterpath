'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The subset of the Turnstile browser API we use. Read through `turnstileApi()` instead of a `declare global`
 * augmentation, so this file never clashes with other widgets that type `window.turnstile` themselves.
 */
interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}

function turnstileApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (turnstileApi()) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Turnstile failed to load'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Cloudflare Turnstile challenge (only rendered when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, only on sign-in).
 * The widget adds a hidden "cf-turnstile-response" input to the surrounding form; the server verifies it.
 * Tokens are single use: pass a new `resetSignal` (any value that changes) after each submit to get a fresh one.
 */
export function TurnstileWidget({ siteKey, resetSignal }: { siteKey: string; resetSignal?: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        const api = turnstileApi();
        if (cancelled || !ref.current || !api || widgetId.current) return;
        widgetId.current = api.render(ref.current, { sitekey: siteKey, size: 'flexible', theme: 'light' });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      const api = turnstileApi();
      if (widgetId.current && api) api.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    const api = turnstileApi();
    if (resetSignal !== undefined && widgetId.current && api) api.reset(widgetId.current);
  }, [resetSignal]);

  return (
    <div className="min-h-[65px]">
      <div ref={ref} />
      {failed ? (
        <p className="text-sm text-conflict-fg" role="alert">
          The safety check could not load. Check your internet connection and reload the page.
        </p>
      ) : null}
    </div>
  );
}
