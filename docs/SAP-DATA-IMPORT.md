# SAP ERP workbook import

```bash
npm run import:sap -- modules/sap-erp/source/SAP_Training_Data_500.xlsx            # validate only
npm run import:sap -- modules/sap-erp/source/SAP_Training_Data_500.xlsx --apply    # import
npm run import:sap -- <file> --report report.json                                  # full report
```

`--apply` needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (`.env.local`).
The source file is never modified; its SHA-256 and the mapping version are stored
with every import (`erp.import_runs`).

## Validation (before anything is written)

* Every sheet listed in **Read Me** exists, maps to the expected table, and has
  the declared number of rows.
* Headers carry the technical field name in parentheses; every mapped column is
  present, no unmapped column is accepted (nothing is silently dropped).
* Types: text keeps the cell text (leading zeros such as `00010` preserved),
  numbers and whole numbers are checked, dates must be real `YYYY-MM-DD` dates.
* Required fields, identifier formats (mirroring the database constraints),
  duplicate keys (including composite keys), and parent-child relationships
  within the workbook.
* Any problem → the report lists sheet, row, column and reason, and nothing is imported.

## Mapping (`scripts/import-sap-data/mapping.mjs`, version `sap-workbook-v1`)

| Sheet | Table | Key | Scope |
| --- | --- | --- | --- |
| Company Codes | `erp.company_codes` (T001) | BUKRS | organization |
| GL Accounts | `erp.gl_accounts` (SKA1) | SAKNR | organization |
| Cost Centers | `erp.cost_centers` (CSKS) | KOSTL | organization |
| Materials | `erp.materials` (MARA) | MAKTX (services have no MATNR) | organization |
| Vendors | `erp.vendors` (LFA1) | LIFNR | workspace |
| Customers | `erp.customers` (KNA1) | KUNNR | workspace |
| Vendor Documents | `erp.vendor_items` (BSIK) | BELNR | workspace |
| Customer Documents | `erp.customer_items` (BSID) | BELNR | workspace |
| Purchase Orders | `erp.po_items` (EKPO) | EBELN + EBELP | workspace |
| Goods Receipts | `erp.material_doc_items` (MSEG) | MBLNR + ZEILE | workspace |
| MIRO Invoices | `erp.invoice_items` (RBKP) | BELNR + EBELN + EBELP | workspace |
| VIM Documents | `erp.vim_documents` (VIMDP) | DOCID | workspace |
| Work Items | `erp.work_items` (SWWWIHEAD) | WI_ID | workspace |
| Contract Accounts | `erp.contract_accounts` (FKKVKP) | VKONT | workspace |
| FICA Open Items | `erp.fica_items` (DFKKOP) | OPBEL | workspace |
| Billable Items | `erp.billable_items` (DFKKBIX) | BITID | workspace |
| Billing Documents | `erp.billing_documents` (DFKKINVBILL) | INVDOC | workspace |
| Payment Lots | `erp.payment_lots` (DFKKZK) | KEYZ1 | workspace |
| Payment Lot Items | `erp.payment_lot_items` (DFKKZP) | KEYZ1 + POSZA | workspace |
| Bank Statement Items | `erp.bank_statement_items` (FEBEP) | KUKEY + ESNUM | workspace |

Column names are the technical field names in lower case. Amounts are
`numeric(15,2)`, quantities `numeric(13,3)`, dates `date`.

## Normalization (recorded in `erp.import_normalizations` with the original value)

| Rule | Change | Why |
| --- | --- | --- |
| `company-name-configurable` | Company names containing prohibited wording (e.g. "NR5 Training India Ltd - Mumbai") → "Company Code 1000 - Mumbai" | The real organization name is set by a teacher under **Organization**; later imports keep it. No legal identity is invented. |
| `user-id-neutral` | `TRAINEEnn` in entered-by/agent fields → `ERPUSERnn` | User-facing wording |

The workbook's records are sample data (`.example` e-mail domains, sample bank
details); the application does not present them as real organizations.

## Applying

`public.erp_import_baseline` runs in **one transaction**: rows are upserted by
their natural keys into the baseline workspace; unchanged rows are not touched;
nothing is deleted; any constraint violation rolls back the whole import (the
failure is recorded separately). The output shows inserted / updated /
unchanged per table, so a re-run reports zero inserts. Open posting periods are
created for the fiscal years in the data, the current and the next year.

Access sessions that already started keep their workspace; new sessions copy
the updated baseline.
