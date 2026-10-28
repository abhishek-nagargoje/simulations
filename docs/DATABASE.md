# Database

Migrations (apply in filename order; all are forward-only and safe to re-run). Internal
names (`classes`, `simulations`) predate the user-facing terms "access" and "application".

| File | Purpose |
| --- | --- |
| `20261026000100_training_platform.sql` | Schema `app`, tables, constraints, RLS, functions and grants, initial catalogue |
| `20261026000200_hr_remedy_hrms.sql` | Adds `simulations.category`; upserts the HRMS entry (shown as **HR Management** since migration `20261027000300`); recreates `admin_list_simulations` |
| `20261027000100_access_management.sql` | Duration per access (15 min–24 h, CHECK-enforced, cannot be extended); usernames unique among open access; username-only student sign-in `student_login_by_username`; teacher sign-in throttle (`app.auth_attempts`, `auth_check_rate`, `auth_record_attempt`); credentials changeable while draft or active; **SAP ERP** in the catalogue; `student_access_info`; hook `app.after_class_start` |
| `20261027000200_sap_erp.sql` | Schema `erp` (see below): reference data, workspaces, business tables, document lines, number ranges, metadata, audit; import, export, transactional commit and teacher configuration functions |
| `20261027000300_neutral_app_names.sql` | Renames the `hr-remedy-hrms` catalogue entry to **HR Management** (slug unchanged) |
| `20261028000100_crm_and_s4hana.sql` | Enables **Zoho CRM** (`zoho-crm`, previously a disabled placeholder) and adds **Amazon S/4HANA** (`amazon-s4hana`) to the catalogue |

No migration drops or truncates data. `DROP FUNCTION` is used only where a function's signature changes.

## Schema `erp` (SAP ERP)

Same security model as `app`: not exposed through the Data API, RLS enabled with
no policies, no privileges for `anon`/`authenticated`; all access through the
functions below.

| Group | Tables |
| --- | --- |
| Organization reference | `company_codes` (teacher-configurable names), `gl_accounts`, `cost_centers`, `materials`, `posting_periods` |
| Workspaces | `workspaces` (one `baseline`, one `session` workspace per SAP ERP access) |
| Workspace data (primary and foreign keys include `workspace_id`) | `vendors`, `customers`, `vendor_items`, `customer_items`, `gl_documents`, `document_lines`, `po_items`, `material_doc_items`, `invoice_items`, `vim_documents`, `work_items`, `contract_accounts`, `fica_items`, `billable_items`, `billing_documents`, `payment_lots`, `payment_lot_items`, `bank_statement_items`, `upload_logs`, `upload_runs`, `number_ranges` |
| Metadata | `table_registry` (keys, updatable fields), `table_columns` (field names, labels, kinds), `status_transitions`, `number_range_defs` |
| Audit | `commits` (each applied batch with assigned numbers and actor), `import_runs`, `import_normalizations` |

Constraints include amounts `numeric(15,2)` > 0 where applicable, tax ≤ gross,
period = fiscal period of the posting date, status-dependent clearing fields,
received ≤ ordered and invoiced ≤ received quantities, net value = quantity ×
price / price unit, and deferred composite foreign keys within the workspace.

| Function | Granted to | Behaviour |
| --- | --- | --- |
| `erp_import_baseline(payload, meta)` | service_role | Atomic, idempotent upsert into the baseline |
| `erp_record_import_failure(meta, error)` | service_role | Records a failed import |
| `erp_export_for_class(access)` | service_role | Workspace data; only for an active, unexpired access |
| `erp_commit_for_class(access, request, ops, actor)` | service_role | Applies one batch atomically with all business checks; idempotent per request id |
| `admin_erp_overview()` | authenticated (teacher) | Import status, company codes, posting periods |
| `admin_update_company_code(bukrs, name)` | authenticated (teacher) | Sets a company name, kept by later imports; audited |
| `admin_set_posting_period(bukrs, year, from, to)` | authenticated (teacher) | Open period range; audited |
| `admin_reset_workspace(access)` | authenticated (teacher) | Restores an active workspace to the baseline; audited |

`admin_start_class` creates the SAP ERP workspace in the same transaction; it
fails with `erp_baseline_missing` until the workbook is imported.

## Schemas

* `app`: private. Holds all tables. `USAGE` revoked from `public`, `anon` and
  `authenticated`; not in the Data API's exposed schemas. RLS enabled on every
  table with **no policies** (deny-all), as defence in depth.
* `public`: only `SECURITY DEFINER` functions with `search_path = ''`.

## Tables (`app.*`)

