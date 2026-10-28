# Business Applications

Business applications with teacher-controlled access. Teachers create
time-limited access for an application, share a link and one set of
credentials, and end the access whenever they want. Students sign in with
those credentials and the application opens directly.

| Application | Business data |
| --- | --- |
| **HR Management** (slug `hr-remedy-hrms`) | In each student's browser, per access session (unchanged single-file module) |
| **SAP ERP** | In PostgreSQL (Supabase): one workspace per access session, created from the imported workbook data |
| **Zoho CRM** (slug `zoho-crm`) | In memory in the student's browser; resets when the page is reloaded (as supplied) |
| **Amazon S/4HANA** (slug `amazon-s4hana`) | Built-in data set plus the student's postings in the browser, per access session |

Launcher icons come from each application's own branding (`components/app-icon.tsx`).

| Doc | Contents |
| --- | --- |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Supabase and Vercel setup, teacher account, data import, smoke tests |
| [docs/DATABASE.md](docs/DATABASE.md) | Schemas, tables, constraints, functions, grants, migrations |
| [docs/MODULES.md](docs/MODULES.md) | How the applications are integrated; the SAP ERP data layer |
| [docs/SAP-DATA-IMPORT.md](docs/SAP-DATA-IMPORT.md) | Workbook → database mapping, validation, normalization, re-running |
| [docs/GUIDES.md](docs/GUIDES.md) | Teacher and student workflows |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Teacher-login error, hydration warning, favicon: causes and fixes |

## Entry points

| | Student | Teacher |
| --- | --- | --- |
| Entry | `/` → **Student Login** (first) → `/student/login` (username + password), or the access link `/access/{id}` | `/` → **Teacher Login** (second) → `/teacher/login` |
| Credentials | Shared username + password set by the teacher (a username belongs to at most one open access) | Personal Supabase Auth account |
| Authorization | Every request: access active, not expired, credential version current, session not revoked | Supabase JWT verified on the server **and** the teacher role (`app.admin_roles`) re-checked by every database function |
| Session | Random token in an HttpOnly cookie; the database stores only its HMAC | Supabase Auth cookies, set by the server sign-in route |

## Architecture

```
Browser ──► Next.js 16 (App Router, Vercel) ──► Supabase (Postgres + Auth)
  /, /about                       landing (two entry points), ownership statement
  /student/login                  username + password
  /access/{id}                    sign-in from an access link (state-aware)
  /access/{id}/app                host page: re-validates the session, heartbeat every 12 s
  /access/{id}/app/content        the module, served only for a valid session (private, no-store)
  /api/access/{id}/erp/data       SAP ERP workspace data   (session-checked, service role)
  /api/access/{id}/erp/commit     one batch of changes      (session-checked, same-origin, idempotent)
  /teacher/login                  → POST /api/teacher/login (server-side sign-in + role check)
  /teacher/dashboard | access | access/new | access/{id} | access/{id}/credentials
  /teacher/applications | organization
  /api/teacher/*                  JWT verified + role checked → admin_* functions (as the teacher)
  proxy.ts                        refreshes teacher cookies (optimistic redirect only)
```

* **Source of truth:** PostgreSQL. Tables live in the private schemas `app` and
  `erp`, which the Data API doesn't expose; RLS is on with no policies; browsers
  never query tables. All access goes through `SECURITY DEFINER` functions with
  explicit grants.
* **Modules** live in `/modules` (not `/public`) and are reachable only through
  the protected content route. The supplied originals are kept unchanged in
  `modules/sap-erp/source/`.

### Access lifecycle

```
 draft ──Start Access──► active ──End Access──► closed
   │                       └──duration elapsed──► expired
   └──discard──► closed
```

* **Start** sets `started_at = now()` and `expires_at = started_at + duration`
  (15 minutes to 24 hours, default 24) using the database clock; a CHECK
  constraint makes extending it impossible.
* **Expiry** is checked on every request (`now() >= expires_at` ⇒ denied); no
  cleanup job is needed for correctness.
* **Changing credentials** (draft or active) stores a new bcrypt hash, increments
  `credential_version` and revokes every student session.
* **End Access** marks the access closed, revokes sessions; the next request or
  heartbeat removes the application. Closed and expired access cannot be
  reopened — create a new one.
