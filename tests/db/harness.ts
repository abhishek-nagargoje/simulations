// Spins up an in-process Postgres (PGlite) that mimics the parts of Supabase the
// migration depends on: the anon/authenticated/service_role roles, Supabase's
// default EXECUTE grants on public functions, auth.users and auth.uid().
// The real migration file is then applied unchanged.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text unique);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
`;

export type Role = 'anon' | 'authenticated' | 'service_role';

export class TestDb {
  private constructor(readonly pg: PGlite) {}

  /** Applies migrations in order; `upTo` stops after the file whose name starts with it. */
  static async create(opts: { upTo?: string } = {}): Promise<TestDb> {
    const pg = await PGlite.create({ extensions: { pgcrypto } });
    await pg.exec(SUPABASE_STUB);
    const dir = join(process.cwd(), 'supabase', 'migrations');
    const db = new TestDb(pg);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      await db.applyMigration(file);
      if (opts.upTo && file.startsWith(opts.upTo)) break;
    }
    return db;
  }

  async applyMigration(file: string) {
    await this.pg.exec('reset role;');
    await this.pg.exec(readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8'));
  }

  async createUser(email: string): Promise<string> {
    const id = randomUUID();
    await this.pg.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
    return id;
  }

  /** Superuser query — used only to arrange test state (e.g. time travel). */
  async admin<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    await this.pg.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    return (await this.pg.query<T>(sql, params)).rows;
  }

  /** Runs a query as an API role, optionally as a specific signed-in user. */
  async as<T = Record<string, unknown>>(role: Role, userId: string | null, sql: string, params: unknown[] = []) {
    await this.pg.exec(`reset role;`);
    await this.pg.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
    await this.pg.exec(`set role ${role};`);
    try {
      return (await this.pg.query<T>(sql, params)).rows;
    } finally {
      await this.pg.exec(`reset role;`);
    }
  }

  async close() {
    await this.pg.close();
  }
}
