import { Component, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { stageLabel, todayQatar, addDays } from './lib/format';
import { L, t } from './lib/i18n';
import { api } from './lib/api';

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
        <h2>{t("This page couldn't be shown", 'تعذّر عرض هذه الصفحة')}</h2>
        <div className="secondary">{t('Nothing was changed. Try again, or open another page from the menu. If it keeps happening, note what you clicked and the time.', 'لم يتغير شيء. حاول مجددًا أو افتح صفحة أخرى من القائمة. إن تكرر ذلك، دوّن ما ضغطت عليه والوقت.')}</div>
        <div className="small muted num">{this.state.error.message}</div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" data-testid="page-error-retry" onClick={() => this.setState({ error: null })}>{t('Try again', 'حاول مجددًا')}</button>
          <button className="btn secondary" onClick={() => window.location.reload()}>{t('Reload', 'إعادة التحميل')}</button>
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

export function StageBadge({ stage, thobes, channel }: { stage: string; thobes?: boolean; channel?: string }) {
  if (stage === 'delivered' && !thobes && (channel === 'pos' || channel === 'import')) return <span className="badge ok">{t('Completed', 'مكتمل')}</span>;
  const tone = stage === 'delivered' ? 'ok' : stage === 'cancelled' || stage === 'payment_failed' ? 'error' : stage === 'ready' || stage === 'out_for_delivery' ? 'gold' : 'dark';
  return <span className={`badge ${tone}`}>{stageLabel(stage, thobes)}</span>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  const auto = useId();
  const one = isValidElement<{ id?: string }>(children) && (children.type === Input || children.type === Select || children.type === TextArea || ['input', 'select', 'textarea'].includes(children.type as string)) ? children : null;
  const id = one ? (one.props.id ?? auto) : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {one ? cloneElement(one, { id }) : children}
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
          <button className="btn ghost icon-btn" onClick={onClose} aria-label={t('Close', 'إغلاق')}>
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
  return <div className="empty">{t('Loading…', 'جارٍ التحميل…')}</div>;
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

type ConfirmFn = (o?: { title?: string; message?: string; ok?: string }) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn>(async () => true);
/**
 * Asks before an edit is saved: "Save changes?" with Save and Cancel. Use it for changes to
 * something that already exists, not for creating something new.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<{ title: string; message: string; ok: string; done: (v: boolean) => void } | null>(null);
  const confirm = useCallback<ConfirmFn>(
    (o) =>
      new Promise<boolean>((done) =>
        setAsk({
          title: o?.title ?? t('Save changes?', 'حفظ التعديلات؟'),
          message: o?.message ?? t('The changes replace what was saved before.', 'ستحل التعديلات محل ما حُفظ سابقًا.'),
          ok: o?.ok ?? t('Save', 'حفظ'),
          done,
        }),
      ),
    [],
  );
  current = confirm;
  const close = (v: boolean) => {
    ask?.done(v);
    setAsk(null);
  };
  useEffect(() => {
    if (!ask) return;
    // Captured first, so Escape or Enter answer this question and don't also close the form behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Enter') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close(e.key === 'Enter');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {ask ? (
        <div className="scrim confirm-scrim" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="modal" role="alertdialog" aria-label={ask.title} data-testid="confirm-dialog" style={{ maxWidth: 400 }}>
            <h2>{ask.title}</h2>
            <div className="secondary">{ask.message}</div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn secondary" data-testid="confirm-cancel" onClick={() => close(false)}>{t('Cancel', 'إلغاء')}</button>
              <button className="btn" data-testid="confirm-ok" onClick={() => close(true)} autoFocus>{ask.ok}</button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmContext);
let current: ConfirmFn = async () => true;
/** The same question from anywhere, without the hook: `onClick={async () => (await confirmSave()) && save.mutate()}`. */
export const confirmSave: ConfirmFn = (o) => current(o);

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

/** A search box with the icon on the reading side. */
export function SearchBox({ value, onChange, placeholder, width = 260, testid, autoFocus }: { value: string; onChange: (v: string) => void; placeholder: string; width?: number; testid?: string; autoFocus?: boolean }) {
  return (
    <div className="search">
      <Search size={16} />
      <input className="input" data-testid={testid} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} style={{ width }} autoFocus={autoFocus} aria-label={placeholder} />
    </div>
  );
}

export type Branch = { id: string; name_en: string; name_ar: string; active: boolean };
export const useBranches = () => useQuery({ queryKey: ['branches'], queryFn: () => api<Branch[]>('/branches'), staleTime: 60_000 });

export function BranchSelect({ value, onChange, all = true, testid }: { value: string; onChange: (v: string) => void; all?: boolean; testid?: string }) {
  const b = useBranches();
  const first = (b.data ?? []).find((x) => x.active)?.id;
  useEffect(() => {
    if (!all && !value && first) onChange(first);
  }, [all, value, first, onChange]);
  return (
    <select className="input" style={{ width: 190 }} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid} aria-label={t('Branch', 'الفرع')}>
      {all ? <option value="">{t('All branches', 'كل الفروع')}</option> : null}
      {(b.data ?? []).filter((x) => x.active || x.id === value).map((x) => (
        <option key={x.id} value={x.id}>{L(x)}</option>
      ))}
    </select>
  );
}

export type Range = { from: string; to: string };
export const lastDays = (n: number): Range => ({ from: addDays(todayQatar(), -(n - 1)), to: todayQatar() });
/** From-to dates with quick picks, in one row. */
export function DateRange({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const today = todayQatar();
  const picks: [string, Range][] = [
    [t('Today', 'اليوم'), { from: today, to: today }],
    [t('7 days', '7 أيام'), lastDays(7)],
    [t('30 days', '30 يومًا'), lastDays(30)],
    [t('This month', 'هذا الشهر'), { from: `${today.slice(0, 8)}01`, to: today }],
  ];
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <input className="input" type="date" style={{ width: 150 }} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label={t('From', 'من')} />
      <span className="muted">–</span>
      <input className="input" type="date" style={{ width: 150 }} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label={t('To', 'إلى')} />
      {picks.map(([label, r]) => (
        <button key={label} className={`chip ${r.from === value.from && r.to === value.to ? 'on' : ''}`} onClick={() => onChange(r)}>{label}</button>
      ))}
    </div>
  );
}

/** Mada-style menu: a tile per page, with a round icon. */
export function Tiles({ items }: { items: { to: string; label: string; icon: any; testid?: string; hidden?: boolean }[] }) {
  return (
    <div className="tiles">
      {items.filter((i) => !i.hidden).map((i) => (
        <Link key={i.to} to={i.to} className="tile" data-testid={i.testid}>
          <span className="tile-icon"><i.icon size={24} /></span>
          <span className="tile-label">{i.label}</span>
        </Link>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'error' | 'gold' }) {
  return (
    <div className="card pad kpi">
      <div className="overline">{label}</div>
      <div className={`value num ${tone ? `tone-${tone}` : ''}`}>{value}</div>
      {sub ? <div className="small muted">{sub}</div> : null}
    </div>
  );
}

/** Opens a print view in a new window (receipt, invoice, tailor ticket, labels…). */
export function openPrint(path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  window.open(`${base}/print/${path}`, '_blank', 'noopener,width=900,height=900');
}
