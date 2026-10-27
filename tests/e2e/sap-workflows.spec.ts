// SAP ERP business workflows through the real module UI, committed to the real
// database logic (see support/sap-harness.ts). Each test checks the database.
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { SapHarness, TODAY, TODAY_DE, run, status } from './support/sap-harness';

let h: SapHarness;
const desktopOnly = (name: string) => name !== 'desktop';

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

let page: Page;
let f: FrameLocator;
let errors: string[] = [];

async function fresh(p: Page) {
  page = p;
  errors = [];
  await h.serve(page, errors);
  f = await h.open(page);
}
const fill = async (id: string, v: string) => {
  await f.locator(`#${id}`).fill(v);
};
const foot = (name: string) => f.locator('#fbtn').getByRole('button', { name, exact: true });
const tool = (title: string) => f.locator(`#tbx .tbb[title="${title}"]`);
async function expectPosted(re: RegExp) {
  await expect(status(f), h.rejections.join('\n')).toContainText(re);
  expect(errors).toEqual([]);
  return /\b(\d{10,12})\b/.exec((await status(f).textContent()) ?? '')?.[1] ?? '';
}
async function upload(trigger: () => Promise<void>, name: string, content: string) {
  const chooser = page.waitForEvent('filechooser');
  await trigger();
  await (await chooser).setFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) });
}

test('ME21N creates a purchase order and displays it with the server-assigned number', async ({ page: p }) => {
  await fresh(p);
  await run(f, 'ME21N');
  await fill('ph_lifnr', '100001');
  await f.locator('#ph_lifnr').press('Tab');
  await f.locator('input[data-i="0"][data-f="MATNR"]').fill('10000201');
  await f.locator('input[data-i="0"][data-f="MATNR"]').press('Tab');
  await f.locator('input[data-i="0"][data-f="MENGE"]').fill('25');
  await f.locator('input[data-i="0"][data-f="MENGE"]').press('Tab');
  await foot('Save').click();
  const ebeln = await expectPosted(/Standard PO created under the number \d{10}/);
  await expect(f.locator('#ttl')).toHaveText(`Standard PO ${ebeln} Display`);
  const rows = await h.q<{ menge: string; wemng: string; netwr: string; status: string }>(
    'select menge::text, wemng::text, netwr::text, status from erp.po_items where workspace_id = $1 and ebeln = $2', [h.ws, ebeln]);
  expect(rows).toEqual([{ menge: '25.000', wemng: '0.000', netwr: '950.00', status: 'Not delivered' }]);
});

test('BP creates a business partner (supplier) in the workspace', async ({ page: p }) => {
  await fresh(p);
  await run(f, 'BP');
  await tool('Organization').click();
  await fill('cn_n', 'Harbour Freight Agents');
  await fill('cn_s', 'HARBOUR');
  await fill('cn_c', 'Mumbai');
  await f.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(status(f), h.rejections.join(' | ')).toContainText(/Business partner \d{6} created/);
  const lifnr = /Business partner (\d{6})/.exec((await status(f).textContent()) ?? '')![1];
  await expect(f.locator('#ttl')).toContainText(`Organization: ${lifnr}`);
  const [v] = await h.q<{ name1: string; bukrs: string }>('select name1, bukrs from erp.vendors where workspace_id = $1 and name1 = $2', [h.ws, 'Harbour Freight Agents']);
  expect(v).toEqual({ name1: 'Harbour Freight Agents', bukrs: '1000' });
  expect(lifnr).toBeTruthy();
});

test('F-47 posts a down payment request', async ({ page: p }) => {
  await fresh(p);
  await run(f, 'F-47');
  await fill('bldat', TODAY_DE);
  await fill('bukrs', '1000');
  await fill('acct', '100001');
  await fill('waers', 'INR');
  await fill('umskz', 'F');
  await foot('New Item').click();
  await fill('amt', '15000');
  await fill('fdt', TODAY_DE);
  await foot('Post').click();
  const belnr = await expectPosted(/Document \d{10} was posted in company code 1000/);
  const [d] = await h.q<{ umskz: string; status: string; wrbtr: string }>('select umskz, status, wrbtr::text from erp.vendor_items where workspace_id = $1 and belnr = $2', [h.ws, belnr]);
  expect(d).toEqual({ umskz: 'F', status: 'Open', wrbtr: '15000.00' });
});

