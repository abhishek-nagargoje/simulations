import { requireAdminPage } from '@/lib/admin-auth';
import { ToastProvider } from '@/components/ui';
import { Brand } from '@/components/brand';
import { AdminNav, SignOutButton } from './nav';

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <ToastProvider>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="shell">
        <header className="sidebar">
          <Brand tone="light" />
          <AdminNav />
          <div className="sidebar-foot">
            <span className="email" title={admin.email ?? ''}>{admin.email}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="main" id="main" tabIndex={-1}>
          <div className="content">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
