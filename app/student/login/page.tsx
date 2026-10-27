import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/brand';
import { StudentLoginForm } from '@/components/student-login-form';

export const metadata: Metadata = { title: 'Student Login' };

export default function StudentLoginPage() {
  return (
    <main className="center-page">
      <div className="card auth-card">
        <div className="card-body">
          <div className="auth-head">
            <Brand />
            <h1>Student Login</h1>
          </div>
          <StudentLoginForm />
          <p className="small">
            <Link href="/">← Back</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