async function payWithClearing(kind: 'K' | 'D') {
  const table = kind === 'K' ? 'vendor_items' : 'customer_items';
  const acc = kind === 'K' ? 'lifnr' : 'kunnr';
  // An account whose open normal items net to an amount owed (vendor: credit, customer: debit).
  const [o] = await h.q<{ acct: string; bukrs: string; wrbtr: string; belnr: string }>(`
    select ${acc} acct, bukrs, abs(sum(case when shkzg = 'S' then wrbtr else -wrbtr end))::text wrbtr, min(belnr) belnr
      from erp.${table} where workspace_id = $1 and status = 'Open' and coalesce(umskz, '') = ''
     group by ${acc}, bukrs
    having sum(case when shkzg = 'S' then wrbtr else -wrbtr end) ${kind === 'K' ? '<' : '>'} 0
     limit 1`, [h.ws]);
  await run(f, 'F-53');
  await fill('bldat', TODAY_DE);
  await fill('bukrs', o.bukrs);
  await fill('waers', 'INR');
  await fill('hkont', kind === 'K' ? '113101' : '113102');
  await fill('wrbtr', o.wrbtr);
  await fill('acct', o.acct);
  await fill('koart', kind);
  await foot('Process Open Items').click();
  await foot('Post').click();
  const pay = await expectPosted(new RegExp(`Document \\d{10} was posted in company code ${o.bukrs}`));
  const [inv] = await h.q<{ status: string; augbl: string }>(`select status, augbl from erp.${table} where workspace_id = $1 and belnr = $2`, [h.ws, o.belnr]);
  expect(inv).toEqual({ status: 'Cleared', augbl: pay });
  const [pm] = await h.q<{ shkzg: string; bschl: string; status: string }>(`select shkzg, bschl, status from erp.${table} where workspace_id = $1 and belnr = $2`, [h.ws, pay]);
  return pm;
}

test('F-53 posts a vendor payment that clears the invoice', async ({ page: p }) => {
  await fresh(p);
  expect(await payWithClearing('K')).toEqual({ shkzg: 'S', bschl: '25', status: 'Cleared' });
});

test('F-53 posts a customer payment on the credit side', async ({ page: p }) => {
  await fresh(p);
  expect(await payWithClearing('D')).toEqual({ shkzg: 'H', bschl: '15', status: 'Cleared' });
});

test('FBRA resets a clearing completely', async ({ page: p }) => {
  await fresh(p);
  const [c] = await h.q<{ augbl: string; bukrs: string; n: number }>(`
    select augbl, bukrs, count(*)::int n from erp.vendor_items where workspace_id = $1 and status = 'Cleared'
     group by augbl, bukrs having count(*) >= 2 limit 1`, [h.ws]);
  await run(f, 'FBRA');
  await fill('augbl', c.augbl);
  await fill('bukrs', c.bukrs);
  await foot('Reset Cleared Items').click();
  await f.getByRole('button', { name: 'Only Resetting' }).click();
  await expectPosted(new RegExp(`Clearing ${c.augbl} reset. ${c.n} items are open again`));
  const left = await h.q('select 1 from erp.vendor_items where workspace_id = $1 and augbl = $2', [h.ws, c.augbl]);
  expect(left).toHaveLength(0);
});

test('MR8M cancels an invoice and reduces the invoiced quantity', async ({ page: p }) => {
  await fresh(p);
  const [r] = await h.q<{ belnr: string; gjahr: string; ebeln: string; remng: string; menge: string }>(`
    select i.belnr, i.gjahr, i.ebeln, p.remng::text, i.menge::text from erp.invoice_items i
      join erp.po_items p on p.workspace_id = i.workspace_id and p.ebeln = i.ebeln and p.ebelp = i.ebelp
     where i.workspace_id = $1 and i.status = 'Posted' and i.type = 'Invoice' and p.remng >= i.menge
       and (select count(*) from erp.invoice_items x where x.workspace_id = i.workspace_id and x.belnr = i.belnr) = 1 limit 1`, [h.ws]);
  await run(f, 'MR8M');
  await fill('belnr', r.belnr);
  await fill('gjahr', r.gjahr);
  await fill('stgrd', '01');
  await foot('Reverse').click();
  await expectPosted(new RegExp(`invoice ${r.belnr} cancelled`));
  const [after] = await h.q<{ status: string; remng: string }>(`
    select i.status, p.remng::text from erp.invoice_items i join erp.po_items p on p.workspace_id = i.workspace_id and p.ebeln = i.ebeln and p.ebelp = i.ebelp
     where i.workspace_id = $1 and i.belnr = $2`, [h.ws, r.belnr]);
  expect(after.status).toBe('Cancelled');
  expect(Number(after.remng)).toBeCloseTo(Number(r.remng) - Number(r.menge), 3);
});

