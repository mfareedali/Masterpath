'use client';

/**
 * Cloudflare Turnstile widget for the chat, loaded only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set.
 * Tokens are single use: bump `resetKey` after each request to get a fresh one.
 *
 * No `declare global` here on purpose: another module (the sign-in form) augments `Window.turnstile` with a
 * smaller type, and two different augmentations do not compile. We read the API through a local cast instead.
 */
import { useEffect, useRef } from 'react';

interface ChatTurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id?: string): void;
  remove(id: string): void;
}

function turnstileApi(): ChatTurnstileApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { turnstile?: ChatTurnstileApi }).turnstile;
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (turnstileApi()) return Promise.resolve();
  // The sign-in page may already have added the same script tag.
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = existing ?? document.createElement('script');
    s.addEventListener('load', () => resolve());
    s.addEventListener('error', () => {
      scriptPromise = null;
      reject(new Error('Turnstile failed to load'));
    });
    if (!existing) {
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
  });
  return scriptPromise;
}

export function TurnstileWidget({
  siteKey,
  onToken,
  onError,
  resetKey,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  onError?: () => void;
  resetKey: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const tokenCb = useRef(onToken);
  const errorCb = useRef(onError);

  useEffect(() => {
    tokenCb.current = onToken;
    errorCb.current = onError;
  }, [onToken, onError]);

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        const api = turnstileApi();
        if (cancelled || !box.current || !api || widgetId.current) return;
        widgetId.current = api.render(box.current, {
          sitekey: siteKey,
          size: 'flexible',
          theme: 'light',
          callback: (t: string) => tokenCb.current(t),
          'expired-callback': () => tokenCb.current(null),
          'error-callback': () => {
            tokenCb.current(null);
            errorCb.current?.();
          },
        });
      })
      .catch(() => {
        tokenCb.current(null);
        errorCb.current?.();
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
    if (resetKey > 0 && widgetId.current && api) {
      tokenCb.current(null);
      api.reset(widgetId.current);
    }
  }, [resetKey]);

  return <div ref={box} className="min-h-[65px]" />;
}
