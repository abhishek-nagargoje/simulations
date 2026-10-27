import { requireAdminApi } from '@/lib/admin-auth';
import { listAccess } from '@/lib/access';
import { resolveApp } from '@/lib/apps/registry';
import { createAccessSchema } from '@/lib/domain';
import { assertSameOrigin, dbFailure, fail, json, readJson, unexpected } from '@/lib/http';

export async function GET() {
  try {
    const auth = await requireAdminApi();
    if ('response' in auth) return auth.response;
    const { sessions, error } = await listAccess(auth.admin.supabase);
    if (error) return dbFailure(error, 'teacher.access.list');
    return json({ sessions });
  } catch (err) {
    return unexpected(err, 'teacher.access.list');
  }
}

export async function POST(request: Request) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const auth = await requireAdminApi();
    if ('response' in auth) return auth.response;

    const parsed = createAccessSchema.safeParse(await readJson(request));
    if (!parsed.success) return fail(400, 'validation', parsed.error.issues[0]?.message ?? 'Invalid input.');
    const { requestId, name, application, username, password, durationMinutes } = parsed.data;
    if (!resolveApp(application)) return fail(400, 'invalid_simulation', 'Select an available application.');
    const { data, error } = await auth.admin.supabase.rpc('admin_create_class', {
      p_request_id: requestId,
      p_name: name,
      p_simulation_slug: application,
      p_username: username,
      p_password: password,
      p_duration_minutes: durationMinutes,
    });
    if (error) return dbFailure(error, 'teacher.access.create');
    return json({ id: data as string }, 201);
  } catch (err) {
    return unexpected(err, 'teacher.access.create');
  }
}
