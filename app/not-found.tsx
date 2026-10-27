import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="center-page">
      <div className="card auth-card">
        <div className="card-body">
          <div className="auth-head">
            <h1>Page not found</h1>
            <p className="muted">Check the link and try again.</p>
          </div>
          <Link className="btn" href="/">
            Go to home page
          </Link>
        </div>
      </div>
    </main>
  );
}
