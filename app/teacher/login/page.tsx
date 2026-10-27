import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { createUserClient } from '@/lib/supabase/server';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Teacher Login' };

/** True only for a verified, role-checked teacher; any failure means "no". */
async function isSignedInTeacher(): Promise<boolean> {
  try {
    const supabase = await createUserClient();
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims) return false;
    const { data: isAdmin } = await supabase.rpc('is_admin');
    return isAdmin === true;
  } catch {
    return false;
  }
}

export default async function TeacherLoginPage({ searchParams }: PageProps<'/teacher/login'>) {
  if (await isSignedInTeacher()) redirect('/teacher/dashboard');
  const { error } = await searchParams;
  return (
    <main className="center-page">
      <div className="card auth-card">
        <div className="card-body">
          <div className="auth-head">
            <Brand />
            <h1>Teacher Login</h1>
          </div>
          <LoginForm initialError={error === 'forbidden' ? 'This account does not have teacher access.' : null} />
          <p className="small">
            <Link href="/">← Back</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
