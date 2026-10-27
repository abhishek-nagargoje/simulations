'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { generatePassword, normalizeUsername, passwordSchema, usernameSchema } from '@/lib/domain';
import { api, ConfirmDialog, CopyField, PasswordInput, useToast } from '@/components/ui';

export function CredentialsForm({ accessId, currentUsername }: { accessId: string; currentUsername: string }) {
  const toast = useToast();
  const [username, setUsername] = useState(currentUsername);
  const [changePassword, setChangePassword] = useState(true);
  const [password, setPassword] = useState(() => generatePassword());
  const [errors, setErrors] = useState<{ username?: string; password?: string; form?: string }>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ username: string; password: string | null } | null>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (done) doneHeading.current?.focus();
  }, [done]);

  const newUsername = normalizeUsername(username);
  const usernameChanged = newUsername !== currentUsername;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    const u = usernameSchema.safeParse(username);
    if (!u.success) next.username = u.error.issues[0].message;
    if (changePassword) {
      const p = passwordSchema.safeParse(password);
      if (!p.success) next.password = p.error.issues[0].message;
    }
    if (!usernameChanged && !changePassword) next.form = 'Change the username, the password, or both.';
    setErrors(next);
    if (next.username) document.getElementById('username')?.focus();
    else if (next.password) document.getElementById('password')?.focus();
    if (Object.keys(next).length === 0) setConfirming(true);
  }

  async function submit() {
    setBusy(true);
    const res = await api<{ credentialVersion: number }>(`/api/teacher/access/${accessId}/credentials`, {
      method: 'POST',
      body: JSON.stringify({
        ...(usernameChanged ? { username: newUsername } : {}),
        ...(changePassword ? { password } : {}),
      }),
    });
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      setErrors({ form: res.message });
      return;
    }
    toast('success', 'Credentials updated. Students signed in with the previous credentials were signed out.');
    setDone({ username: newUsername, password: changePassword ? password : null });
  }

  if (done) {
    return (
      <section className="card" aria-labelledby="done-h">
        <div className="card-header">
          <h2 id="done-h" ref={doneHeading} tabIndex={-1}>
            New Access Credentials
          </h2>
        </div>
        <div className="card-body stack">
          {done.password && (
            <div className="alert alert-warning" role="status">
              Copy this password now. It cannot be shown again.
            </div>
          )}
          <dl className="dl">
            <dt>Username</dt>
            <dd>
              <CopyField value={done.username} what="Username" />
            </dd>
            {done.password && (
              <>
                <dt>Password</dt>
                <dd>
                  <CopyField value={done.password} what="Password" />
                </dd>
              </>
            )}
          </dl>
          <div className="row">
            <Link className="btn btn-primary" href={`/teacher/access/${accessId}`}>
              Back to access
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <div className="card-body form-grid">
        {errors.form && (
          <div className="alert alert-error" role="alert">
            {errors.form}
          </div>
        )}
        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            className="input mono"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={!!errors.username || undefined}
            aria-describedby={errors.username ? 'user-err' : undefined}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {errors.username && <span className="error" id="user-err">{errors.username}</span>}
        </div>
        <fieldset className="field fieldset">
          <legend className="sr-only">Password</legend>
          <label className="check">
            <input type="checkbox" checked={changePassword} onChange={(e) => setChangePassword(e.target.checked)} /> Set a new password
          </label>
          {changePassword && (
            <>
              <label htmlFor="password">New password</label>
              <div className="input-group">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <PasswordInput
                    id="password"
                    value={password}
                    onChange={setPassword}
                    invalid={!!errors.password}
                    describedBy={errors.password ? 'pass-err pass-hint' : 'pass-hint'}
                  />
                </div>
                <button type="button" className="btn" onClick={() => setPassword(generatePassword())}>
                  Generate
                </button>
              </div>
              <span className="hint" id="pass-hint">8–72 characters, case-sensitive.</span>
              {errors.password && <span className="error" id="pass-err">{errors.password}</span>}
            </>
          )}
        </fieldset>
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            Update credentials
          </button>
          <Link className="btn btn-ghost" href={`/teacher/access/${accessId}`}>
            Cancel
          </Link>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Update credentials?"
        confirmLabel="Update and sign students out"
        danger
        busy={busy}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      >
        Students signed in with the current credentials are signed out and must sign in again with the new ones.
      </ConfirmDialog>
    </form>
  );
}
