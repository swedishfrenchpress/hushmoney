import { defineConfig } from '@playwright/test';

// Browser tests against a dev server on its own port, in the Chromium that's
// already on this machine (Playwright's cache, build 1243). PW_CHROMIUM points elsewhere.
export const CHROMIUM =
  process.env.PW_CHROMIUM ??
  `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
export const PORT = 5193;
// The tests' own pool of songs, apart from a dev server's.
process.env.POOL_FILE ??= '.data-e2e/pool.json';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath: CHROMIUM },
  },
  webServer: {
    command: `VITE_TEST_MINT=1 npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
