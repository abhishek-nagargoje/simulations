import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Brand } from '@/components/brand';
import { ClassOver } from '@/components/class-over';
import { uuidSchema } from '@/lib/domain';

export const metadata: Metadata = { title: 'Class is over' };

const MESSAGES: Record<string, [string, string]> = {
  not_started: ['Access is not available yet', 'Refresh the access link once your teacher starts it.'],
  unavailable: ['Temporarily unavailable', 'Your access could not be confirmed. Please try again in a moment.'],
};

export default async function EndedPage({ params, searchParams }: PageProps<'/access/[id]/ended'>) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const { reason } = await searchParams;
  if (reason === 'closed' || reason === 'expired') return <ClassOver />;
  const [title, text] = MESSAGES[typeof reason === 'string' ? reason : ''] ?? ['Session ended', 'Your session has ended.'];
  return (
    <main className="center-page">
      <div className="card auth-card" role="alert">
        <div className="card-body">
          <div className="auth-head">
            <Brand />
            <h1>{title}</h1>
            <p className="muted">{text}</p>
          </div>
          <Link className="btn btn-block" href={`/access/${id}`}>
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
