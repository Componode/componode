import { defineConfig, devices } from '@playwright/test';

// The workload always runs serially: seeded database state and mock
// scenarios are shared and mutable across the suite.
const baseURL = process.env.PW_BASE_URL ?? 'https://app.componode-pw.test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit-results.xml' }],
  ],
  outputDir: 'test-results',
  use: {
    baseURL,
    // Real TLS trust only — the workload CA is installed into the runner
    // image trust stores. Do not set ignoreHTTPSErrors here.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'chromium-narrow',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 800 } },
      testIgnore: /api|infra\/(preflight|reporting|coverage-governance)/,
    },
    {
      name: 'firefox-smoke',
      use: {
        ...devices['Desktop Firefox'],
        firefoxUserPrefs: { 'security.enterprise_roots.enabled': true },
      },
      grep: /@smoke/,
    },
    {
      name: 'webkit-smoke',
      use: { ...devices['Desktop Safari'] },
      grep: /@smoke/,
    },
  ],
});
