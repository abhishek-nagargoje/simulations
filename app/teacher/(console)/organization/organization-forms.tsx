'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { api, useToast } from '@/components/ui';

type Code = { bukrs: string; name: string; city: string | null; currency: string; configured: boolean };
type Period = { bukrs: string; fiscal_year: number; from_period: number; to_period: number };

export function CompanyCodeForm({ code }: { code: Code }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(code.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = `cc-${code.bukrs}`;
  const showError = (m: string) => {
    setError(m);
    input.current?.focus();
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      showError('Enter a name of at least 2 characters.');
      return;
    }
    setBusy(true);
    const res = await api('/api/teacher/organization/company-codes', { method: 'POST', body: JSON.stringify({ bukrs: code.bukrs, name }) });
    setBusy(false);
    if (!res.ok) {
      showError(res.message);
      return;
    }
    setError(null);
    toast('success', `Company code ${code.bukrs} updated.`);
    router.refresh();
  }

  return (
    <form className="inline-form" onSubmit={onSubmit} noValidate>
      <div className="field" style={{ flex: 1, minWidth: 220 }}>
        <label htmlFor={id}>
          Company code {code.bukrs}
          {code.city ? ` (${code.city})` : ''}
        </label>
        <input
          id={id}
          ref={input}
          className="input"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${id}-err` : `${id}-hint`}
        />
        {error ? (
          <span className="error" id={`${id}-err`} role="alert">{error}</span>
        ) : (
          <span className="hint" id={`${id}-hint`}>{code.configured ? 'Set by a teacher.' : 'Default name from the data import.'}</span>
        )}
      </div>
      <button className="btn" type="submit" disabled={busy || name.trim() === code.name}>
        Save<span className="sr-only"> company code {code.bukrs}</span>
      </button>
    </form>
  );
}

const PERIODS = Array.from({ length: 12 }, (_, i) => i + 1);

export function PostingPeriodForm({ companyCodes, periods }: { companyCodes: string[]; periods: Period[] }) {
  const router = useRouter();
  const toast = useToast();
  const years = [...new Set(periods.map((p) => p.fiscal_year))].sort();
  const [bukrs, setBukrs] = useState(companyCodes[0] ?? '');
  const [year, setYear] = useState(years[years.length - 1] ?? new Date().getFullYear());
  const current = periods.find((p) => p.bukrs === bukrs && p.fiscal_year === year);
  const [from, setFrom] = useState(current?.from_period ?? 1);
  const [to, setTo] = useState(current?.to_period ?? 12);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function select(nextBukrs: string, nextYear: number) {
    setBukrs(nextBukrs);
    setYear(nextYear);
    const p = periods.find((x) => x.bukrs === nextBukrs && x.fiscal_year === nextYear);
    setFrom(p?.from_period ?? 1);
    setTo(p?.to_period ?? 12);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (from > to) {
      setError('The first open period must not be after the last one.');
      document.getElementById('pp-from')?.focus();
      return;
    }
    setBusy(true);
    const res = await api('/api/teacher/organization/posting-periods', {
      method: 'POST',
      body: JSON.stringify({ bukrs, fiscalYear: year, fromPeriod: from, toPeriod: to }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setError(null);
    toast('success', `Posting periods ${from}–${to} of ${year} are open for company code ${bukrs}.`);
    router.refresh();
  }

  if (!companyCodes.length) return <p className="muted">No company codes yet.</p>;
  return (
    <>
      <div className="table-wrap" role="region" aria-label="Open posting periods" tabIndex={0}>
        <table className="table">
          <caption className="sr-only">Open posting periods</caption>
          <thead>
            <tr>
              <th scope="col">Company code</th>
              <th scope="col">Fiscal year</th>
              <th scope="col">Open periods</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => (
              <tr key={`${p.bukrs}-${p.fiscal_year}`}>
                <td>{p.bukrs}</td>
                <td>{p.fiscal_year}</td>
                <td>
                  {p.from_period}–{p.to_period}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="inline-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="pp-bukrs">Company code</label>
          <select id="pp-bukrs" className="select" value={bukrs} onChange={(e) => select(e.target.value, year)}>
            {companyCodes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pp-year">Fiscal year</label>
          <input id="pp-year" className="input" type="number" min={2000} max={2100} value={year} onChange={(e) => select(bukrs, Number(e.target.value))} />
        </div>
        <div className="field">
          <label htmlFor="pp-from">From period</label>
          <select id="pp-from" className="select" aria-invalid={!!error || undefined} aria-describedby={error ? 'pp-err' : undefined} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {PERIODS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pp-to">To period</label>
          <select id="pp-to" className="select" aria-invalid={!!error || undefined} aria-describedby={error ? 'pp-err' : undefined} value={to} onChange={(e) => setTo(Number(e.target.value))}>
            {PERIODS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <button className="btn" type="submit" disabled={busy}>
          Save periods
        </button>
      </form>
      {error && (
        <div className="alert alert-error" role="alert" id="pp-err">
          {error}
        </div>
      )}
    </>
  );
}
