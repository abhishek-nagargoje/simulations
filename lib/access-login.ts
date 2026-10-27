import 'server-only';
import { cookies } from 'next/headers';
import { fail } from '@/lib/http';
import { cookieName, cookieOptions } from '@/lib/access-session';

export const LOGIN_OUTCOMES: Record<string, [number, string]> = {
  invalid_credentials: [401, 'Incorrect username or password.'],
  rate_limited: [429, 'Too many sign-in attempts. Please wait a few minutes and try again.'],
  not_found: [404, 'This access link is not valid.'],
  not_started: [403, 'Access has not started yet. Please wait for your teacher.'],
  closed: [403, 'This access has been ended by the teacher.'],
  expired: [403, 'This access has expired.'],
};

export function loginOutcome(outcome: string) {
  const [status, message] = LOGIN_OUTCOMES[outcome] ?? [400, 'Unable to sign in.'];
  return fail(status, outcome, message);
}

export async function setSessionCookie(accessId: string, token: string) {
  (await cookies()).set(cookieName(accessId), token, cookieOptions());
}
