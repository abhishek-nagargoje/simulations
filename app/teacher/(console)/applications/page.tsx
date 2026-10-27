import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-auth';
import { listAccess, listApplications } from '@/lib/access';
import { resolveApp } from '@/lib/apps/registry';
import { LoadError } from '@/components/access-table';
import { AppIcon } from '@/components/app-icon';

export const metadata: Metadata = { title: 'Applications' };

// Application launcher. Only applications that are enabled in the catalogue
// and actually installed on this server are offered. Each application's access
// is managed independently.
export default async function ApplicationsPage() {
  const { supabase } = await requireAdminPage();
  const [{ applications, error }, { sessions }] = await Promise.all([listApplications(supabase), listAccess(supabase)]);
  const available = applications.filter((a) => resolveApp(a.slug) !== null);
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Applications</h1>
      </div>
      {error ? (
        <LoadError />
      ) : available.length === 0 ? (
        <section className="card">
          <div className="card-body">
            <p className="muted">No applications are available.</p>
          </div>
        </section>
      ) : (
        <ul className="app-grid launcher" role="list">
          {available.map((a) => {
            const active = sessions.filter((s) => s.app_slug === a.slug && s.status === 'active').length;
            return (
              <li className="card app-card" key={a.slug}>
                <div className="card-body stack-sm">
                  <div className="app-card-head">
                    <AppIcon slug={a.slug} />
                    <h2>{a.name}</h2>
                  </div>
                  <p className="small muted">{a.description}</p>
                  <p className="small">{active === 0 ? 'No active access' : `${active} active ${active === 1 ? 'access' : 'accesses'}`}</p>
                  <div className="row-actions">
                    <Link className="btn btn-primary btn-sm" href={`/teacher/access?application=${a.slug}`}>
                      Open<span className="sr-only"> {a.name}</span>
                    </Link>
                    <Link className="btn btn-sm" href={`/teacher/access/new?application=${a.slug}`}>
                      Start new access<span className="sr-only"> for {a.name}</span>
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
