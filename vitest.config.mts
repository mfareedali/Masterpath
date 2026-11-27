import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@data': fileURLToPath(new URL('./data', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // A hung test must FAIL, never stall a CI job: per-test, per-hook and teardown limits.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 15_000,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
