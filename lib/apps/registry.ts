// Application registry: maps a catalogue slug (app.simulations.slug) to the
// module that implements it. To add an application:
//   1. add a catalogue row in a new migration,
//   2. put its private entry file under /modules/<slug>/,
//   3. register it below.
// Authentication and access management need no changes.
import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type AppModule = {
  slug: string;
  /** Single-file HTML module served into the host page. */
  type: 'html';
  /** Entry file relative to /modules — never under /public. */
  entry: string;
  /** Business data is stored in the database (SAP ERP) or in the browser (HRMS). */
  storage: 'database' | 'browser';
};

export const APP_MODULES: Record<string, AppModule> = {
  'hr-remedy-hrms': { slug: 'hr-remedy-hrms', type: 'html', entry: 'hr-remedy-hrms/index.html', storage: 'browser' },
  'sap-erp': { slug: 'sap-erp', type: 'html', entry: 'sap-erp/index.html', storage: 'database' },
};

const MODULES_DIR = join(process.cwd(), 'modules');

/** The module for a slug, only if its content is actually installed. */
export function resolveApp(slug: string): AppModule | null {
  const mod = Object.hasOwn(APP_MODULES, slug) ? APP_MODULES[slug] : null;
  if (!mod) return null;
  return existsSync(join(MODULES_DIR, mod.entry)) ? mod : null;
}

/**
 * Returns the entry HTML with a bootstrap telling the module which access
 * session it runs in and where its data API is. Both values come from the
 * server-validated session, never from the URL.
 */
export function renderApp(mod: AppModule, accessId: string): string {
  const html = readFileSync(join(MODULES_DIR, mod.entry), 'utf8');
  const access = { id: accessId, app: mod.slug, api: `/api/access/${accessId}/erp` };
  // __CLASSROOM__ namespaces the HRMS module's browser storage per access session.
  const boot = `<script>window.__ACCESS__=${JSON.stringify(access)};window.__CLASSROOM__=${JSON.stringify(accessId)};</script>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}${boot}`) : boot + html;
}
