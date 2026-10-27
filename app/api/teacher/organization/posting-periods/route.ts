import { z } from 'zod';
import { requireAdminApi } from '@/lib/admin-auth';
import { assertSameOrigin, dbFailure, fail, json, readJson, unexpected } from '@/lib/http';

const schema = z
  .object({
    bukrs: z.string().regex(/^[0-9A-Z]{4}$/),
    fiscalYear: z.number().int().min(2000).max(2100),
    fromPeriod: z.number().int().min(1).max(12),
    toPeriod: z.number().int().min(1).max(12),
  })
  .refine((v) => v.fromPeriod <= v.toPeriod, { message: 'The first open period must not be after the last one.' });

/** Opens a range of posting periods for a company code and fiscal year. */
export async function POST(request: Request) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const auth = await requireAdminApi();
    if ('response' in auth) return auth.response;
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) return fail(400, 'validation', parsed.error.issues[0]?.message ?? 'Invalid input.');
    const { bukrs, fiscalYear, fromPeriod, toPeriod } = parsed.data;
    const { error } = await auth.admin.supabase.rpc('admin_set_posting_period', {
      p_bukrs: bukrs, p_fiscal_year: fiscalYear, p_from: fromPeriod, p_to: toPeriod,
    });
    if (error) return dbFailure(error, 'teacher.organization.periods');
    return json({ ok: true });
  } catch (err) {
    return unexpected(err, 'teacher.organization.periods');
  }
}
