// Shared harness for SAP ERP module browser tests: the built module runs in a
// host page; its data API is served from an in-process Postgres (PGlite) with
// the real migrations and the imported workbook, using the same request
// validation and error mapping as the Next.js routes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, type FrameLocator, type Page } from '@playwright/test';
import { TestDb } from '../../db/harness';
import { commitSchema, mapErpError } from '../../../lib/erp/api';
// @ts-expect-error -- plain ESM module without type declarations
import { buildPayload } from '../../../scripts/import-sap-data/workbook.mjs';

export const ORIGIN = 'http://erp.test';
// The module works with the browser's local date (as users see it).
const now = new Date();
export const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
export const TODAY_DE = TODAY.split('-').reverse().join('.');
const MODULE = readFileSync(join(process.cwd(), 'modules', 'sap-erp', 'index.html'), 'utf8');

export type CommitMode = 'normal' | 'fail-after-commit' | 'forbidden';

export class SapHarness {
  commitCalls = 0;
  commitResponse: ((attempt: number) => CommitMode) | null = null;
  /** Error messages returned by the server for rejected commits (for diagnosis). */
  rejections: string[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  private constructor(readonly db: TestDb, readonly classId: string, readonly ws: string) {}

  static async create() {
    const db = await TestDb.create();
    const adminId = await db.createUser('teacher@example.test');
    await db.as('service_role', null, 'select public.bootstrap_admin($1)', ['teacher@example.test']);
    const { payload, meta } = await buildPayload(join(process.cwd(), 'modules', 'sap-erp', 'source', 'SAP_Training_Data_500.xlsx'));
    await db.as('service_role', null, 'select public.erp_import_baseline($1, $2)', [payload, meta]);
    const [{ id }] = await db.as<{ id: string }>('authenticated', adminId,
      'select public.admin_create_class($1,$2,$3,$4,$5) as id', [randomUUID(), 'SAP batch', 'sap-erp', `sap-${Date.now() % 1e6}`, 'Secret-Pass-1']);
    await db.as('authenticated', adminId, 'select public.admin_start_class($1)', [id]);
    const ws = (await db.admin<{ id: string }>('select id from erp.workspaces where class_id = $1', [id]))[0].id;
    return new SapHarness(db, id, ws);
  }

  /** PGlite is a single connection: database work runs one call at a time. */
  serial<T>(fn: () => Promise<T>) {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return this.serial(() => this.db.admin<T>(sql, params)) as Promise<T[]>;
  }

  reset() {
    this.commitCalls = 0;
    this.commitResponse = null;
    this.rejections = [];
  }

  async serve(page: Page, errors: string[]) {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    const api = `/api/access/${this.classId}/erp`;
    await page.route(`${ORIGIN}/**`, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.pathname === '/host') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><title>host</title><script>window.msgs=[];addEventListener('message',e=>msgs.push(e.data))</script>
<iframe id="f" src="/module" style="width:100%;height:96vh;border:0"></iframe>`,
        });
      }
      if (url.pathname === '/module') {
        const boot = `<script>window.__ACCESS__=${JSON.stringify({ id: this.classId, app: 'sap-erp', api })};</script>`;
        return route.fulfill({ contentType: 'text/html', body: MODULE.replace(/<head[^>]*>/i, (m) => m + boot) });
      }
      if (url.pathname === `${api}/data`) {
        const [row] = await this.serial(() => this.db.as<{ r: unknown }>('service_role', null, 'select public.erp_export_for_class($1) as r', [this.classId]));
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(row.r) });
      }
      if (url.pathname === `${api}/commit`) {
        this.commitCalls++;
        const parsed = commitSchema.safeParse(JSON.parse(req.postData() ?? 'null'));
        if (!parsed.success) {
          return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'validation', message: 'Invalid request.' } }) });
        }
        const mode = this.commitResponse?.(this.commitCalls) ?? 'normal';
        if (mode === 'forbidden') {
          return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'forbidden', message: 'Your access has ended.' } }) });
        }
        try {
          const [row] = await this.serial(() => this.db.as<{ r: unknown }>('service_role', null,
            'select public.erp_commit_for_class($1, $2, $3, $4) as r', [this.classId, parsed.data.requestId, JSON.stringify(parsed.data.ops), 'session:test']));
          if (mode === 'fail-after-commit') return route.fulfill({ status: 502, body: 'Bad gateway' });
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify(row.r) });
        } catch (e) {
          const m = mapErpError(e as { message: string; detail?: string; code?: string });
          this.rejections.push(`${m.status} ${m.message} [${(e as Error).message}]`);
          return route.fulfill({ status: m.status, contentType: 'application/json', body: JSON.stringify({ error: { code: m.code, message: m.message } }) });
        }
      }
      return route.fulfill({ status: 404, body: 'not found' });
    });
  }

  async open(page: Page) {
    await page.goto(`${ORIGIN}/host`);
    const f = page.frameLocator('#f');
    await expect(f.locator('#fvl')).toBeVisible({ timeout: 30_000 });
    return f;
  }
}

export async function run(f: FrameLocator, tc: string) {
  await f.locator('#cmd').fill(tc);
  await f.locator('#cmd').press('Enter');
}

export const status = (f: FrameLocator) => f.locator('#sbar');
