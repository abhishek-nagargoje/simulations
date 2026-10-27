import type { Metadata } from 'next';
import { requireAdminPage } from '@/lib/admin-auth';
import { erpOverview } from '@/lib/access';
import { LoadError } from '@/components/access-table';
import { LocalTime } from '@/components/time';
import { CompanyCodeForm, PostingPeriodForm } from './organization-forms';

export const metadata: Metadata = { title: 'Organization' };

export default async function OrganizationPage() {
  const { supabase } = await requireAdminPage();
  const { overview, error } = await erpOverview(supabase);
  if (error || !overview) {
    return (
      <div className="stack">
        <h1>Organization</h1>
        <LoadError />
      </div>
    );
  }
  const imp = overview.last_import;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Organization</h1>
          <p>Settings of the SAP ERP application that apply to every access.</p>
        </div>
      </div>

      <section className="card" aria-labelledby="data-h">
        <div className="card-header">
          <h2 id="data-h">SAP ERP data</h2>
        </div>
        <div className="card-body stack">
          {overview.baseline_loaded ? (
            <p>The data set is imported. Each SAP ERP access receives its own copy of it when the access starts.</p>
          ) : (
            <div className="alert alert-warning" role="status">
              The data set has not been imported yet, so SAP ERP access cannot be started. An administrator imports it with{' '}
              <code>npm run import:sap -- &lt;workbook&gt; --apply</code> (see the documentation).
            </div>
          )}
          {imp && (
            <dl className="dl">
              <dt>Last import</dt>
              <dd>
                {imp.status === 'applied' ? 'Applied' : 'Failed'} · <LocalTime value={imp.finished_at ?? imp.started_at} />
              </dd>
              <dt>Mapping</dt>
              <dd className="mono">{imp.mapping_version}</dd>
            </dl>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="cc-h">
        <div className="card-header">
          <h2 id="cc-h">Company codes</h2>
        </div>
        <div className="card-body stack">
          <p className="muted small">Set the organization name shown for each company code. Later data imports keep the names set here.</p>
          {overview.company_codes.length === 0 ? (
            <p className="muted">No company codes yet.</p>
          ) : (
            overview.company_codes.map((c) => <CompanyCodeForm key={c.bukrs} code={c} />)
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="pp-h">
        <div className="card-header">
          <h2 id="pp-h">Open posting periods</h2>
        </div>
        <div className="card-body stack">
          <p className="muted small">
            Postings are accepted only in open periods. The fiscal year runs from April (period 1) to March (period 12).
          </p>
          <PostingPeriodForm companyCodes={overview.company_codes.map((c) => c.bukrs)} periods={overview.posting_periods} />
        </div>
      </section>
    </div>
  );
}
