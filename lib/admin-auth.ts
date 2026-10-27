import 'server-only';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createUserClient } from '@/lib/supabase/server';
import { fail } from '@/lib/http';

type AdminContext = { supabase: SupabaseClient; userId: string; email: string | null };

/**
 * Verifies the Supabase JWT (getClaims validates the signature) and then asks
 * the database whether that user holds the admin role. Every admin_* database
 * function repeats the role check, so this is defence in depth, not the only gate.
 */
async function resolveAdmin(): Promise<AdminContext | 'unauthenticated' | 'forbidden'> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return 'unauthenticated';
  const { data: isAdmin, error: roleError } = await supabase.rpc('is_admin');
  if (roleError || isAdmin !== true) return 'forbidden';
  return { supabase, userId: claims.sub, email: (claims.email as string | undefined) ?? null };
}

export async function requireAdminPage(): Promise<AdminContext> {
  const result = await resolveAdmin();
  if (result === 'unauthenticated') redirect('/teacher/login');
  if (result === 'forbidden') redirect('/teacher/login?error=forbidden');
  return result;
}

export async function requireAdminApi() {
  const result = await resolveAdmin();
  if (result === 'unauthenticated') return { response: fail(401, 'unauthenticated', 'Please sign in.') } as const;
  if (result === 'forbidden') return { response: fail(403, 'forbidden', 'Administrator access required.') } as const;
  return { admin: result } as const;
}
