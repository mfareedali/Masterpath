/**
 * Parsers for numbers typed by students (forms, shared links, saved rows). Pure, no imports, so any module
 * (profile.ts, onboarding, Supabase mappers) can use them without an import cycle.
 */

/**
 * Parse a grade typed by a student. Accepts "2.5", "2,5" (comma decimal), ".5" and surrounding spaces.
 * Returns null for an empty input and NaN for anything that is not a plain non-negative number.
 */
export function parseDecimal(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let t = String(raw).replace(/\s+/g, '');
  if (t === '') return null;
  if (/^\d*,\d+$/.test(t)) t = t.replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

/**
 * Parse a rupee amount. Accepts digits with thousands separators ("6,000,000", "60,00,000", "60 00 000") and an
 * optional "PKR"/"Rs" prefix. Returns null for an empty input and NaN for anything else.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let t = String(raw).trim();
  if (t === '') return null;
  t = t.replace(/^(pkr|rs\.?)\s*/i, '').replace(/[\s,_']/g, '');
  if (!/^\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(Number(t));
}
