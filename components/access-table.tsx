import Link from 'next/link';
import type { AccessRecord } from '@/lib/access';
import { accessUrl } from '@/lib/access';
import { CopyButton, StatusBadge } from './ui';
import { LocalTime } from './time';

export function AccessTable({
  sessions,
  origin,
  emptyTitle,
  emptyText,
  caption,
}: {
  sessions: AccessRecord[];
  origin: string;
  emptyTitle: string;
  emptyText: string;
  caption: string;
}) {
  if (sessions.length === 0) {
    return (
      <div className="empty">
        <h3>{emptyTitle}</h3>
        <p>{emptyText}</p>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="table responsive" role="table">
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">Access</th>
            <th scope="col" role="columnheader">Status</th>
            <th scope="col" role="columnheader">Username</th>
            <th scope="col" role="columnheader">Started</th>
            <th scope="col" role="columnheader">Expires / ended</th>
            <th scope="col" role="columnheader">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {sessions.map((s) => (
            <tr role="row" key={s.id}>
              <td role="cell" className="cell-primary">
                <div>
                  <Link href={`/teacher/access/${s.id}`}>
                    <strong>{s.name}</strong>
                  </Link>
                  <span className="cell-sub">{s.app_name}</span>
                </div>
              </td>
              <td role="cell" data-label="Status">
                <StatusBadge status={s.status} />
              </td>
              <td role="cell" data-label="Username">
                <span className="mono">{s.student_username}</span>
              </td>
              <td role="cell" data-label="Started">
                <LocalTime value={s.started_at} />
              </td>
              <td role="cell" data-label={s.status === 'active' ? 'Expires' : 'Ended'}>
                <LocalTime value={s.status === 'active' || s.status === 'draft' ? s.expires_at : s.closed_at} />
              </td>
              <td role="cell" data-label="Actions">
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  {s.status === 'active' && <CopyButton value={accessUrl(origin, s.id)} label="Copy" what={`Access link for ${s.name}`} />}
                  <Link className="btn btn-sm" href={`/teacher/access/${s.id}`} aria-label={`${s.status === 'active' ? 'Manage' : 'Open'} ${s.name}`}>
                    {s.status === 'active' ? 'Manage' : 'Open'}
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LoadError() {
  return (
    <div className="alert alert-error" role="alert">
      Could not load data from the server. Refresh the page to try again.
    </div>
  );
}
