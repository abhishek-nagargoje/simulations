import { expect, test } from '@playwright/test';

// Hydration investigation. React reports attribute mismatches only in
// development builds, so this spec runs against a dev server:
//   E2E_DEV_URL=http://localhost:3000 npx playwright test hydration --project desktop
//
// 1. A clean browser (Playwright's Chromium has no extensions) must produce no
//    hydration warning on any public page.
// 2. The attributes reported by the user (data-kantu on <html> from the
//    UI.Vision/Kantu extension, cz-shortcut-listen on <body> from ColorZilla),
//    added before React hydrates, no longer produce a warning: <html> and <body>
//    carry suppressHydrationWarning for their own attributes only.
// 3. A real mismatch inside <body> is still reported.

const DEV = process.env.E2E_DEV_URL;
test.skip(!DEV, 'Set E2E_DEV_URL to a running `next dev` server.');

const PAGES = ['/', '/student/login', '/teacher/login', '/about'];
const isHydrationWarning = (t: string) => /hydrat/i.test(t);

test('a clean browser shows no hydration mismatch', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => isHydrationWarning(m.text()) && warnings.push(m.text()));
  for (const p of PAGES) {
    await page.goto(DEV + p);
    await page.waitForLoadState('networkidle');
  }
  expect(warnings).toEqual([]);
});

test('extension-injected attributes on <html> and <body> produce no warning', async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (document.body) {
        document.documentElement.setAttribute('data-kantu', '1');
        document.body.setAttribute('cz-shortcut-listen', 'true');
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const warnings: string[] = [];
  page.on('console', (m) => isHydrationWarning(m.text()) && warnings.push(m.text()));
  for (const p of PAGES) {
    await page.goto(DEV + p);
    await page.waitForLoadState('networkidle');
  }
  expect(await page.locator('html').getAttribute('data-kantu')).toBe('1');
  expect(warnings).toEqual([]);
});

test('a mismatch inside the page is still reported', async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      const main = document.querySelector('main');
      if (main) {
        main.setAttribute('data-injected', 'x');
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  const warnings: string[] = [];
  page.on('console', (m) => isHydrationWarning(m.text()) && warnings.push(m.text()));
  await page.goto(DEV + '/');
  await expect.poll(() => warnings.length).toBeGreaterThan(0);
});