test('MIGO cancels a goods receipt (movement type 102)', async ({ page: p }) => {
  await fresh(p);
  const [m] = await h.q<{ mblnr: string; ebeln: string; wemng: string; menge: string }>(`
    select m.mblnr, m.ebeln, p.wemng::text, m.menge::text from erp.material_doc_items m
      join erp.po_items p on p.workspace_id = m.workspace_id and p.ebeln = m.ebeln and p.ebelp = m.ebelp
     where m.workspace_id = $1 and m.status = 'Posted' and m.bwart = '101' and p.remng = 0
       and (select count(*) from erp.material_doc_items x where x.workspace_id = m.workspace_id and x.mblnr = m.mblnr) = 1 limit 1`, [h.ws]);
  await run(f, 'MIGO');
  await f.locator('#mg_a').selectOption('A03');
  await fill('mg_no', m.mblnr);
  await f.locator('#mg_no').press('Enter');
  await f.locator('input[data-ok="0"]').check();
  await foot('Post').click();
  await expectPosted(/Material document \d{10} posted/);
  const [src] = await h.q<{ status: string }>('select status from erp.material_doc_items where workspace_id = $1 and mblnr = $2', [h.ws, m.mblnr]);
  expect(src.status).toBe('Reversed');
  const [po] = await h.q<{ wemng: string }>('select wemng::text from erp.po_items where workspace_id = $1 and ebeln = $2', [h.ws, m.ebeln]);
  expect(Number(po.wemng)).toBeCloseTo(Number(m.wemng) - Number(m.menge), 3);
});

test('MR11 clears GR/IR differences automatically', async ({ page: p }) => {
  await fresh(p);
  const [{ n }] = await h.q<{ n: number }>(`select count(*)::int n from erp.po_items where workspace_id = $1 and bukrs = '1000' and wemng <> remng and grirclr is null`, [h.ws]);
  await run(f, 'MR11');
  await f.locator('input[name="mo"][value="c"]').check();
  await foot('Execute').click();
  await expectPosted(new RegExp(`Document \\d{10} was posted \\(${n} item\\(s\\) cleared\\)`));
  const [{ left }] = await h.q<{ left: number }>(`select count(*)::int left from erp.po_items where workspace_id = $1 and bukrs = '1000' and wemng <> remng and grirclr is null`, [h.ws]);
  expect(left).toBe(0);
});

test('FP06 clears contract-account items with a residual item', async ({ page: p }) => {
  await fresh(p);
  const [g] = await h.q<{ gpart: string }>(`
    select gpart from erp.fica_items where workspace_id = $1 and status = 'Open' group by gpart
    having bool_or(betrw < 0) and bool_or(betrw > 0) limit 1`, [h.ws]);
  await run(f, 'FP06');
  await fill('bp', g.gpart);
  await fill('waers', 'INR');
  await foot('Execute').click();
  await foot('Post').click();
  if (await f.getByRole('button', { name: 'Yes' }).isVisible().catch(() => false)) await f.getByRole('button', { name: 'Yes' }).click();
  const augbl = await expectPosted(/Document \d{12} posted/);
  const cleared = await h.q<{ betrw: string }>('select betrw::text from erp.fica_items where workspace_id = $1 and augbl = $2', [h.ws, augbl]);
  expect(cleared.length).toBeGreaterThan(1);
});

