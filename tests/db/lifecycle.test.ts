import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { TestDb } from './harness';

const hex64 = () => randomBytes(32).toString('hex');
const CLIENT = hex64();

let db: TestDb;
let adminId: string;
let outsiderId: string;

async function createClass(opts: { username?: string; password?: string; sim?: string } = {}) {
  // A username belongs to at most one open access session; release it from earlier tests.
  await db.admin(
    `update app.classes set status = 'closed', closed_at = now()
      where student_username = $1 and status in ('draft', 'active')`,
    [opts.username ?? 'student'],
  );
  const [row] = await db.as<{ id: string }>(
    'authenticated', adminId,
    'select public.admin_create_class($1, $2, $3, $4, $5) as id',
    [randomUUID(), 'Batch A', opts.sim ?? 'hr-remedy-hrms', opts.username ?? 'student', opts.password ?? 'Secret-Pass-1'],
  );
  return row.id;
}

async function start(id: string) {
  await db.as('authenticated', adminId, 'select public.admin_start_class($1)', [id]);
}

async function login(id: string, username: string, password: string, token = hex64(), client = CLIENT) {
  const [row] = await db.as<{ r: string }>(
    'service_role', null,
    'select public.student_login($1, $2, $3, $4, $5) as r',
    [id, username, password, client, token],
  );
  return { result: row.r, token };
}

async function validate(id: string, token: string) {
  const [row] = await db.as<{ valid: boolean; reason: string; simulation_slug: string | null }>(
    'service_role', null, 'select * from public.student_validate_session($1, $2)', [id, token],
  );
  return row;
}

async function getClass(id: string) {
  const rows = await db.as<Record<string, unknown>>(
    'authenticated', adminId, 'select * from public.admin_list_classes($1)', [id],
  );
  return rows[0];
}

beforeAll(async () => {
  db = await TestDb.create();
  adminId = await db.createUser('training@example.test');
  outsiderId = await db.createUser('someone@example.test');
  await db.as('service_role', null, 'select public.bootstrap_admin($1)', ['TRAINING@example.test']);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('administrator authorization', () => {
  it('recognises the bootstrapped admin and nobody else', async () => {
    expect((await db.as<{ a: boolean }>('authenticated', adminId, 'select public.is_admin() as a'))[0].a).toBe(true);
    expect((await db.as<{ a: boolean }>('authenticated', outsiderId, 'select public.is_admin() as a'))[0].a).toBe(false);
  });

  it('rejects admin operations from a signed-in non-admin (fabricated identity)', async () => {
    await expect(
      db.as('authenticated', outsiderId, 'select public.admin_create_class($1,$2,$3,$4,$5)',
        [randomUUID(), 'Hack', 'hr-remedy-hrms', 'student', 'Secret-Pass-1']),
    ).rejects.toThrow(/not_authorized/);
    await expect(db.as('authenticated', outsiderId, 'select * from public.admin_list_classes()'))
      .rejects.toThrow(/not_authorized/);
  });

  it('denies anon (publishable key) access to every admin and student function', async () => {
    for (const sql of [
      'select public.admin_list_classes()',
      `select public.admin_start_class('${randomUUID()}')`,
      `select public.student_login('${randomUUID()}', 'a', 'b', '${hex64()}', '${hex64()}')`,
      `select * from public.student_validate_session('${randomUUID()}', '${hex64()}')`,
      `select public.bootstrap_admin('x@y.z')`,
    ]) {
      await expect(db.as('anon', null, sql)).rejects.toThrow(/permission denied/);
    }
  });

  it('denies authenticated users the service-only student and bootstrap functions', async () => {
    await expect(db.as('authenticated', adminId, `select public.bootstrap_admin('someone@example.test')`))
      .rejects.toThrow(/permission denied/);
    await expect(db.as('authenticated', outsiderId,
      `select public.student_login('${randomUUID()}', 'a', 'b', '${hex64()}', '${hex64()}')`))
      .rejects.toThrow(/permission denied/);
  });

  it('keeps private tables unreadable for anon and authenticated roles', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expect(db.as(role, adminId, 'select * from app.classes')).rejects.toThrow(/permission denied/);
      await expect(db.as(role, adminId, 'select * from app.student_sessions')).rejects.toThrow(/permission denied/);
    }
  });

  it('never returns the password hash from admin listings', async () => {
    const id = await createClass();
    const row = await getClass(id);
    expect(Object.keys(row)).not.toContain('student_password_hash');
    expect(JSON.stringify(row)).not.toMatch(/\$2[aby]\$/);
  });
});

