// SAP ERP workbook import (trusted, run locally or in CI).
//
//   npm run import:sap -- <workbook.xlsx>              validate only (dry run, default)
//   npm run import:sap -- <workbook.xlsx> --apply      validate, then import
//   ... --report report.json                           also write the full report
//
// The import is repeatable and idempotent: rows are upserted by their natural
// keys into the baseline data set, unchanged rows are left alone, nothing is
// deleted, and the whole import runs in one database transaction (all or
// nothing). Workspaces of access sessions that already started are not changed;
// new sessions are created from the updated baseline.
//
// --apply needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (.env.local).
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { buildPayload } from './workbook.mjs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--report');
const apply = args.includes('--apply');
const reportPath = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;

if (!file) {
  console.error('Usage: npm run import:sap -- <workbook.xlsx> [--apply] [--report <file.json>]');
  process.exit(1);
}

const { meta, payload, report } = await buildPayload(file);

console.log(`Workbook   ${meta.file_name}`);
console.log(`SHA-256    ${meta.file_sha256}`);
console.log(`Mapping    ${meta.mapping_version}`);
console.log('');
console.log('Sheet                  Table         Read   Valid  Invalid');
for (const s of report.sheets) {
  console.log(`${s.sheet.padEnd(22)} ${s.table.padEnd(12)} ${String(s.read).padStart(5)} ${String(s.valid).padStart(7)} ${String(s.invalid).padStart(8)}`);
}
console.log('');
console.log(`Normalized values: ${report.normalizations} (recorded with their original values)`);
if (report.errors.length) {
  console.log(`\n${report.errors.length} problem(s):`);
  for (const e of report.errors.slice(0, 200)) {
    console.log(`  ${e.sheet}${e.row ? ` row ${e.row}` : ''}${e.column ? ` [${e.column}]` : ''}: ${e.message}`);
  }
  if (report.errors.length > 200) console.log(`  … ${report.errors.length - 200} more (use --report)`);
}
if (reportPath) {
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${reportPath}`);
}

if (report.errors.length) {
  console.error('\nValidation failed. Nothing was imported. Fix the workbook and run again.');
  process.exit(2);
}
if (!apply) {
  console.log('\nValidation passed. Dry run only: nothing was written. Re-run with --apply to import.');
  process.exit(0);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY (set them in .env.local).');
  process.exit(1);
}
const supabase = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supabase.rpc('erp_import_baseline', { p_payload: payload, p_meta: meta });
if (error) {
  const message = [error.message, error.details].filter(Boolean).join(' — ');
  await supabase.rpc('erp_record_import_failure', { p_meta: meta, p_error: message });
  console.error(`\nImport failed and was rolled back: ${message}`);
  process.exit(3);
}
console.log(`\nImport ${data.import_id} applied.`);
console.log('Table          Rows  Inserted  Updated  Unchanged');
for (const [code, c] of Object.entries(data.counts)) {
  console.log(`${code.padEnd(12)} ${String(c.rows).padStart(6)} ${String(c.inserted).padStart(9)} ${String(c.updated).padStart(8)} ${String(c.unchanged).padStart(10)}`);
}
