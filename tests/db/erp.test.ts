// SAP ERP data layer: workbook import, workspaces, and the transactional
// commit with its business rules — applied to the real migrations in PGlite.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { TestDb } from './harness';
// @ts-expect-error -- plain ESM module without type declarations
import { buildPayload } from '../../scripts/import-sap-data/workbook.mjs';
// @ts-expect-error -- plain ESM module without type declarations
import { SHEETS } from '../../scripts/import-sap-data/mapping.mjs';

const WORKBOOK = join(process.cwd(), 'modules', 'sap-erp', 'source', 'SAP_Training_Data_500.xlsx');

type Ops = Record<string, unknown>[];
type Payload = { meta: Record<string, string>; payload: { tables: Record<string, unknown[]>; normalizations: unknown[] } };

let db: TestDb;
let adminId: string;
let built: Payload;
let n = 0;

async function importBaseline(payload = built.payload, meta = built.meta) {
  const [row] = await db.as<{ r: { import_id: number; counts: Record<string, { rows: number; inserted: number; updated: number; unchanged: number }> } }>(
    'service_role', null, 'select public.erp_import_baseline($1, $2) as r', [payload, meta]);
  return row.r;
}

async function sapSession(start = true) {
  n += 1;
  const [{ id }] = await db.as<{ id: string }>('authenticated', adminId,
    'select public.admin_create_class($1,$2,$3,$4,$5) as id', [randomUUID(), `ERP ${n}`, 'sap-erp', `erp-user-${n}`, 'Secret-Pass-1']);
  if (start) await db.as('authenticated', adminId, 'select public.admin_start_class($1)', [id]);
  return id;
}

async function commit(classId: string, ops: Ops, requestId: string = randomUUID()) {
  const [row] = await db.as<{ r: { numbers: Record<string, string>; replayed?: boolean } }>(
    'service_role', null, 'select public.erp_commit_for_class($1, $2, $3, $4) as r', [classId, requestId, JSON.stringify(ops), 'ERPUSER01']);
  return row.r;
}

async function wsOf(classId: string) {
  const [w] = await db.admin<{ id: string }>('select id from erp.workspaces where class_id = $1', [classId]);
  return w.id;
}

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.admin<T>(sql, params))[0];
}

const TODAY = new Date().toISOString().slice(0, 10);
const fy = (d: string) => (+d.slice(5, 7) >= 4 ? +d.slice(0, 4) : +d.slice(0, 4) - 1);
const per = (d: string) => (+d.slice(5, 7) >= 4 ? +d.slice(5, 7) - 3 : +d.slice(5, 7) + 9);

function glDoc(belnr: string, lines: [string, string, number][], extra: Record<string, unknown> = {}) {
  return {
    op: 'insert', t: 'GLDOC',
    row: {
      BELNR: belnr, BUKRS: '1000', GJAHR: String(fy(TODAY)), BLART: 'SA', BLDAT: TODAY, BUDAT: TODAY, MONAT: per(TODAY),
      XBLNR: 'TEST', BKTXT: 'Test posting', WAERS: 'INR', USNAM: 'ERPUSER01', STATUS: 'Posted', STBLG: '',
      IT: lines.map(([bschl, acc, amt], i) => ({ BUZEI: String(i + 1).padStart(3, '0'), BSCHL: bschl, KOART: 'S', ACC: acc, AMT: amt, MWSKZ: '', ZUONR: '', SGTXT: 'line', KOSTL: '', UMSKZ: '', GSBER: '' })),
      ...extra,
    },
  };
}

