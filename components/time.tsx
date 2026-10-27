'use client';
import { useEffect, useState } from 'react';
import { formatRemaining } from '@/lib/domain';
import { formatDateTime } from './format';

/** Renders a timestamp in the viewer's own time zone (after hydration). */
export function LocalTime({ value }: { value: string | null }) {
  const [text, setText] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- locale/time zone are only known in the browser
  useEffect(() => setText(formatDateTime(value)), [value]);
  if (!value) return <span>—</span>;
  return (
    <time dateTime={value} title={value}>
      {text ?? '…'}
    </time>
  );
}

/**
 * Informational countdown. The offset between the server clock and the local
 * clock is applied so a wrong device clock does not distort it. Authorization
 * never depends on this value.
 */
export function Countdown({ expiresAt, serverNow }: { expiresAt: string; serverNow: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const skew = new Date(serverNow).getTime() - Date.now();
    const tick = () => setRemaining(new Date(expiresAt).getTime() - (Date.now() + skew));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [expiresAt, serverNow]);
  return <span className="mono">{remaining === null ? '…' : formatRemaining(remaining)}</span>;
}
