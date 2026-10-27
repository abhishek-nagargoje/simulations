'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PasswordInput } from '@/components/ui';

type Errors = Partial<Record<'username' | 'password' | 'form', string>>;

/**
 * Username + password only. From an access link the session is known from the
 * URL; without a link the username identifies the open access session.
 */
export function StudentLoginForm({ accessId, notice }: { accessId?: string; notice?: string | null }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!username.trim()) next.username = 'Enter your username.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    const first = (['username', 'password'] as const).find((k) => next[k]);
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(accessId ? `/api/access/${accessId}/login` : '/api/access/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        cache: 'no-store',
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.id) {
        router.replace(`/access/${body.id}/app`);
        return;
      }
      const code: string | undefined = body?.error?.code;
      if (accessId && (code === 'closed' || code === 'expired' || code === 'not_started' || code === 'not_found')) {
        router.refresh(); // the page re-renders with the matching state message
        return;
      }
      setErrors({ form: body?.error?.message ?? 'Unable to sign in. Please try again.' });
      if (code === 'invalid_credentials') setPassword('');
    } catch {
      setErrors({ form: 'The server could not be reached. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate aria-busy={busy}>
      {notice && !errors.form && (
        <div className="alert alert-info" role="status">
          {notice}
        </div>
      )}
      {errors.form && (
        <div className="alert alert-error" role="alert" id="login-error">
          {errors.form}
        </div>
      )}
      <div className="field">
        <label htmlFor="username">Username</label>
        <input
          id="username"
          className="input"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-invalid={!!errors.username || undefined}
          aria-describedby={errors.username ? 'username-err' : errors.form ? 'login-error' : undefined}
          autoComplete="username"
          autoCapitalize="off"
          spellCheck={false}
        />
        {errors.username && <span className="error" id="username-err">{errors.username}</span>}
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <PasswordInput
          id="password"
          value={password}
          onChange={setPassword}
          invalid={!!errors.password}
          describedBy={errors.password ? 'password-err' : errors.form ? 'login-error' : undefined}
          autoComplete="current-password"
        />
        {errors.password && <span className="error" id="password-err">{errors.password}</span>}
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign In'}
      </button>
    </form>
  );
}
