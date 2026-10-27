# Deployment (Supabase + Vercel)

## 0. Security housekeeping (do first)

The database password and the administrator password were shared in plain text
(including a screenshot). Treat both as compromised:

1. Supabase → **Project Settings → Database → Reset database password**. Store it in a password manager only.
2. Replace the administrator password with `npm run setup:admin -- --reset-password` (step 1.4).

## 1. Supabase

1. Open the project (URL `https://<project-ref>.supabase.co`).
2. **SQL Editor** → run the migrations in filename order:
   1. `supabase/migrations/20261026000100_training_platform.sql`
   2. `supabase/migrations/20261026000200_hr_remedy_hrms.sql`
   3. `supabase/migrations/20261027000100_access_management.sql`
   4. `supabase/migrations/20261027000200_sap_erp.sql`
   5. `supabase/migrations/20261027000300_neutral_app_names.sql`

   (or `supabase db push` / `psql "$DATABASE_URL" -f …`). All are forward-only and safe to re-run.
   Confirm in **Project Settings → Data API** that `app` and `erp` are **not** exposed schemas.
3. **Project Settings → API Keys**: copy the publishable key; create a secret key (`sb_secret_…`).
4. **Authentication → Sign In / Providers**: keep Email enabled; turn **off** "Allow new users to sign up".
   **Authentication → URL Configuration**: Site URL = your Vercel production URL.
5. Create `.env.local` from `.env.example` with the URL, both keys, a fresh
   `SESSION_SIGNING_SECRET` and `ADMIN_EMAIL=training@hrremedyindia.com`.

### Teacher account

```bash
npm run setup:admin -- --reset-password
```

Creates the account if missing (email confirmed) or replaces its password
(typed twice, never echoed or stored), grants the teacher role through the
service-role function `bootstrap_admin`, then verifies: account exists, email
confirmed, sign-in works, server-side role check passes, teacher functions are
available, and unauthenticated callers are refused. Additional teachers: run it
with another `ADMIN_EMAIL`. Revoke: `delete from app.admin_roles where user_id = (select id from auth.users where email = '…');`

### SAP ERP data

```bash
npm run import:sap -- modules/sap-erp/source/SAP_Training_Data_500.xlsx           # dry run
npm run import:sap -- modules/sap-erp/source/SAP_Training_Data_500.xlsx --apply   # import
```

Then sign in as teacher → **Organization**: set the real company-code names and
check the open posting periods.

## 2. Vercel

1. Push the repository and **Import** it in Vercel (framework Next.js, default build).
2. **Settings → Environment Variables** (Production and Preview; different `SESSION_SIGNING_SECRET` per environment):
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (Sensitive),
   `SESSION_SIGNING_SECRET` (Sensitive). Do not set `DATABASE_URL` or any `E2E_*`.
3. Ensure `modules/*/index.html` are committed (traced into the protected routes;
   `modules/*/source` is not deployed to functions).
4. Deploy a **Preview**, run the smoke tests, then promote.

CLI: `npm i -g vercel && vercel link && vercel env add … && vercel deploy`, then `vercel deploy --prod`.

## 3. Smoke tests (preview URL)

Automated: `E2E_BASE_URL=<url> E2E_ADMIN_EMAIL=… E2E_ADMIN_PASSWORD=… npm run test:live`
(creates and ends its own access sessions; does not change organization settings).

Manual:
1. `/` shows **Student Login** then **Teacher Login**; `/favicon.ico` → 200.
2. Teacher Login with a wrong password → "Incorrect email or password."; correct → Dashboard with HR Management and SAP ERP.
3. `curl -i <url>/api/teacher/access` → 401.
4. Create Access (SAP ERP) → draft → the student link shows "Access is not available yet".
5. Start Access → student signs in (Student Login, username + password) → SAP ERP opens without a second login. Post FB01; reload; FB03 shows it.
6. `curl -i <url>/access/<id>/app/content` (no cookie) → 401.
7. Change credentials → the student is signed out within ~12 s; the old password fails.
8. End Access → the student sees "Class is over for now."; `/api/access/<id>/erp/data` → 401.

## 4. Optional

Expiry needs no job. To mark expired rows promptly for reporting, schedule
`select public.expire_classes();` (Supabase Integrations → Cron).
