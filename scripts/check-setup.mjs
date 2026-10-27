// Read-only setup diagnostics for the configured Supabase project.
//   npm run check:setup
// Reports configuration, connectivity, migrations, the teacher account and role,
// and the SAP ERP data import. Never prints keys, passwords or tokens.
import { createClient } from '@supabase/supabase-js';

const results = [];
const ok = (m) => results.push(['✓', m]);
const bad = (m) => results.push(['✗', m]);
const info = (m) => results.push(['•', m]);
const check = (cond, good, fail) => (cond ? ok(good) : bad(fail));

const env = (k) => process.env[k] ?? '';
const url = env('NEXT_PUBLIC_SUPABASE_URL');
const pub = env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
const secret = env('SUPABASE_SECRET_KEY');
const signing = env('SESSION_SIGNING_SECRET');
const email = env('ADMIN_EMAIL').trim().toLowerCase();

check(/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url), 'NEXT_PUBLIC_SUPABASE_URL set', 'NEXT_PUBLIC_SUPABASE_URL missing or malformed');
check(pub.startsWith('sb_publishable_'), 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY set', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing or not a publishable key');
check(secret.startsWith('sb_secret_'), 'SUPABASE_SECRET_KEY set', 'SUPABASE_SECRET_KEY missing or not a secret key');
check(signing.length >= 32 && !/replace-with/.test(signing), 'SESSION_SIGNING_SECRET set', 'SESSION_SIGNING_SECRET missing, too short or still the placeholder');

if (url && secret) {
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const anon = createClient(url, pub, { auth: { persistSession: false, autoRefreshToken: false } });

  const health = await fetch(`${url}/auth/v1/health`, { headers: { apikey: pub } }).catch(() => null);
  check(health?.ok, 'Supabase Auth reachable', `Supabase Auth not reachable (${health ? health.status : 'network error'})`);

  // Migrations: each function is probed with harmless arguments as the service role.
  const probes = [
    ['20261026000100 platform', 'student_class_info', { p_class_id: '00000000-0000-0000-0000-000000000000' }],
    ['20261027000100 access management', 'student_access_info', { p_class_id: '00000000-0000-0000-0000-000000000000' }],
    ['20261027000200 SAP ERP', 'erp_record_import_failure', null],
  ];
  for (const [label, fn, args] of probes) {
    if (!args) {
      // Existence check without writing: call with an invalid argument type.
      const { error } = await admin.rpc(fn, { p_meta: 'x', p_error: 'x' }).then((r) => r, (e) => ({ error: e }));
      const missing = error && /Could not find the function|PGRST202/.test(`${error.message} ${error.code}`);
      check(!missing, `migration ${label} applied`, `migration ${label} not applied`);
      continue;
    }
    const { error } = await admin.rpc(fn, args);
    check(!error, `migration ${label} applied`, `migration ${label} not applied (${error?.code ?? 'error'})`);
  }

  if (email) {
    let user = null;
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) bad(`cannot list Auth users (${error.status ?? ''} ${error.code ?? ''})`);
    else user = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
    if (!error) check(user, `teacher account ${email} exists`, `teacher account ${email} does not exist (run npm run setup:admin)`);
    if (user) check(user.email_confirmed_at, 'teacher email confirmed', 'teacher email not confirmed');
  }

  const { error: anonErr } = await anon.rpc('admin_erp_overview');
  if (anonErr?.code === 'PGRST202') info('teacher function access not checked (migrations missing)');
  else check(anonErr, 'teacher functions refuse anonymous callers', 'teacher functions answered an anonymous caller');
  info('teacher role and sign-in are verified by: npm run setup:admin (prompts for the password)');
}

for (const [s, m] of results) console.log(`  ${s} ${m}`);
if (results.some(([s]) => s === '✗')) process.exitCode = 1;
