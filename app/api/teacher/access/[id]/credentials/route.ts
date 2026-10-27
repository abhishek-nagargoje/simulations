import { requireAdminApi } from '@/lib/admin-auth';
import { rotateCredentialsSchema, uuidSchema } from '@/lib/domain';
import { assertSameOrigin, dbFailure, fail, json, readJson, unexpected } from '@/lib/http';

export async function POST(request: Request, ctx: RouteContext<'/api/teacher/access/[id]/credentials'>) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return fail(404, 'not_found', 'The access session was not found.');
    const auth = await requireAdminApi();
    if ('response' in auth) return auth.response;

    const parsed = rotateCredentialsSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(400, 'validation', parsed.error.issues[0]?.message ?? 'Invalid input.');
    // A new credential version revokes every session signed in with the previous one.
    const { data, error } = await auth.admin.supabase.rpc('admin_rotate_credentials', {
      p_class_id: id,
      p_username: parsed.data.username ?? null,
      p_password: parsed.data.password ?? null,
    });
    if (error) return dbFailure(error, 'teacher.access.credentials');
    console.info('[teacher] credentials changed', { accessId: id, actor: auth.admin.userId, version: data });
    return json({ credentialVersion: data as number });
  } catch (err) {
    return unexpected(err, 'teacher.access.credentials');
  }
}
