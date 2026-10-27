import type { Metadata } from 'next';
import { requireAdminPage } from '@/lib/admin-auth';
import { listApplications } from '@/lib/access';
import { resolveApp } from '@/lib/apps/registry';
import { LoadError } from '@/components/access-table';
import { NewAccessForm } from './new-access-form';

export const metadata: Metadata = { title: 'Create Access' };

export default async function NewAccessPage({ searchParams }: PageProps<'/teacher/access/new'>) {
  const { supabase } = await requireAdminPage();
  const { application } = await searchParams;
  const { applications, error } = await listApplications(supabase);
  const options = applications.map(({ slug, name, description }) => ({ slug, name, description, available: resolveApp(slug) !== null }));
  const preselect = typeof application === 'string' && options.some((o) => o.slug === application && o.available) ? application : undefined;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Create Access</h1>
          <p>Access starts as a draft. Students can sign in only after you start it.</p>
        </div>
      </div>
      {error ? <LoadError /> : <NewAccessForm applications={options} preselect={preselect} />}
    </div>
  );
}
