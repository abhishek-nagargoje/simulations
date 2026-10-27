import { cookies } from 'next/headers';
import { uuidSchema } from '@/lib/domain';
import { assertSameOrigin, fail, json, unexpected } from '@/lib/http';
import { createServiceClient } from '@/lib/supabase/server';
import { cookieName, hmac } from '@/lib/access-session';

export async function POST(request: Request, ctx: RouteContext<'/api/access/[id]/logout'>) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return fail(404, 'not_found', 'Not found.');
    const store = await cookies();
    const token = store.get(cookieName(id))?.value;
    if (token) {
      const { error } = await createServiceClient().rpc('student_logout', { p_class_id: id, p_token_hash: hmac(token) });
      if (error) console.error('[access] logout rpc failed', { accessId: id, code: error.code });
    }
    store.delete(cookieName(id));
    return json({ ok: true });
  } catch (err) {
    return unexpected(err, 'access.logout');
  }
}
