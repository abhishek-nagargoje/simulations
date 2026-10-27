import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-auth';
import { listAccess, listApplications } from '@/lib/access';
import { resolveApp } from '@/lib/apps/registry';
import { getOrigin } from '@/lib/origin';
import { AccessTable, LoadError } from '@/components/access-table';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const { supabase } = await requireAdminPage();
  const [{ sessions, error }, { applications, error: appError }, origin] = await Promise.all([
    listAccess(supabase),
    listApplications(supabase),
    getOrigin(),
  ]);
  if (error || appError) {
    return (
      <div className="stack">
        <h1>Dashboard</h1>
        <LoadError />
      </div>
    );
  }

  const active = sessions.filter((s) => s.status === 'active');
  const drafts = sessions.filter((s) => s.status === 'draft');
  const closed = sessions.filter((s) => s.status === 'closed').slice(0, 8);
  const expired = sessions.filter((s) => s.status === 'expired').slice(0, 8);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Dashboard</h1>
        <Link className="btn btn-primary" href="/teacher/access/new">
          Create Access
        </Link>
      </div>

      <section aria-labelledby="apps-h" className="stack">
        <h2 id="apps-h">Applications</h2>
        <div className="app-grid">
          {applications.map((a) => {
            const count = active.filter((s) => s.app_slug === a.slug).length;
            const installed = resolveApp(a.slug) !== null;
            return (
              <div className="card app-card" key={a.slug}>
                <div className="card-body stack-sm">
                  <h3>{a.name}</h3>
                  <p className="small muted">{a.category}</p>
                  <p className="small">
                    {count} active {count === 1 ? 'access' : 'accesses'}
                  </p>
                  {installed ? (
                    <Link className="btn btn-sm" href={`/teacher/access/new?application=${a.slug}`}>
                      Create Access<span className="sr-only"> for {a.name}</span>
                    </Link>
                  ) : (
                    <p className="small muted">Not installed on this server.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card" aria-labelledby="active-h">
        <div className="card-header">
          <h2 id="active-h">Active Access ({active.length})</h2>
        </div>
        <AccessTable sessions={active} origin={origin} caption="Active access" emptyTitle="No active access" emptyText="Start an access session to let students sign in." />
      </section>

      {drafts.length > 0 && (
        <section className="card" aria-labelledby="draft-h">
          <div className="card-header">
            <h2 id="draft-h">Not started ({drafts.length})</h2>
          </div>
          <AccessTable sessions={drafts} origin={origin} caption="Access not started" emptyTitle="" emptyText="" />
        </section>
      )}

      <section className="card" aria-labelledby="closed-h">
        <div className="card-header">
          <h2 id="closed-h">Recently closed</h2>
          <Link href="/teacher/access?filter=history" className="small">
            View history
          </Link>
        </div>
        <AccessTable sessions={closed} origin={origin} caption="Recently closed access" emptyTitle="Nothing closed yet" emptyText="Access you end appears here." />
      </section>

      <section className="card" aria-labelledby="expired-h">
        <div className="card-header">
          <h2 id="expired-h">Expired</h2>
        </div>
        <AccessTable sessions={expired} origin={origin} caption="Expired access" emptyTitle="Nothing expired yet" emptyText="Access that reached its time limit appears here." />
      </section>
    </div>
  );
}
