import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    retries: 0,
    use: {
        baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173',
        trace: 'on-first-retry',
    },
    webServer: process.env.E2E_SKIP_WEBSERVER
        ? undefined
        : {
              command: 'npm run preview -- --host 127.0.0.1 --port 4173',
              url: 'http://127.0.0.1:4173',
              reuseExistingServer: !process.env.CI,
              timeout: 120_000,
          },
});
