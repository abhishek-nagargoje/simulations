# Application modules

| Layer | Where | Holds |
| --- | --- | --- |
| Catalogue | `app.simulations` (DB, internal name) | slug, name, description, category, enabled, display order |
| Registry | `lib/apps/registry.ts` | slug → entry file, storage type |
| Module | `modules/<slug>/index.html` | Built single-file application. **Never** under `/public` |
| Sources | `modules/<slug>/source/` | Supplied originals (`SAP.html` and workbook, `zoho-crm.html`, `Amazon_S4HANA.html`), unchanged |

The content route injects `window.__ACCESS__ = { id, app, api }` (and
`window.__CLASSROOM__` for HRMS storage) from the **validated session**, so a
student cannot select another application or access through the URL. Modules
report `access:exit` (user exits) and `access:ended` (server refused access) to
the host page via `postMessage`; the host accepts messages only from its own
frame and origin.

To add an application: catalogue row in a migration, module file under
`modules/<slug>/`, an entry in the registry.

## HR Management (slug `hr-remedy-hrms`)

Built by `scripts/integrate-hrms.mjs` from its supplied source (or re-worded in
place with `--refresh`): embedded login removed, storage namespaced per access
session (`hrms_v1:<access id>`, current + two most recent kept), standard
downloads, Exit hands control to the platform, third-party names removed,
neutral wording ("Reload standard employee data" etc.). Business data stays in
the student's browser — unchanged behaviour, documented limitation.

## Zoho CRM (slug `zoho-crm`)

Built by `scripts/integrate-crm.mjs` (`npm run build:crm`) from
`modules/zoho-crm/source/zoho-crm.html`: embedded sign-in and its hard-coded
credentials removed (the CRM opens directly after the platform sign-in), Sign Out
posts `access:exit` to the host, original product mark kept, neutral wording
(features that are not connected say "… for your organization"; "Clone" is
"Duplicate"). Records live in memory and reset on reload, as supplied.

## Amazon S/4HANA (slug `amazon-s4hana`)

Built by `scripts/integrate-s4hana.mjs` (`npm run build:s4hana`) from
`modules/amazon-s4hana/source/Amazon_S4HANA.html`:

* **Size:** the 8 MB embedded data set is stored gzip-compressed (base64) and
  unpacked with `DecompressionStream` before the application script starts;
  the module is about 1.9 MB, below the 4.5 MB function response limit.
* **Storage:** postings, user and preferences stay in the browser, namespaced
  `s4:<access id>:` (current + two most recently used sessions kept).
* **Logon:** the S/4HANA logon (user ID and name, no password) is kept; it only
  attributes postings to a user. The platform sign-in is the access gate.
* **Wording:** no training/simulation/practice terms; "Simulate" is "Preview";
  former disclaimers removed, the SAP trademark notice kept.

## SAP ERP

Built by `scripts/build-sap-module.mjs` from `modules/sap-erp/source/SAP.html`
(`npm run build:sap`). Every patch must match exactly; the build stops if the
source changes shape, and refuses an output that still contains credential
hashes, the login, embedded data, the splash image or prohibited wording.

### Data layer (replaces localStorage)

1. **Load:** `GET /api/access/{id}/erp/data` → all tables of the session's
   workspace (same column/label format the module always used) plus explicit
   document line items.
2. **Change:** the module's existing `addRow` / `upd` / `nr` calls now record
   operations. All operations of one user action form one batch, sent once to
   `POST /api/access/{id}/erp/commit` with a request id.
3. **Numbers:** `nr()` returns a placeholder (`{#FI.12#}`); the database assigns
   the real number from the workspace's number range inside the transaction
   (no collisions between students sharing a workspace). The browser then
   replaces placeholders in its data and on screen.