test('FKKBIXBIT_MON bills items and FKKINVBILL_DISP reverses the billing document', async ({ page: p }) => {
  await fresh(p);
  const [g] = await h.q<{ vkont: string }>(`select vkont from erp.billable_items where workspace_id = $1 and status = 'Not Billed' group by vkont having count(*) >= 1 limit 1`, [h.ws]);
  await run(f, 'FKKBIXBIT_MON');
  await fill('vk', g.vkont);
  await foot('Execute').click();
  await f.locator('.alvh [data-b="all"]').click();
  await f.getByRole('button', { name: 'Bill', exact: true }).click();
  await expectPosted(/billable item\(s\) billed in 1 billing document\(s\)/);
  const [bill] = await h.q<{ invdoc: string; amount: string }>(`select invdoc, amount::text from erp.billing_documents where workspace_id = $1 and vkont = $2 and billedon = $3`, [h.ws, g.vkont, TODAY]);
  const [sum] = await h.q<{ s: string }>(`select sum(bitamount)::text s from erp.billable_items where workspace_id = $1 and invdoc = $2`, [h.ws, bill.invdoc]);
  expect(sum.s).toBe(bill.amount);

  await run(f, 'FKKINVBILL_DISP');
  await fill('dn', bill.invdoc);
  await foot('Execute').click();
  await f.locator('tr[data-k]').first().dblclick();
  await tool('Reverse').click();
  await expectPosted(new RegExp(`Billing document ${bill.invdoc} reversed`));
  const [rev] = await h.q<{ status: string; n: number }>(`
    select b.status, (select count(*)::int from erp.billable_items i where i.workspace_id = b.workspace_id and i.invdoc = b.invdoc) n
      from erp.billing_documents b where b.workspace_id = $1 and b.invdoc = $2`, [h.ws, bill.invdoc]);
  expect(rev).toEqual({ status: 'Reversed', n: 0 });
});

test('FEBAN posts a bank statement item', async ({ page: p }) => {
  await fresh(p);
  await run(f, 'FEBAN');
  await f.locator('.dlg .ib.ok').click();
  const row = f.locator('tr[data-k]').first();
  const key = await row.getAttribute('data-k');
  await row.click();
  await tool('Post').click();
  await expectPosted(/Document \d{10} posted in company code/);
  const [kukey, esnum] = key!.split('/');
  const [it] = await h.q<{ bankstat: string; substat: string }>('select bankstat, substat from erp.bank_statement_items where workspace_id = $1 and kukey = $2 and esnum = $3', [h.ws, kukey, esnum]);
  expect(it).toEqual({ bankstat: 'Posted', substat: 'Cleared' });
});

test('VIM posts a DP document and a scan creates a new one without inventing a vendor', async ({ page: p }) => {
  await fresh(p);
  const [d] = await h.q<{ docid: string }>(`select docid from erp.vim_documents where workspace_id = $1 and tab = 'My Inbox' and coalesce(ebeln, '') = '' limit 1`, [h.ws]);
  await run(f, '/OPT/VIM_WP');
  await f.locator(`tr[data-k="${d.docid}"]`).dblclick();
  await tool('Post').click();
  await expectPosted(new RegExp(`DP document ${d.docid} completed - invoice reference \\d{10} assigned`));
  const [after] = await h.q<{ proc_status: string; tab: string }>('select proc_status, tab from erp.vim_documents where workspace_id = $1 and docid = $2', [h.ws, d.docid]);
  expect(after).toEqual({ proc_status: 'Posted', tab: 'My Completed' });

  await run(f, '/OPT/VIM_WP');
  await upload(() => tool('Scan').click(), 'INV-SCAN-1.pdf', '%PDF-1.4');
  const docid = await expectPosted(/DP document \d{10} created in My Inbox/);
  const [scan] = await h.q<{ lifnr: string | null; proc_status: string }>('select lifnr, proc_status from erp.vim_documents where workspace_id = $1 and xblnr = $2', [h.ws, 'INV-SCAN-1']);
  expect(scan).toEqual({ lifnr: null, proc_status: 'New' });
  expect(docid).toBeTruthy();
});

test('SWIA completes work items and keeps final ones unchanged', async ({ page: p }) => {
  await fresh(p);
  const [w] = await h.q<{ wi_id: string }>(`select wi_id from erp.work_items where workspace_id = $1 and wi_stat = 'READY' limit 1`, [h.ws]);
  await run(f, 'SWIA');
  await fill('wid', w.wi_id);
  await fill('cd', '');
  await foot('Execute').click();
  await f.locator('tr[data-k]').first().click();
  await f.getByRole('button', { name: 'Complete Manually' }).click();
  await expectPosted(/1 work item\(s\) completed manually/);
  // The item stays selected; a second attempt must not change a completed item.
  await f.getByRole('button', { name: 'Complete Manually' }).click();
  await expect(status(f)).toContainText('already completed or cancelled');
  const [after] = await h.q<{ wi_stat: string }>('select wi_stat from erp.work_items where workspace_id = $1 and wi_id = $2', [h.ws, w.wi_id]);
  expect(after.wi_stat).toBe('COMPLETED');
});

