// Trusted administrator (teacher) provisioning. Run locally by an administrator:
//
//   npm run setup:admin                    create the account if missing, grant the role, verify
//   npm run setup:admin -- --reset-password  also set a new password (use this to replace a
//                                            password that was ever shared or exposed)
//
// The password is typed interactively (not echoed, typed twice) and is never
// stored, logged or written to any file. The teacher role is granted only by
// the service-role database function bootstrap_admin — never by the browser.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
// SUPABASE_SECRET_KEY and ADMIN_EMAIL.
import { createClient } from '@supabase/supabase-js';
import { createInterface } from 'node:readline';

function need(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
  return v;
}

// Reads one line without echoing it. In a terminal, raw mode keeps the typed
// characters off the screen; piped input is read from a shared line queue so
// no line is lost between prompts.
const queued = [];
const waiting = [];
let reader = null;
function nextPipedLine() {
  reader ??= createInterface({ input: process.stdin, terminal: false }).on('line', (l) => {
    const w = waiting.shift();
    if (w) w(l);
    else queued.push(l);
  });
  return queued.length ? Promise.resolve(queued.shift()) : new Promise((r) => waiting.push(r));
}
function nextHiddenTtyLine() {
  return new Promise((resolve) => {
    let value = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.off('data', onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          return resolve(value);
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}
async function askHidden(question) {
  process.stdout.write(question);
  const answer = process.stdin.isTTY ? await nextHiddenTtyLine() : await nextPipedLine();
  process.stdout.write('\n');
  return answer;
}

async function choosePassword(email) {
  const first = await askHidden(`New password for ${email} (at least 8 characters): `);
  if (first.length < 8) {
    console.error('Password too short. Nothing was changed.');
    process.exit(1);
  }
  const second = await askHidden('Repeat the password: ');
  if (first !== second) {
    console.error('The passwords do not match. Nothing was changed.');
    process.exit(1);
  }
  reader?.close();
  return first;
}

const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  console.error(`  ✗ ${msg}`);
  process.exitCode = 1;
};

const url = need('NEXT_PUBLIC_SUPABASE_URL');
const publishable = need('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
const secret = need('SUPABASE_SECRET_KEY');
const email = need('ADMIN_EMAIL').trim().toLowerCase();
const resetPassword = process.argv.includes('--reset-password');
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

// 1. Find or create the Auth user.
let user = null;
for (let page = 1; !user; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.error(`Could not list users (check the secret key and project URL): ${error.message}`);
    process.exit(1);
  }
  user = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 200) break;
}

let password = null;
if (!user) {
  password = await choosePassword(email);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    console.error(`Could not create the account: ${error.message}`);
    process.exit(1);
  }
  user = data.user;
  console.log(`Created account ${email}.`);
} else if (resetPassword) {
  password = await choosePassword(email);
  const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
  if (error) {
    console.error(`Could not set the new password: ${error.message}`);
    process.exit(1);
  }
  console.log(`Password of ${email} replaced. Sessions signed in with the old password should be signed out in the dashboard if needed.`);
} else if (!user.email_confirmed_at) {
  const { error } = await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
  if (error) {
    console.error(`Could not confirm the email address: ${error.message}`);
    process.exit(1);
  }
  console.log(`Email address of ${email} confirmed.`);
} else {
  console.log(`Account ${email} exists; password unchanged (use --reset-password to replace it).`);
}

// 2. Grant the teacher role (trusted, service role only).
const { error: roleError } = await admin.rpc('bootstrap_admin', { p_email: email });
if (roleError) {
  console.error(`Could not grant the teacher role (are the migrations applied?): ${roleError.message}`);
  process.exit(1);
}

// 3. Verify.
console.log('\nVerification');
const { data: fresh } = await admin.auth.admin.getUserById(user.id);
if (fresh?.user) ok('account exists in Supabase Auth');
else fail('account not found');
if (fresh?.user?.email_confirmed_at) ok('email address confirmed');
else fail('email address not confirmed');

if (password) {
  const client = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    fail(`sign-in failed: ${signInError.message}`);
  } else {
    ok('account can sign in with the new password');
    const { data: isAdmin, error } = await client.rpc('is_admin');
    if (isAdmin === true && !error) ok('server-side teacher role check passes');
    else fail('teacher role check failed');
    const { data: overview, error: ovError } = await client.rpc('admin_erp_overview');
    if (ovError) fail(`teacher functions unavailable: ${ovError.message}`);
    else {
      ok('teacher functions available (migrations applied)');
      if (overview?.baseline_loaded) ok('SAP ERP data imported');
      else console.log('  • SAP ERP data not imported yet: npm run import:sap -- <workbook.xlsx> --apply');
    }
    await client.auth.signOut();
  }
} else {
  console.log('  • sign-in not tested (password unchanged); sign in at /teacher/login to confirm');
}
// A user without the role must be refused by the same check (anon key, no session).
const anon = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
const { error: anonError } = await anon.rpc('admin_erp_overview');
if (anonError) ok('teacher functions refuse unauthenticated callers');
else fail('teacher functions answered an unauthenticated caller');
