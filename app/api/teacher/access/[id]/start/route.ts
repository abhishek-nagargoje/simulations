import { z } from 'zod';
import { requireAdminApi } from '@/lib/admin-auth';
import { durationSchema, uuidSchema } from '@/lib/domain';
import { assertSameOrigin, dbFailure, fail, json, readJson, unexpected } from '@/lib/http';

const bodySchema = z.object({ durationMinutes: durationSchema.optional() }).nullable();

export async function POST(request: Request, ctx: RouteContext<'/api/teacher/access/[id]/start'>) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return fail(404, 'not_found', 'The access session was not found.');
    const auth = await requireAdminApi();
    if ('response' in auth) return auth.response;
    const parsed = bodySchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(400, 'validation', parsed.error.issues[0]?.message ?? 'Invalid input.');
    // The expiry is set by the database clock: started_at + duration (max 24 h).
    const { error } = await auth.admin.supabase.rpc('admin_start_class', {
      p_class_id: id,
      p_duration_minutes: parsed.data?.durationMinutes ?? null,
    });
    if (error) return dbFailure(error, 'teacher.access.start');
    console.info('[teacher] access started', { accessId: id, actor: auth.admin.userId });
    return json({ ok: true });
  } catch (err) {
    return unexpected(err, 'teacher.access.start');
  }
}
