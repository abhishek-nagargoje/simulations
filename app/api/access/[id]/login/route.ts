// Student sign-in from an access link (the link identifies the session).
import { studentLoginSchema, uuidSchema } from '@/lib/domain';
import { assertSameOrigin, fail, json, readJson, unexpected } from '@/lib/http';
import { createServiceClient } from '@/lib/supabase/server';
import { STUDENT_SESSION_TTL_SECONDS, clientKey, hmac, newToken } from '@/lib/access-session';
import { LOGIN_OUTCOMES, loginOutcome, setSessionCookie } from '@/lib/access-login';

export async function POST(request: Request, ctx: RouteContext<'/api/access/[id]/login'>) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return fail(404, 'not_found', LOGIN_OUTCOMES.not_found[1]);
    const parsed = studentLoginSchema.safeParse(await readJson(request, 4_000));
    if (!parsed.success) return fail(400, 'validation', 'Enter your username and password.');

    const token = newToken();
    const { data, error } = await createServiceClient().rpc('student_login', {
      p_class_id: id,
      p_username: parsed.data.username,
      p_password: parsed.data.password,
      p_client_key: clientKey(request.headers),
      p_token_hash: hmac(token),
      p_session_ttl_seconds: STUDENT_SESSION_TTL_SECONDS,
    });
    if (error) {
      console.error('[access] login rpc failed', { accessId: id, code: error.code });
      return fail(503, 'unavailable', 'Sign-in is temporarily unavailable. Please try again.');
    }
    const outcome = data as string;
    if (outcome !== 'ok') {
      if (outcome === 'invalid_credentials' || outcome === 'rate_limited') console.warn('[access] login rejected', { accessId: id, outcome });
      return loginOutcome(outcome);
    }
    await setSessionCookie(id, token);
    return json({ ok: true, id });
  } catch (err) {
    return unexpected(err, 'access.link-login');
  }
}
