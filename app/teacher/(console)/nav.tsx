'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

const LINKS = [
  { href: '/teacher/dashboard', label: 'Dashboard' },
  { href: '/teacher/access', label: 'Access Management' },
  { href: '/teacher/access/new', label: 'Create Access' },
  { href: '/teacher/applications', label: 'Applications' },
  { href: '/teacher/organization', label: 'Organization' },
];

export function AdminNav() {
  const path = usePathname();
  const current = (href: string) =>
    href === '/teacher/access' ? path === href || (path.startsWith('/teacher/access/') && path !== '/teacher/access/new') : path === href;
  return (
    <nav className="nav" aria-label="Teacher">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current(l.href) ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/teacher/logout', { method: 'POST' }).catch(() => {});
        router.replace('/teacher/login');
        router.refresh();
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
