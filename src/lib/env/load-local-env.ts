import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Load `.env.local` (then `.env`) from `dir` into process.env using Node's built-in loader.
 * Real environment variables always win: process.loadEnvFile never overwrites a variable that is already set,
 * and `.env.local` is read first so it wins over `.env`. A missing or unreadable file is skipped silently.
 * Returns the names of the files that were loaded (never any values).
 */
export function loadLocalEnv(dir: string = process.cwd()): string[] {
  const loaded: string[] = [];
  for (const name of ['.env.local', '.env']) {
    const file = join(dir, name);
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
      loaded.push(name);
    } catch {
      /* unreadable or malformed file: real environment variables still apply */
    }
  }
  return loaded;
}
