import { Component, createContext, useCallback, useContext, useEffect, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';
import { STAGE_LABEL } from './lib/format';

/** A page that fails to draw shows this instead of a blank screen; the sidebar keeps working. */
export class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('page failed', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card pad stack" data-testid="page-error" role="alert" style={{ maxWidth: 560 }}>
        <h2>This page couldn't be shown</h2>
        <div className="secondary">Nothing was changed. Try again, or open another page from the menu. If it keeps happening, note what you clicked and the time.</div>
        <div className="small muted num">{this.state.error.message}</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" data-testid="page-error-retry" onClick={() => this.setState({ error: null })}>Try again</button>
          <button className="btn secondary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="stack" style={{ gap: 4 }}>
        <h1>{title}</h1>
        {sub ? <div className="secondary">{sub}</div> : null}
      </div>
      {children ? <div className="row wrap no-print">{children}</div> : null}
    </div>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  const tone = stage === 'delivered' ? 'ok' : stage === 'cancelled' || stage === 'payment_failed' ? 'error' : stage === 'ready' || stage === 'out_for_delivery' ? 'gold' : 'dark';
  return <span className={`badge ${tone}`}>{STAGE_LABEL[stage] ?? stage}</span>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input className="input" {...p} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select className="input" {...p} />;
export const TextArea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea className="input" {...p} />;

export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="row spread">
          <h2>{title}</h2>
          <button className="btn ghost icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
        {footer ? <div className="row" style={{ justifyContent: 'flex-end' }}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading() {
  return <div className="empty">Loading…</div>;
}

type ToastFn = (message: string, tone?: 'ok' | 'error') => void;
const ToastContext = createContext<ToastFn>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: 'ok' | 'error' } | null>(null);
  const show = useCallback<ToastFn>((message, tone = 'ok') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <div className={`toast ${toast.tone === 'error' ? 'error' : ''}`} role="status">
          {toast.message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