describe('class lifecycle', () => {
  it('creates classes in draft and is idempotent per request id', async () => {
    const req = randomUUID();
    const args = [req, 'Batch B', 'hr-remedy-hrms', '  Student.One ', 'Secret-Pass-1'];
    const [a] = await db.as<{ id: string }>('authenticated', adminId, 'select public.admin_create_class($1,$2,$3,$4,$5) as id', args);
    const [b] = await db.as<{ id: string }>('authenticated', adminId, 'select public.admin_create_class($1,$2,$3,$4,$5) as id', args);
    expect(a.id).toBe(b.id);
    const row = await getClass(a.id);
    expect(row.status).toBe('draft');
    expect(row.student_username).toBe('student.one');
    expect(row.started_at).toBeNull();
    expect(row.expires_at).toBeNull();
  });

  it('rejects invalid input', async () => {
    const call = (name: string, sim: string, user: string, pass: string) =>
      db.as('authenticated', adminId, 'select public.admin_create_class($1,$2,$3,$4,$5)', [randomUUID(), name, sim, user, pass]);
    await expect(call('Ok name', 'not-a-sim', 'student', 'Secret-Pass-1')).rejects.toThrow(/invalid_simulation/);
    await expect(call('Ok name', 'hr-remedy-hrms', 'a b', 'Secret-Pass-1')).rejects.toThrow(/invalid_username/);
    await expect(call('Ok name', 'hr-remedy-hrms', 'student', 'short')).rejects.toThrow(/invalid_password/);
    await expect(call('x', 'hr-remedy-hrms', 'student', 'Secret-Pass-1')).rejects.toThrow(/invalid_name/);
    // Placeholder simulations without content are disabled and cannot be assigned.
    await expect(call('Ok name', 'zoho-crm', 'student', 'Secret-Pass-1')).rejects.toThrow(/invalid_simulation/);
  });

  it('does not admit students before the class starts', async () => {
    const id = await createClass();
    expect((await login(id, 'student', 'Secret-Pass-1')).result).toBe('not_started');
  });

  it('starting records server timestamps with a 24h expiry and is idempotent', async () => {
    const id = await createClass();
    await start(id);
    const first = await getClass(id);
    expect(first.status).toBe('active');
    const startedAt = new Date(first.started_at as string).getTime();
    const expiresAt = new Date(first.expires_at as string).getTime();
    expect(expiresAt - startedAt).toBe(24 * 60 * 60 * 1000);
    await start(id); // duplicate request
    const second = await getClass(id);
    expect(second.started_at).toEqual(first.started_at);
  });

  it('admits correct credentials, rejects wrong ones, and enforces the selected simulation', async () => {
    const id = await createClass({ sim: 'hr-remedy-hrms' });
    await start(id);
    expect((await login(id, 'student', 'wrong-password')).result).toBe('invalid_credentials');
    expect((await login(id, 'other', 'Secret-Pass-1')).result).toBe('invalid_credentials');
    expect((await login(id, 'student', 'secret-pass-1')).result).toBe('invalid_credentials'); // password is case-sensitive
    const ok = await login(id, ' STUDENT ', 'Secret-Pass-1');
    expect(ok.result).toBe('ok');
    const v = await validate(id, ok.token);
    expect(v.valid).toBe(true);
    expect(v.simulation_slug).toBe('hr-remedy-hrms');
  });

  it('does not let a session for one class authorize another class', async () => {
    const a = await createClass({ username: 'cross-a' });
    const b = await createClass({ username: 'cross-b' });
    await start(a);
    await start(b);
    const s = await login(a, 'cross-a', 'Secret-Pass-1');
    expect((await validate(b, s.token)).valid).toBe(false);
  });

  it('rate-limits repeated failures per client', async () => {
    const id = await createClass();
    await start(id);
    const client = hex64();
    for (let i = 0; i < 10; i++) {
      expect((await login(id, 'student', 'nope-nope', hex64(), client)).result).toBe('invalid_credentials');
    }
    expect((await login(id, 'student', 'Secret-Pass-1', hex64(), client)).result).toBe('rate_limited');
    expect((await login(id, 'student', 'Secret-Pass-1', hex64(), hex64())).result).toBe('ok');
  });

  it('rotating credentials revokes old sessions and old credentials', async () => {
    const id = await createClass();
    await start(id);
    const old = await login(id, 'student', 'Secret-Pass-1');
    const [{ v }] = await db.as<{ v: number }>('authenticated', adminId,
      'select public.admin_rotate_credentials($1, $2, $3) as v', [id, 'batch2', 'New-Secret-22']);
    expect(v).toBe(2);
    expect((await validate(id, old.token)).reason).toBe('revoked');
    expect((await login(id, 'student', 'Secret-Pass-1')).result).toBe('invalid_credentials');
    expect((await login(id, 'batch2', 'Secret-Pass-1')).result).toBe('invalid_credentials');
    const fresh = await login(id, 'batch2', 'New-Secret-22');
    expect(fresh.result).toBe('ok');
    expect((await validate(id, fresh.token)).valid).toBe(true);
  });

  it('closing blocks new logins, revokes sessions, is idempotent and cannot be undone', async () => {
    const id = await createClass();
    await start(id);
    const s = await login(id, 'student', 'Secret-Pass-1');
    const [{ r }] = await db.as<{ r: string }>('authenticated', adminId, 'select public.admin_close_class($1) as r', [id]);
    expect(r).toBe('closed');
    expect((await validate(id, s.token)).reason).toBe('closed');
    expect((await login(id, 'student', 'Secret-Pass-1')).result).toBe('closed');
    const [{ r: again }] = await db.as<{ r: string }>('authenticated', adminId, 'select public.admin_close_class($1) as r', [id]);
    expect(again).toBe('closed');
    await expect(start(id)).rejects.toThrow(/invalid_state/);
    await expect(db.as('authenticated', adminId, 'select public.admin_rotate_credentials($1, null, $2)', [id, 'Another-Pass-9']))
      .rejects.toThrow(/invalid_state/);
  });

  it('one shared credential pair admits a whole class at once, each with its own session', async () => {
    const id = await createClass({ username: 'shared-class', password: 'Shared-Pass-77' });
    await start(id);
    // 25 students sign in concurrently with the same username and password.
    const results = await Promise.all(
      Array.from({ length: 25 }, () => login(id, 'shared-class', 'Shared-Pass-77', hex64(), hex64())),
    );
    expect(results.every((r) => r.result === 'ok')).toBe(true);
    for (const r of results) expect((await validate(id, r.token)).valid).toBe(true);
    // Still exactly one credential pair: one row, credential version 1, no per-student credentials.
    const [row] = await db.admin<{ n: number; v: number; users: number }>(
      `select count(*)::int as n, max(credential_version)::int as v,
              count(distinct student_username)::int as users
         from app.classes where id = $1`, [id]);
    expect(row).toEqual({ n: 1, v: 1, users: 1 });
  });

  it('stores only a bcrypt hash of the shared password', async () => {
    const id = await createClass({ username: 'hash-check', password: 'Plain-Text-Never-1' });
    const [row] = await db.admin<{ h: string }>('select student_password_hash as h from app.classes where id = $1', [id]);
    expect(row.h).toMatch(/^\$2[aby]\$10\$/);
    expect(row.h).not.toContain('Plain-Text-Never-1');
    const [dump] = await db.admin<{ t: string }>('select row_to_json(c)::text as t from app.classes c where id = $1', [id]);
    expect(dump.t).not.toContain('Plain-Text-Never-1');
  });

  it('a new access gets a new id; the old one stays closed with its old credentials refused', async () => {
    const old = await createClass({ username: 'reuse-me', password: 'First-Pass-11' });
    await start(old);
    await db.as('authenticated', adminId, 'select public.admin_close_class($1)', [old]);
    // createClass would close nothing here: the username is free again once the old access ended.
    const [{ id: fresh }] = await db.as<{ id: string }>(
      'authenticated', adminId, 'select public.admin_create_class($1, $2, $3, $4, $5) as id',
      [randomUUID(), 'Batch B', 'hr-remedy-hrms', 'reuse-me', 'Second-Pass-22'],
    );
    await start(fresh);
    expect(fresh).not.toBe(old);
    expect((await getClass(old)).status).toBe('closed');
    expect((await login(old, 'reuse-me', 'First-Pass-11')).result).toBe('closed');
    expect((await login(old, 'reuse-me', 'Second-Pass-22')).result).toBe('closed');
    expect((await login(fresh, 'reuse-me', 'First-Pass-11')).result).toBe('invalid_credentials');
    expect((await login(fresh, 'reuse-me', 'Second-Pass-22')).result).toBe('ok');
  });

  it('expires exactly at expires_at without any sweep having run', async () => {
    const id = await createClass();
    await start(id);
    const s = await login(id, 'student', 'Secret-Pass-1');
    // Time-travel: move the window so that expires_at == now() (boundary) — status is still 'active' in the row.
    await db.admin(`update app.classes set started_at = now() - interval '24 hours',
                    expires_at = now() where id = $1`, [id]);
    const [row] = await db.admin<{ status: string }>('select status from app.classes where id = $1', [id]);
    expect(row.status).toBe('active');
    expect((await validate(id, s.token)).reason).toBe('expired');
    expect((await login(id, 'student', 'Secret-Pass-1')).result).toBe('expired');
    await expect(db.as('authenticated', adminId, 'select public.admin_rotate_credentials($1, null, $2)', [id, 'Another-Pass-9']))
      .rejects.toThrow(/invalid_state/);
  });

  it('still authorizes one second before expiry', async () => {
    const id = await createClass();
    await start(id);
    const s = await login(id, 'student', 'Secret-Pass-1');
    await db.admin(`update app.classes set started_at = now() - interval '24 hours' + interval '1 second',
                    expires_at = now() + interval '1 second' where id = $1`, [id]);
    expect((await validate(id, s.token)).valid).toBe(true);
  });

  it('sweep marks expired classes and they cannot be restarted', async () => {
    const id = await createClass();
    await start(id);
    await db.admin(`update app.classes set started_at = now() - interval '25 hours',
                    expires_at = now() - interval '1 hour' where id = $1`, [id]);
    const row = await getClass(id); // admin listing runs the sweep
    expect(row.status).toBe('expired');
    const [stored] = await db.admin<{ status: string }>('select status from app.classes where id = $1', [id]);
    expect(stored.status).toBe('expired');
    await expect(start(id)).rejects.toThrow(/invalid_state/);
  });

  it('caps a student session at the class expiry', async () => {
    const id = await createClass();
    await start(id);
    const s = await login(id, 'student', 'Secret-Pass-1');
    const [row] = await db.admin<{ ok: boolean }>(
      `select ss.expires_at <= c.expires_at as ok from app.student_sessions ss
         join app.classes c on c.id = ss.class_id where ss.class_id = $1`, [id]);
    expect(row.ok).toBe(true);
    expect((await validate(id, s.token)).valid).toBe(true);
  });

  it('logout revokes only that session', async () => {
    const id = await createClass();
    await start(id);
    const a = await login(id, 'student', 'Secret-Pass-1');
    const b = await login(id, 'student', 'Secret-Pass-1');
    await db.as('service_role', null, 'select public.student_logout($1, $2)', [id, a.token]);
    expect((await validate(id, a.token)).reason).toBe('revoked');
    expect((await validate(id, b.token)).valid).toBe(true);
  });

  it('writes audit records without secrets', async () => {
    const id = await createClass({ password: 'Audit-Secret-77' });
    await start(id);
    await db.as('authenticated', adminId, 'select public.admin_rotate_credentials($1, null, $2)', [id, 'Audit-Secret-88']);
    await db.as('authenticated', adminId, 'select public.admin_close_class($1)', [id]);
    const rows = await db.as<{ action: string; details: unknown }>(
      'authenticated', adminId, 'select action, details from public.admin_list_audit($1)', [id]);
    expect(rows.map((r) => r.action).sort()).toEqual(
      ['class.closed', 'class.created', 'class.credentials_rotated', 'class.started']);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain('Audit-Secret');
    expect(dump).not.toMatch(/\$2[aby]\$/);
  });

  it('allows changing draft credentials and discarding the draft, then nothing more', async () => {
    const id = await createClass({ username: 'draft-user' });
    const [{ v }] = await db.as<{ v: number }>('authenticated', adminId,
      'select public.admin_rotate_credentials($1, $2, null) as v', [id, 'draft-user2']);
    expect(v).toBe(2);
    const [{ r }] = await db.as<{ r: string }>('authenticated', adminId, 'select public.admin_close_class($1) as r', [id]);
    expect(r).toBe('closed');
    expect((await login(id, 'draft-user2', 'Secret-Pass-1')).result).toBe('closed');
    await expect(db.as('authenticated', adminId, 'select public.admin_rotate_credentials($1, $2, null)', [id, 'draft-user3']))
      .rejects.toThrow(/invalid_state/);
  });
});

