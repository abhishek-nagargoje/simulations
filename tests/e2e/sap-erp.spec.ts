// End-to-end checks of the integrated SAP ERP module against the real database
// logic (see support/sap-harness.ts). No Supabase project is needed.
import { expect, test, type FrameLocator } from '@playwright/test';
import { SapHarness, TODAY, run, status } from './support/sap-harness';

let h: SapHarness;
const desktopOnly = (name: string) => name !== 'desktop';
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({}, info) => {
  if (desktopOnly(info.project.name)) return;
  test.setTimeout(180_000);
  h = await SapHarness.create();
});

test.afterAll(async () => {
  await h?.db.close();
});

test.beforeEach(({}, info) => {
  test.skip(desktopOnly(info.project.name), 'desktop layout only');
  h.reset();
});

test('opens directly from the database without a second login or embedded data', async ({ page }) => {
  const errors: string[] = [];
  await h.serve(page, errors);
  const f = await h.open(page);
  await expect(f.locator('#login, #pw, #em')).toHaveCount(0);
  await expect(f.locator('#ttl')).toHaveText('Easy Access');
  await expect(f.locator('body')).not.toContainText(/training|simulat|practice|demo/i);
  // Data comes from the workspace: a vendor renamed in the database is shown.
  await h.q(`update erp.vendors set name1 = 'Workspace Vendor Check' where workspace_id = $1 and lifnr = '100001'`, [h.ws]);
  await page.reload();
  await expect(f.locator('#fvl')).toBeVisible();
  await run(f, 'XK03');
  await f.locator('#vn').fill('100001');
  await f.locator('#x1').check();
  await f.locator('#vn').press('Enter');
  await expect(f.locator('#sv0')).toHaveValue('Workspace Vendor Check');
  const prefs = await page.frames()[1].evaluate(() => Object.keys(localStorage));
  expect(prefs.every((k) => k.startsWith('erp_prefs:'))).toBe(true);
  expect(errors).toEqual([]);
});

test('every favorite transaction opens without script errors', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  await h.serve(page, errors);
  const f = await h.open(page);
  const codes = await page.frames()[1].evaluate(() => (window as unknown as { FAV?: string[][] }).FAV?.map((x) => x[0]) ??
    [...document.querySelectorAll('#fvl .it')].map((e) => (e as HTMLElement).dataset.c!));
  expect(codes.length).toBeGreaterThan(40);
  for (const tc of codes) {
    await run(f, tc);
    await expect(f.locator('#ttl'), tc).not.toHaveText('Easy Access');
    // Some transactions start with a selection dialog; cancel it like a user would.
    while (await f.locator('.ov').count()) await f.locator('.ov .x').last().click();
    await f.locator('#exit').click();
    await expect(f.locator('#ttl')).toHaveText('Easy Access');
  }
  expect(errors).toEqual([]);
});

async function postGl(f: FrameLocator, amount: string) {
  await run(f, 'FB01');
  await f.locator('#bldat').fill(TODAY.split('-').reverse().join('.'));
  await f.locator('#bukrs').fill('1000');
  await f.locator('#npk').fill('40');
  await f.locator('#nacc').fill('450000');
  await f.locator('#nacc').press('Enter');
  await f.locator('#amt').fill(amount);
  await f.locator('#npk').fill('50');
  await f.locator('#nacc').fill('113100');
  await f.locator('#nacc').press('Enter');
  await f.locator('#amt').fill(amount);
  await f.getByRole('button', { name: 'Post', exact: true }).click();
}

test('posts a G/L document that persists in the database and after reload', async ({ page }) => {
  const errors: string[] = [];
  await h.serve(page, errors);
  const f = await h.open(page);
  await postGl(f, '1234.50');
  await expect(status(f)).toContainText(/Document \d{10} was posted in company code 1000/);
  const belnr = /Document (\d{10})/.exec((await status(f).textContent()) ?? '')![1];
  const lines = await h.q<{ amt: string; acc: string }>(
    'select acc, amt::text from erp.document_lines where workspace_id = $1 and belnr = $2 order by buzei', [h.ws, belnr]);
  expect(lines).toEqual([{ acc: '450000', amt: '1234.50' }, { acc: '113100', amt: '-1234.50' }]);
  await page.reload();
  await expect(f.locator('#fvl')).toBeVisible();
  await run(f, 'FB03');
  await f.locator('#belnr').fill(belnr);
  await f.locator('#belnr').press('Enter');
  await expect(f.locator('#scr')).toContainText('1,234.50');
  expect(errors).toEqual([]);
});