beforeAll(async () => {
  db = await TestDb.create();
  adminId = await db.createUser('teacher@example.test');
  await db.as('service_role', null, 'select public.bootstrap_admin($1)', ['teacher@example.test']);
  built = await buildPayload(WORKBOOK);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe('workbook import', () => {
  it('validates the workbook without errors and maps every sheet', () => {
    const report = (built as unknown as { report: { errors: unknown[]; sheets: { read: number; valid: number }[] } }).report;
    expect(report.errors).toEqual([]);
    expect(report.sheets).toHaveLength(20);
    expect(report.sheets.every((s) => s.read === s.valid)).toBe(true);
  });

  it('refuses to start an SAP ERP session before the baseline is imported', async () => {
    const id = await sapSession(false);
    await expect(db.as('authenticated', adminId, 'select public.admin_start_class($1)', [id])).rejects.toThrow(/erp_baseline_missing/);
    const [{ status }] = await db.admin<{ status: string }>('select status from app.classes where id = $1', [id]);
    expect(status).toBe('draft'); // the start was rolled back as a whole
  });

  it('imports every row once and keeps types, keys and leading zeros', async () => {
    const r = await importBaseline();
    for (const s of SHEETS as { code: string }[]) {
      expect(r.counts[s.code].inserted, s.code).toBe(built.payload.tables[s.code].length);
    }
    const base = (await one<{ id: string }>(`select id from erp.workspaces where kind = 'baseline'`)).id;
    const po = await one<{ ebelp: string; menge: string; netpr: string; bedat: string }>(
      `select ebelp, menge::text, netpr::text, bedat::text from erp.po_items where workspace_id = $1 and ebeln = '7200005049'`, [base]);
    expect(po).toEqual({ ebelp: '00010', menge: '140.000', netpr: '95.25', bedat: '2026-08-17' });
    const zp = await one<{ n: number }>(`select count(*)::int n from erp.payment_lot_items where workspace_id = $1 and posza = '0001'`, [base]);
    expect(zp.n).toBe(50);
  });

  it('normalizes prohibited wording and records the original values', async () => {
    const names = await db.admin<{ butxt: string }>('select butxt from erp.company_codes order by bukrs');
    expect(names.map((x) => x.butxt)).toEqual(['Company Code 1000 - Mumbai', 'Company Code 2000 - Chennai', 'Company Code 3000 - Pune']);
    const users = await one<{ n: number }>(`select count(*)::int n from erp.vendor_items where usnam ilike 'trainee%'`);
    expect(users.n).toBe(0);
    const audit = await db.admin<{ rule: string; n: number }>(
      'select rule, count(*)::int n from erp.import_normalizations group by rule order by rule');
    expect(audit).toEqual([{ rule: 'company-name-configurable', n: 3 }, { rule: 'user-id-neutral', n: 806 }]);
    const orig = await one<{ original: string }>(`select original from erp.import_normalizations where code = 'T001' and row_key = '1000'`);
    expect(orig.original).toBe('NR5 Training India Ltd - Mumbai');
  });

  it('is idempotent: a re-run inserts and changes nothing', async () => {
    const r = await importBaseline();
    for (const [code, c] of Object.entries(r.counts)) {
      expect({ code, inserted: c.inserted, updated: c.updated }).toEqual({ code, inserted: 0, updated: 0 });
    }
    const total = await one<{ n: number }>('select count(*)::int n from erp.vendor_items');
    expect(total.n).toBe(500);
  });

  it('keeps a teacher-configured company name on re-import', async () => {
    await db.as('authenticated', adminId, 'select public.admin_update_company_code($1, $2)', ['1000', 'Acme Freight Pvt Ltd']);
    await importBaseline();
    expect((await one<{ butxt: string }>(`select butxt from erp.company_codes where bukrs = '1000'`)).butxt).toBe('Acme Freight Pvt Ltd');
  });

  it('rolls back the whole import when any row is invalid', async () => {
    const bad = structuredClone(built.payload);
    (bad.tables.LFA1[0] as Record<string, unknown>).name1 = 'Changed name';
    (bad.tables.EKPO[3] as Record<string, unknown>).menge = -5;
    const runs = (await one<{ n: number }>(`select count(*)::int n from erp.import_runs where status = 'applied'`)).n;
    await expect(importBaseline(bad)).rejects.toThrow(/check constraint/);
    expect((await one<{ name1: string }>(`select name1 from erp.vendors v join erp.workspaces w on w.id = v.workspace_id
      where w.kind = 'baseline' and lifnr = $1`, [(built.payload.tables.LFA1[0] as { lifnr: string }).lifnr])).name1).not.toBe('Changed name');
    expect((await one<{ n: number }>(`select count(*)::int n from erp.import_runs where status = 'applied'`)).n).toBe(runs);
  });
});

describe('workspaces', () => {
  it('gives each SAP ERP session its own copy of the baseline when it starts', async () => {
    const a = await sapSession();
    const counts = await db.admin<{ kind: string; n: number }>(
      `select w.kind, count(*)::int n from erp.vendor_items v join erp.workspaces w on w.id = v.workspace_id
        where w.kind = 'baseline' or w.class_id = $1 group by w.kind order by w.kind`, [a]);
    expect(counts).toEqual([{ kind: 'baseline', n: 500 }, { kind: 'session', n: 500 }]);
    const hr = await db.as<{ id: string }>('authenticated', adminId, 'select public.admin_create_class($1,$2,$3,$4,$5) as id',
      [randomUUID(), 'HR batch', 'hr-remedy-hrms', 'hr-user-1', 'Secret-Pass-1']);
    await db.as('authenticated', adminId, 'select public.admin_start_class($1)', [hr[0].id]);
    expect((await db.admin('select 1 from erp.workspaces where class_id = $1', [hr[0].id]))).toHaveLength(0);
  });

  it('ending SAP ERP access leaves an HR Management access running, and sessions do not cross', async () => {
    const sap = await sapSession();
    const [{ id: hr }] = await db.as<{ id: string }>('authenticated', adminId, 'select public.admin_create_class($1,$2,$3,$4,$5) as id',
      [randomUUID(), 'HR batch', 'hr-remedy-hrms', `hr-indep-${n}`, 'Secret-Pass-1']);
    await db.as('authenticated', adminId, 'select public.admin_start_class($1)', [hr]);
    const signIn = async (id: string, user: string) => {
      const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      const [{ r }] = await db.as<{ r: string }>('service_role', null, 'select public.student_login($1,$2,$3,$4,$5) as r',
        [id, user, 'Secret-Pass-1', randomUUID().replace(/-/g, '').padEnd(64, '0'), token]);
      expect(r).toBe('ok');
      return token;
    };
    const valid = async (id: string, token: string) =>
      (await db.as<{ valid: boolean }>('service_role', null, 'select * from public.student_validate_session($1,$2)', [id, token]))[0].valid;
    const sapToken = await signIn(sap, `erp-user-${n}`);
    const hrToken = await signIn(hr, `hr-indep-${n}`);
    await db.as('authenticated', adminId, 'select public.admin_close_class($1)', [sap]);
    expect(await valid(sap, sapToken)).toBe(false);
    expect(await valid(hr, hrToken)).toBe(true);
    expect(await valid(sap, hrToken)).toBe(false);
    expect(await valid(hr, sapToken)).toBe(false);
  });

  it('exports the workspace in the module format', async () => {
    const a = await sapSession();
    const [{ r }] = await db.as<{ r: { tables: Record<string, { c: string[]; l: string[]; r: unknown[][] }> } }>(
      'service_role', null, 'select public.erp_export_for_class($1) as r', [a]);
    expect(Object.keys(r.tables)).toHaveLength(23);
    const ekpo = r.tables.EKPO;
    const row = ekpo.r[0];
    expect(ekpo.c.slice(0, 3)).toEqual(['EBELN', 'EBELP', 'BSART']);
    expect(typeof row[ekpo.c.indexOf('MENGE')]).toBe('number');
    expect(row[ekpo.c.indexOf('BEDAT')]).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(row[ekpo.c.indexOf('KNTTP')]).toBe('');
    expect(r.tables.T001.r[0][1]).toBe('Acme Freight Pvt Ltd');
  });

  it('denies data access for sessions that are not open', async () => {
    const draft = await sapSession(false);
    await expect(db.as('service_role', null, 'select public.erp_export_for_class($1)', [draft])).rejects.toThrow(/not_authorized/);
    const closed = await sapSession();
    await db.as('authenticated', adminId, 'select public.admin_close_class($1)', [closed]);
    await expect(db.as('service_role', null, 'select public.erp_export_for_class($1)', [closed])).rejects.toThrow(/not_authorized/);
    await expect(commit(closed, [glDoc('{#FI.1#}', [['40', '450000', 10], ['50', '113100', -10]])])).rejects.toThrow(/not_authorized/);
    // Data of a closed session is retained.
    expect((await one<{ n: number }>(`select count(*)::int n from erp.vendor_items where workspace_id = $1`, [await wsOf(closed)])).n).toBe(500);
    const expired = await sapSession();
    await db.admin(`update app.classes set started_at = now() - interval '24 hours', expires_at = now() where id = $1`, [expired]);
    await expect(db.as('service_role', null, 'select public.erp_export_for_class($1)', [expired])).rejects.toThrow(/not_authorized/);
  });

  it('keeps workspaces isolated from each other', async () => {
    const a = await sapSession();
    const b = await sapSession();
    const res = await commit(a, [glDoc('{#FI.1#}', [['40', '450000', 250], ['50', '113100', -250]])]);
    const belnr = res.numbers['{#FI.1#}'];
    expect(await db.admin('select 1 from erp.gl_documents where workspace_id = $1 and belnr = $2', [await wsOf(a), belnr])).toHaveLength(1);
    expect(await db.admin('select 1 from erp.gl_documents where workspace_id = $1 and belnr = $2', [await wsOf(b), belnr])).toHaveLength(0);
    // Session B cannot change a record that only exists in A.
    await expect(commit(b, [{ op: 'update', t: 'GLDOC', key: { BELNR: belnr }, set: { BKTXT: 'hijack' } }])).rejects.toThrow(/erp_conflict/);
  });

  it('lets a teacher reset an active workspace to the baseline', async () => {
    const a = await sapSession();
    await commit(a, [glDoc('{#FI.1#}', [['40', '450000', 99], ['50', '113100', -99]])]);
    expect((await one<{ n: number }>('select count(*)::int n from erp.gl_documents where workspace_id = $1', [await wsOf(a)])).n).toBe(1);
    await db.as('authenticated', adminId, 'select public.admin_reset_workspace($1)', [a]);
    expect((await one<{ n: number }>('select count(*)::int n from erp.gl_documents where workspace_id = $1', [await wsOf(a)])).n).toBe(0);
    const outsider = await db.createUser('student@example.test');
    await expect(db.as('authenticated', outsider, 'select public.admin_reset_workspace($1)', [a])).rejects.toThrow(/not_authorized/);
  });
});

describe('postings', () => {
  let cls: string;
  let ws: string;
  beforeAll(async () => {
    cls = await sapSession();
    ws = await wsOf(cls);
  });

  it('assigns document numbers on the server and persists balanced documents', async () => {
    const r = await commit(cls, [glDoc('{#FI.1#}', [['40', '450000', 1180], ['50', '113100', -1180]])]);
    const belnr = r.numbers['{#FI.1#}'];
    expect(belnr).toBe('1900000501'); // first number after the imported vendor documents
    const lines = await db.admin<{ amt: string }>('select amt::text from erp.document_lines where workspace_id = $1 and belnr = $2 order by buzei', [ws, belnr]);
    expect(lines.map((l) => l.amt)).toEqual(['1180.00', '-1180.00']);
    const second = await commit(cls, [glDoc('{#FI.1#}', [['40', '450000', 1], ['50', '113100', -1]])]);
    expect(second.numbers['{#FI.1#}']).toBe('1900000502');
  });

  it('rejects unbalanced documents and keeps nothing of the batch', async () => {
    const before = (await one<{ n: number }>('select count(*)::int n from erp.gl_documents where workspace_id = $1', [ws])).n;
    await expect(commit(cls, [glDoc('{#FI.1#}', [['40', '450000', 100], ['50', '113100', -90]])])).rejects.toThrow(/erp_invalid/);
    await expect(commit(cls, [glDoc('{#FI.1#}', [['40', '450000', -100], ['50', '113100', 100]])])).rejects.toThrow(/erp_invalid/); // sign vs posting key
    await expect(commit(cls, [glDoc('{#FI.1#}', [['40', '999999', 100], ['50', '113100', -100]])])).rejects.toThrow(/erp_invalid/); // account
    expect((await one<{ n: number }>('select count(*)::int n from erp.gl_documents where workspace_id = $1', [ws])).n).toBe(before);
  });

  it('enforces open posting periods and the fiscal year', async () => {
    await db.as('authenticated', adminId, 'select public.admin_set_posting_period($1, $2, $3, $4)', ['1000', fy(TODAY), 1, 1]);
    const p = per(TODAY);
    if (p > 1) {
      await expect(commit(cls, [glDoc('{#FI.1#}', [['40', '450000', 5], ['50', '113100', -5]])])).rejects.toThrow(/erp_invalid/);
    }
    await db.as('authenticated', adminId, 'select public.admin_set_posting_period($1, $2, $3, $4)', ['1000', fy(TODAY), 1, 12]);
    await expect(commit(cls, [glDoc('{#FI.1#}', [['40', '450000', 5], ['50', '113100', -5]], { GJAHR: '1999' })])).rejects.toThrow(/erp_invalid/);
  });

  it('is idempotent per request id (no duplicate documents on retry)', async () => {
    const req = randomUUID();
    const ops = [glDoc('{#FI.1#}', [['40', '450000', 77], ['50', '113100', -77]])];
    const a = await commit(cls, ops, req);
    const b = await commit(cls, ops, req);
    expect(b.replayed).toBe(true);
    expect(b.numbers).toEqual(a.numbers);
    expect((await one<{ n: number }>(`select count(*)::int n from erp.gl_documents where workspace_id = $1 and xblnr = 'TEST' and belnr = $2`,
      [ws, a.numbers['{#FI.1#}']])).n).toBe(1);
  });

  it('detects concurrent changes (optimistic concurrency)', async () => {
    const doc = await one<{ belnr: string; bktxt: string }>(`select belnr, bktxt from erp.vendor_items where workspace_id = $1 order by seq limit 1`, [ws]);
    await commit(cls, [{ op: 'update', t: 'BSIK', key: { BELNR: doc.belnr }, set: { BKTXT: 'first' }, expect: { BKTXT: doc.bktxt } }]);
    await expect(commit(cls, [{ op: 'update', t: 'BSIK', key: { BELNR: doc.belnr }, set: { BKTXT: 'second' }, expect: { BKTXT: doc.bktxt } }]))
      .rejects.toThrow(/erp_conflict/);
  });

  it('allows only permitted fields and status transitions', async () => {
    const open = await one<{ belnr: string }>(`select belnr from erp.vendor_items where workspace_id = $1 and status = 'Open' and coalesce(umskz,'') = '' limit 1`, [ws]);
    await expect(commit(cls, [{ op: 'update', t: 'BSIK', key: { BELNR: open.belnr }, set: { WRBTR: 1 } }])).rejects.toThrow(/erp_invalid/);
    await expect(commit(cls, [{ op: 'update', t: 'BSIK', key: { BELNR: open.belnr }, set: { LIFNR: '100002' } }])).rejects.toThrow(/erp_invalid/);
    const rev = await one<{ belnr: string }>(`select belnr from erp.vendor_items where workspace_id = $1 and status = 'Reversed' limit 1`, [ws]);
    await expect(commit(cls, [{ op: 'update', t: 'BSIK', key: { BELNR: rev.belnr }, set: { STATUS: 'Open', STBLG: '' } }])).rejects.toThrow(/erp_invalid/);
    await expect(commit(cls, [{ op: 'insert', t: 'LFA1', row: { LIFNR: '{#LIF.1#}', NAME1: 'X', BUKRS: '1000', WAERS: 'INR', HACK: 'y' } }])).rejects.toThrow(/erp_invalid/);
    await expect(commit(cls, [{ op: 'insert', t: 'T001', row: { BUKRS: '9999', BUTXT: 'x', WAERS: 'INR' } }])).rejects.toThrow(/erp_invalid/);
  });

  it('reverses a document only together with a reversal document', async () => {
    const open = await one<{ belnr: string }>(`select belnr from erp.vendor_items where workspace_id = $1 and status = 'Open' and blart = 'KR' limit 1`, [ws]);
    await expect(commit(cls, [{ op: 'update', t: 'BSIK', key: { BELNR: open.belnr }, set: { STATUS: 'Reversed', STBLG: '{#FI.1#}', AUGBL: '{#FI.1#}', AUGDT: TODAY } }]))
      .rejects.toThrow(/erp_invalid/);
  });

  it('reconciles goods receipts with the purchase order quantity', async () => {
    const po = await one<{ ebeln: string; ebelp: string; menge: string; wemng: string }>(
      `select ebeln, ebelp, menge::text, wemng::text from erp.po_items where workspace_id = $1 and wemng = 0 and menge >= 2 limit 1`, [ws]);
    const gr = (q: number, mb = '{#MB.1#}') => ({ op: 'insert', t: 'MSEG', row: { MBLNR: mb, MJAHR: TODAY.slice(0, 4), ZEILE: '0001', BWART: '101', BLDAT: TODAY, BUDAT: TODAY,
      EBELN: po.ebeln, EBELP: po.ebelp, MATNR: '', MAKTX: 'x', MENGE: q, MEINS: 'EA', WERKS: '1000', LGORT: '0001', USNAM: 'ERPUSER01', STATUS: 'Posted' } });
    const upd = (wemng: number, prev: number) => ({ op: 'update', t: 'EKPO', key: { EBELN: po.ebeln, EBELP: po.ebelp }, set: { WEMNG: wemng, STATUS: 'Delivered' }, expect: { WEMNG: prev } });
    await expect(commit(cls, [gr(1), upd(2, 0)])).rejects.toThrow(/erp_invalid/);          // mismatch
    await expect(commit(cls, [upd(1, 0)])).rejects.toThrow(/erp_invalid/);                 // no material document
    await expect(commit(cls, [gr(+po.menge + 1), upd(+po.menge + 1, 0)])).rejects.toThrow(/po_items_gr_qty_check/); // over-delivery
    const ok = await commit(cls, [gr(1), upd(1, 0)]);
    expect(ok.numbers['{#MB.1#}']).toMatch(/^\d{10}$/);
    expect((await one<{ wemng: string }>(`select wemng::text from erp.po_items where workspace_id = $1 and ebeln = $2 and ebelp = $3`, [ws, po.ebeln, po.ebelp])).wemng).toBe('1.000');
  });

  it('validates invoice quantities and blocks duplicate invoices', async () => {
    const po = await one<{ ebeln: string; ebelp: string; lifnr: string; bukrs: string; wemng: number; remng: number; netpr: number }>(
      `select ebeln, ebelp, lifnr, bukrs, wemng::float8 wemng, remng::float8 remng, netpr::float8 netpr from erp.po_items
        where workspace_id = $1 and wemng > remng and remng = 0 limit 1`, [ws]);
    const inv = (q: number, ref: string) => ({ op: 'insert', t: 'RBKP', row: { BELNR: '{#INV.1#}', GJAHR: String(fy(TODAY)), BUKRS: po.bukrs, BLART: 'RE', TYPE: 'Invoice',
      LIFNR: po.lifnr, XBLNR: ref, BLDAT: TODAY, BUDAT: TODAY, RMWWR: 118, WMWST: 18, MWSKZ: 'G1', WAERS: 'INR', EBELN: po.ebeln, EBELP: po.ebelp,
      MENGE: q, ZTERM: 'Z030', ZLSPR: '', FIDOC: '{#FIDOC.1#}', STATUS: 'Posted', STBLG: '', SGTXT: 'x', USNAM: 'ERPUSER01' } });
    const upd = (remng: number) => ({ op: 'update', t: 'EKPO', key: { EBELN: po.ebeln, EBELP: po.ebelp }, set: { REMNG: remng }, expect: { REMNG: po.remng } });
    await expect(commit(cls, [inv(po.wemng + 1, 'INV-X1'), upd(po.wemng + 1)])).rejects.toThrow(/po_items_ir_qty_check/); // more than received
    await expect(commit(cls, [inv(1, 'INV-X1'), upd(2)])).rejects.toThrow(/erp_invalid/);                                    // quantity mismatch
    await commit(cls, [inv(1, 'INV-X1'), upd(1)]);
    const po2 = await one<{ ebeln: string; ebelp: string; remng: number }>(
      `select ebeln, ebelp, remng::float8 remng from erp.po_items where workspace_id = $1 and wemng > remng and lifnr = $2 and ebeln <> $3 limit 1`, [ws, po.lifnr, po.ebeln]);
    if (po2) {
      const dup = { ...inv(1, 'inv-x1'), row: { ...inv(1, 'inv-x1').row, EBELN: po2.ebeln, EBELP: po2.ebelp } };
      await expect(commit(cls, [dup, { op: 'update', t: 'EKPO', key: { EBELN: po2.ebeln, EBELP: po2.ebelp }, set: { REMNG: po2.remng + 1 } }]))
        .rejects.toThrow(/erp_invalid/);
    }
  });

  it('requires open-item clearings to balance', async () => {
    // An open KR invoice and an open KZ payment of the same vendor and amount.
    const pair = await one<{ inv: string; pay: string; bukrs: string; wrbtr: number }>(
      `select i.belnr inv, p.belnr pay, i.bukrs, i.wrbtr::float8 wrbtr from erp.vendor_items i
         join erp.vendor_items p on p.workspace_id = i.workspace_id and p.lifnr = i.lifnr and p.wrbtr = i.wrbtr and p.blart = 'KZ' and p.status = 'Open'
        where i.workspace_id = $1 and i.blart = 'KR' and i.status = 'Open' and i.shkzg = 'H' and p.shkzg = 'S' limit 1`, [ws]);
    const clearDoc = { op: 'insert', t: 'GLDOC', row: { BELNR: '{#CLR.1#}', BUKRS: pair.bukrs, GJAHR: String(fy(TODAY)), BLART: 'KZ', BLDAT: TODAY, BUDAT: TODAY,
      MONAT: per(TODAY), WAERS: 'INR', USNAM: 'ERPUSER01', STATUS: 'Posted', IT: [] } };
    const clear = (belnr: string) => ({ op: 'update', t: 'BSIK', key: { BELNR: belnr }, set: { STATUS: 'Cleared', AUGBL: '{#CLR.1#}', AUGDT: TODAY }, expect: { STATUS: 'Open' } });
    await expect(commit(cls, [clearDoc, clear(pair.inv)])).rejects.toThrow(/erp_invalid/); // invoice alone does not balance
    const ok = await commit(cls, [clearDoc, clear(pair.inv), clear(pair.pay)]);
    const x = ok.numbers['{#CLR.1#}'];
    expect((await db.admin<{ status: string }>(`select status from erp.vendor_items where workspace_id = $1 and augbl = $2`, [ws, x])).map((r) => r.status))
      .toEqual(['Cleared', 'Cleared']);
    // Resetting must cover every item of the clearing.
    await expect(commit(cls, [{ op: 'update', t: 'BSIK', key: { BELNR: pair.inv }, set: { STATUS: 'Open', AUGBL: '', AUGDT: '' } }]))
      .rejects.toThrow(/erp_invalid/);
    await commit(cls, [pair.inv, pair.pay].map((b) => ({ op: 'update', t: 'BSIK', key: { BELNR: b }, set: { STATUS: 'Open', AUGBL: '', AUGDT: '' } })));
  });

  it('stores upload logs and refuses a second productive run with the same run ID', async () => {
    const log = { op: 'insert', t: 'LOG', row: { ID: '{#LOG.1#}', TC: 'Z_MASS_UPLOAD', TS: '27.10.2026 10:00:00', TXT: 'Upload: 1 ok, 0 errors', FILE: 'po.csv', T: 'S' } };
    const res = await commit(cls, [log, { op: 'insert', t: 'RUNS', row: { RUNID: 'RUN-1', TS: '27.10.2026 10:00:00' } }]);
    expect(res.numbers['{#LOG.1#}']).toMatch(/^\d+$/);
    expect((await one<{ txt: string }>('select txt from erp.upload_logs where workspace_id = $1', [ws])).txt).toBe('Upload: 1 ok, 0 errors');
    await expect(commit(cls, [{ op: 'insert', t: 'RUNS', row: { RUNID: 'RUN-1', TS: 'x' } }])).rejects.toThrow(/erp_conflict/);
  });

  it('records an audit trail of applied changes', async () => {
    const rows = await db.admin<{ actor: string; n: number }>('select actor, count(*)::int n from erp.commits where workspace_id = $1 group by actor', [ws]);
    expect(rows[0].actor).toBe('ERPUSER01');
    expect(rows[0].n).toBeGreaterThan(3);
  });
});

describe('privileges', () => {
  it('exposes no ERP table or function to anon or authenticated users', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(db.as(role, adminId, 'select * from erp.vendor_items limit 1')).rejects.toThrow(/permission denied/);
      await expect(db.as(role, adminId, `select public.erp_export_for_class('${randomUUID()}')`)).rejects.toThrow(/permission denied/);
      await expect(db.as(role, adminId, `select public.erp_commit_for_class('${randomUUID()}', '${randomUUID()}', '[]', 'x')`)).rejects.toThrow(/permission denied/);
      await expect(db.as(role, adminId, `select public.erp_import_baseline('{}', '{}')`)).rejects.toThrow(/permission denied/);
    }
    await expect(db.as('anon', null, 'select public.admin_erp_overview()')).rejects.toThrow(/permission denied/);
  });

  it('mirrors the database NOT NULL columns in the import mapping', async () => {
    const rows = await db.admin<{ code: string; col: string }>(`
      select g.code, upper(i.column_name) col from erp.table_registry g
        join information_schema.columns i on i.table_schema = 'erp' and i.table_name = g.relname
       where i.is_nullable = 'NO' and i.column_name not in ('workspace_id', 'seq', 'name_configured', 'updated_at')
         and i.is_identity = 'NO' and g.code not in ('GLDOC', 'LOG', 'RUNS')`);
    for (const s of SHEETS as { code: string; required: string[] }[]) {
      const db_required = rows.filter((r) => r.code === s.code).map((r) => r.col).sort();
      expect([s.code, [...s.required].sort()]).toEqual([s.code, db_required]);
    }
  });
});
