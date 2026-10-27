'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AccessRecord } from '@/lib/access';
import { DURATION_OPTIONS, formatDuration } from '@/lib/domain';
import { api, ConfirmDialog, CopyField, useToast } from '@/components/ui';
import { Countdown, LocalTime } from '@/components/time';

type Pending = 'start' | 'end' | 'reset' | null;

export function AccessActions({ session: s, link, usesDatabase }: { session: AccessRecord; link: string; usesDatabase: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [duration, setDuration] = useState(s.duration_minutes);
  // After a state change the section holding the trigger disappears; move focus
  // to the heading of the new state so keyboard and screen-reader users follow.
  const heading = useRef<HTMLHeadingElement>(null);
  const focusNext = useRef(false);
  useEffect(() => {
    // Also when the server changed the status (e.g. expiry) and the focused control disappeared.
    if (focusNext.current || document.activeElement === document.body) {
      focusNext.current = false;
      heading.current?.focus();
    }
  }, [s.status]);

  // Keep the page in sync with the server (automatic expiry, other tabs).
  useEffect(() => {
    if (s.status !== 'active') return;
    const t = setInterval(() => router.refresh(), 30_000);
    return () => clearInterval(t);
  }, [s.status, router]);

  async function run(action: 'start' | 'end' | 'reset') {
    setBusy(true);
    const res = await api<{ status?: string }>(`/api/teacher/access/${s.id}/${action}`, {
      method: 'POST',
      body: action === 'start' ? JSON.stringify({ durationMinutes: duration }) : undefined,
    });
    setBusy(false);
    setConfirm(null);
    if (!res.ok) {
      toast('error', res.message);
      router.refresh();
      return;
    }
    focusNext.current = action !== 'reset';
    if (action === 'start') toast('success', 'Access started. Share the link and the credentials with your students.');
    else if (action === 'end') toast('success', res.data.status === 'expired' ? 'The access had already expired.' : 'Access ended. Students can no longer use it.');
    else toast('success', 'Workspace data was reset to the imported data set.');
    router.refresh();
  }

  return (
    <>
      {s.status === 'draft' && (
        <section className="card" aria-labelledby="ready-h">
          <div className="card-body stack">
            <div>
              <h2 id="ready-h" ref={heading} tabIndex={-1}>
                Ready to start
              </h2>
              <p className="muted" style={{ marginTop: 4 }}>
                Students cannot sign in until you start the access. It then ends automatically after the selected duration.
              </p>
            </div>
            <div className="field" style={{ maxWidth: 260 }}>
              <label htmlFor="start-duration">Duration</label>
              <select id="start-duration" className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {DURATION_OPTIONS.map((o) => (
                  <option key={o.minutes} value={o.minutes}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <button className="btn btn-primary" onClick={() => setConfirm('start')}>
                Start Access
              </button>
              <Link className="btn" href={`/teacher/access/${s.id}/credentials`}>
                Change credentials
              </Link>
              <button className="btn" onClick={() => setConfirm('end')}>
                Discard draft
              </button>
            </div>
          </div>
        </section>
      )}

      {s.status === 'active' && s.expires_at && (
        <section className="card" aria-labelledby="live-h">
          <div className="card-header">
            <h2 id="live-h" ref={heading} tabIndex={-1}>
              Active Access
            </h2>
            <span className="small muted">
              Expires At <LocalTime value={s.expires_at} /> · ends in <Countdown expiresAt={s.expires_at} serverNow={s.server_now} />
            </span>
          </div>
          <div className="card-body stack">
            <dl className="dl">
              <dt>Access link</dt>
              <dd>
                <CopyField value={link} what="Access link" />
              </dd>
              <dt>Username</dt>
              <dd>
                <CopyField value={s.student_username} what="Username" />
              </dd>
              <dt>Password</dt>
              <dd className="muted small">Shown only when it is set. Use “Change credentials” to set a new one.</dd>
            </dl>
            <div className="row">
              <Link className="btn" href={`/teacher/access/${s.id}/credentials`}>
                Change credentials
              </Link>
              {usesDatabase && (
                <button className="btn" onClick={() => setConfirm('reset')}>
                  Reset Workspace Data
                </button>
              )}
              <button className="btn btn-danger" onClick={() => setConfirm('end')}>
                End Access
              </button>
            </div>
          </div>
        </section>
      )}

      {(s.status === 'closed' || s.status === 'expired') && (
        <div className="alert alert-info" role="status">
          <h2 className="sr-only" ref={heading} tabIndex={-1}>
            Access {s.status}
          </h2>
          This access is {s.status === 'closed' ? 'ended' : 'expired'}. Students can no longer use it.
          {usesDatabase && ' Its business data is kept.'} To grant access again, <Link href="/teacher/access/new">create a new access</Link>.
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'start'}
        title="Start this access?"
        confirmLabel="Start Access"
        busy={busy}
        onConfirm={() => run('start')}
        onCancel={() => setConfirm(null)}
      >
        Students can sign in with the access credentials for {formatDuration(duration)}, or until you end the access.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'end'}
        title={s.status === 'draft' ? 'Discard this draft?' : 'End this access now?'}
        confirmLabel={s.status === 'draft' ? 'Discard draft' : 'End Access'}
        danger
        busy={busy}
        onConfirm={() => run('end')}
        onCancel={() => setConfirm(null)}
      >
        {s.status === 'draft'
          ? 'The draft is closed and cannot be started.'
          : 'All students are signed out immediately and the credentials stop working. This cannot be undone.'}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === 'reset'}
        title="Reset workspace data?"
        confirmLabel="Reset Workspace Data"
        danger
        busy={busy}
        onConfirm={() => run('reset')}
        onCancel={() => setConfirm(null)}
      >
        All postings and changes made in this access are removed and the imported data set is restored. Students stay signed in.
        This cannot be undone.
      </ConfirmDialog>
    </>
  );
}
