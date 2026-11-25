import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTokensCss, fit, palette, semantic, status } from './theme';

/** WCAG relative luminance + contrast ratio. */
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const LIGHT_SURFACES: [string, string][] = [
  ['card', semantic.surface],
  ['page top', semantic.page],
  ['page bottom', semantic['page-end']],
];

describe('design tokens', () => {
  it('src/app/tokens.css is in sync with src/theme.ts (run `npm run tokens`)', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'app', 'tokens.css'), 'utf8');
    expect(css).toBe(buildTokensCss());
  });

  it('keeps the brief\'s exact brand values', () => {
    expect(palette['forest-950']).toBe('#121A05');
    expect(palette['bark-900']).toBe('#1C1209');
    expect(palette['olive-600']).toBe('#5A6B1F');
    expect(palette['olive-100']).toBe('#E4EBCF');
    expect(palette['stone-100']).toBe('#ECE8E0');
    expect(palette['stone-50']).toBe('#F7F5F0');
    expect(palette['stone-300']).toBe('#C8C1B7');
    expect(palette['sky-700']).toBe('#2F6EA8');
    expect(palette['sky-100']).toBe('#DCE9F6');
    expect(semantic.muted).toBe('#5C574D');
  });

  // Every text colour that appears on a light surface, against every light surface (incl. the darkest gradient end).
  const TEXT_ON_LIGHT: [string, string][] = [
    ['body text', semantic.ink],
    ['headings', semantic.heading],
    ['muted text', semantic.muted],
    ['olive text / internal links', semantic['primary-ink']],
    ['official source links', semantic.link],
  ];
  for (const [surfaceName, surface] of LIGHT_SURFACES) {
    it.each(TEXT_ON_LIGHT)(`%s on ${surfaceName} has contrast >= 4.5:1`, (_n, fg) => {
      expect(contrast(fg, surface)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it.each([
    ['stone-100 on forest bars', semantic['on-chrome'], semantic.chrome],
    ['muted text on forest bars', semantic['on-chrome-muted'], semantic.chrome],
    ['primary button hover: stone-100 on olive-600', semantic['on-chrome'], semantic.primary],
    ['white on olive-600 (chips, rank badges)', semantic['on-primary'], semantic.primary],
    ['white on accent', semantic['on-accent'], semantic.accent],
    ['accent button: forest on olive-100', semantic['on-accent-soft'], semantic['accent-soft']],
    ['body text on evidence tint', semantic.ink, semantic['evidence-bg']],
    ['source link on evidence tint', semantic.link, semantic['evidence-bg']],
    ['olive text on olive tint', semantic['primary-ink'], semantic['surface-tint']],
    ['form-control border on cards', semantic['line-strong'], semantic.surface],
    ['verified badge', status['verified-fg'], status['verified-bg']],
    ['likely badge', status['likely-fg'], status['likely-bg']],
    ['unverified badge', status['unverified-fg'], status['unverified-bg']],
    ['conflict badge / warning button', status['conflict-fg'], status['conflict-bg']],
    ['blocked badge on card', status['blocked-fg'], semantic.surface],
    ['fit: meets minimum', fit['fit-meets-fg'], fit['fit-meets-bg']],
    ['fit: competitive range unknown', fit['fit-unknown-fg'], fit['fit-unknown-bg']],
    ['fit: below minimum', fit['fit-below-fg'], fit['fit-below-bg']],
  ])('%s has contrast >= 4.5:1', (_name, fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('badges differ in lightness, not only hue', () => {
    const l = [status['verified-bg'], status['likely-bg'], status['unverified-bg'], status['conflict-bg']].map(lum);
    const sorted = [...l].sort();
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThan(0.005);
  });

  it('blue is reserved for official sources: no other semantic token is sky', () => {
    const blues = new Set<string>([palette['sky-700'], palette['sky-800'], palette['sky-100']]);
    const allowed = new Set(['link', 'evidence-bg', 'evidence-bar']);
    for (const [k, v] of Object.entries(semantic)) if (blues.has(v)) expect(allowed.has(k), k).toBe(true);
  });
});
