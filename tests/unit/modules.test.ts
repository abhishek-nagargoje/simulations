// Checks of the integrated application modules and the registry bootstrap.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderApp, resolveApp, APP_MODULES } from '@/lib/apps/registry';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const hrms = read('modules/hr-remedy-hrms/index.html');
const sap = read('modules/sap-erp/index.html');
const crm = read('modules/zoho-crm/index.html');
const s4 = read('modules/amazon-s4hana/index.html');
const ID = '7b0c1c1e-1d2f-4a3b-9c4d-5e6f7a8b9c0d';

describe('HR Management module', () => {
  it('has no embedded login, credential hashes or bypass', () => {
    expect(hrms).not.toMatch(/id="login"/);
    expect(hrms).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(hrms).not.toMatch(/\bEH\b|\bPH\b/);
    expect(hrms).not.toContain('crypto.subtle.digest');
  });
  it('keeps its original product branding', () => {
    expect(hrms).toContain('letter-spacing:-.5px">darwinbox</b>');
    expect(hrms).toContain('title="Home">d</span>');
    expect(hrms).toContain('<title>HR Management</title>');
    expect(hrms).not.toMatch(/HR Remedy/i);
  });
  it('namespaces storage per access session and boots without a second login', () => {
    expect(hrms).toContain('const KEY="hrms_v1:"+(window.__CLASSROOM__||"standalone");');
    expect(hrms).toMatch(/authed=true;\$\("#app"\)\.style\.display="block";load\(\);go\("dash"\);\n\}\)\(\);\n<\/script>\n<\/body><\/html>\n$/);
  });
  it('uses standard downloads and exits via the platform host', () => {
    expect(hrms).not.toContain('claude.use');
    expect(hrms).toContain('a.download=name');
    expect(hrms).toContain('parent.postMessage({type:"access:exit"},location.origin)');
    expect(hrms).not.toContain('location.reload()');
  });
});

describe('SAP ERP module', () => {
  it('has no embedded login, credentials or logon flag', () => {
    expect(sap).not.toMatch(/id="login"|id="pw"|nr5_logon|sessionStorage/);
    expect(sap).not.toMatch(/\b[0-9a-f]{64}\b/);
    expect(sap).not.toContain('crypto.subtle.digest');
  });
  it('contains no embedded data set and keeps no business data in browser storage', () => {
    expect(sap).not.toMatch(/const RAW=|const HERO=|data:image\//);
    expect(sap).not.toMatch(/nr5_sap_sim|ST\.add|ST\.mod|ST\.ctr|ST\.logs|ST\.runs/);
    expect(sap).toContain("const LSK='erp_prefs:'");
    expect(sap.length).toBeLessThan(400_000);
  });
  it('loads data from and commits changes to the server', () => {
    expect(sap).toContain("fetch(API+'/data'");
    expect(sap).toContain("fetch(API+'/commit'");
    expect(sap).toContain('requestId:b.id');
  });
  it('uses the original SAP logo from the supplied file and claims no live SAP connection', () => {
    const original = /const LOGO=h=>`<svg[^`]*`;/.exec(readFileSync(join(process.cwd(), 'modules', 'sap-erp', 'source', 'SAP.html'), 'utf8'))![0];
    expect(sap).toContain(original);
    expect(sap).not.toMatch(/HR Remedy/i);
    expect(sap).not.toMatch(/sent to SAP|SAP inbox|SAP system/i);
  });
});

describe('Zoho CRM module', () => {
  it('has no embedded sign-in or hard-coded credentials', () => {
    expect(crm).not.toMatch(/id="login-|type="password"|login-form|AUTH\./);
    expect(crm).not.toMatch(/hrremedy|Ryf645/i);
  });
  it('keeps its product branding and opens directly', () => {
    expect(crm).toContain('<title>Zoho CRM</title>');
    expect(crm).toContain('const LOGO_SVG = `<svg viewBox="0 0 40 40"');
    expect(crm).toContain('<div id="app" class="app">');
    expect(crm).toContain("  AUTHED = true;\n  go('home');\n");
  });
  it('exits via the platform host', () => {
    expect(crm).toContain("parent.postMessage({ type: 'access:exit' }, location.origin)");
  });
});

describe('Amazon S/4HANA module', () => {
  it('namespaces browser storage per access session', () => {
    expect(s4).toContain("const NS = 's4:' + (window.__CLASSROOM__ || 'standalone') + ':';");
    expect(s4).toContain('localStorage.getItem(NS + k)');
    expect(s4).toContain('localStorage.setItem(NS + k,');
  });
  it('ships its data set compressed and stays below the response size limit', () => {
    expect(s4).not.toContain('const RAW = ');
    expect(s4).toContain('<script type="application/octet-stream" id="s4-data">');
    expect(s4).toContain('<script type="text/plain" id="s4-app">');
    expect(s4.length).toBeLessThan(4_000_000);
  });
  it('keeps its branding without the former notices', () => {
    expect(s4).toContain('<title>Amazon S/4HANA</title>');
    expect(s4).toContain('<b>amazon</b><span>OSCM</span>');
    expect(s4).not.toMatch(/lg-note">|Not affiliated/);
  });
});

describe('module bootstrap', () => {
  it('registers the four applications in catalogue order, all installed', () => {
    expect(Object.keys(APP_MODULES)).toEqual(['hr-remedy-hrms', 'sap-erp', 'zoho-crm', 'amazon-s4hana']);
    for (const slug of Object.keys(APP_MODULES)) expect(resolveApp(slug)?.entry).toBe(`${slug}/index.html`);
  });
  it('injects the session-derived access id and API path into <head>', () => {
    const out = renderApp(resolveApp('sap-erp')!, ID);
    expect(out).toContain(`<head><script>window.__ACCESS__={"id":"${ID}","app":"sap-erp","api":"/api/access/${ID}/erp"};window.__CLASSROOM__="${ID}";</script>`);
  });
});
