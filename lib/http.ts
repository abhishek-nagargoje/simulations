import 'server-only';
import { NextResponse } from 'next/server';
import { ConfigError } from '@/lib/env';

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' };

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function fail(status: number, code: string, message: string) {
  return json({ error: { code, message } }, status);
}

/**
 * Rejects cross-site state-changing requests. Browsers always send Origin on
 * POST; it must match the host serving this app.
 */
export function assertSameOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) return fail(403, 'forbidden', 'Cross-origin request rejected.');
  try {
    if (new URL(origin).host !== host) return fail(403, 'forbidden', 'Cross-origin request rejected.');
  } catch {
    return fail(403, 'forbidden', 'Cross-origin request rejected.');
  }
  return null;
}

const DB_ERRORS: Record<string, [number, string]> = {
  not_authorized: [403, 'You are not authorized to perform this action.'],
  not_found: [404, 'The access session was not found.'],
  invalid_state: [409, 'This action is not allowed in the current state of the access session.'],
  invalid_simulation: [400, 'Select an available application.'],
  invalid_username: [400, 'Username must be 3–40 characters: letters, numbers, dot, dash or underscore.'],
  invalid_password: [400, 'Password must be 8–72 characters.'],
  invalid_name: [400, 'Name must be 3–120 characters.'],
  invalid_duration: [400, 'Duration must be between 15 minutes and 24 hours.'],
  username_taken: [409, 'This username is already used by another open access session. Choose a different username.'],
  erp_baseline_missing: [409, 'The SAP ERP data has not been imported yet. Import it first (see Organization).'],
  invalid_request: [400, 'Invalid request.'],
};

/** Maps a database error to a safe response; unknown errors are logged, not echoed. */
export function dbFailure(error: { message?: string; code?: string } | null, context: string) {
  const key = Object.keys(DB_ERRORS).find((k) => error?.message?.includes(k));
  if (key) {
    const [status, message] = DB_ERRORS[key];
    return fail(status, key, message);
  }
  console.error(`[${context}] database error`, { code: error?.code });
  return fail(500, 'server_error', 'Something went wrong. Please try again.');
}

export function unexpected(err: unknown, context: string) {
  if (err instanceof ConfigError) {
    console.error(`[${context}] ${err.message}`);
    return fail(503, 'config_error', 'The server is not fully configured. Contact the administrator.');
  }
  console.error(`[${context}] unexpected error`, { name: (err as Error)?.name });
  return fail(500, 'server_error', 'Something went wrong. Please try again.');
}

/** Reads a JSON body with a size limit; null when missing, too large or invalid. */
export async function readJson(request: Request, maxBytes = 64_000): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return null;
  const text = await request.text().catch(() => '');
  if (!text || text.length > maxBytes) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
