import { defineConfig, devices } from '@playwright/test';

// Full-stack browser tests of the real application (production build) against
// a local stand-in for Supabase Auth and RPC (tests/support/local-supabase.mjs)
// backed by the real migrations and the imported SAP ERP workbook.
//   npm run test:stack
const SUPABASE_PORT = 54399;
const APP_PORT = 3200;
const env = {
  NEXT_DIST_DIR: '.next-stack',
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${SUPABASE_PORT}`,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local_test_key',
  SUPABASE_SECRET_KEY: 'sb_secret_local_test_key',
  SESSION_SIGNING_SECRET: 'local-stack-test-signing-secret-0123456789abcdef',
  E2E_ADMIN_EMAIL: 'training@hrremedyindia.com',
  E2E_ADMIN_PASSWORD: 'Local-Teacher-Pass-1',
  LOCAL_STACK: '1',
  LOCAL_SUPABASE_PORT: String(SUPABASE_PORT),
};
// The test workers read the same settings (credentials, LOCAL_STACK).
Object.assign(process.env, env);

export default defineConfig({
  testDir: 'tests/stack',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  webServer: [
    {
      command: 'node tests/support/local-supabase.mjs',
      url: `http://localhost:${SUPABASE_PORT}/auth/v1/user`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 180_000,
      env,
      stdout: 'pipe',
      // /auth/v1/user answers 401 without a token, which counts as "up".
    },
    {
      command: `npx next build && npx next start -p ${APP_PORT}`,
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 600_000,
      env,
    },
  ],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
});
