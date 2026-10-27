// Heartbeat. Returns only whether this browser may keep using the application.
import { uuidSchema } from '@/lib/domain';
import { json, unexpected } from '@/lib/http';
import { checkAccessSession } from '@/lib/access-session';

export async function GET(_request: Request, ctx: RouteContext<'/api/access/[id]/session'>) {
  try {
    const { id } = await ctx.params;
    if (!uuidSchema.safeParse(id).success) return json({ valid: false, reason: 'no_session' }, 401);
    const check = await checkAccessSession(id);
    if (!check.valid) {
      return json({ valid: false, reason: check.reason }, check.reason === 'unavailable' ? 503 : 401);
    }
    return json({ valid: true, expiresAt: check.expiresAt, sessionExpiresAt: check.sessionExpiresAt, serverNow: check.serverNow });
  } catch (err) {
    return unexpected(err, 'access.session');
  }
}
