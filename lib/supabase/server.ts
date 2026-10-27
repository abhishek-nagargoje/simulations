import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { publicEnv, serverEnv } from '@/lib/env';

/** Client acting as the signed-in administrator (RLS / grants as `authenticated`). */
export async function createUserClient() {
  // Read cookies first: it marks the route dynamic, so admin pages are never prerendered.
  const cookieStore = await cookies();
  const { supabaseUrl, publishableKey } = publicEnv();
  return createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}

/**
 * Privileged client for the student_* functions. Server-only: the secret key
 * never reaches a browser bundle (enforced by the `server-only` import).
 */
export function createServiceClient() {
  const { supabaseUrl, secretKey } = serverEnv();
  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
