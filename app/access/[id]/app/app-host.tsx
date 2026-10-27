'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HEARTBEAT_INTERVAL_MS } from '@/lib/domain';
import { Countdown } from '@/components/time';
import { ClassOver } from '@/components/class-over';

const MAX_CONSECUTIVE_FAILURES = 3; // fail closed after ~36 s without a server answer

type Props = {
  accessId: string;
  accessName: string;
  appName: string;
  installed: boolean;
  expiresAt: string;
  serverNow: string;
};

const ENDED_MESSAGE: Record<string, string> = {
  revoked: 'Your teacher changed the sign-in details. Please sign in again.',
};

export function AppHost({ accessId, accessName, appName, installed, expiresAt, serverNow }: Props) {
  const [ended, setEnded] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const failures = useRef(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const offlineHeading = useRef<HTMLHeadingElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const wasOffline = useRef(false);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (offline) offlineHeading.current?.focus();
    else if (wasOffline.current) {
      // The paused overlay is gone: return focus to the page and say so.
      title.current?.focus();
      setAnnouncement('Connection restored.');
    }
    wasOffline.current = offline;
  }, [offline]);

  // Spoken warnings before the access time runs out (the countdown is visual only).
  useEffect(() => {
    const skew = new Date(serverNow).getTime() - Date.now();
    const remaining = new Date(expiresAt).getTime() - (Date.now() + skew);
    const timers = [5, 1]
      .filter((min) => remaining > min * 60_000)
      .map((min) =>
        setTimeout(
          () => setAnnouncement(`Access ends in ${min} minute${min > 1 ? 's' : ''}. Save your work.`),
          remaining - min * 60_000,
        ),
      );
    return () => timers.forEach(clearTimeout);
  }, [expiresAt, serverNow]);

  const leave = useCallback(
    (reason: string) => {
      // Remove the application first, then leave the protected page.
      setEnded(reason);
      const target =
        reason === 'revoked' || reason === 'session_expired'
          ? `/access/${accessId}?reason=${reason}`
          : reason === 'no_session'
            ? `/access/${accessId}`
            : `/access/${accessId}/ended?reason=${encodeURIComponent(reason)}`;
      setTimeout(() => window.location.replace(target), 1500);
    },
    [accessId],
  );

  const check = useCallback(async () => {
    try {
      const res = await fetch(`/api/access/${accessId}/session`, { cache: 'no-store', credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.valid) {
        failures.current = 0;
        setOffline(false);
        return;
      }
      if (res.status === 401 && body?.reason) {
        leave(body.reason);
        return;
      }
      throw new Error('unavailable');
    } catch {
      failures.current += 1;
      if (failures.current >= MAX_CONSECUTIVE_FAILURES) setOffline(true);
    }
  }, [accessId, leave]);

  useEffect(() => {
    if (ended) return;
    const timer = setInterval(check, HEARTBEAT_INTERVAL_MS);
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [check, ended]);

  const exit = useCallback(async () => {
    await fetch(`/api/access/${accessId}/logout`, { method: 'POST' }).catch(() => {});
    window.location.replace(`/access/${accessId}`);
  }, [accessId]);

  // The application asks the host to exit or reports that its access ended.
  // Only messages from our own frame and origin are accepted.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const type = (e.data as { type?: string } | null)?.type;
      if (type === 'access:exit') exit();
      if (type === 'access:ended') check();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [exit, check]);

  // The application is unmounted before anything else is shown.
  if (ended === 'closed' || ended === 'expired') return <ClassOver />;
  if (ended) {
    return (
      <main className="center-page">
        <div className="card auth-card" role="alert" aria-live="assertive">
          <div className="card-body">
            <h1>Session ended</h1>
            <p className="muted">{ENDED_MESSAGE[ended] ?? 'Your session has ended.'}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="app-frame">
      <header className="app-bar">
        <div>
          <h1 className="title" ref={title} tabIndex={-1}>
            {appName}
          </h1>
          <div className="small muted">
            {accessName} · Access ends in <Countdown expiresAt={expiresAt} serverNow={serverNow} />
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={exit}>
          Exit
        </button>
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </header>
      <main className="app-main">
        {offline && (
          <div className="center-page">
            <div className="card auth-card">
              <div className="card-body">
                <h2 ref={offlineHeading} tabIndex={-1}>
                  Connection lost
                </h2>
                <p className="muted" role="alert">
                  Your access cannot be confirmed right now, so the application is paused. It resumes automatically when the
                  connection returns.
                </p>
                <button className="btn btn-primary" onClick={check}>
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}
        {installed ? (
          // While offline the application stays loaded but hidden and inert,
          // so it cannot be used until the server re-confirms access.
          <iframe
            ref={frame}
            className="app-content"
            src={`/access/${accessId}/app/content`}
            title={appName}
            sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
            referrerPolicy="same-origin"
            hidden={offline}
            inert={offline}
          />
        ) : (
          <div className="center-page">
            <div className="card auth-card">
              <div className="card-body">
                <h2>Application not available</h2>
                <p className="muted">{appName} is not available on this server. Please let your teacher know.</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
