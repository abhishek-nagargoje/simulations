// Student sign-in without a link: the username identifies the open access
// session (a username belongs to at most one open session at a time).
import { studentLoginSchema } from '@/lib/domain';
import { assertSameOrigin, fail, json, readJson, unexpected } from '@/lib/http';
import { createServiceClient } from '@/lib/supabase/server';
import { STUDENT_SESSION_TTL_SECONDS, clientKey, hmac, newToken } from '@/lib/access-session';
import { loginOutcome, setSessionCookie } from '@/lib/access-login';

export async function POST(request: Request) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const parsed = studentLoginSchema.safeParse(await readJson(request, 4_000));
    if (!parsed.success) return fail(400, 'validation', 'Enter your username and password.');

    const token = newToken();
    const { data, error } = await createServiceClient()
      .rpc('student_login_by_username', {
        p_username: parsed.data.username,
        p_password: parsed.data.password,
        p_client_key: clientKey(request.headers),
        p_token_hash: hmac(token),
        p_session_ttl_seconds: STUDENT_SESSION_TTL_SECONDS,
      })
      .single<{ outcome: string; class_id: string | null }>();
    if (error || !data) {
      console.error('[access] login rpc failed', { code: error?.code });
      return fail(503, 'unavailable', 'Sign-in is temporarily unavailable. Please try again.');
    }
    if (data.outcome !== 'ok' || !data.class_id) {
      if (data.outcome === 'invalid_credentials' || data.outcome === 'rate_limited') {
        console.warn('[access] login rejected', { outcome: data.outcome });
      }
      return loginOutcome(data.outcome);
    }
    await setSessionCookie(data.class_id, token);
    return json({ id: data.class_id });
  } catch (err) {
    return unexpected(err, 'access.login');
  }
}
