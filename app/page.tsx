import Link from 'next/link';
import { Brand } from '@/components/brand';

function StudentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
    </svg>
  );
}

function TeacherIcon() {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
      <path d="m7 12 3-3 2 2 4-4" />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="landing">
      <header className="landing-head">
        <Brand />
      </header>

      <main className="landing-main">
        <h1 className="sr-only">Sign in</h1>
        <div className="role-grid">
          <section className="card role-card" aria-labelledby="student-title">
            <span className="role-icon">
              <StudentIcon />
            </span>
            <h2 id="student-title">Student Login</h2>
            <Link className="btn btn-primary btn-block" href="/student/login">
              Student Login
            </Link>
          </section>

          <section className="card role-card" aria-labelledby="teacher-title">
            <span className="role-icon role-icon-alt">
              <TeacherIcon />
            </span>
            <h2 id="teacher-title">Teacher Login</h2>
            <Link className="btn btn-block" href="/teacher/login">
              Teacher Login
            </Link>
          </section>
        </div>
      </main>

      <footer className="landing-foot small">
        <Link href="/about">About</Link>
      </footer>
    </div>
  );
}