| Table | Key columns | Notes |
| --- | --- | --- |
| `admin_roles` | `user_id` PK → `auth.users`, `role` (`admin`) | Trusted mapping; written only by `bootstrap_admin` (service role) or SQL editor |
| `simulations` | `id`, `slug` UNIQUE (kebab-case), `name`, `description`, `category`, `enabled`, `display_order`, timestamps | `hr-remedy-hrms` (1, enabled), `zoho-crm`, `sap-finance` (disabled: no content) |
| `classes` | `id` UUID, `name`, `simulation_id` FK, `status`, `created_by` FK, `student_username`, `student_password_hash` (bcrypt), `credential_version`, `request_id` UNIQUE, `created_at`, `started_at`, `expires_at`, `closed_at`, `updated_at` | CHECK `classes_lifecycle_shape` enforces field shape per status, incl. `expires_at = started_at + duration_minutes` (15–1440) |
| `student_sessions` | `id`, `class_id` FK (cascade), `token_hash` UNIQUE (64 hex), `credential_version`, `expires_at`, `revoked_at` | Raw tokens are never stored |
| `login_attempts` | `class_id`, `client_key` (HMAC of IP), `succeeded`, `attempted_at` | Rate limiting; rows >7 days deleted by the sweep |
| `audit_log` | `actor_id`, `action`, `class_id`, `details` jsonb, `created_at` | No secrets ever written |

Indexes: `classes(status, expires_at)`, `classes(created_by)`, `classes(simulation_id)`,
`classes(created_at desc)`, `student_sessions(class_id)`,
`login_attempts(class_id, client_key, attempted_at desc)`, `login_attempts(attempted_at)`,
`audit_log(class_id, created_at desc)`, `audit_log(created_at desc)`.

### Status shape (CHECK constraint)

| status | started_at | expires_at | closed_at |
| --- | --- | --- | --- |
| draft | null | null | null |
| active | set | started_at + duration | null |
| closed | null **or** set | null **or** started_at + duration | set |
| expired | set | started_at + duration | = expires_at |

## Functions and grants

| Function | Granted to | Behaviour |
| --- | --- | --- |
| `is_admin()` | authenticated | Role check for `auth.uid()` |
| `admin_list_simulations()` | authenticated (admin) | Catalogue |
| `admin_list_classes(p_class_id?)` | authenticated (admin) | Runs expiry sweep, returns non-secret fields + `server_now` |
| `admin_create_class(request_id, name, slug, username, password)` | authenticated (admin) | Validates, bcrypt-hashes, inserts draft; idempotent per `request_id` |
| `admin_start_class(id)` | authenticated (admin) | `FOR UPDATE`; draft → active with DB timestamps; repeat call on active is a no-op |
| `admin_rotate_credentials(id, username?, password?)` | authenticated (admin) | Active & unexpired only; bumps `credential_version`, revokes sessions |
| `admin_close_class(id)` | authenticated (admin) | draft/active → closed; bumps version, revokes sessions; idempotent |
| `admin_list_audit(id)` | authenticated (admin) | Audit events for a class |
| `student_class_info(id)` | service_role | Effective status; name only when active |
| `student_login(id, user, pass, client_key, token_hash, ttl)` | service_role | `FOR SHARE` lock (serialises with close/rotate), rate limit, verify, create session capped at class expiry |
| `student_validate_session(id, token_hash)` | service_role | Authoritative check → `ok`/`no_session`/`revoked`/`session_expired`/`closed`/`expired`/`not_started` |
| `student_logout(id, token_hash)` | service_role | Revokes one session |
| `bootstrap_admin(email)` | service_role | Grants admin to an existing auth user |
| `expire_classes()` | service_role | Manual/cron sweep (optional; never required for correctness) |

All functions first `REVOKE ALL … FROM public, anon, authenticated, service_role`
(Supabase grants EXECUTE on new public functions by default) and then grant
exactly the roles above. Internal helpers in `app` are not executable by API roles.

## Applying migrations safely

Supabase Dashboard → **SQL Editor** → paste the migration → Run. Or, with a
rotated password, `psql "$DATABASE_URL" -f supabase/migrations/<file>.sql`, or
`supabase db push` if you use the Supabase CLI. Re-running is safe.

Verify afterwards (SQL editor):

```sql
select slug, enabled from app.simulations order by display_order; -- hr-remedy-hrms first
select relname, relrowsecurity from pg_class
 where relnamespace = 'app'::regnamespace and relkind = 'r';     -- all true
select has_function_privilege('anon', 'public.student_login(uuid,text,text,text,text,integer)', 'execute'); -- false
```

Also confirm in **Project Settings → Data API** that `app` is **not** in "Exposed schemas".
