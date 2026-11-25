/**
 * MastersPath design tokens — the ONE place to change colours, fonts, radii and sizes.
 *
 * Edit values here, then run `npm run tokens` (it also runs automatically before `dev` and `build`).
 * The generator writes `src/app/tokens.css`, which defines the Tailwind theme (`@theme`) and CSS variables.
 * Never hard-code a colour or font anywhere else: use Tailwind classes such as `bg-chrome`, `text-ink`,
 * `border-line`, `text-link`, `font-display`, `min-h-tap`.
 *
 * Look: calm, serious, data-first. Deep forest-green bars on warm stone surfaces, olive buttons.
 * BLUE MEANS "VERIFIED BY AN OFFICIAL SOURCE" AND NOTHING ELSE: source links, evidence snippets, the Verified badge.
 *
 * Rules: all text and UI contrast >= 4.5:1 (checked by src/theme.test.ts). Status badges differ by label, icon AND
 * lightness, never by colour alone.
 */

export const palette = {
  'forest-950': '#121A05', // top bar, bottom nav, hero panel
  'bark-900': '#1C1209', // headings and strong text on light surfaces
  'bark-800': '#2E2820', // body text on light surfaces
  'olive-600': '#5A6B1F', // primary fills: buttons (hover), active states, rank-number badges
  'olive-700': '#4C5B19', // olive TEXT (olive-600 is 4.1:1 on the darkest page gradient; this is 5.2:1)
  'olive-100': '#E4EBCF', // soft olive tint backgrounds
  'stone-50': '#F7F5F0', // cards
  'stone-100': '#ECE8E0', // page background (top of the gradient); text on dark surfaces
  'stone-200': '#DDD7CC', // page background (bottom of the gradient)
  'stone-300': '#C8C1B7', // borders and dividers (decorative)
  'stone-500': '#6E675B', // form-control borders (needs >= 4.5:1 against cards)
  'stone-600': '#5C574D', // muted text on light surfaces
  'stone-400-on-dark': '#B9B2A6', // muted text on forest-950
  'sky-700': '#2F6EA8', // evidence bars, source icons (non-text)
  'sky-800': '#275C8D', // source-link TEXT (sky-700 is 4.4:1 on stone-100; this is 5.7:1)
  'sky-100': '#DCE9F6', // tint behind evidence snippets and the Verified badge
  white: '#FFFFFF',
} as const;

/** Semantic aliases used by components. Point these at different palette entries to re-skin the app. */
export const semantic = {
  // Surfaces
  page: palette['stone-100'],
  'page-end': palette['stone-200'],
  surface: palette['stone-50'],
  'surface-tint': palette['olive-100'],
  chrome: palette['forest-950'], // top bar, bottom nav, hero panel
  'on-chrome': palette['stone-100'],
  'on-chrome-muted': palette['stone-400-on-dark'],
  // Text
  ink: palette['bark-800'],
  heading: palette['bark-900'],
  muted: palette['stone-600'],
  // Lines
  line: palette['stone-300'],
  'line-strong': palette['stone-500'],
  // Olive actions
  primary: palette['olive-600'], // fills and borders
  'primary-ink': palette['olive-700'], // olive text and internal links
  'primary-hover': palette['olive-600'],
  'on-primary': palette.white,
  accent: palette['olive-600'], // active indicator bars, rank-number badges
  'on-accent': palette.white,
  'accent-soft': palette['olive-100'], // accent button, key call-outs
  'on-accent-soft': palette['forest-950'],
  // Official sources (blue = verified by an official source, nothing else)
  link: palette['sky-800'],
  'evidence-bg': palette['sky-100'],
  'evidence-bar': palette['sky-700'],
  focus: palette['olive-600'],
} as const;

/** Status badges: distinct label, icon AND lightness. */
export const status = {
  'verified-bg': '#DCE9F6',
  'verified-fg': '#1F4F82',
  // Nudged from #F6E7B0 so Likely's lightness clearly differs from Verified's (see DECISIONS.md, restyle).
  'likely-bg': '#F8EBBB',
  'likely-fg': '#5E4700',
  'unverified-bg': '#E4E0D8',
  'unverified-fg': '#3B3730',
  'conflict-bg': '#F6D9D0',
  'conflict-fg': '#7E2410',
  'blocked-fg': '#7E2410', // used with a dashed border
} as const;

