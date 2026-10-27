// Functional checks of the integrated HR Management module. It is served exactly
// as the protected content route serves it (same <head> bootstrap), inside an
// iframe on a host page, so these tests need no Supabase configuration.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const ORIGIN = 'http://hrms.test';
const SOURCE = readFileSync(join(process.cwd(), 'modules', 'hr-remedy-hrms', 'index.html'), 'utf8');

function moduleHtml(access: string) {
  const boot = `<script>window.__ACCESS__=${JSON.stringify({ id: access, app: 'hr-remedy-hrms', api: `/api/access/${access}/erp` })};window.__CLASSROOM__=${JSON.stringify(access)};</script>`;
  return SOURCE.replace(/<head[^>]*>/i, (m) => m + boot);
}

async function serve(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept('1200000'));
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/host') {
      return route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>host</title><script>window.msgs=[];addEventListener('message',e=>msgs.push({origin:e.origin,data:e.data}))</script>
<iframe id="f" src="/sim/${url.searchParams.get('c')}" style="width:100%;height:95vh;border:0"></iframe>`,
      });
    }
    const classroom = url.pathname.split('/')[2] ?? 'x';
    return route.fulfill({ contentType: 'text/html', body: moduleHtml(classroom) });
  });
}

async function openSim(page: Page, classroom: string) {
  await page.goto(`${ORIGIN}/host?c=${classroom}`);
  const frame = page.frameLocator('#f');
  await expect(frame.locator('#top')).toContainText('HR Management');
  return frame;
}

test.describe('HR Management module', () => {
  test('opens without a second login and exposes no embedded credentials', async ({ page }) => {
    const errors: string[] = [];
    await serve(page, errors);
    const sim = await openSim(page, 'class-a');
    await expect(sim.locator('#login, #lf, #pw, #em')).toHaveCount(0);
    await expect(sim.locator('#main')).toContainText('My Access');
    await expect(sim.locator('body')).not.toContainText(/darwin/i);
    const keys = await page.frames()[1].evaluate(() => Object.keys(localStorage).sort());
    expect(keys).toEqual(['hrms_v1:__index', 'hrms_v1:class-a']);
    expect(errors).toEqual([]);
  });

  test('core HR workflows work through the real UI', async ({ page }) => {
    test.slow();
    const errors: string[] = [];
    await serve(page, errors);
    const sim = await openSim(page, 'class-wf');
    const frame = page.frames()[1];
    const home = () => sim.getByRole('link', { name: '‹ My Access' }).click();

    // Employee management: add an employee through the form
    const before = await frame.evaluate(() => S.emps.length);
    await sim.getByRole('button', { name: 'Employees', exact: true }).click();
    const form = sim.locator('form[onsubmit="addEmp(event)"]');
    for (const el of await form.locator('input, select').all()) {
      const tag = await el.evaluate((e) => e.tagName);
      const type = await el.getAttribute('type');
      if (tag === 'SELECT') await el.selectOption({ index: 1 });
      else if (type === 'date') await el.fill('2026-01-15');
      else if (type === 'number') await el.fill('650000');
      else if (type === 'email') await el.fill('trainee@example.test');
      else await el.fill('Training Trainee');
    }
    await sim.getByRole('button', { name: 'Add employee' }).click();
    await expect(sim.locator('#toast')).toContainText('Employee added');
    expect(await frame.evaluate(() => S.emps.length)).toBe(before + 1);

    // Export: employee CSV download uses a standard browser download
    const csv = page.waitForEvent('download');
    await sim.getByRole('button', { name: 'Download CSV' }).first().click();
    expect((await csv).suggestedFilename()).toMatch(/\.csv$/);

    // Recruitment, attendance, leave, payroll, performance, documents, reports
    const visits: [string, string, string][] = [
      ['Recruitment', 'Candidates', 'Candidates'],
      ['Attendance', 'REGULARIZE', 'Attendance Request'],
      ['Leave', 'APPLY', 'Leave'],
      ['Payroll', 'CTC CALCULATOR', 'CTC'],
      ['Performance', 'Goal Plan', 'Goal'],
      ['HR Documents', 'Generate Letter', 'Letter'],
    ];
    for (const [tile, action, expected] of visits) {
      await home();
      await sim.getByRole('button', { name: tile, exact: true }).first().click(); // home tile
      // Module tabs in the source file are <a>/<span> without href, so target them by visible text.
      await sim.locator('#main').getByText(action, { exact: true }).first().click();
      await expect(sim.locator('#main'), `${tile} › ${action}`).toContainText(expected);
      // Some actions open an in-app modal; close it the way a user would.
      const modal = sim.locator('.mdl');
      if (await modal.count()) await modal.getByText('✕').first().click();
      await expect(modal).toHaveCount(0);
    }

    await home();
    await sim.getByRole('button', { name: 'Reports', exact: true }).click();
    const report = page.waitForEvent('download');
    await sim.getByRole('button', { name: 'Payroll register' }).click();
    expect((await report).suggestedFilename()).toMatch(/\.csv$/);

    expect(errors).toEqual([]);
  });

  test('every module view renders without script errors', async ({ page }) => {
    const errors: string[] = [];
    await serve(page, errors);
    await openSim(page, 'class-views');
    const frame = page.frames()[1];
    const views = await frame.evaluate(() => Object.keys(VIEWS));
    expect(views.length).toBeGreaterThan(20);
    for (const v of views) {
      await frame.evaluate((k) => go(k), v);
      expect(await frame.locator('#main').innerText(), v).not.toBe('');
    }
    expect(errors).toEqual([]);
  });

  test('state is isolated per access session and survives reloads', async ({ page }) => {
    const errors: string[] = [];
    await serve(page, errors);
    await openSim(page, 'class-a');
    await page.frames()[1].evaluate(() => { S.emps[0].name = 'Isolation Marker'; save(); });

    await page.reload();
    await openSim(page, 'class-a');
    expect(await page.frames()[1].evaluate(() => S.emps[0].name)).toBe('Isolation Marker');

    await openSim(page, 'class-b');
    expect(await page.frames()[1].evaluate(() => S.emps[0].name)).not.toBe('Isolation Marker');

    await openSim(page, 'class-a');
    expect(await page.frames()[1].evaluate(() => S.emps[0].name)).toBe('Isolation Marker');
    expect(errors).toEqual([]);
  });

  test('keeps the current access session plus the two most recent others', async ({ page }) => {
    await serve(page, []);
    for (const c of ['c1', 'c2', 'c3', 'c4']) await openSim(page, c);
    const keys = await page.frames()[1].evaluate(() => Object.keys(localStorage).filter((k) => k !== 'hrms_v1:__index').sort());
    expect(keys).toEqual(['hrms_v1:c2', 'hrms_v1:c3', 'hrms_v1:c4']);
  });

  test('"Exit" asks the platform host to sign out', async ({ page }) => {
    await serve(page, []);
    await openSim(page, 'class-exit');
    await page.frames()[1].evaluate(() => hrmsExit());
    await expect.poll(() => page.evaluate(() => (window as unknown as { msgs: unknown[] }).msgs)).toEqual([
      { origin: ORIGIN, data: { type: 'access:exit' } },
    ]);
  });
});

declare global {
  // Globals defined by the simulation file (classic-script lexical globals).
  const S: { emps: { name: string }[] };
  const VIEWS: Record<string, () => string>;
  function go(view: string): void;
  function save(): void;
  function hrmsExit(): void;
}
