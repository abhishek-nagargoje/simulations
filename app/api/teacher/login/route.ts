// Teacher sign-in. Runs on the server so that configuration problems, an
// unreachable authentication service, wrong credentials and missing teacher
// permissions are told apart (the browser previously reported every failure,
// including missing configuration, as a network error).
import { teacherLoginSchema } from '@/lib/domain';
import { assertSameOrigin, fail, json, readJson, unexpected } from '@/lib/http';
import { clientKey, hmac } from '@/lib/access-session';
import { createServiceClient, createUserClient } from '@/lib/supabase/server';

type AuthLikeError = { name?: string; status?: number; code?: string; message?: string };

function authFailure(error: AuthLikeError) {
  if (error.name === 'AuthRetryableFetchError' || error.status === 0 || error.status === undefined) {
    console.error('[teacher.login] authentication service unreachable', { name: error.name, status: error.status });
    return fail(503, 'unavailable', 'The sign-in service could not be reached. Please try again in a moment.');
  }
  if (error.code === 'email_not_confirmed') {
    return fail(403, 'email_not_confirmed', 'This account’s email address has not been confirmed yet.');
  }
  if (error.status === 429 || error.code === 'over_request_rate_limit') {
    return fail(429, 'rate_limited', 'Too many sign-in attempts. Please wait a few minutes and try again.');
  }
  if (error.code === 'invalid_credentials' || error.status === 400) {
    return fail(401, 'invalid_credentials', 'Incorrect email or password.');
  }
  console.error('[teacher.login] sign-in rejected', { status: error.status, code: error.code });
  return fail(502, 'auth_error', 'Sign-in failed. Please try again.');
}

export async function POST(request: Request) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const parsed = teacherLoginSchema.safeParse(await readJson(request, 4_000));
    if (!parsed.success) return fail(400, 'validation', 'Enter your email address and password.');
    const email = parsed.data.email.trim().toLowerCase();

    // Throttle by client and by account before contacting the auth service.
    const service = createServiceClient();
    const client = clientKey(request.headers);
    const account = hmac(`teacher:${email}`);
    const { data: allowed, error: rateError } = await service.rpc('auth_check_rate', {
      p_kind: 'teacher', p_client_key: client, p_account_key: account,
    });
    if (rateError) {
      console.error('[teacher.login] rate check failed', { code: rateError.code });
      return fail(503, 'unavailable', 'Sign-in is temporarily unavailable. Please try again in a moment.');
    }
    if (allowed !== true) return fail(429, 'rate_limited', 'Too many sign-in attempts. Please wait a few minutes and try again.');
    const record = (succeeded: boolean) =>
      service.rpc('auth_record_attempt', { p_kind: 'teacher', p_client_key: client, p_account_key: account, p_succeeded: succeeded });

    const supabase = await createUserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: parsed.data.password });
    if (signInError) {
      if (signInError.code === 'invalid_credentials' || signInError.status === 400) await record(false);
      return authFailure(signInError);
    }

    // Authentication alone is not enough: the teacher role must be verified.
    const { data: isAdmin, error: roleError } = await supabase.rpc('is_admin');
    if (roleError) {
      await supabase.auth.signOut();
      console.error('[teacher.login] role lookup failed', { code: roleError.code });
      return fail(503, 'unavailable', 'Your teacher permissions could not be verified. Please try again.');
    }
    if (isAdmin !== true) {
      await supabase.auth.signOut();
      await record(false);
      return fail(403, 'forbidden', 'This account does not have teacher access.');
    }
    await record(true);
    return json({ ok: true });
  } catch (err) {
    return unexpected(err, 'teacher.login');
  }
}
