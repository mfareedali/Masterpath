'use client';

/**
 * "Share my shortlist". Tiny client leaf: the link path is built on the server (profileShortlistPath), so the
 * only browser work is adding the origin and opening the share sheet.
 *  - navigator.share when the browser has it (phones, secure contexts);
 *  - otherwise (or if it fails) a WhatsApp link and "Copy link" appear under the button.
 * Server and first client render are identical (no hydration mismatch, no layout shift before a tap).
 */
import { useState } from 'react';
import { buttonClass } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { SHARE_PRIVACY_LINE, absoluteShareUrl, shareShortlistText, whatsappShareHref } from '@/lib/shortlist/share';

export function ShareShortlist({ path }: { path: string }) {
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  async function onShare() {
    const url = absoluteShareUrl(path, window.location.origin);
    if (!url) return;
    const text = shareShortlistText(url);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'My Masters shortlist', text });
        return;
      } catch (e) {
        // The student closed the share sheet: nothing to do. Any other failure falls back to the links below.
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }
    setFallbackUrl(url);
  }

  return (
    <div>
      <button type="button" onClick={onShare} className={buttonClass('secondary', 'px-4')} aria-expanded={fallbackUrl !== null}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
        </svg>
        Share my shortlist
      </button>
      <p className="mt-1 text-xs text-muted">{SHARE_PRIVACY_LINE}</p>
      {fallbackUrl ? (
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <a
            href={whatsappShareHref(shareShortlistText(fallbackUrl))}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('secondary', 'px-4')}
          >
            Send on WhatsApp
            <span className="sr-only"> (opens WhatsApp in a new tab)</span>
          </a>
          <CopyButton text={fallbackUrl} label="Copy link" copiedLabel="Link copied" />
        </div>
      ) : null}
    </div>
  );
}
