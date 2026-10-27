import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { uuidSchema } from '@/lib/domain';
import { resolveApp } from '@/lib/apps/registry';
import { checkAccessSession, deniedTarget } from '@/lib/access-session';
import { AppHost } from './app-host';

export async function generateMetadata({ params }: PageProps<'/access/[id]/app'>): Promise<Metadata> {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) return { title: 'Application' };
  const check = await checkAccessSession(id);
  return { title: check.valid ? check.appName : 'Application' };
}

export default async function AppPage({ params }: PageProps<'/access/[id]/app'>) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  const check = await checkAccessSession(id);
  if (!check.valid) redirect(deniedTarget(id, check.reason));

  return (
    <AppHost
      accessId={id}
      accessName={check.accessName}
      appName={check.appName}
      installed={resolveApp(check.appSlug) !== null}
      expiresAt={check.expiresAt}
      serverNow={check.serverNow}
    />
  );
}
