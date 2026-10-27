// Local stand-in for the two Supabase services the application uses, for
// full-stack browser tests without a Supabase project:
//   * Auth: password sign-in, user lookup (session verification), sign-out, refresh.
//   * PostgREST RPC: POST /rest/v1/rpc/<function> with named arguments.
// Backed by an in-process Postgres (PGlite) with the real migrations applied and
// the SAP ERP workbook imported. Roles follow Supabase: the secret key runs as
// service_role, a user JWT as authenticated (auth.uid() = sub), otherwise anon.
//
//   node tests/support/local-supabase.mjs        (port from LOCAL_SUPABASE_PORT, default 54399)
//
// Test-only: never deploy. Credentials come from E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.
import { createServer } from 'node:http';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { buildPayload } from '../../scripts/import-sap-data/workbook.mjs';

const PORT = Number(process.env.LOCAL_SUPABASE_PORT ?? 54399);
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? 'sb_secret_local_test_key';
const JWT_SECRET = randomBytes(32);
const ADMIN_EMAIL = (process.env.E2E_ADMIN_EMAIL ?? 'training@hrremedyindia.com').toLowerCase();
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Local-Teacher-Pass-1';
const OTHER_EMAIL = 'staff@hrremedyindia.com'; // authenticated, but no teacher role
const root = process.cwd();

const STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create schema extensions; grant usage on schema extensions to anon, authenticated, service_role;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;`;

const pg = await PGlite.create({ extensions: { pgcrypto } });
await pg.exec(STUB);
for (const f of readdirSync(join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
  await pg.exec('reset role;');
  await pg.exec(readFileSync(join(root, 'supabase', 'migrations', f), 'utf8'));
}

const users = new Map(); // email -> { id, email, password }
async function addUser(email, password) {
  const id = randomUUID();
  await pg.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  users.set(email, { id, email, password });
  return id;
}
await addUser(ADMIN_EMAIL, ADMIN_PASSWORD);
await addUser(OTHER_EMAIL, ADMIN_PASSWORD);
await pg.query('select public.bootstrap_admin($1)', [ADMIN_EMAIL]);
const { payload, meta } = await buildPayload(join(root, 'modules', 'sap-erp', 'source', 'SAP_Training_Data_500.xlsx'));
await pg.query('select public.erp_import_baseline($1, $2)', [payload, meta]);

// ---------------------------------------------------------------- JWT (HS256)
const b64 = (b) => Buffer.from(b).toString('base64url');
function sign(claims) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify(claims));
  return `${head}.${body}.${b64(createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest())}`;
}
function verify(token) {
  const [h, p, s] = String(token ?? '').split('.');
  if (!h || !p || !s) return null;
  const expected = createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  return claims.exp * 1000 > Date.now() ? claims : null;
}
const refreshTokens = new Map();
function session(user) {
  const now = Math.floor(Date.now() / 1000);
  const access_token = sign({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 });
  const refresh_token = randomBytes(24).toString('hex');
  refreshTokens.set(refresh_token, user.email);
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token, user: userJson(user) };
}
const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-01-01T00:00:00Z',
  app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });

// ---------------------------------------------------------------- serialized DB access
let queue = Promise.resolve();
const serial = (fn) => {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
};

async function rpc(fn, args, role, sub) {
  if (!/^[a-z_][a-z0-9_]*$/.test(fn)) return { status: 404, body: { code: 'PGRST202', message: 'Function not found' } };
  const keys = Object.keys(args ?? {});
  if (keys.some((k) => !/^[a-z_][a-z0-9_]*$/.test(k))) return { status: 400, body: { code: 'PGRST100', message: 'Invalid argument' } };
  return serial(async () => {
    const info = await pg.query(`select proretset, prorettype::regtype::text as rt from pg_proc
                                  where proname = $1 and pronamespace = 'public'::regnamespace limit 1`, [fn]);
    if (!info.rows.length) return { status: 404, body: { code: 'PGRST202', message: `Could not find the function public.${fn}` } };
    const { proretset, rt } = info.rows[0];
    const call = `public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')})`;
    const sql = proretset ? `select coalesce(json_agg(t), '[]'::json) as r from ${call} t`
      : rt === 'void' ? `select ${call}, null::json as r` : `select to_json(${call}) as r`;
    const params = keys.map((k) => {
      const v = args[k];
      return v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
    try {
      await pg.exec('reset role;');
      await pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [sub ?? '']);
      await pg.exec(`set role ${role};`);
      const res = await pg.query(sql, params);
      return { status: 200, body: res.rows[0].r };
    } catch (e) {
      const code = e.code ?? 'P0001';
      const status = code === '42501' ? (role === 'anon' ? 401 : 403) : code === 'P0002' ? 404 : 400;
      return { status, body: { code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null } };
    } finally {
      await pg.exec('reset role;');
    }
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const bearer = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const claims = verify(bearer);

  // ---- Auth
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
    const u = users.get(String(body.email ?? '').toLowerCase());
    if (!u || u.password !== body.password) {
      return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, { 'x-supabase-api-version': '2024-01-01' });
    }
    return send(res, 200, session(u));
  }
  if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const email = refreshTokens.get(body.refresh_token);
    if (!email) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }, { 'x-supabase-api-version': '2024-01-01' });
    refreshTokens.delete(body.refresh_token);
    return send(res, 200, session(users.get(email)));
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
    if (!claims) return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, { 'x-supabase-api-version': '2024-01-01' });
    return send(res, 200, userJson(users.get(claims.email)));
  }
  if (url.pathname === '/auth/v1/logout') {
    res.writeHead(204);
    return res.end();
  }

  // ---- Auth admin API (secret key only), used by scripts/setup-admin.mjs
  if (url.pathname.startsWith('/auth/v1/admin/users')) {
    if (req.headers.apikey !== SECRET_KEY && bearer !== SECRET_KEY) return send(res, 401, { msg: 'not allowed' });
    const id = url.pathname.split('/')[5];
    const confirmed = new Map([...users.values()].map((u) => [u.id, u.confirmed !== false]));
    const full = (u) => ({ ...userJson(u), email_confirmed_at: confirmed.get(u.id) ? '2026-01-01T00:00:00Z' : null });
    if (req.method === 'GET' && !id) return send(res, 200, { users: [...users.values()].map(full), aud: 'authenticated' });
    if (req.method === 'POST' && !id) {
      const email = String(body.email).toLowerCase();
      if (users.has(email)) return send(res, 422, { code: 422, error_code: 'email_exists', msg: 'already registered' });
      await serial(() => addUser(email, body.password));
      users.get(email).confirmed = body.email_confirm === true;
      return send(res, 200, full(users.get(email)));
    }
    const u = [...users.values()].find((x) => x.id === id);
    if (!u) return send(res, 404, { code: 404, error_code: 'user_not_found', msg: 'User not found' });
    if (req.method === 'GET') return send(res, 200, full(u));
    if (req.method === 'PUT') {
      if (body.password) u.password = body.password;
      if (body.email_confirm === true) u.confirmed = true;
      return send(res, 200, full(u));
    }
  }

  // ---- PostgREST RPC
  const m = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
  if (m && req.method === 'POST') {
    const apikey = req.headers.apikey ?? '';
    const role = claims ? 'authenticated' : apikey === SECRET_KEY || bearer === SECRET_KEY ? 'service_role' : 'anon';
    const out = await rpc(m[1], body, role, claims?.sub);
    if (out.status === 200 && String(req.headers.accept ?? '').includes('vnd.pgrst.object')) {
      if (!Array.isArray(out.body)) return send(res, 200, out.body);
      if (out.body.length !== 1) {
        return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned',
          details: `The result contains ${out.body.length} rows`, hint: null });
      }
      return send(res, 200, out.body[0]);
    }
    return send(res, out.status, out.body);
  }
  return send(res, 404, { message: 'not found' });
}).listen(PORT, () => console.log(`local supabase ready on http://localhost:${PORT}`));
