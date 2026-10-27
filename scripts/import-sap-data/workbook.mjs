// Reads and validates the SAP ERP workbook and builds the import payload.
// Pure with respect to the database: used by the CLI (dry run and apply) and by tests.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import ExcelJS from 'exceljs';
import { MAPPING_VERSION, NORMALIZATIONS, PATTERNS, RELATIONS, SHEETS, TABLE_PATTERNS } from './mapping.mjs';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function cellValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v;
    if ('result' in v) return cellValue(v.result);          // formula
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text;                          // hyperlink
    return null;
  }
  return v;
}

function isoDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function validDate(s) {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** Converts one cell to the database type. Returns { value } or { error }. */
export function convert(kind, raw) {
  const v = cellValue(raw);
  if (v === null || (typeof v === 'string' && v.trim() === '')) return { value: null };
  if (kind === 'text') {
    if (v instanceof Date) return { error: 'expected text, found a date' };
    return { value: String(v).trim() };
  }
  if (kind === 'num' || kind === 'int') {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN;
    if (!Number.isFinite(n)) return { error: 'expected a number' };
    if (kind === 'int' && !Number.isInteger(n)) return { error: 'expected a whole number' };
    return { value: n };
  }
  if (kind === 'date') {
    if (v instanceof Date) return { value: isoDate(v) };
    const s = String(v).trim();
    return validDate(s) ? { value: s } : { error: 'expected a date (YYYY-MM-DD)' };
  }
  return { error: `unknown kind ${kind}` };
}

const keyOf = (row, cols) => cols.map((c) => row[c] ?? '').join('/');

/**
 * Validates the workbook and returns the payload for erp_import_baseline.
 * report.errors lists every rejected cell or row; nothing is dropped silently.
 */
export async function buildPayload(path) {
  const bytes = readFileSync(path);
  const meta = {
    file_name: basename(path),
    file_sha256: createHash('sha256').update(bytes).digest('hex'),
    mapping_version: MAPPING_VERSION,
  };
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);

  const errors = [];
  const err = (sheet, row, column, message) => errors.push({ sheet, row, column, message });
  const rowsByCode = {};
  const normalizations = [];
  const sheetsReport = [];

  // The Read Me sheet declares each sheet's table and row count.
  const declared = new Map();
  const readme = wb.getWorksheet('Read Me');
  if (!readme) err('Read Me', null, null, 'sheet is missing');
  else {
    readme.eachRow((r, i) => {
      if (i === 1) return;
      const [sheet, table, , rows] = r.values.slice(1).map(cellValue);
      if (sheet && table && typeof rows === 'number') declared.set(String(sheet), { table: String(table), rows });
    });
  }

  for (const def of SHEETS) {
    const ws = wb.getWorksheet(def.sheet);
    const rep = { sheet: def.sheet, table: def.code, read: 0, valid: 0, invalid: 0 };
    sheetsReport.push(rep);
    if (!ws) {
      err(def.sheet, null, null, 'sheet is missing');
      continue;
    }
    const d = declared.get(def.sheet);
    if (!d) err(def.sheet, null, null, 'sheet is not listed in Read Me');
    else if (d.table !== def.code) err(def.sheet, null, null, `Read Me maps this sheet to ${d.table}, expected ${def.code}`);

    // Header: technical names in parentheses, in any order.
    const header = ws.getRow(1).values.slice(1).map((h) => {
      const m = /\(([A-Z0-9_]+)\)\s*$/.exec(String(cellValue(h) ?? ''));
      return m ? m[1] : null;
    });
    const position = new Map();
    header.forEach((name, i) => {
      if (!name) err(def.sheet, 1, i + 1, 'header has no technical field name in parentheses');
      else if (position.has(name)) err(def.sheet, 1, i + 1, `duplicate column ${name}`);
      else position.set(name, i + 1);
    });
    for (const c of def.columns) if (!position.has(c.name)) err(def.sheet, 1, null, `required column ${c.name} is missing`);
    for (const name of position.keys()) {
      if (!def.columns.some((c) => c.name === name)) err(def.sheet, 1, position.get(name), `unexpected column ${name} (not mapped)`);
    }
    if (def.columns.some((c) => !position.has(c.name))) continue;

    const out = [];
    const seen = new Map();
    ws.eachRow((r, rowNo) => {
      if (rowNo === 1) return;
      const cells = def.columns.map((c) => cellValue(r.getCell(position.get(c.name)).value));
      if (cells.every((v) => v === null || v === '')) return; // blank row
      rep.read++;
      const row = {};
      let ok = true;
      def.columns.forEach((c, i) => {
        const res = convert(c.kind, cells[i]);
        if (res.error) {
          err(def.sheet, rowNo, c.name, res.error);
          ok = false;
          return;
        }
        row[c.name] = res.value;
      });
      if (!ok) {
        rep.invalid++;
        return;
      }
      for (const c of def.required) {
        if (row[c] === null) {
          err(def.sheet, rowNo, c, 'value is required');
          ok = false;
        }
      }
      for (const [col, re] of Object.entries({ ...PATTERNS, ...(TABLE_PATTERNS[def.code] ?? {}) })) {
        if (col in row && row[col] !== null && !re.test(String(row[col]))) {
          err(def.sheet, rowNo, col, `invalid format "${row[col]}"`);
          ok = false;
        }
      }
      const key = keyOf(row, def.key);
      if (seen.has(key)) {
        err(def.sheet, rowNo, def.key.join('+'), `duplicate key ${key} (first seen in row ${seen.get(key)})`);
        ok = false;
      } else seen.set(key, rowNo);
      if (!ok) {
        rep.invalid++;
        return;
      }
      // Normalization (recorded, never silent)
      for (const c of def.columns) {
        const v = row[c.name];
        if (typeof v !== 'string') continue;
        for (const n of NORMALIZATIONS) {
          if (n.applies(def.code, c.name, v)) {
            const nv = n.apply(v, row);
            normalizations.push({ code: def.code, row_key: key, col: c.name.toLowerCase(), original: v, normalized: nv, rule: n.rule });
            row[c.name] = nv;
          }
        }
      }
      row.__row = rowNo;
      out.push(row);
      rep.valid++;
    });
    if (d && d.rows !== rep.read) err(def.sheet, null, null, `Read Me declares ${d.rows} rows, sheet has ${rep.read}`);
    rowsByCode[def.code] = out;
  }

  // Referential integrity inside the workbook.
  for (const [child, cols, parent, pcols] of RELATIONS) {
    const p = rowsByCode[parent];
    const c = rowsByCode[child];
    if (!p || !c) continue;
    const keys = new Set(p.map((r) => keyOf(r, pcols)));
    const sheet = SHEETS.find((s) => s.code === child).sheet;
    for (const r of c) {
      if (cols.some((col) => r[col] === null)) continue;
      if (!keys.has(keyOf(r, cols))) err(sheet, r.__row, cols.join('+'), `${keyOf(r, cols)} does not exist in ${parent}`);
    }
  }

  const tables = {};
  for (const def of SHEETS) {
    tables[def.code] = (rowsByCode[def.code] ?? []).map((r) => {
      const o = {};
      for (const c of def.columns) o[c.name.toLowerCase()] = r[c.name];
      return o;
    });
  }
  return {
    meta,
    payload: { tables, normalizations },
    report: { mapping_version: MAPPING_VERSION, file: meta, sheets: sheetsReport, errors, normalizations: normalizations.length },
  };
}
