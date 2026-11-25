/**
 * "Share my shortlist" text. Pure and dependency-free, so the client leaf that uses it stays tiny.
 * The link itself is built on the server by profileShortlistPath (src/lib/shortlist/index.ts): grade, scale,
 * field, budget and countries only. Never a name, university, degree, passport or ID number.
 */

/** Shown next to the share button. */
export const SHARE_PRIVACY_LINE =
  'The link contains your grade, field, budget and countries. It never contains your name or university.';

const INTRO = 'My Masters shortlist on MastersPath (free, open source). Each verified fact links to its official page:';

/**
 * The message: one fixed sentence and the link. No outcome or chance wording. Never truncated (a cut link is
 * broken); the link is short by construction (six profile params plus rank), well under WhatsApp's 1,500 cap.
 */
export function shareShortlistText(url: string): string {
  return `${INTRO} ${url}`;
}

/** https://wa.me/?text=<encoded>: opens WhatsApp with the message ready to send to anyone. */
export function whatsappShareHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Absolute URL for a same-site path such as "/shortlist?cgpa=2.5&…". Only a path starting with a single "/"
 * is accepted, so a stray value can never point the link at another site. Null otherwise.
 */
export function absoluteShareUrl(path: string, origin: string): string | null {
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  try {
    const u = new URL(path, origin);
    return u.origin === new URL(origin).origin ? u.toString() : null;
  } catch {
    return null;
  }
}
