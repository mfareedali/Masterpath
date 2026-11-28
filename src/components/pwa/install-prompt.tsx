'use client';

/**
 * "Install the app" popup.
 *
 * - Chrome, Edge and Android: the browser fires `beforeinstallprompt`. We hold on to it and show a small card with an
 *   Install button that opens the browser's own install dialog.
 * - iPhone / iPad Safari has no install event, so the card explains Share -> Add to Home Screen instead.
 * - Never shown inside the installed app (display-mode: standalone), and hidden for DISMISS_DAYS after "Not now".
 * - Appears SHOW_DELAY_MS after load so it never competes with first paint. Sits above the mobile bottom nav.
 */
import Image from 'next/image';
import { useEffect, useState } from 'react';

export const DISMISS_KEY = 'masterspath:install-dismissed-at';
export const DISMISS_DAYS = 14;
const SHOW_DELAY_MS = 4000;

export const INSTALL_TITLE = 'Install MastersPath';
export const INSTALL_BODY = 'Open it from your home screen like an app. Your saved shortlist works offline too.';
export const IOS_STEPS = 'Tap the Share button, then “Add to Home Screen”.';

/** The non-standard event Chrome/Edge fire when the site can be installed. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallMode = 'prompt' | 'ios';

/** iPhone/iPad Safari (other iOS browsers cannot add to the home screen from their own menu reliably). */
export function isIosSafari(ua: string, maxTouchPoints = 0): boolean {
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1); // iPadOS reports as Mac
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(ua);
  return ios && safari;
}

/** True when the dismissal is older than DISMISS_DAYS, or there is none / it is unreadable. */
export function dismissalExpired(raw: string | null, now: number): boolean {
  const at = raw ? Number(raw) : NaN;
  if (!Number.isFinite(at)) return true;
  return now - at > DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Storage blocked (private mode): the popup may come back next visit, which is fine.
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Presentation only (render-tested without a DOM). */
export function InstallPromptView({
  mode,
  onInstall,
  onClose,
}: {
  mode: InstallMode;
  onInstall?: () => void;
  onClose?: () => void;
}) {
  return (
    <section
      aria-label="Install the app"
      data-install-prompt={mode}
      className="fixed inset-x-3 bottom-[calc(1.5rem+var(--spacing-bottom-nav)+env(safe-area-inset-bottom))] z-50 mx-auto max-w-sm rounded-card border border-line bg-surface p-4 shadow-dock md:inset-x-auto md:bottom-6 md:right-6"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-button bg-chrome">
          <Image src="/brand/logo-mark-light.png" alt="" width={227} height={160} className="h-auto w-9" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-heading">{INSTALL_TITLE}</h2>
          <p className="mt-1 text-sm text-muted">{mode === 'ios' ? `${INSTALL_BODY} ${IOS_STEPS}` : INSTALL_BODY}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mr-2 -mt-2 inline-flex min-h-tap min-w-tap items-center justify-center rounded-chip text-xl leading-none text-muted hover:bg-surface-tint"
        >
          ×
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-tap items-center rounded-chip px-4 text-sm font-semibold text-primary-ink hover:bg-surface-tint"
        >
          {mode === 'ios' ? 'Got it' : 'Not now'}
        </button>
        {mode === 'prompt' ? (
          <button
            type="button"
            onClick={onInstall}
            className="inline-flex min-h-tap items-center rounded-chip border border-chrome bg-chrome px-5 text-sm font-semibold text-on-chrome hover:border-primary hover:bg-primary"
          >
            Install
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function InstallPrompt() {
  const [mode, setMode] = useState<InstallMode | null>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || !dismissalExpired(readDismissed(), Date.now())) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const showLater = (m: InstallMode) => {
      clearTimeout(timer);
      timer = setTimeout(() => setMode(m), SHOW_DELAY_MS);
    };
    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // keep the browser's mini-infobar quiet; our card offers the same action
      setDeferred(e as BeforeInstallPromptEvent);
      showLater('prompt');
    };
    const onInstalled = () => {
      clearTimeout(timer);
      setMode(null);
      setDeferred(null);
      rememberDismissed();
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    if (isIosSafari(navigator.userAgent, navigator.maxTouchPoints)) showLater('ios');
    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!mode) return null;

  const close = () => {
    rememberDismissed();
    setMode(null);
  };
  const install = async () => {
    if (!deferred) return close();
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    setMode(null);
    if (outcome === 'dismissed') rememberDismissed();
  };

  return <InstallPromptView mode={mode} onInstall={install} onClose={close} />;
}
