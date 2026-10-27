import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdminPage } from '@/lib/admin-auth';
import { listAccess, listApplications } from '@/lib/access';
import { getOrigin } from '@/lib/origin';
import { AccessTable, LoadError } from '@/components/access-table';

export const metadata: Metadata = { title: 'Access Management' };

const FILTERS = {
  all: { label: 'All', match: () => true },
  active: { label: 'Active', match: (s: string) => s === 'active' },
  draft: { label: 'Not started', match: (s: string) => s === 'draft' },
  history: { label: 'History (closed and expired)', match: (s: string) => s === 'closed' || s === 'expired' },
} as const;

export default async function AccessListPage({ searchParams }: PageProps<'/teacher/access'>) {
  const { supabase } = await requireAdminPage();
  const { filter: raw, application: rawApp } = await searchParams;
  const filter = (typeof raw === 'string' && raw in FILTERS ? raw : 'all') as keyof typeof FILTERS;
  const [{ sessions: all, error }, { applications }, origin] = await Promise.all([
    listAccess(supabase),
    listApplications(supabase),
    getOrigin(),
  ]);
  // Optional application scope (from the Applications launcher).
  const app = applications.find((a) => a.slug === rawApp) ?? null;
  const sessions = app ? all.filter((s) => s.app_slug === app.slug) : all;
  const shown = sessions.filter((s) => FILTERS[filter].match(s.status));
  const href = (key: string) => {
    const q = new URLSearchParams();
    if (key !== 'all') q.set('filter', key);
    if (app) q.set('application', app.slug);
    const qs = q.toString();
    return qs ? `/teacher/access?${qs}` : '/teacher/access';
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{app ? app.name : 'Access Management'}</h1>
          {app && (
            <p>
              Access for this application only. <Link href="/teacher/access">Show all applications</Link>
            </p>
          )}
        </div>
        <Link className="btn btn-primary" href={app ? `/teacher/access/new?application=${app.slug}` : '/teacher/access/new'}>
          Create Access
        </Link>
      </div>
      {error ? (
        <LoadError />
      ) : (
        <section className="card" aria-labelledby="list-h">
          <h2 id="list-h" className="sr-only">
            {FILTERS[filter].label}
          </h2>
          <nav className="tabs" aria-label="Filter access">
            {Object.entries(FILTERS).map(([key, f]) => (
              <Link
                key={key}
                href={href(key)}
                aria-current={filter === key ? 'page' : undefined}
              >
                {f.label} ({sessions.filter((s) => f.match(s.status)).length})
              </Link>
            ))}
          </nav>
          <AccessTable
            sessions={shown}
            origin={origin}
            caption={FILTERS[filter].label}
            emptyTitle="Nothing here yet"
            emptyText={filter === 'history' ? 'Closed and expired access appears here.' : 'No access matches this filter.'}
          />
        </section>
      )}
    </div>
  );
}
