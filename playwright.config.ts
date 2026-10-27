import { defineConfig, devices } from '@playwright/test';

// landing.spec and hrms.spec run anywhere. classroom.spec needs a fully
// configured instance (Supabase + admin) and skips without E2E_* variables.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // Without E2E_BASE_URL, serve the production build locally (run `npm run build` first).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run start -- -p 3100', url: 'http://localhost:3100', reuseExistingServer: true, timeout: 120_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
