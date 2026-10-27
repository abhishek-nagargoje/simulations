// Student access sessions: an opaque random token in an HttpOnly cookie.
// The database stores only HMAC-SHA256(token) and re-validates the access
// session's status, expiry and credential version on every request, so the
// cookie's own lifetime is never trusted for authorization.
import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { serverEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/supabase/server';

export const STUDENT_SESSION_TTL_SECONDS = 8 * 60 * 60;

export function cookieName(accessId: string) {
  return `acc_${accessId.replace(/-/g, '')}`;
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: STUDENT_SESSION_TTL_SECONDS,
  };
}

export function newToken() {
  return randomBytes(32).toString('base64url');
}

export function hmac(value: string, secret = serverEnv().signingSecret) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

/** Rate-limit key derived from the client IP. The raw IP is never stored. */
export function clientKey(headers: Headers) {
  const ip =
    headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  return hmac(`ip:${ip}`);
}

export type SessionCheck =
  | {
      valid: true;
      accessName: string;
      appSlug: string;
      appName: string;
      expiresAt: string;
      sessionExpiresAt: string;
      serverNow: string;
      /** Pseudonymous session reference for audit records (never the token). */
      sessionRef: string;
    }
  | { valid: false; reason: string; serverNow?: string };

/** Fails closed: any error is treated as "not authorized". */
export async function checkAccessSession(accessId: string): Promise<SessionCheck> {
  const token = (await cookies()).get(cookieName(accessId))?.value;
  if (!token) return { valid: false, reason: 'no_session' };
  try {
    const tokenHash = hmac(token);
    const { data, error } = await createServiceClient()
      .rpc('student_validate_session', { p_class_id: accessId, p_token_hash: tokenHash })
      .single<{
        valid: boolean;
        reason: string;
        class_name: string | null;
        simulation_slug: string | null;
        simulation_name: string | null;
        class_expires_at: string | null;
        session_expires_at: string | null;
        server_now: string;
      }>();
    if (error || !data) {
      console.error('[access] session validation failed', { accessId, code: error?.code });
      return { valid: false, reason: 'unavailable' };
    }
    if (!data.valid) return { valid: false, reason: data.reason, serverNow: data.server_now };
    return {
      valid: true,
      accessName: data.class_name!,
      appSlug: data.simulation_slug!,
      appName: data.simulation_name!,
      expiresAt: data.class_expires_at!,
      sessionExpiresAt: data.session_expires_at!,
      serverNow: data.server_now,
      sessionRef: `session:${tokenHash.slice(0, 12)}`,
    };
  } catch (err) {
    console.error('[access] session validation error', { accessId, name: (err as Error).name });
    return { valid: false, reason: 'unavailable' };
  }
}

/** Where a student goes when a session check fails. */
export function deniedTarget(accessId: string, reason: string) {
  if (reason === 'no_session') return `/access/${accessId}`;
  if (reason === 'revoked' || reason === 'session_expired') return `/access/${accessId}?reason=${reason}`;
  return `/access/${accessId}/ended?reason=${encodeURIComponent(reason)}`;
}
