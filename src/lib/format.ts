/** Display helpers. Pure functions, safe on server and client. */
import { COUNTRY_NAMES, type Money } from './types';

export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

const PERIOD_LABEL: Record<Money['period'], string> = {
  year: 'per year',
  semester: 'per semester',
  month: 'per month',
  total: 'total',
};

export function formatMoney(m: Money | null | undefined): string {
  if (!m || !Number.isFinite(m.amount)) return 'Not verified yet';
  let amount: string;
  try {
    amount = new Intl.NumberFormat('en-GB', { style: 'currency', currency: m.currency, maximumFractionDigits: 0 }).format(m.amount);
  } catch {
    amount = `${m.currency} ${Math.round(m.amount).toLocaleString('en-GB')}`;
  }
  return `${amount} ${PERIOD_LABEL[m.period]}`;
}

/** PKR in lakh/crore-friendly form, e.g. "PKR 6,000,000 (60 lakh)". */
export function formatPkr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'Not verified yet';
  const base = `PKR ${Math.round(n).toLocaleString('en-GB')}`;
  if (n >= 10_000_000) return `${base} (${(n / 10_000_000).toFixed(1).replace(/\.0$/, '')} crore)`;
  if (n >= 100_000) return `${base} (${(n / 100_000).toFixed(1).replace(/\.0$/, '')} lakh)`;
  return base;
}

/** "12 Jan 2027" from "2027-01-12". Returns the input unchanged if it is not a date. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Not verified yet';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(t));
}

export function formatMonths(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'Not verified yet';
  if (n % 12 === 0) {
    const y = n / 12;
    return `${y} year${y === 1 ? '' : 's'}`;
  }
  return `${n} months`;
}

/** Hostname without "www." for compact source links. Returns '' for invalid URLs. */
export function domainOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Only http(s) URLs are ever rendered as links (defence against javascript: URLs in data). */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}
