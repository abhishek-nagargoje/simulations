import { z } from 'zod';
import { requireAdminApi } from '@/lib/admin-auth';
import { assertSameOrigin, dbFailure, fail, json, readJson, unexpected } from '@/lib/http';

const schema = z.object({
  bukrs: z.string().regex(/^[0-9A-Z]{4}$/),
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(80, 'Name must be at most 80 characters.'),
});

/** Sets the organization name of a company code (shown in the SAP ERP module). */
export async function POST(request: Request) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const auth = await requireAdminApi();
    if ('response' in auth) return auth.response;
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return fail(400, 'validation', parsed.error.issues[0]?.message ?? 'Invalid input.');
    const { error } = await auth.admin.supabase.rpc('admin_update_company_code', { p_bukrs: parsed.data.bukrs, p_name: parsed.data.name });
    if (error) return dbFailure(error, 'teacher.organization.company');
    return json({ ok: true });
  } catch (err) {
    return unexpected(err, 'teacher.organization.company');
  }
}
