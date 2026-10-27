import { requireAdminApi } from '@/lib/admin-auth';
import { uuidSchema } from '@/lib/domain';
import { assertSameOrigin, dbFailure, fail, json, unexpected } from '@/lib/http';

/** Restores an active SAP ERP workspace to the imported data set (audited). */
export async function POST(request: Request, ctx: RouteContext<'/api/teacher/access/[id]/reset'>) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return fail(404, 'not_found', 'The access session was not found.');
    const auth = await requireAdminApi();
    if ('response' in auth) return auth.response;
    const { error } = await auth.admin.supabase.rpc('admin_reset_workspace', { p_class_id: id });
    if (error) return dbFailure(error, 'teacher.access.reset');
    console.info('[teacher] workspace reset', { accessId: id, actor: auth.admin.userId });
    return json({ ok: true });
  } catch (err) {
    return unexpected(err, 'teacher.access.reset');
  }
}
