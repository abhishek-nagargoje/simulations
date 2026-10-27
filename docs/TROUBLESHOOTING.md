# Troubleshooting and investigation records

## Teacher login: "Network error. Check your connection and try again."

**Root cause (reproduced).** The teacher form created a Supabase client *in the
browser* from `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
The project had no `.env.local` (and no Vercel project), so both were undefined.
`createBrowserClient` then threw *"Your project's URL and API key are required to
create a Supabase client!"* before any request was made, and the form's
catch-all handler showed every exception as a network error. Reproduction with a
clean Chromium against the dev server: the alert appeared and **zero** network
requests were sent after pressing Sign in.

**Fix.**
1. Sign-in moved to the server: `POST /api/teacher/login` signs in with
   `@supabase/ssr` (cookies set by the server), then verifies the teacher role
   with `is_admin()`; a failed or missing role signs the user out again.
2. Each failure has its own safe message and status: missing configuration
   (503 `config_error`, the server log names the variable), auth service
   unreachable (503), wrong credentials (401), unconfirmed email (403), rate
   limit (429), role lookup failure (503, fail closed), no teacher role (403).
   "The server could not be reached" is shown only when the request itself fails.
3. The browser no longer needs any Supabase key.
4. Configure the four variables (see `.env.example`) locally and in Vercel.

Verified by `tests/e2e/landing.spec.ts` (configuration missing → specific
message) and `tests/stack/lifecycle.spec.ts` (wrong password, account without the
teacher role, success).

## Hydration warning in `app/layout.tsx` (`data-kantu`, `cz-shortcut-listen`)

**Outcome: caused by browser extensions, not by the application.**

* `data-kantu="1"` is added to `<html>` by the UI.Vision RPA (Kantu) extension;
  `cz-shortcut-listen="true"` is added to `<body>` by ColorZilla. Both are added
  before React hydrates.
* In a clean browser (Playwright Chromium, no extensions) no page produces a
  hydration warning (`tests/e2e/hydration.spec.ts`, dev server).
* Injecting exactly those two attributes before hydration reproduced the
  reported warning.
* The code was also reviewed for real mismatches: times are formatted after
  mount (`components/time.tsx`), no `Date.now()`/`Math.random()`/browser APIs
  in initial render, valid nesting. The landing page no longer reads cookies or
  calls the database.
* Fix: `<html>` and `<body>` in `app/layout.tsx` carry `suppressHydrationWarning`.
  React applies it to those two elements' own attributes only, one level deep, so
  extension attributes there are ignored while a mismatch anywhere inside the
  application is still reported. The spec checks both.

## `/favicon.ico` returned 404

There was no icon at all. `app/favicon.ico` (16/32/48 px), `app/icon.svg` and
`app/apple-icon.png` are now generated from the neutral launcher mark by
`npm run build:icons` and served through Next.js file conventions
(`tests/e2e/landing.spec.ts` checks all three return 200 and that no request on
the landing page fails).

## Other symptoms

| Symptom | Fix |
| --- | --- |
| "The server is not fully configured" | Set the variable named in the server log and redeploy |
| "This account does not have teacher access." | `npm run setup:admin` (grants the role) or `select public.bootstrap_admin('<email>')` |
| "Incorrect email or password." after setup | Run `npm run setup:admin -- --reset-password` |
| Teacher cannot start SAP ERP access ("data has not been imported") | `npm run import:sap -- <workbook> --apply` |
| SAP ERP shows "Posting period … is not open" | Teacher → Organization → Open posting periods |
| "This username is already used by another open access session" | Choose another username or end the other access |
| Students all signed out at once | Credentials changed, access ended/expired, or `SESSION_SIGNING_SECRET` rotated |
| `permission denied for function …` | Migrations not applied, or a wrong key type on the server |
