// Full teacher â†’ student lifecycle through the real application.
//   npm run test:stack  production build + local Supabase stand-in (playwright.stack.config.ts)
//   npm run test:live   a real deployment (playwright.live.config.ts; needs E2E_BASE_URL,
//                       E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD). Creates and ends its own access
//                       sessions; organization settings are changed only on the local stack
//                       or with E2E_ALLOW_ORG_CHANGES=1.
import { expect, test, type Browser, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'training@hrremedyindia.com';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Local-Teacher-Pass-1';
const stamp = Date.now() % 100000;
const LOCAL = process.env.LOCAL_STACK === '1';
const NON_TEACHER_EMAIL = process.env.E2E_NON_TEACHER_EMAIL ?? (LOCAL ? 'staff@hrremedyindia.com' : '');
const NON_TEACHER_PASSWORD = process.env.E2E_NON_TEACHER_PASSWORD ?? (LOCAL ? PASSWORD : '');
const ORG_CHANGES = LOCAL || process.env.E2E_ALLOW_ORG_CHANGES === '1';

async function teacherSignIn(page: Page) {
  await page.goto('/teacher/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
}

async function createAccess(page: Page, app: 'HR Management' | 'SAP ERP', username: string, duration = '24 hours') {
  await page.goto('/teacher/access/new');
  await page.getByLabel('Application').selectOption({ label: app });
  await page.getByLabel('Name', { exact: true }).fill(`${app} batch ${stamp}`);
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Show password' }).click();
  const password = await page.getByLabel('Password', { exact: true }).inputValue();
  await page.getByLabel('Duration after start').selectOption({ label: duration });
  await page.getByRole('button', { name: 'Create Access' }).click();
  await expect(page.getByRole('heading', { name: 'Access created' })).toBeVisible();
  await page.getByRole('link', { name: 'Open access to start it' }).click();
  await expect(page.getByRole('heading', { name: 'Ready to start' })).toBeVisible();
  const id = page.url().split('/').pop()!;
  return { id, password };
}

async function start(page: Page) {
  await page.getByRole('button', { name: 'Start Access' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start Access' }).click();
  await expect(page.getByRole('heading', { name: 'Active Access' })).toBeVisible();
  return (await page.locator('.copy-field code').first().textContent())!;
}

async function studentPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test('teacher login: wrong password, account without teacher role, and success', async ({ page }) => {
  await page.goto('/teacher/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill('Wrong-Password-9');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.locator('#login-error')).toHaveText('Incorrect email or password.');

  if (NON_TEACHER_EMAIL) {
    await page.getByLabel('Email').fill(NON_TEACHER_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(NON_TEACHER_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.locator('#login-error')).toHaveText('This account does not have teacher access.');
    // The non-teacher was signed out again: the console stays closed.
    await page.goto('/teacher/dashboard');
    await expect(page).toHaveURL(/\/teacher\/login/);
  }

  await teacherSignIn(page);
});

test('a student cannot reach the teacher console or APIs', async ({ browser }) => {
  const anon = await studentPage(browser);
  await anon.goto('/teacher/dashboard');
  await expect(anon).toHaveURL(/\/teacher\/login/);
  expect((await anon.request.get('/api/teacher/access')).status()).toBe(401);
  const res = await anon.request.post('/api/teacher/access', {
    headers: { Origin: new URL(test.info().project.use.baseURL!).origin },
    data: { requestId: crypto.randomUUID(), name: 'x', application: 'sap-erp', username: 'hack', password: 'Secret-Pass-1' },
  });
  expect(res.status()).toBe(401);
});

test('HR Management: draft blocks students, start admits them, rotation and ending revoke them', async ({ page, browser }) => {
  test.slow();
  await teacherSignIn(page);
  const username = `hr${stamp}`;
  const { id, password } = await createAccess(page, 'HR Management', username);

  const student = await studentPage(browser);
  await student.goto(`/access/${id}`);
  await expect(student.getByRole('heading', { name: 'Access is not available yet' })).toBeVisible();

  const link = await start(page);
  expect(link).toMatch(new RegExp(`/access/${id}$`));

  // Wrong password, then sign-in through the generic Student Login (username only).
  await student.goto('/student/login');
  await student.getByLabel('Username').fill(username);
  await student.getByLabel('Password', { exact: true }).fill('wrong-password');
  await student.getByRole('button', { name: 'Sign In' }).click();
  await expect(student.locator('#login-error')).toHaveText('Incorrect username or password.');
  await student.getByLabel('Password', { exact: true }).fill(password);
  await student.getByRole('button', { name: 'Sign In' }).click();
  await expect(student).toHaveURL(new RegExp(`/access/${id}/app$`));
  await expect(student.getByRole('heading', { name: 'HR Management', level: 1 })).toBeVisible();
  await expect(student.frameLocator('iframe').locator('#main')).toContainText('My Access');

  // A second student uses the same shared username and password; both stay signed in.
  const classmate = await studentPage(browser);
  await classmate.goto(`/access/${id}`);
  await classmate.getByLabel('Username').fill(username);
  await classmate.getByLabel('Password', { exact: true }).fill(password);
  await classmate.getByRole('button', { name: 'Sign In' }).click();
  await expect(classmate).toHaveURL(new RegExp(`/access/${id}/app$`));
  expect((await student.request.get(`/api/access/${id}/session`)).status()).toBe(200);
  expect((await classmate.request.get(`/api/access/${id}/session`)).status()).toBe(200);

  // Changing the credentials revokes the session.
  await page.getByRole('link', { name: 'Change credentials' }).click();
  await page.getByRole('button', { name: 'Update credentials' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Update and sign students out' }).click();
  await expect(page.getByRole('heading', { name: 'New Access Credentials' })).toBeVisible();
  const newPassword = (await page.locator('.copy-field code').nth(1).textContent())!;
  expect((await student.request.get(`/api/access/${id}/session`)).status()).toBe(401);
  expect((await classmate.request.get(`/api/access/${id}/session`)).status()).toBe(401);
  expect((await student.request.get(`/access/${id}/app/content`)).status()).toBe(401);

  // New credentials work through the access link.
  await student.goto(`/access/${id}`);
  await expect(student.getByRole('heading', { name: 'HR Management' })).toBeVisible();
  await student.getByLabel('Username').fill(username);
  await student.getByLabel('Password', { exact: true }).fill(password);
  await student.getByRole('button', { name: 'Sign In' }).click();
  await expect(student.locator('#login-error')).toHaveText('Incorrect username or password.');
  await student.getByLabel('Password', { exact: true }).fill(newPassword);
  await student.getByRole('button', { name: 'Sign In' }).click();
  await expect(student).toHaveURL(new RegExp(`/access/${id}/app$`));

  // Ending the access blocks the student immediately.
  await page.goto(`/teacher/access/${id}`);
  await page.getByRole('button', { name: 'End Access' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End Access' }).click();
  await expect(page.locator('.toasts').filter({ hasText: 'Students can no longer use it' })).toBeVisible();
  expect((await student.request.get(`/access/${id}/app/content`)).status()).toBe(401);
  await student.goto(`/access/${id}/app`);
  await expect(student.getByRole('heading', { name: 'Class is over for now.' })).toBeVisible();
  await expect(student.locator('iframe')).toHaveCount(0);
  // The access link itself no longer offers a sign-in form.
  await student.goto(`/access/${id}`);
  await expect(student.getByRole('heading', { name: 'Class is over for now.' })).toBeVisible();
  await expect(student.getByLabel('Username')).toHaveCount(0);

  // A new access for the next class gets a new link; the old link stays closed.
  const next = await createAccess(page, 'HR Management', username);
  expect(next.id).not.toBe(id);
  await start(page);
  await student.goto(`/access/${id}`);
  await expect(student.getByRole('heading', { name: 'Class is over for now.' })).toBeVisible();
  const closedLogin = await student.request.post(`/api/access/${id}/login`, {
    data: { username, password: next.password },
    headers: { origin: new URL(student.url()).origin },
  });
  expect(closedLogin.status()).toBe(403);
  expect((await closedLogin.json()).error.code).toBe('closed');
  // End the new access too so the test leaves nothing open.
  await page.getByRole('button', { name: 'End Access' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End Access' }).click();
  await expect(page.locator('.toasts').filter({ hasText: 'Students can no longer use it' })).toBeVisible();
});

test('SAP ERP: the module opens without a second login and postings persist in the database', async ({ page, browser }) => {
  test.slow();
  await teacherSignIn(page);
  const username = `sap${stamp}`;
  const { id, password } = await createAccess(page, 'SAP ERP', username, '1 hour');
  await start(page);
  await expect(page.getByText(/ends in/)).toBeVisible();

  const student = await studentPage(browser);
  const errors: string[] = [];
  student.on('pageerror', (e) => errors.push(e.message));
  await student.goto(`/access/${id}`);
  await student.getByLabel('Username').fill(username);
  await student.getByLabel('Password', { exact: true }).fill(password);
  await student.getByRole('button', { name: 'Sign In' }).click();
  await expect(student).toHaveURL(new RegExp(`/access/${id}/app$`));
  const app = student.frameLocator('iframe');
  await expect(app.locator('#fvl')).toBeVisible({ timeout: 30_000 });
  await expect(app.locator('#pw, #em, #login')).toHaveCount(0);

  // FB01: post a G/L document through the real API route.
  const today = new Date().toISOString().slice(0, 10).split('-').reverse().join('.');
  await app.locator('#cmd').fill('FB01');
  await app.locator('#cmd').press('Enter');
  await app.locator('#bldat').fill(today);
  await app.locator('#bukrs').fill('1000');
  await app.locator('#npk').fill('40');
  await app.locator('#nacc').fill('450000');
  await app.locator('#nacc').press('Enter');
  await app.locator('#amt').fill('2500');
  await app.locator('#npk').fill('50');
  await app.locator('#nacc').fill('113100');
  await app.locator('#nacc').press('Enter');
  await app.locator('#amt').fill('2500');
  await app.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(app.locator('#sbar')).toContainText(/Document \d{10} was posted in company code 1000/);
  const belnr = /Document (\d{10})/.exec((await app.locator('#sbar').textContent()) ?? '')![1];

  // Persists after a reload (read back from the database).
  await student.reload();
  await expect(app.locator('#fvl')).toBeVisible({ timeout: 30_000 });
  await app.locator('#cmd').fill('FB03');
  await app.locator('#cmd').press('Enter');
  await app.locator('#belnr').fill(belnr);
  await app.locator('#belnr').press('Enter');
  await expect(app.locator('#scr')).toContainText('2,500.00');

  // The data API rejects foreign origins and other sessions' ids.
  const forged = await student.request.post(`/api/access/${id}/erp/commit`, {
    headers: { Origin: 'https://evil.example' }, data: { requestId: crypto.randomUUID(), ops: [{ op: 'insert', t: 'GLDOC', row: {} }] },
  });
  expect(forged.status()).toBe(403);
  expect((await student.request.get(`/api/access/${crypto.randomUUID()}/erp/data`)).status()).toBe(401);

  // Teacher configuration is reflected in the module (company code name).
  if (ORG_CHANGES) {
    await page.goto('/teacher/organization');
    await page.getByLabel('Company code 1000 (Mumbai)').fill('Northwind Logistics India');
    await page.getByRole('button', { name: 'Save company code 1000' }).click();
    await expect(page.getByLabel('Company code 1000 (Mumbai)')).toHaveValue('Northwind Logistics India');
    await student.reload();
    await expect(app.locator('#fvl')).toBeVisible({ timeout: 30_000 });
    await app.locator('#cmd').fill('SE16N');
    await app.locator('#cmd').press('Enter');
    await app.locator('#tab').fill('T001');
    await app.locator('#tab').press('Enter');
    await app.getByRole('button', { name: 'Execute', exact: true }).click();
    await expect(app.locator('#scr')).toContainText('Northwind Logistics India');
  }

  // Reset workspace data (teacher) removes the posting; ending access stops the module.
  await page.goto(`/teacher/access/${id}`);
  await page.getByRole('button', { name: 'Reset Workspace Data' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset Workspace Data' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Workspace data was reset' })).toBeVisible();
  const data = await student.request.get(`/api/access/${id}/erp/data`);
  expect(data.status()).toBe(200);
  expect(JSON.stringify(await data.json())).not.toContain(belnr);

  await page.getByRole('button', { name: 'End Access' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End Access' }).click();
  await expect(page.locator('.toasts').filter({ hasText: 'Students can no longer use it' })).toBeVisible();
  expect((await student.request.get(`/api/access/${id}/erp/data`)).status()).toBe(401);
  expect(errors).toEqual([]);
});

test('dashboard lists applications and access from the database', async ({ page }) => {
  await teacherSignIn(page);
  await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
  await expect(page.locator('.app-card h3')).toHaveText(['HR Management', 'SAP ERP']);
  await page.getByRole('link', { name: 'Access Management' }).click();
  await page.getByRole('link', { name: /History/ }).click();
  await expect(page.locator('table')).toContainText(`HR Management batch ${stamp}`);
  await expect(page.locator('table')).toContainText(`SAP ERP batch ${stamp}`);
});
