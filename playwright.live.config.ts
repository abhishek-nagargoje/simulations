import { defineConfig, devices } from '@playwright/test';

// Smoke tests of a real deployment (preview or production):
//   E2E_BASE_URL=https://<deployment> E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... npm run test:live
// Creates its own access sessions and ends them. Never set these variables in Vercel.
const base = process.env.E2E_BASE_URL;
if (!base || !process.env.E2E_ADMIN_EMAIL || !process.env.E2E_ADMIN_PASSWORD) {
  throw new Error('Set E2E_BASE_URL, E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD to run the live tests.');
}

export default defineConfig({
  testDir: 'tests/stack',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: base, trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
});
