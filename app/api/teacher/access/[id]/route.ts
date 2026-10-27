import { requireAdminApi } from '@/lib/admin-auth';
import { listAccess } from '@/lib/access';
import { uuidSchema } from '@/lib/domain';
import { dbFailure, fail, json, unexpected } from '@/lib/http';

export async function GET(_request: Request, ctx: RouteContext<'/api/teacher/access/[id]'>) {
  try {
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return fail(404, 'not_found', 'The access session was not found.');
    const auth = await requireAdminApi();
    if ('response' in auth) return auth.response;
    const { sessions, error } = await listAccess(auth.admin.supabase, id);
    if (error) return dbFailure(error, 'teacher.access.get');
    if (!sessions[0]) return fail(404, 'not_found', 'The access session was not found.');
    return json({ session: sessions[0] });
  } catch (err) {
    return unexpected(err, 'teacher.access.get');
  }
}