/** Fit labels. */
export const fit = {
  'fit-meets-bg': palette['olive-600'], // "Meets minimum": solid olive-600, white text
  'fit-meets-fg': palette.white,
  'fit-unknown-bg': palette['stone-50'], // "Competitive range unknown": stone-50 with an olive border
  'fit-unknown-fg': palette['bark-900'],
  'fit-unknown-border': palette['olive-600'],
  'fit-below-bg': palette['forest-950'], // "Below minimum": solid forest-950, stone-100 text
  'fit-below-fg': palette['stone-100'],
} as const;

/**
 * Fonts. UI and body use the system stack (no download). The display face is used ONLY for the hero wordmark
 * (>= 40px); thin weights are never used below 28px. It is loaded with next/font (subset, display: swap) in
 * src/components/home/hero.tsx, which defines --font-outfit; swap the font there and here in one edit.
 */
const systemSans =
  'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, sans-serif';

export const fonts = {
  ui: systemSans,
  // var() with a fallback, so the declaration stays valid on pages that do not load the display font.
  display: `var(--font-outfit, Outfit), ${systemSans}`,
  'button-primary': systemSans,
  'button-secondary': systemSans,
  'button-danger': systemSans,
} as const;

/** Per-button typography so primary / secondary / warning buttons look clearly different. */
export const buttonType = {
  'primary-weight': '600',
  'primary-tracking': '0.01em',
  'secondary-weight': '600',
  'secondary-tracking': '0',
  'danger-weight': '600',
  'danger-tracking': '0.01em',
  'display-weight': '300',
  'heading-weight': '600',
} as const;

/** UI weights stay within 400-600: Tailwind's font-bold/extrabold are capped at 600 (headings read as semibold). */
export const fontWeights = {
  bold: '600',
  extrabold: '600',
  black: '600',
} as const;

export const radius = {
  card: '20px',
  panel: '24px',
  chip: '999px',
  button: '16px', // inputs and boxed controls (buttons themselves are pills)
  badge: '8px',
} as const;

export const sizes = {
  /** Minimum tap target (WCAG / brief: >= 44px). */
  tap: '44px',
  /** Primary button height. */
  button: '52px',
  /** Height reserved for the fixed bottom navigation on mobile. */
  'bottom-nav': '64px',
} as const;

export const shadows = {
  card: '0 1px 2px rgba(18, 26, 5, 0.05), 0 4px 14px rgba(18, 26, 5, 0.06)',
  sheet: '0 -6px 18px rgba(18, 26, 5, 0.18)',
} as const;

export const theme = { palette, semantic, status, fit, fonts, fontWeights, buttonType, radius, sizes, shadows };

/** Builds the CSS written to src/app/tokens.css. Pure: used by the generator and by a drift test. */
export function buildTokensCss(): string {
  const lines: string[] = [];
  lines.push('/* AUTO-GENERATED from src/theme.ts by scripts/build-tokens.ts. Do not edit by hand. */');
  lines.push('@theme {');
  // Remove Tailwind's default colour palette so only our tokens can be used.
  lines.push('  --color-*: initial;');
  lines.push('  --color-transparent: transparent;');
  lines.push('  --color-current: currentColor;');
  for (const [k, v] of Object.entries(palette)) lines.push(`  --color-${k}: ${v};`);
  for (const [k, v] of Object.entries(semantic)) lines.push(`  --color-${k}: ${v};`);
  for (const [k, v] of Object.entries(status)) lines.push(`  --color-${k}: ${v};`);
  for (const [k, v] of Object.entries(fit)) lines.push(`  --color-${k}: ${v};`);
  for (const [k, v] of Object.entries(fonts)) lines.push(`  --font-${k}: ${v};`);
  for (const [k, v] of Object.entries(fontWeights)) lines.push(`  --font-weight-${k}: ${v};`);
  for (const [k, v] of Object.entries(radius)) lines.push(`  --radius-${k}: ${v};`);
  for (const [k, v] of Object.entries(sizes)) lines.push(`  --spacing-${k}: ${v};`);
  for (const [k, v] of Object.entries(shadows)) lines.push(`  --shadow-${k}: ${v};`);
  lines.push('}');
  lines.push(':root {');
  for (const [k, v] of Object.entries(buttonType)) lines.push(`  --btn-${k}: ${v};`);
  lines.push('}');
  return lines.join('\n') + '\n';
}
