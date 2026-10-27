// Serves the application module into the host page's frame — only after the
// database confirms an active, unrevoked session. The module is taken from the
// session (the application selected by the teacher), never from the URL.
import { uuidSchema } from '@/lib/domain';
import { renderApp, resolveApp } from '@/lib/apps/registry';
import { checkAccessSession } from '@/lib/access-session';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "frame-ancestors 'self'",
  'X-Robots-Tag': 'noindex, nofollow',
};

function denied(status: number, message: string) {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Access denied</title><p style="font-family:system-ui;padding:24px">${message}</p></html>`,
    { status, headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

export async function GET(_request: Request, ctx: RouteContext<'/access/[id]/app/content'>) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return denied(404, 'Not found.');

  const check = await checkAccessSession(id);
  if (!check.valid) return denied(check.reason === 'unavailable' ? 503 : 401, 'Your access is not active.');

  const mod = resolveApp(check.appSlug);
  if (!mod) return denied(404, 'This application is not available.');

  return new Response(renderApp(mod, id), {
    status: 200,
    headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}
