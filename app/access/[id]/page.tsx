import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { StudentLoginForm } from '@/components/student-login-form';
import { ClassOver } from '@/components/class-over';
import { uuidSchema } from '@/lib/domain';
import { createServiceClient } from '@/lib/supabase/server';
import { checkAccessSession } from '@/lib/access-session';

export const metadata: Metadata = { title: 'Student Login' };

type Info = { status: 'draft' | 'active' | 'closed' | 'expired'; appName: string | null };

async function loadInfo(id: string): Promise<Info | null | 'error'> {
  try {
    const { data, error } = await createServiceClient()
      .rpc('student_access_info', { p_class_id: id })
      .maybeSingle<{ status: Info['status']; app_name: string | null }>();
    if (error) {
      console.error('[access] info failed', { accessId: id, code: error.code });
      return 'error';
    }
    return data ? { status: data.status, appName: data.app_name } : null;
  } catch (err) {
    console.error('[access] info error', { accessId: id, name: (err as Error).name });
    return 'error';
  }
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="center-page">
      <div className="card auth-card">
        <div className="card-body">
          <div className="auth-head">
            <Brand />
            <h1>{title}</h1>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

export default async function AccessLoginPage({ params, searchParams }: PageProps<'/access/[id]'>) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { reason } = await searchParams;

  const session = await checkAccessSession(id);
  if (session.valid) redirect(`/access/${id}/app`);

  const info = await loadInfo(id);
  if (info === 'error') {
    return (
      <Shell title="Temporarily unavailable">
        <p className="muted">The service could not be reached. Refresh the page in a moment.</p>
      </Shell>
    );
  }
  if (!info) {
    return (
      <Shell title="Link not valid">
        <p className="muted">This access link is not valid. Check the link with your teacher.</p>
        <Link className="btn btn-block" href="/student/login">Student Login</Link>
      </Shell>
    );
  }
  if (info.status === 'draft') {
    return (
      <Shell title="Access is not available yet">
        <p className="muted">Refresh this page once your teacher starts it.</p>
      </Shell>
    );
  }
  // Closed or expired: the database compares its own clock with expires_at.
  if (info.status === 'closed' || info.status === 'expired') return <ClassOver />;

  const notice =
    reason === 'revoked'
      ? 'Your teacher changed the sign-in details. Sign in again with the new username and password.'
      : reason === 'session_expired'
        ? 'Your session expired. Please sign in again.'
        : null;

  return (
    <Shell title={info.appName ?? 'Student Login'}>
      <StudentLoginForm accessId={id} notice={notice} />
    </Shell>
  );
}
