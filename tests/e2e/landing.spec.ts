import { expect, test } from '@playwright/test';

// Public pages, the favicon and fail-closed behaviour. Runs against any build;
// without Supabase configuration the sign-in forms must report exactly that.

const PROHIBITED = /\b(training|trainee|simulat\w*|demo|practi[cs]e|prototype|mock|clone)\b/i;

test('the landing page offers Student Login first and Teacher Login second, and nothing else', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Applications');
  const cards = await page.locator('.role-card h2').allInnerTexts();
  expect(cards).toEqual(['Student Login', 'Teacher Login']);
  const buttons = await page.locator('.role-card a').allInnerTexts();
  expect(buttons).toEqual(['Student Login', 'Teacher Login']);
  await page.getByRole('link', { name: 'Student Login' }).click();
  await expect(page).toHaveURL(/\/student\/login$/);
  await expect(page.getByRole('heading', { name: 'Student Login' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: 'Teacher Login' }).click();
  await expect(page).toHaveURL(/\/teacher\/login$/);
  await expect(page.getByRole('heading', { name: 'Teacher Login' })).toBeVisible();
});

test('the student login has only username, password, show password and sign in', async ({ page }) => {
  await page.goto('/student/login');
  const form = page.locator('form');
  await expect(form.locator('input')).toHaveCount(2);
  await expect(form.getByLabel('Username')).toBeVisible();
  await expect(form.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await form.getByRole('button', { name: 'Show password' }).click();
  await expect(form.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await expect(form.getByRole('button', { name: 'Sign In' })).toBeVisible();
});

test('public pages contain no prohibited wording', async ({ page }) => {
  for (const path of ['/', '/student/login', '/teacher/login', '/about']) {
    await page.goto(path);
    const text = await page.locator('body').innerText();
    const title = await page.title();
    expect(`${title}\n${text}`, path).not.toMatch(PROHIBITED);
    const meta = await page.locator('meta[name="description"]').getAttribute('content');
    expect(meta ?? '', path).not.toMatch(PROHIBITED);
  }
});

test('pages fit the viewport without horizontal scroll', async ({ page }) => {
  for (const path of ['/', '/student/login', '/teacher/login', '/about']) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('the favicon and app icons are served', async ({ page, request }) => {
  const ico = await request.get('/favicon.ico');
  expect(ico.status()).toBe(200);
  expect(ico.headers()['content-type']).toMatch(/icon/);
  const svg = await request.get('/icon.svg');
  expect(svg.status()).toBe(200);
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
  expect((await request.get('/apple-icon.png')).status()).toBe(200);
  const failed: string[] = [];
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(await page.locator('link[rel="icon"]').count()).toBeGreaterThan(0);
  expect(failed).toEqual([]);
});

test('public pages log no console errors in a clean browser', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  for (const path of ['/', '/student/login', '/teacher/login', '/about']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(errors).toEqual([]);
});

test('student login validates input before contacting the server', async ({ page }) => {
  await page.goto('/student/login');
  let posted = false;
  page.on('request', (r) => {
    if (r.method() === 'POST') posted = true;
  });
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByText('Enter your username.')).toBeVisible();
  await expect(page.getByText('Enter your password.')).toBeVisible();
  await expect(page.getByLabel('Username')).toHaveAttribute('aria-invalid', 'true');
  expect(posted).toBe(false);
});

test('protected endpoints never grant access without a session', async ({ request }) => {
  const id = '7b0c1c1e-1d2f-4a3b-9c4d-5e6f7a8b9c0d';
  expect((await request.get(`/access/${id}/app/content`)).status()).toBe(401);
  expect((await request.get(`/api/access/${id}/session`)).status()).toBe(401);
  expect((await request.get(`/api/access/${id}/erp/data`)).status()).toBe(401);
  const commit = await request.post(`/api/access/${id}/erp/commit`, {
    headers: { Origin: 'https://evil.example' },
    data: { requestId: id, ops: [] },
  });
  expect(commit.status()).toBe(403);
  expect((await request.get('/api/teacher/access')).ok()).toBe(false);
  const cross = await request.post(`/api/access/${id}/login`, {
    headers: { Origin: 'https://evil.example' },
    data: { username: 'a', password: 'b' },
  });
  expect(cross.status()).toBe(403);
  // Module files and supplied sources are not published as static files.
  for (const p of ['/modules/sap-erp/index.html', '/modules/sap-erp/source/SAP.html', '/sap-erp/index.html', '/index.html',
    '/modules/sap-erp/source/SAP_Training_Data_500.xlsx']) {
    expect((await request.get(p)).status(), p).toBe(404);
  }
});

test('old links redirect to the new access pages', async ({ request }) => {
  const id = '7b0c1c1e-1d2f-4a3b-9c4d-5e6f7a8b9c0d';
  const r = await request.get(`/classroom/${id}`, { maxRedirects: 0 });
  expect([307, 308]).toContain(r.status());
  expect(r.headers().location).toBe(`/access/${id}`);
});

test('teacher sign-in reports the actual failure instead of a network error', async ({ page }) => {
  // This test server may run without Supabase configuration. Either way the
  // message must name the real cause (configuration, credentials, service).
  await page.goto('/teacher/login');
  await page.getByLabel('Email').fill('training@hrremedyindia.com');
  await page.getByLabel('Password', { exact: true }).fill('not-the-password');
  const response = page.waitForResponse('**/api/teacher/login');
  await page.getByRole('button', { name: 'Sign In' }).click();
  const res = await response;
  const alert = page.locator('#login-error');
  await expect(alert).toBeVisible();
  await expect(alert).not.toHaveText(/network error/i);
  if (res.status() === 503) {
    const body = await res.json();
    expect(['config_error', 'unavailable']).toContain(body.error.code);
  } else {
    expect([401, 403, 429]).toContain(res.status());
  }
});
