// Applies one batch of changes (one user action) to the SAP ERP workspace.
// The database function runs the whole batch in one transaction, assigns
// document numbers, validates the business rules and is idempotent per
// request id, so a retried request never posts twice.
import { assertSameOrigin, fail, json, readJson, unexpected } from '@/lib/http';
import { MAX_COMMIT_BYTES, commitSchema, mapErpError } from '@/lib/erp/api';
import { requireErpSession } from '@/lib/erp/guard';
import { createServiceClient } from '@/lib/supabase/server';

export async function POST(request: Request, ctx: RouteContext<'/api/access/[id]/erp/commit'>) {
  try {
    const blocked = assertSameOrigin(request);
    if (blocked) return blocked;
    const { id } = await ctx.params;
    const auth = await requireErpSession(id);
    if ('response' in auth) return auth.response;

    const parsed = commitSchema.safeParse(await readJson(request, MAX_COMMIT_BYTES));
    if (!parsed.success) return fail(400, 'validation', 'The request is invalid or too large.');

    const { data, error } = await createServiceClient().rpc('erp_commit_for_class', {
      p_class_id: id,
      p_request_id: parsed.data.requestId,
      p_ops: parsed.data.ops,
      p_actor: auth.session.sessionRef,
    });
    if (error) {
      const m = mapErpError(error);
      if (m.status >= 500) console.error('[erp] commit failed', { accessId: id, code: error.code });
      else console.info('[erp] commit rejected', { accessId: id, code: m.code });
      return json({ error: { code: m.code, message: m.message } }, m.status);
    }
    return json(data);
  } catch (err) {
    return unexpected(err, 'erp.commit');
  }
}
