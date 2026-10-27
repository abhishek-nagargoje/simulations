import 'server-only';
import { fail } from '@/lib/http';
import { checkAccessSession } from '@/lib/access-session';
import { uuidSchema } from '@/lib/domain';

/**
 * Every SAP ERP data request is authorized against the database: the access
 * session must be active and unexpired, the credential version current, and
 * the session's application must be SAP ERP. The workspace is derived from the
 * session on the database side; the browser never names it.
 */
export async function requireErpSession(accessId: string) {
  if (!uuidSchema.safeParse(accessId).success) return { response: fail(404, 'not_found', 'Not found.') } as const;
  const check = await checkAccessSession(accessId);
  if (!check.valid) {
    return check.reason === 'unavailable'
      ? ({ response: fail(503, 'unavailable', 'The service is temporarily unavailable. Please try again.') } as const)
      : ({ response: fail(401, check.reason, 'Your access has ended. Sign in again.') } as const);
  }
  if (check.appSlug !== 'sap-erp') return { response: fail(403, 'forbidden', 'Not available for this application.') } as const;
  return { session: check } as const;
}
