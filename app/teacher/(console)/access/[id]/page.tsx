import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/admin-auth';
import { accessUrl, listAccess } from '@/lib/access';
import { APP_MODULES } from '@/lib/apps/registry';
import { formatDuration, uuidSchema } from '@/lib/domain';
import { getOrigin } from '@/lib/origin';
import { LoadError } from '@/components/access-table';
import { StatusBadge } from '@/components/ui';
import { LocalTime } from '@/components/time';
import { AccessActions } from './access-actions';

export const metadata: Metadata = { title: 'Access' };

const AUDIT_LABEL: Record<string, string> = {
  'class.created': 'Access created',
  'class.started': 'Access started',
  'class.credentials_rotated': 'Credentials changed',
  'class.closed': 'Access ended',
  'erp.workspace_reset': 'Workspace data reset',
};

export default async function AccessDetailPage({ params }: PageProps<'/teacher/access/[id]'>) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase } = await requireAdminPage();
  const [{ sessions, error }, audit, origin] = await Promise.all([
    listAccess(supabase, id),
    supabase.rpc('admin_list_audit', { p_class_id: id }),
    getOrigin(),
  ]);
  if (error) {
    return (
      <div className="stack">
        <h1>Access</h1>
        <LoadError />
      </div>
    );
  }
  const s = sessions[0];
  if (!s) notFound();
  const events = (audit.data ?? []) as { id: number; action: string; actor_email: string | null; created_at: string }[];
  const usesDatabase = APP_MODULES[s.app_slug]?.storage === 'database';

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="small">
            <Link href="/teacher/access">← Access Management</Link>
          </p>
          <h1 style={{ marginTop: 6 }}>{s.name}</h1>
          <div className="row" style={{ marginTop: 8 }}>
            <StatusBadge status={s.status} />
            <span className="muted small">{s.app_name}</span>
          </div>
        </div>
      </div>

      <AccessActions session={s} link={accessUrl(origin, s.id)} usesDatabase={usesDatabase} />

      <section className="card" aria-labelledby="details-h">
        <div className="card-header">
          <h2 id="details-h">Details</h2>
        </div>
        <div className="card-body">
          <dl className="dl">
            <dt>Application</dt>
            <dd>{s.app_name}</dd>
            <dt>Username</dt>
            <dd className="mono">{s.student_username}</dd>
            <dt>Duration</dt>
            <dd>{formatDuration(s.duration_minutes)}</dd>
            <dt>Credential version</dt>
            <dd>{s.credential_version}</dd>
            <dt>Created</dt>
            <dd>
              <LocalTime value={s.created_at} /> {s.created_by_email && <span className="muted">by {s.created_by_email}</span>}
            </dd>
            <dt>Started</dt>
            <dd>
              <LocalTime value={s.started_at} />
            </dd>
            <dt>Expires At</dt>
            <dd>
              <LocalTime value={s.expires_at} />
            </dd>
            <dt>Ended</dt>
            <dd>
              <LocalTime value={s.closed_at} />
            </dd>
            <dt>Business data</dt>
            <dd>
              {usesDatabase
                ? 'Stored in the database workspace of this access. Kept after the access ends.'
                : 'Stored in each student’s browser for this access.'}
            </dd>
          </dl>
        </div>
      </section>

      <section className="card" aria-labelledby="activity-h">
        <div className="card-header">
          <h2 id="activity-h">Activity</h2>
        </div>
        {events.length === 0 ? (
          <div className="empty">
            <p>No recorded activity.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table responsive" role="table">
              <caption className="sr-only">Activity</caption>
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">Event</th>
                  <th scope="col" role="columnheader">By</th>
                  <th scope="col" role="columnheader">When</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {events.map((e) => (
                  <tr role="row" key={e.id}>
                    <td role="cell" className="cell-primary">{AUDIT_LABEL[e.action] ?? e.action}</td>
                    <td role="cell" data-label="By">{e.actor_email ?? '—'}</td>
                    <td role="cell" data-label="When">
                      <LocalTime value={e.created_at} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
