'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="center-page">
      <div className="card auth-card" role="alert">
        <div className="card-body">
          <div className="auth-head">
            <h1>Something went wrong</h1>
            <p className="muted">
              The server could not complete this request. If this keeps happening, the application may not be fully configured.
            </p>
          </div>
          <button className="btn btn-primary" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