describe('simulation catalogue (migration 2)', () => {
  it('lists HR Management first, SAP ERP second and placeholders as disabled', async () => {
    const rows = await db.as<{ slug: string; name: string; category: string; enabled: boolean }>(
      'authenticated', adminId, 'select slug, name, category, enabled from public.admin_list_simulations()');
    expect(rows[0]).toMatchObject({ slug: 'hr-remedy-hrms', name: 'HR Management', category: 'Human Resources', enabled: true });
    expect(rows.filter((r) => r.enabled).map((r) => r.slug)).toEqual(['hr-remedy-hrms', 'sap-erp']);
  });

  it('denies the catalogue to non-admins and anon', async () => {
    await expect(db.as('authenticated', outsiderId, 'select * from public.admin_list_simulations()')).rejects.toThrow(/not_authorized/);
    await expect(db.as('anon', null, 'select * from public.admin_list_simulations()')).rejects.toThrow(/permission denied/);
  });

  it('is non-destructive: keeps a placeholder enabled if a class already uses it, and is re-runnable', async () => {
    const old = await TestDb.create({ upTo: '20261026000100' });
    try {
      const uid = await old.createUser('t@example.test');
      await old.as('service_role', null, 'select public.bootstrap_admin($1)', ['t@example.test']);
      const [{ id }] = await old.as<{ id: string }>('authenticated', uid,
        'select public.admin_create_class($1,$2,$3,$4,$5) as id', [randomUUID(), 'Legacy', 'zoho-crm', 'student', 'Secret-Pass-1']);
      await old.applyMigration('20261026000200_hr_remedy_hrms.sql');
      await old.applyMigration('20261026000200_hr_remedy_hrms.sql'); // idempotent
      const sims = await old.admin<{ slug: string; enabled: boolean }>('select slug, enabled from app.simulations order by display_order');
      expect(sims).toEqual([
        { slug: 'hr-remedy-hrms', enabled: true },
        { slug: 'zoho-crm', enabled: true },
        { slug: 'sap-finance', enabled: false },
      ]);
      const [cls] = await old.admin<{ n: number }>('select count(*)::int as n from app.classes where id = $1', [id]);
      expect(cls.n).toBe(1);
    } finally {
      await old.close();
    }
  });
});
