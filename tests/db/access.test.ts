// Access management (migration 20261027000100): username sign-in, unique open
// usernames, configurable lifetime (max 24 h), teacher sign-in throttling.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { TestDb } from './harness';

const hex64 = () => randomBytes(32).toString('hex');
let db: TestDb;
let adminId: string;

async function create(username: string, minutes?: number, app = 'hr-remedy-hrms') {
  const args: unknown[] = [randomUUID(), 'Batch', app, username, 'Secret-Pass-1'];
  const sql = minutes === undefined
    ? 'select public.admin_create_class($1,$2,$3,$4,$5) as id'
    : 'select public.admin_create_class($1,$2,$3,$4,$5,$6) as id';
  if (minutes !== undefined) args.push(minutes);
  const [row] = await db.as<{ id: string }>('authenticated', adminId, sql, args);
  return row.id;
}
const start = (id: string, minutes?: number) =>
  db.as('authenticated', adminId, 'select public.admin_start_class($1, $2)', [id, minutes ?? null]);
async function loginByName(username: string, password: string, client = hex64()) {
  const [row] = await db.as<{ outcome: string; class_id: string | null }>(
    'service_role', null, 'select * from public.student_login_by_username($1, $2, $3, $4)', [username, password, client, hex64()]);
  return row;
}

beforeAll(async () => {
  db = await TestDb.create();
  adminId = await db.createUser('training@hrremedyindia.com');
  await db.as('service_role', null, 'select public.bootstrap_admin($1)', ['training@hrremedyindia.com']);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe('username sign-in', () => {
  it('finds the open access session from the username alone', async () => {
    const id = await create('batch-a');
    expect((await loginByName('batch-a', 'Secret-Pass-1')).outcome).toBe('not_started');
    await start(id);
    const ok = await loginByName(' BATCH-A ', 'Secret-Pass-1');
    expect(ok).toEqual({ outcome: 'ok', class_id: id });
  });

  it('reveals nothing for wrong passwords or unknown usernames', async () => {
    expect(await loginByName('batch-a', 'wrong-pass')).toEqual({ outcome: 'invalid_credentials', class_id: null });
    expect(await loginByName('nobody-here', 'Secret-Pass-1')).toEqual({ outcome: 'invalid_credentials', class_id: null });
  });

  it('rate-limits a client across usernames', async () => {
    const client = hex64();
    for (let i = 0; i < 10; i++) expect((await loginByName(`guess-${i}`, 'x-wrong-x', client)).outcome).toBe('invalid_credentials');
    expect((await loginByName('batch-a', 'Secret-Pass-1', client)).outcome).toBe('rate_limited');
  });

  it('keeps a username unique among open sessions and frees it when they end', async () => {
    const id = await create('batch-b');
    await expect(create('batch-b')).rejects.toThrow(/username_taken/);
    const other = await create('batch-c');
    await expect(db.as('authenticated', adminId, 'select public.admin_rotate_credentials($1, $2, null)', [other, 'batch-b']))
      .rejects.toThrow(/username_taken/);
    await db.as('authenticated', adminId, 'select public.admin_close_class($1)', [id]);
    expect(await create('batch-b')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('describes a session for the link page without secrets', async () => {
    const id = await create('batch-info');
    const draft = await db.as('service_role', null, 'select * from public.student_access_info($1)', [id]);
    expect(draft).toEqual([{ status: 'draft', app_name: null }]);
    await start(id);
    const active = await db.as('service_role', null, 'select * from public.student_access_info($1)', [id]);
    expect(active).toEqual([{ status: 'active', app_name: 'HR Management' }]);
    await expect(db.as('anon', null, 'select * from public.student_access_info($1)', [id])).rejects.toThrow(/permission denied/);
  });
});

describe('access lifetime', () => {
  it('defaults to 24 hours and accepts shorter lifetimes', async () => {
    const day = await create('life-24');
    await start(day);
    const short = await create('life-1h', 60);
    await start(short);
    const rows = await db.admin<{ id: string; secs: number }>(
      'select id, extract(epoch from expires_at - started_at)::int secs from app.classes where id in ($1, $2)', [day, short]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.secs]))).toEqual({ [day]: 86_400, [short]: 3_600 });
  });

  it('never exceeds 24 hours', async () => {
    await expect(create('life-25h', 1441)).rejects.toThrow(/invalid_duration/);
    const id = await create('life-start');
    await expect(start(id, 1500)).rejects.toThrow(/invalid_duration/);
    await expect(db.admin(`update app.classes set status = 'active', started_at = now(), duration_minutes = 1500,
      expires_at = now() + interval '25 hours' where id = $1`, [id])).rejects.toThrow(/classes_duration_check/);
  });

  it('cannot be extended after it started', async () => {
    const id = await create('life-ext', 60);
    await start(id);
    await expect(db.admin(`update app.classes set expires_at = expires_at + interval '1 hour' where id = $1`, [id]))
      .rejects.toThrow(/classes_lifecycle_shape/);
  });

  it('denies sign-in exactly at the expiry instant', async () => {
    const id = await create('life-edge', 60);
    await start(id);
    const ok = await loginByName('life-edge', 'Secret-Pass-1');
    expect(ok.outcome).toBe('ok');
    await db.admin(`update app.classes set started_at = now() - interval '60 minutes', expires_at = now() where id = $1`, [id]);
    expect((await loginByName('life-edge', 'Secret-Pass-1')).outcome).toBe('expired');
    const [v] = await db.as<{ reason: string }>('service_role', null, 'select reason from public.student_validate_session($1, $2)', [id, hex64()]);
    expect(v.reason).toBe('no_session');
  });
});

describe('teacher sign-in throttle', () => {
  it('blocks a client after 10 failures and an account after 8', async () => {
    const client = hex64();
    const allowed = async (c: string, a: string) =>
      (await db.as<{ ok: boolean }>('service_role', null, 'select public.auth_check_rate($1, $2, $3) as ok', ['teacher', c, a]))[0].ok;
    const fail = (c: string, a: string) => db.as('service_role', null, 'select public.auth_record_attempt($1, $2, $3, false)', ['teacher', c, a]);
    for (let i = 0; i < 10; i++) {
      expect(await allowed(client, hex64())).toBe(true);
      await fail(client, hex64());
    }
    expect(await allowed(client, hex64())).toBe(false);
    const account = hex64();
    for (let i = 0; i < 8; i++) await fail(hex64(), account);
    expect(await allowed(hex64(), account)).toBe(false);
    await expect(db.as('anon', null, `select public.auth_check_rate('teacher', '${client}', '${account}')`)).rejects.toThrow(/permission denied/);
  });
});
