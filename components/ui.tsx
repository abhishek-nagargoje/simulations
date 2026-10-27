'use client';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { STATUS_LABEL, type AccessStatus } from '@/lib/domain';

export function StatusBadge({ status }: { status: AccessStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

// ---------------------------------------------------------------- Toasts

type Toast = { id: number; kind: 'success' | 'error' | 'info'; message: string };
const ToastContext = createContext<(kind: Toast['kind'], message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((kind: Toast['kind'], message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, message }]);
    // Errors stay until dismissed so they can be read at any pace.
    if (kind !== 'error') setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.message}</span>
            {t.kind === 'error' && (
              <button
                type="button"
                className="toast-close"
                aria-label="Dismiss message"
                onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------- Copy

export function CopyButton({ value, label = 'Copy', what }: { value: string; label?: string; what: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast('success', `${what} copied to clipboard.`);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('error', `Could not copy ${what.toLowerCase()}. Select and copy it manually.`);
    }
  }
  return (
    <button type="button" className="btn btn-sm" onClick={copy} aria-label={copied ? `${what} copied` : `${label} ${what.toLowerCase()}`}>
      {copied ? 'Copied' : label}
    </button>
  );
}

export function CopyField({ value, what }: { value: string; what: string }) {
  return (
    <div className="copy-field">
      <code>{value}</code>
      <CopyButton value={value} what={what} />
    </div>
  );
}

// ---------------------------------------------------------------- Password input

export function PasswordInput({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  autoComplete = 'new-password',
  name,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  describedBy?: string;
  autoComplete?: string;
  name?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-group">
      <input
        id={id}
        name={name}
        className="input mono"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete={autoComplete}
        spellCheck={false}
        autoCapitalize="off"
      />
      <button
        type="button"
        className="btn"
        onClick={() => setVisible((v) => !v)}
        aria-controls={id}
      >
        {visible ? 'Hide' : 'Show'}
        <span className="sr-only"> password</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Confirm dialog

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal(); // native modal: focus trap + Esc
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="modal-body">
        <h2 id={titleId}>{title}</h2>
        <div className="muted" id={descId}>
          {children}
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy} autoFocus>
          Cancel
        </button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------- Fetch helper

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

export async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, status: res.status, message: body?.error?.message ?? 'Something went wrong. Please try again.' };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, message: 'The server could not be reached. Check your connection and try again.' };
  }
}
