import { describe, expect, it, beforeAll, vi } from 'vitest';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  process.env.SESSION_SIGNING_SECRET = 'a'.repeat(48);
});

describe('same-origin protection', () => {
  it('accepts same-origin and rejects cross-site or missing origins', async () => {
    const { assertSameOrigin } = await import('@/lib/http');
    const req = (origin: string | null) =>
      new Request('https://app.test/api/x', {
        method: 'POST',
        headers: { host: 'app.test', ...(origin ? { origin } : {}) },
      });
    expect(assertSameOrigin(req('https://app.test'))).toBeNull();
    expect(assertSameOrigin(req('https://evil.test'))?.status).toBe(403);
    expect(assertSameOrigin(req(null))?.status).toBe(403);
    expect(assertSameOrigin(req('not a url'))?.status).toBe(403);
  });
});

describe('safe error mapping', () => {
  it('maps known database errors and hides unknown ones', async () => {
    const { dbFailure } = await import('@/lib/http');
    expect(dbFailure({ message: 'not_authorized' }, 't').status).toBe(403);
    expect(dbFailure({ message: 'invalid_state' }, 't').status).toBe(409);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = dbFailure({ message: 'relation "app.classes" does not exist', code: '42P01' }, 't');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('app.classes');
    spy.mockRestore();
  });
});

describe('student session tokens', () => {
  it('produces 64-hex HMACs that depend on the secret', async () => {
    const { hmac, newToken, clientKey, cookieName } = await import('@/lib/access-session');
    const t = newToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(hmac(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hmac(t, 'b'.repeat(48))).not.toBe(hmac(t));
    expect(newToken()).not.toBe(t);
    const k = clientKey(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }));
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toContain('203.0.113.9');
    expect(cookieName('7b0c1c1e-1d2f-4a3b-9c4d-5e6f7a8b9c0d')).toBe('acc_7b0c1c1e1d2f4a3b9c4d5e6f7a8b9c0d');
  });
  it('raises a configuration error without leaking values when the secret is missing', async () => {
    const { serverEnv, ConfigError } = await import('@/lib/env');
    const saved = process.env.SESSION_SIGNING_SECRET;
    process.env.SESSION_SIGNING_SECRET = 'short';
    expect(() => serverEnv()).toThrow(ConfigError);
    try { serverEnv(); } catch (e) { expect((e as Error).message).not.toContain('short'); }
    process.env.SESSION_SIGNING_SECRET = saved;
  });
});

describe('application registry', () => {
  it('only resolves registered, installed modules', async () => {
    const { resolveApp, APP_MODULES } = await import('@/lib/apps/registry');
    expect(resolveApp('../../etc/passwd')).toBeNull();
    expect(resolveApp('unknown-app')).toBeNull();
    expect(resolveApp('__proto__')).toBeNull();
    expect(Object.keys(APP_MODULES)).toEqual(['hr-remedy-hrms', 'sap-erp', 'zoho-crm', 'amazon-s4hana']);
    expect(resolveApp('sap-erp')?.storage).toBe('database');
  });
});

describe('ERP request validation and error mapping', () => {
  it('accepts well-formed batches only', async () => {
    const { commitSchema } = await import('@/lib/erp/api');
    const ok = { requestId: '7b0c1c1e-1d2f-4a3b-9c4d-5e6f7a8b9c0d', ops: [{ op: 'insert', t: 'BSIK', row: { BELNR: '1' } }] };
    expect(commitSchema.safeParse(ok).success).toBe(true);
    expect(commitSchema.safeParse({ ...ok, ops: [] }).success).toBe(false);
    expect(commitSchema.safeParse({ ...ok, requestId: 'x' }).success).toBe(false);
    expect(commitSchema.safeParse({ ...ok, ops: [{ op: 'delete', t: 'BSIK', key: {} }] }).success).toBe(false);
    expect(commitSchema.safeParse({ ...ok, ops: [{ op: 'insert', t: 'erp.vendor_items; drop', row: {} }] }).success).toBe(false);
  });
  it('maps database errors to safe messages', async () => {
    const { mapErpError } = await import('@/lib/erp/api');
    expect(mapErpError({ message: 'erp_invalid', details: 'Document 1 is not balanced.' })).toEqual({ status: 422, code: 'invalid', message: 'Document 1 is not balanced.' });
    expect(mapErpError({ message: 'erp_conflict', details: 'Changed by another user.' }).status).toBe(409);
    expect(mapErpError({ message: 'not_authorized' }).status).toBe(403);
    expect(mapErpError({ code: '23514', message: 'new row for relation "po_items" violates check constraint "po_items_gr_qty_check"' }).message)
      .toBe('The received quantity cannot exceed the ordered quantity.');
    expect(mapErpError({ code: '23503', message: 'violates foreign key constraint "vendor_items_kostl_fkey"' }).message).toBe('The cost center does not exist.');
    const internal = mapErpError({ code: '42P01', message: 'relation "erp.secret" does not exist' });
    expect(internal.status).toBe(500);
    expect(internal.message).not.toContain('erp.secret');
  });
});
