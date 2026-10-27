import { requireAdminApi } from '@/lib/admin-auth';
import { uuidSchema } from '@/lib/domain';
import { assertSameOrigin, dbFailure, fail, json, unexpected } from '@/lib/http';

export async function POST(request: Request, ctx: RouteContext<'/api/teacher/access/[id]/end'>) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return fail(404, 'not_found', 'The access session was not found.');
    const auth = await requireAdminApi();
    if ('response' in auth) return auth.response;
    const { data, error } = await auth.admin.supabase.rpc('admin_close_class', { p_class_id: id });
    if (error) return dbFailure(error, 'teacher.access.end');
    console.info('[teacher] access ended', { accessId: id, actor: auth.admin.userId, status: data });
    return json({ status: data as string });
  } catch (err) {
    return unexpected(err, 'teacher.access.end');
  }
}
