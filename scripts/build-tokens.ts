/**
 * Generates src/app/tokens.css from src/theme.ts (the single source of styling values).
 * Runs automatically before `npm run dev` and `npm run build`.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildTokensCss } from '../src/theme';

const out = join(process.cwd(), 'src', 'app', 'tokens.css');
const css = buildTokensCss();
const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
if (current !== css) {
  writeFileSync(out, css, 'utf8');
  console.log('tokens: wrote src/app/tokens.css');
} else {
  console.log('tokens: up to date');
}