test('Z_MASS_UPLOAD validates a file, creates purchase orders and stores the log', async ({ page: p }) => {
  await fresh(p);
  const csv = 'Supplier,Company Code,Purch. Org.,Purch. Group,Material,Short Text,Quantity,Unit,Net Price,Plant,Delivery Date,Cost Center\n' +
    `100002,1000,1000,P01,10000201,Packaging carton 5-ply,40,EA,38,1000,${TODAY_DE},\n` +
    `999999,1000,1000,P01,10000201,Bad supplier,1,EA,38,1000,${TODAY_DE},\n`;
  await run(f, 'Z_MASS_UPLOAD');
  await upload(() => f.locator('#fp').press('F4'), 'po_upload.csv', csv);
  await tool('Validation Run').click();
  await expect(status(f)).toContainText('Validation finished: 1 item(s) OK, 1 error(s)');
  await f.locator('#bk').click();
  await foot('Execute').click();
  await expect(status(f), h.rejections.join('\n')).toContainText('Upload finished: 1 item(s) OK, 1 error(s)');
  const pos = await h.q(`select 1 from erp.po_items where workspace_id = $1 and txz01 = 'Packaging carton 5-ply' and menge = 40 and bedat = $2`, [h.ws, TODAY]);
  expect(pos).toHaveLength(1);
  const logs = await h.q<{ tc: string; txt: string }>('select tc, txt from erp.upload_logs where workspace_id = $1 order by seq', [h.ws]);
  expect(logs.map((l) => l.txt)).toEqual(['Validation: 1 ok, 1 errors', 'Upload: 1 ok, 1 errors']);
  expect(errors).toEqual([]);
});

test('IR upload posts invoices once per run ID', async ({ page: p }) => {
  await fresh(p);
  const [po] = await h.q<{ ebeln: string; gross: string }>(`
    select p.ebeln, round(sum((p.wemng - p.remng) * p.netpr) * 1.18, 2)::text gross from erp.po_items p
     where p.workspace_id = $1 and p.wemng > p.remng
       and not exists (select 1 from erp.po_items x where x.workspace_id = p.workspace_id and x.ebeln = p.ebeln and x.wemng <= x.remng)
     group by p.ebeln limit 1`, [h.ws]);
  const csv = `Purchase Order,Invoice Date,Reference,Gross Amount,Tax Code\n${po.ebeln},${TODAY_DE},UP-${po.ebeln.slice(-4)},${po.gross},G1\n`;
  await run(f, '/HSUD/PPO_MIROUPLOAD');
  await fill('ri', 'RUN-E2E-1');
  await upload(() => f.locator('#fp').press('F4'), 'ir.csv', csv);
  await f.locator('#tr').uncheck();
  await foot('Execute').click();
  await expect(status(f), h.rejections.join('\n')).toContainText('1 line(s) OK, 0 error(s)');
  const inv = await h.q(`select 1 from erp.invoice_items where workspace_id = $1 and ebeln = $2 and status = 'Posted' and budat = $3`, [h.ws, po.ebeln, TODAY]);
  expect(inv.length).toBeGreaterThan(0);
  await f.locator('#bk').click();
  await foot('Execute').click();
  await expect(status(f)).toContainText('Run ID RUN-E2E-1 has already been used for a productive run');
  expect(errors).toEqual([]);
});

test('FKKBIXBIT_UPLOAD creates billable items from a file', async ({ page: p }) => {
  await fresh(p);
  const [ca] = await h.q<{ vkont: string }>('select vkont from erp.contract_accounts where workspace_id = $1 limit 1', [h.ws]);
  await run(f, 'FKKBIXBIT_UPLOAD');
  await upload(() => f.locator('#src').press('F4'), 'bix.csv', `${ca.vkont};USG1;${TODAY_DE};1250;SRC-E2E\n`);
  await foot('Execute').click();
  await expect(status(f), h.rejections.join('\n')).toContainText('1 billable item(s) uploaded, 0 error(s)');
  const rows = await h.q<{ bitid: string }>(`select bitid from erp.billable_items where workspace_id = $1 and srctaid = 'SRC-E2E'`, [h.ws]);
  expect(rows[0].bitid).toMatch(/^BIT\d{8,}$/);
  expect(TODAY).toBeTruthy();
});
