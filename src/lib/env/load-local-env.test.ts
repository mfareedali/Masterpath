import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLocalEnv } from './load-local-env';

const KEYS = ['MP_TEST_FROM_FILE', 'MP_TEST_REAL', 'MP_TEST_BOTH'];
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mp-env-'));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of KEYS) delete process.env[k];
  vi.restoreAllMocks();
});

describe('loadLocalEnv', () => {
  it('loads .env.local into process.env', () => {
    writeFileSync(join(dir, '.env.local'), 'MP_TEST_FROM_FILE=from-file\n');
    expect(loadLocalEnv(dir)).toEqual(['.env.local']);
    expect(process.env.MP_TEST_FROM_FILE).toBe('from-file');
  });

  it('real environment variables override the file', () => {
    process.env.MP_TEST_REAL = 'from-shell';
    writeFileSync(join(dir, '.env.local'), 'MP_TEST_REAL=from-file\n');
    loadLocalEnv(dir);
    expect(process.env.MP_TEST_REAL).toBe('from-shell');
  });

  it('.env.local wins over .env', () => {
    writeFileSync(join(dir, '.env.local'), 'MP_TEST_BOTH=local\n');
    writeFileSync(join(dir, '.env'), 'MP_TEST_BOTH=plain\n');
    loadLocalEnv(dir);
    expect(process.env.MP_TEST_BOTH).toBe('local');
  });

  it('a missing file is silent: no error, no output, nothing loaded', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(loadLocalEnv(dir)).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it('prints no values when a file is loaded', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    writeFileSync(join(dir, '.env.local'), 'MP_TEST_FROM_FILE=secret-value\n');
    loadLocalEnv(dir);
    expect(log).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
