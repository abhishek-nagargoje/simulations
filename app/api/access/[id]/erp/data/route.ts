// All business data of the access session's SAP ERP workspace.
import { json, unexpected } from '@/lib/http';
import { mapErpError } from '@/lib/erp/api';
import { requireErpSession } from '@/lib/erp/guard';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(_request: Request, ctx: RouteContext<'/api/access/[id]/erp/data'>) {
  try {
    const { id } = await ctx.params;
    const auth = await requireErpSession(id);
    if ('response' in auth) return auth.response;
    const { data, error } = await createServiceClient().rpc('erp_export_for_class', { p_class_id: id });
    if (error) {
      const m = mapErpError(error);
      if (m.status >= 500) console.error('[erp] export failed', { accessId: id, code: error.code });
      return json({ error: { code: m.code, message: m.message } }, m.status);
    }
    return json(data);
  } catch (err) {
    return unexpected(err, 'erp.data');
  }
}