* **Data retention:** ending or expiry revokes *access* only. SAP ERP workspace
  data is kept (teachers can reset an active workspace explicitly).

## SAP ERP

`scripts/build-sap-module.mjs` builds `modules/sap-erp/index.html` from the
supplied `SAP.html` with asserted patches: no embedded login or credentials, no
embedded data, server-backed persistence (batches committed atomically, numbers
assigned by the server, success shown only after the server confirmed), corrected
accounting behaviour, no simulated successes, neutral wording and an original
brand mark. Details: [docs/MODULES.md](docs/MODULES.md).

The workbook is imported with `npm run import:sap` (dry run by default,
`--apply` to write; atomic and idempotent). Details: [docs/SAP-DATA-IMPORT.md](docs/SAP-DATA-IMPORT.md).

## Local development

```bash
npm install
cp .env.example .env.local     # fill in the values (see below)
npm run dev                    # http://localhost:3000
```

The migrations must be applied and a teacher account provisioned first — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Without configuration the pages load,
and sign-in reports "The server is not fully configured" (the log names the
missing variable).

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Dev server / production build / serve the build |
| `npm run lint` · `npm run typecheck` | ESLint · `tsc --noEmit` |
| `npm test` | Unit tests: domain rules, server helpers, ERP request/error mapping, modules, wording audit |
| `npm run test:db` | Real migrations in in-process Postgres (PGlite): access lifecycle, security, ERP import, workspaces, posting rules |
| `npm run test:e2e` | Playwright: public pages, favicon, fail-closed endpoints, HRMS module, SAP ERP module and 22 transaction workflows against the real database logic. First run: `npx playwright install chromium`, then `npm run build` |
| `npm run test:stack` | Full teacher → student lifecycle through a production build against a local Supabase stand-in (`tests/support/local-supabase.mjs`) |
| `npm run test:live` | The same lifecycle against a real deployment (`E2E_BASE_URL`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`) |
| `E2E_DEV_URL=http://localhost:3000 npx playwright test hydration --project desktop` | Hydration check against a dev server |
| `npm run setup:admin [-- --reset-password]` | Create/verify the teacher account, replace its password, grant the role |
| `npm run import:sap -- <workbook.xlsx> [--apply]` | Validate / import the SAP ERP workbook |
| `npm run build:sap` · `npm run build:crm` · `npm run build:s4hana` · `npm run build:icons` | Rebuild the SAP ERP, Zoho CRM or Amazon S/4HANA module · regenerate the favicon set |

## Environment variables

| Name | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | server (public value) | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | server (public value) | Publishable key (`sb_publishable_…`) |
| `SUPABASE_SECRET_KEY` | **server only** | Secret key (`sb_secret_…`): student/ERP functions, rate limits |
| `SESSION_SIGNING_SECRET` | **server only** | ≥32 random characters: HMAC of student tokens and rate-limit keys |
| `ADMIN_EMAIL` | local script | Account for `npm run setup:admin` |

The browser never receives a Supabase key: teacher sign-in runs on the server.
Missing variables produce a generic "not fully configured" message; the server
log names the variable, never its value. Protected routes fail closed.

## Security controls

* Teacher: Supabase Auth on the server, JWT verified (`getClaims`), role from a
  private table re-checked in every SQL function; sign-in throttled per client
  (10/15 min) and per account (8/15 min).
* Student: bcrypt-hashed shared password, HttpOnly/SameSite=Lax/Secure cookie,
  8 h session capped at the access expiry, revocable; 10 failed sign-ins per
  client per 15 min.
* ERP data: workspace derived from the session server-side; every write in one
  transaction with type, field, status-transition, period, balance, clearing,
  quantity and duplicate-invoice checks; optimistic concurrency; idempotency
  per request; audit trail (`erp.commits`).
* Same-origin check on every state-changing endpoint; `private, no-store` on all
  personal pages and APIs; `X-Frame-Options: SAMEORIGIN`; no secrets in the browser.
* Limitation: what an authorized browser already displayed can be copied while
  access is open; ending access stops further use.

## Status

Implemented and verified locally (see the final report in the pull request /
change log): all tests above, the production build, and the full lifecycle
against the local stand-in. Requires your Supabase project and Vercel to go
live — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