test('a rejected posting is rolled back with an accurate message', async ({ page }) => {
  const errors: string[] = [];
  await h.serve(page, errors);
  const f = await h.open(page);
  const fy = +TODAY.slice(5, 7) >= 4 ? +TODAY.slice(0, 4) : +TODAY.slice(0, 4) - 1;
  const before = (await h.q<{ n: number }>('select count(*)::int n from erp.gl_documents where workspace_id = $1', [h.ws]))[0].n;
  await h.q(`update erp.posting_periods set from_period = 13 - 1, to_period = 12 where bukrs = '1000' and fiscal_year = $1`, [fy]);
  try {
    const per = +TODAY.slice(5, 7) >= 4 ? +TODAY.slice(5, 7) - 3 : +TODAY.slice(5, 7) + 9;
    test.skip(per === 12, 'current period is the only open one');
    await postGl(f, '50');
    await expect(status(f)).toContainText(/Changes could not be saved: Posting period \d{3}\/\d{4} is not open for company code 1000/);
    await expect(status(f)).not.toContainText('was posted');
    expect((await h.q<{ n: number }>('select count(*)::int n from erp.gl_documents where workspace_id = $1', [h.ws]))[0].n).toBe(before);
    // Nothing of the rejected batch is left behind in the browser either.
    // The number range was not advanced (the whole transaction was rolled back).
    const [next] = await h.q<{ v: string }>(`select next_value::text v from erp.number_ranges where workspace_id = $1 and name = 'fi'`, [h.ws]);
    await run(f, 'FB03');
    await f.locator('#belnr').fill(next.v);
    await f.locator('#belnr').press('Enter');
    await expect(status(f)).toContainText('does not exist');
    expect(await page.frames()[1].evaluate(() => document.body.innerText.includes('{#'))).toBe(false);
  } finally {
    await h.q(`update erp.posting_periods set from_period = 1, to_period = 12 where bukrs = '1000' and fiscal_year = $1`, [fy]);
  }
  expect(errors).toEqual([]);
});

test('a lost response is retried without creating a duplicate document', async ({ page }) => {
  await h.serve(page, []);
  const f = await h.open(page);
  const before = (await h.q<{ n: number }>('select count(*)::int n from erp.gl_documents where workspace_id = $1', [h.ws]))[0].n;
  h.commitResponse = (attempt) => (attempt === 1 ? 'fail-after-commit' : 'normal');
  await postGl(f, '321');
  await expect(status(f)).toContainText(/Document \d{10} was posted/);
  expect(h.commitCalls).toBe(2);
  expect((await h.q<{ n: number }>('select count(*)::int n from erp.gl_documents where workspace_id = $1', [h.ws]))[0].n).toBe(before + 1);
});

test('goods receipt and invoice update the purchase order in the database', async ({ page }) => {
  const errors: string[] = [];
  await h.serve(page, errors);
  const f = await h.open(page);
  // A purchase order whose only item has no goods receipt yet.
  const [po] = await h.q<{ ebeln: string; menge: string; bukrs: string }>(
    `select ebeln, menge::text, bukrs from erp.po_items p where workspace_id = $1 and wemng = 0
       and (select count(*) from erp.po_items x where x.workspace_id = p.workspace_id and x.ebeln = p.ebeln) = 1 limit 1`, [h.ws]);
  await run(f, 'MIGO');
  await f.locator('#mg_no').fill(po.ebeln);
  await f.locator('#mg_no').press('Enter');
  await f.locator('input[data-ok="0"]').check();
  await f.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(status(f)).toContainText(/Material document \d{10} posted/);
  const [after] = await h.q<{ wemng: string; status: string }>('select wemng::text, status from erp.po_items where workspace_id = $1 and ebeln = $2', [h.ws, po.ebeln]);
  expect(after).toEqual({ wemng: po.menge, status: 'Delivered' });

  await run(f, 'MIRO');
  await f.locator('#cc_v').fill(po.bukrs);
  await f.locator('#cc_v').press('Enter');
  await f.locator('#mr_bldat').fill(TODAY.split('-').reverse().join('.'));
  await f.locator('#mr_po').fill(po.ebeln);
  await f.locator('#mr_po').press('Enter');
  await expect(status(f)).toContainText('proposed');
  const balance = await f.locator('input.num[readonly]').first().inputValue();
  await f.locator('#mr_amt').fill(balance.replace(/[,-]/g, ''));
  await f.locator('#mr_amt').press('Tab');
  await f.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(status(f)).toContainText(/Document no\. \d{10} created/);
  const [inv] = await h.q<{ remng: string; status: string }>('select remng::text, status from erp.po_items where workspace_id = $1 and ebeln = $2', [h.ws, po.ebeln]);
  expect(inv).toEqual({ remng: po.menge, status: 'Invoiced' });
  expect(errors).toEqual([]);
});

