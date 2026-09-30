import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
const origin = process.env.DOCS_ORIGIN ?? 'http://127.0.0.1:4173';
export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  outputDir: process.env.DOCS_QA_DIR ?? join(tmpdir(), 'dou-bot-docs-qa'),
  use: {
    baseURL: `${origin}/dou-bot/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: process.env.DOCS_ORIGIN
    ? undefined
    : {
        command: 'npm run preview -- --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173/dou-bot/',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
      },
});
