/**
 * Plain-text answer -> segments. A URL becomes a link ONLY if it equals a row's source_url or official_url
 * (after safeHref normalisation). Any other URL the model writes stays plain, unclickable text.
 * Pure; safe on server and client. Never produces HTML.
 */
import { safeHref } from '@/lib/format';
import type { ChatRow } from './types';

export type TextSegment = { type: 'text'; text: string } | { type: 'link'; text: string; href: string };

function urlKey(url: string | null | undefined): string | null {
  const h = safeHref(url);
  return h ? h.replace(/\/+$/, '') : null;
}

/** Normalised keys of every link the rows allow. */
export function allowedUrlKeys(rows: ChatRow[]): Set<string> {
  const keys = new Set<string>();
  for (const r of rows) {
    for (const u of [r.source_url, r.official_url, ...(r.sources ?? []).map((s) => s.source_url)]) {
      const k = urlKey(u);
      if (k) keys.add(k);
    }
  }
  return keys;
}

const URL_RE = /https?:\/\/[^\s<>"'()[\]{}]+/g;

export function linkifySegments(text: string, allowed: Set<string>): TextSegment[] {
  const out: TextSegment[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.type === 'text') last.text += t;
    else out.push({ type: 'text', text: t });
  };
  let i = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    let url = m[0];
    // Trailing sentence punctuation is not part of the URL.
    const trail = url.match(/[.,;:!?]+$/);
    if (trail) url = url.slice(0, -trail[0].length);
    pushText(text.slice(i, start));
    const key = urlKey(url);
    const href = key && allowed.has(key) ? safeHref(url) : null;
    if (href) out.push({ type: 'link', text: url, href });
    else pushText(url);
    i = start + url.length;
  }
  pushText(text.slice(i));
  return out;
}
