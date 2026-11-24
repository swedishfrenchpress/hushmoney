import { defineConfig } from 'vitest/config';

// Against the real testnut mint, over the network. Slow, and testnut can be down.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
