import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdminPage } from '@/lib/admin-auth';
import { listAccess } from '@/lib/access';
import { uuidSchema } from '@/lib/domain';
import { LoadError } from '@/components/access-table';
import { CredentialsForm } from './credentials-form';

export const metadata: Metadata = { title: 'Access Credentials' };

export default async function CredentialsPage({ params }: PageProps<'/teacher/access/[id]/credentials'>) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { supabase } = await requireAdminPage();
  const { sessions, error } = await listAccess(supabase, id);
  if (error) {
    return (
      <div className="stack">
        <h1>Access Credentials</h1>
        <LoadError />
      </div>
    );
  }
  const s = sessions[0];
  if (!s) notFound();

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="small">
            <Link href={`/teacher/access/${s.id}`}>← {s.name}</Link>
          </p>
          <h1 style={{ marginTop: 6 }}>Access Credentials</h1>
          <p>Students who are signed in are signed out and must use the new credentials.</p>
        </div>
      </div>
      {s.status === 'active' || s.status === 'draft' ? (
        <CredentialsForm accessId={s.id} currentUsername={s.student_username} />
      ) : (
        <div className="alert alert-info" role="status">
          Credentials can only be changed before the access ends. This access is {s.status === 'closed' ? 'ended' : 'expired'}.
        </div>
      )}
    </div>
  );
}
