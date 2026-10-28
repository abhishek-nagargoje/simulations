// User-facing wording audit. The applications must not carry the former HR Remedy
// branding or present themselves as training, simulation, demo, practice, prototype, mock or clone environments.
// Scans every source file that renders user-visible text, the built modules
// and the public metadata.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// "Train" (a mode of travel) is allowed; JavaScript's ".prototype" is code, not wording.
const PROHIBITED = /\b(hr remedy|training|trainee\w*|simulat\w*|demo|demos|practi[cs]e|(?<!\.)prototype|mock(?:ed|s)?|clone[sd]?|dummy)\b/i;

function files(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

const root = process.cwd();
const UI_SOURCES = [
  ...files(join(root, 'app'), ['.tsx', '.ts', '.css', '.svg']),
  ...files(join(root, 'components'), ['.tsx', '.ts']),
  join(root, 'lib', 'domain.ts'),
  join(root, 'lib', 'http.ts'),
  join(root, 'lib', 'access-login.ts'),
  join(root, 'lib', 'erp', 'api.ts'),
  join(root, 'lib', 'erp', 'guard.ts'),
  join(root, 'modules', 'hr-remedy-hrms', 'index.html'),
  join(root, 'modules', 'sap-erp', 'index.html'),
  join(root, 'modules', 'zoho-crm', 'index.html'),
  join(root, 'modules', 'amazon-s4hana', 'index.html'),
];

describe('prohibited wording', () => {
  for (const file of UI_SOURCES) {
    it(`is absent from ${relative(root, file)}`, () => {
      const text = readFileSync(file, 'utf8');
      const lines = text.split('\n');
      const hits = lines
        .map((l, i) => [i + 1, l.match(PROHIBITED)?.[0]] as const)
        .filter(([, m]) => m)
        .map(([n, m]) => `line ${n}: ${m}`);
      expect(hits).toEqual([]);
    });
  }

  it('is absent from the catalogue entries offered to teachers', () => {
    const sql = readFileSync(join(root, 'supabase', 'migrations', '20261027000100_access_management.sql'), 'utf8');
    const offered = [...sql.matchAll(/values \('sap-erp', '([^']+)',\s*'([^']+)'/g)].flatMap((m) => [m[1], m[2]]);
    const hrms = /set description = '([^']+)'/.exec(sql)?.[1] ?? '';
    for (const text of [...offered, hrms]) expect(text).not.toMatch(PROHIBITED);
    const added = readFileSync(join(root, 'supabase', 'migrations', '20261028000100_crm_and_s4hana.sql'), 'utf8');
    const rows = [...added.matchAll(/\('(?:zoho-crm|amazon-s4hana)', '([^']+)',\s*'([^']+)'/g)].flatMap((m) => [m[1], m[2]]);
    expect(rows).toHaveLength(4);
    for (const text of rows) expect(text).not.toMatch(PROHIBITED);
  });
});