4. **Server checks** (all in one transaction, `erp.commit`): table and field
   whitelist, types, key and foreign-key integrity, optimistic concurrency
   (`expect` values), status transitions, open posting period and fiscal year,
   balanced line items with valid accounts and posting-key signs, duplicate
   vendor invoices, clearing balance and complete clearing resets, goods-receipt
   and invoice quantities reconciled with the purchase order, FI-CA clearing
   balance, billing totals and reversal, down-payment transfers, workflow final
   states. Idempotent per request id; audited in `erp.commits`.
5. **Feedback:** while saving, input is blocked ("Saving changes…"). Success
   messages appear only after the server confirmed. A rejection undoes the
   local changes and shows the server's reason; a conflict or unknown outcome
   reloads the data from the server; ended access stops the module.
6. **Preferences** (variants, layouts, recent transactions, personal settings)
   stay in the browser under `erp_prefs:<access id>` — they are not business data.

### Isolation and retention

* Organization-wide reference data: company codes (names configurable by
  teachers), G/L accounts, cost centers, materials, posting periods.
* Workspace data: everything else, one workspace per SAP ERP access session,
  copied from the imported baseline when the access starts. Keys and foreign
  keys include the workspace, so sessions cannot read or change each other's
  rows; the workspace is derived from the session on the server.
* Students of the same access share its workspace (shared credentials cannot
  identify individuals). Extras › Reload Data shows others' changes.
* Ending/expiry revokes access; workspace data is kept. Teachers can reset an
  active workspace to the baseline (audited).

### Corrections to the supplied application

| Area | Before | After |
| --- | --- | --- |
| Login | Hard-coded SHA-256 credential check, sessionStorage flag | Removed; platform sign-in only |
| Data | 1.3 MB embedded data, changes in localStorage | PostgreSQL workspace |
| Reversals (FB08, FBL1N, FBRA) | Only marked the document | Posts a reversal document offsetting every line |
| F-53 customer payment | Stored on the debit side | Credit side (posting key 15) |
| F-53 charge-off | Difference silently lost | Use residual items (charge-off not offered there) |
| Residual items | Kept the original period | Period/fiscal year of their own posting date |
| Fiscal year | Hard-coded 2026 | Derived from the posting date |
| G/L open-item status | Derived from document-number digits | From the document (reversed / open) |
| Cancelled invoices | No offsetting G/L lines | Cancellation lines in the G/L views |
| VIM scan | Assigned a random vendor | Vendor left empty for data entry |
| Background jobs, attachments, notes, hold, team settings | Reported success without effect | "Not available in this configuration" |
| Re-render while typing (MIRO/MIGO/ME21N) | Script error "node to be removed is no longer a child" | Guarded |
| Branding | SAP logo imitation and SAP GUI splash image | Product name with a neutral icon and background (no approved SAP logo asset supplied); SAP transaction names kept as functional references |
| Wording | Training/practice/simulation terms | Neutral ("Work Queue", "Data Overview", "Preview", "Validation Run") |

### Verified workflows

`tests/e2e/sap-erp.spec.ts` and `tests/e2e/sap-workflows.spec.ts` drive the real
module UI against the real database logic: every favorite transaction opens
without errors; FB01, FB03/FB02 (conflict), MIGO receipt and cancellation, MIRO,
MR8M, MR11, F-44, F-47, F-53 (vendor and customer), FB08, FBRA, ME21N, BP,
FP06, FKKBIXBIT_MON + FKKINVBILL_DISP reversal, FEBAN, VIM post and scan, SWIA,
Z_MASS_UPLOAD (validation run + upload + logs), IR upload (run ID once),
FKKBIXBIT_UPLOAD; rejected postings roll back; a lost response is retried
without a duplicate; ended access stops the module.

### Known limitations

* The module's own screens are keyboard-operable as in the original but use
  `div`/`span` controls in places; full screen-reader support would require
  rewriting the UI.
* Reports are computed in the browser from the workspace data (as before).
* Not every SAP behaviour is modelled (e.g. tax determination, payment runs);
  unsupported functions say so.
