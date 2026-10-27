'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DURATION_OPTIONS, MAX_ACCESS_MINUTES, accessNameSchema, generatePassword, passwordSchema, usernameSchema } from '@/lib/domain';
import { api, CopyField, PasswordInput, useToast } from '@/components/ui';

type App = { slug: string; name: string; description: string; available: boolean };
type Errors = Partial<Record<'name' | 'application' | 'username' | 'password', string>>;

export function NewAccessForm({ applications: catalogue, preselect }: { applications: App[]; preselect?: string }) {
  const applications = catalogue.filter((a) => a.available);
  const toast = useToast();
  const [name, setName] = useState('');
  const [application, setApplication] = useState(preselect ?? applications[0]?.slug ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState(() => generatePassword());
  const [duration, setDuration] = useState<number>(MAX_ACCESS_MINUTES);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One idempotency key per form instance: a retry after a network error cannot create duplicates.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [created, setCreated] = useState<{ id: string; username: string; password: string } | null>(null);
  const createdHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (created) createdHeading.current?.focus();
  }, [created]);

  if (applications.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <h2>No applications available</h2>
          <p>No application module is installed on this server.</p>
        </div>
      </div>
    );
  }

  function validate(): Errors {
    const e: Errors = {};
    const n = accessNameSchema.safeParse(name);
    if (!n.success) e.name = n.error.issues[0].message;
    if (!applications.some((a) => a.slug === application)) e.application = 'Select an application.';
    const u = usernameSchema.safeParse(username);
    if (!u.success) e.username = u.error.issues[0].message;
    const p = passwordSchema.safeParse(password);
    if (!p.success) e.password = p.error.issues[0].message;
    return e;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    setFormError(null);
    const e = validate();
    setErrors(e);
    const first = (['name', 'application', 'username', 'password'] as const).find((k) => e[k]);
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
    setBusy(true);
    const res = await api<{ id: string }>('/api/teacher/access', {
      method: 'POST',
      body: JSON.stringify({ requestId, name, application, username, password, durationMinutes: duration }),
    });
    setBusy(false);
    if (!res.ok) {
      setFormError(res.message);
      return;
    }
    toast('success', 'Access created as a draft.');
    setCreated({ id: res.data.id, username: usernameSchema.parse(username), password });
  }

  if (created) {
    return (
      <section className="card" aria-labelledby="created-h">
        <div className="card-header">
          <h2 id="created-h" ref={createdHeading} tabIndex={-1}>
            Access created
          </h2>
        </div>
        <div className="card-body stack">
          <div className="alert alert-warning" role="status">
            Copy the password now. It is stored only as a hash and cannot be shown again; you can set a new one later.
          </div>
          <h3>Access Credentials</h3>
          <dl className="dl">
            <dt>Username</dt>
            <dd>
              <CopyField value={created.username} what="Username" />
            </dd>
            <dt>Password</dt>
            <dd>
              <CopyField value={created.password} what="Password" />
            </dd>
          </dl>
          <div className="row">
            <Link className="btn btn-primary" href={`/teacher/access/${created.id}`}>
              Open access to start it
            </Link>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setCreated(null);
                setName('');
                setUsername('');
                setPassword(generatePassword());
                setRequestId(crypto.randomUUID());
              }}
            >
              Create another
            </button>
          </div>
        </div>
      </section>
    );
  }

  const app = applications.find((a) => a.slug === application);
  return (
    <form className="card" onSubmit={onSubmit} noValidate>
      <div className="card-body form-grid">
        {formError && (
          <div className="alert alert-error" role="alert">
            {formError}
          </div>
        )}
        <div className="field">
          <label htmlFor="application">Application</label>
          <select
            id="application"
            className="select"
            value={application}
            onChange={(e) => setApplication(e.target.value)}
            aria-invalid={!!errors.application || undefined}
            aria-describedby={errors.application ? 'app-err' : 'app-hint'}
          >
            {applications.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.name}
              </option>
            ))}
          </select>
          {errors.application ? (
            <span className="error" id="app-err">{errors.application}</span>
          ) : (
            <span className="hint" id="app-hint">{app?.description}</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!errors.name || undefined}
            aria-describedby={errors.name ? 'name-err' : 'name-hint'}
            maxLength={120}
          />
          {errors.name ? (
            <span className="error" id="name-err">{errors.name}</span>
          ) : (
            <span className="hint" id="name-hint">For your reference, for example the batch and date.</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            className="input mono"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={!!errors.username || undefined}
            aria-describedby={errors.username ? 'user-err' : 'user-hint'}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {errors.username ? (
            <span className="error" id="user-err">{errors.username}</span>
          ) : (
            <span className="hint" id="user-hint">Shared by all students of this access. Must not be in use by another open access.</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <div className="input-group">
            <div style={{ flex: 1, minWidth: 0 }}>
              <PasswordInput
                id="password"
                value={password}
                onChange={setPassword}
                invalid={!!errors.password}
                describedBy={errors.password ? 'pass-err' : 'pass-hint'}
              />
            </div>
            <button type="button" className="btn" onClick={() => setPassword(generatePassword())}>
              Generate
            </button>
          </div>
          {errors.password ? (
            <span className="error" id="pass-err">{errors.password}</span>
          ) : (
            <span className="hint" id="pass-hint">8–72 characters, case-sensitive. Shown once after creating the access.</span>
          )}
        </div>

        <div className="field">
          <label htmlFor="duration">Duration after start</label>
          <select id="duration" className="select" value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-describedby="duration-hint">
            {DURATION_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
          <span className="hint" id="duration-hint">Access ends automatically at this time after you start it (24 hours at most). You can end it earlier.</span>
        </div>

        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create Access'}
          </button>
          <Link className="btn btn-ghost" href="/teacher/access">
            Cancel
          </Link>
        </div>
      </div>
    </form>
  );
}