test('clearing and reversal post balanced documents', async ({ page }) => {
  const errors: string[] = [];
  await h.serve(page, errors);
  const f = await h.open(page);
  // A vendor whose only open normal items are one invoice and one payment of the same amount.
  const [v] = await h.q<{ lifnr: string; bukrs: string }>(`
    select i.lifnr, i.bukrs from erp.vendor_items i
      join erp.vendor_items p on p.workspace_id = i.workspace_id and p.lifnr = i.lifnr and p.bukrs = i.bukrs and p.wrbtr = i.wrbtr
                              and p.blart = 'KZ' and p.status = 'Open' and p.shkzg = 'S'
     where i.workspace_id = $1 and i.blart = 'KR' and i.status = 'Open' and i.shkzg = 'H'
       and (select count(*) from erp.vendor_items o where o.workspace_id = i.workspace_id and o.lifnr = i.lifnr and o.bukrs = i.bukrs
              and o.status = 'Open' and o.umskz is null) = 2
     limit 1`, [h.ws]);
  await run(f, 'F-44');
  await f.locator('#acct').fill(v.lifnr);
  await f.locator('#bukrs').fill(v.bukrs);
  await f.locator('#acct').press('Enter');
  await f.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(status(f)).toContainText(/Document \d{10} was posted/);
  const cleared = await h.q<{ status: string }>(`select status from erp.vendor_items where workspace_id = $1 and lifnr = $2 and bukrs = $3 and umskz is null and augdt = $4`, [h.ws, v.lifnr, v.bukrs, TODAY]);
  expect(cleared.map((r) => r.status)).toEqual(['Cleared', 'Cleared']);

  const [inv] = await h.q<{ belnr: string; bukrs: string; gjahr: string }>(
    `select belnr, bukrs, gjahr from erp.vendor_items where workspace_id = $1 and status = 'Open' and blart = 'KR' limit 1`, [h.ws]);
  await run(f, 'FB08');
  await f.locator('#belnr').fill(inv.belnr);
  await f.locator('#bukrs').fill(inv.bukrs);
  await f.locator('#gjahr').fill(inv.gjahr);
  await f.locator('#stgrd').fill('01');
  await f.getByRole('button', { name: 'Reverse', exact: true }).click();
  await expect(status(f)).toContainText(/Document \d{10} was posted/);
  const [rev] = await h.q<{ status: string; stblg: string }>('select status, stblg from erp.vendor_items where workspace_id = $1 and belnr = $2', [h.ws, inv.belnr]);
  expect(rev.status).toBe('Reversed');
  const [sum] = await h.q<{ n: number; s: string }>('select count(*)::int n, sum(amt)::text s from erp.document_lines where workspace_id = $1 and belnr = $2', [h.ws, rev.stblg]);
  expect(sum.n).toBeGreaterThanOrEqual(2);
  expect(sum.s).toBe('0.00');
  expect(errors).toEqual([]);
});

test('a change made meanwhile by another user is detected and the data reloaded', async ({ page }) => {
  await h.serve(page, []);
  const f = await h.open(page);
  const [doc] = await h.q<{ belnr: string; bukrs: string; gjahr: string }>(
    `select belnr, bukrs, gjahr from erp.vendor_items where workspace_id = $1 and status = 'Open' limit 1`, [h.ws]);
  await run(f, 'FB02');
  await f.locator('#belnr').fill(doc.belnr);
  await f.locator('#bukrs').fill(doc.bukrs);
  await f.locator('#gjahr').fill(doc.gjahr);
  await f.locator('#belnr').press('Enter');
  await h.q(`update erp.vendor_items set bktxt = 'Changed elsewhere' where workspace_id = $1 and belnr = $2`, [h.ws, doc.belnr]);
  await f.locator('#dh_t').fill('My change');
  await f.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(status(f)).toContainText('was changed by another user');
  expect((await h.q<{ bktxt: string }>('select bktxt from erp.vendor_items where workspace_id = $1 and belnr = $2', [h.ws, doc.belnr]))[0].bktxt)
    .toBe('Changed elsewhere');
});

test('ended access stops the module and notifies the host', async ({ page }) => {
  await h.serve(page, []);
  const f = await h.open(page);
  h.commitResponse = () => 'forbidden';
  await postGl(f, '10');
  await expect(f.locator('#scr')).toContainText('Your access to this application has ended.');
  const msgs = await page.evaluate(() => (window as unknown as { msgs: { type: string }[] }).msgs.map((m) => m.type));
  expect(msgs).toContain('access:ended');
});

test('log off hands control back to the platform', async ({ page }) => {
  await h.serve(page, []);
  const f = await h.open(page);
  await f.locator('#mnu').click();
  await f.locator('.pop div', { hasText: 'System' }).hover();
  await f.locator('.pop div', { hasText: 'Log Off' }).last().click();
  await f.getByRole('button', { name: 'Yes' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { msgs: { type: string }[] }).msgs.map((m) => m.type))).toContain('access:exit');
});
