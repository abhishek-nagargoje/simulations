'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PasswordInput } from '@/components/ui';

export function LoginForm({ initialError }: { initialError: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const router = useRouter();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const empty = [!email.trim() && 'email', !password && 'password'].filter(Boolean) as string[];
    setMissing(empty);
    if (empty.length) {
      setError(empty.length === 2 ? 'Enter your email address and password.' : empty[0] === 'email' ? 'Enter your email address.' : 'Enter your password.');
      document.getElementById(empty[0])?.focus();
      return;
    }
    setBusy(true);
    try {
      // Sign-in and the teacher-role check run on the server (see app/api/teacher/login).
      const res = await fetch('/api/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
        cache: 'no-store',
      });
      const body = await res.json().catch(() => null);
      if (res.ok) {
        router.replace('/teacher/dashboard');
        router.refresh();
        return;
      }
      setError(body?.error?.message ?? 'Sign-in failed. Please try again.');
      if (body?.error?.code === 'invalid_credentials') setPassword('');
    } catch {
      // Only a failed request (no response at all) is a connection problem.
      setError('The server could not be reached. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate aria-busy={busy}>
      {error && (
        <div className="alert alert-error" role="alert" id="login-error">
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          className="input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={missing.includes('email') || undefined}
          aria-describedby={error ? 'login-error' : undefined}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <PasswordInput
          id="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          invalid={missing.includes('password')}
          describedBy={error ? 'login-error' : undefined}
        />
      </div>
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign In'}
      </button>
    </form>
  );
}
