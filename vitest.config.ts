import { defineConfig } from 'vitest/config';

// Unit and in-process tests: no network. The mint is tests/support/fakemint.ts.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
