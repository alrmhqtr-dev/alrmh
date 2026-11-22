import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { api } from './lib/api';
import { L, t } from './lib/i18n';
import { date, minuteToTime, money, num, phone } from './lib/format';

type AlertOrder = { id: string; number: string; stage: string; expected_delivery: string | null; customer_name: string | null; phone: string | null; balance: number; thobe_count: number };
type Visit = { id: string; starts_at: string; customer_name: string; phone: string; member: string; area: string | null };
export type Alerts = {
  today: string;
  tomorrow: string;
  remindAfterDays: number;
  dueTomorrow: AlertOrder[];
  overdue: AlertOrder[];
  pickupTomorrow: AlertOrder[];
  waiting: AlertOrder[];
  visitsToday: Visit[];
  visitsTomorrow: Visit[];
  lowStock: { kind: 'fabric' | 'product'; id: string; name_en: string; name_ar: string; qty: number; alert_qty: number }[];
  count: number;
};

export const useAlerts = () => useQuery({ queryKey: ['alerts'], queryFn: () => api<Alerts>('/alerts'), refetchInterval: 60_000 });

const visitTime = (iso: string) => {
  const q = new Date(new Date(iso).getTime() + 3 * 3600_000);
  return minuteToTime(q.getUTCHours() * 60 + q.getUTCMinutes());
};

function OrderLine({ o, extra }: { o: AlertOrder; extra?: string }) {
  return (
    <Link to={`/orders/${o.id}`} className="alert-line">
      <span className="strong num">#{o.number}</span>
      <span className="grow ellipsis" dir="auto">{o.customer_name ?? '—'}</span>
      {o.thobe_count > 1 ? <span className="small muted num ltr">×{o.thobe_count}</span> : null}
      <span className="small muted">{extra ?? (o.balance > 0 ? `${t('due', 'متبقي')} ${money(o.balance)}` : '')}</span>
    </Link>
  );
}

/** Everything staff should act on today, grouped. Used in the bell panel and on Home. */
export function AlertList({ a, compact }: { a: Alerts; compact?: boolean }) {
  const sections: { key: string; title: string; tone: string; body: React.ReactNode; n: number }[] = [
    { key: 'overdue', title: t('Past their pickup date, not ready', 'تجاوزت موعد الاستلام ولم تجهز'), tone: 'error', n: a.overdue.length, body: a.overdue.map((o) => <OrderLine key={o.id} o={o} extra={date(o.expected_delivery)} />) },
    { key: 'dueTomorrow', title: t('Pickup tomorrow, not ready yet', 'استلام غدًا ولم تجهز بعد'), tone: 'gold', n: a.dueTomorrow.length, body: a.dueTomorrow.map((o) => <OrderLine key={o.id} o={o} />) },
    { key: 'pickupTomorrow', title: t('Customer pickup tomorrow (ready)', 'استلام العميل غدًا (جاهزة)'), tone: 'ok', n: a.pickupTomorrow.length, body: a.pickupTomorrow.map((o) => <OrderLine key={o.id} o={o} />) },
    { key: 'waiting', title: t(`Ready, not collected for ${a.remindAfterDays}+ days`, `جاهزة ولم تُستلم منذ ${a.remindAfterDays}+ أيام`), tone: 'gold', n: a.waiting.length, body: a.waiting.map((o) => <OrderLine key={o.id} o={o} />) },
    {
      key: 'visits',
      title: t('Home visits today', 'زيارات منزلية اليوم'),
      tone: 'ok',
      n: a.visitsToday.length,
      body: a.visitsToday.map((v) => (
        <Link key={v.id} to="/appointments" className="alert-line">
          <span className="strong num">{visitTime(v.starts_at)}</span>
          <span className="grow ellipsis">{v.member} · {v.customer_name}{v.area ? ` · ${v.area}` : ''}</span>
          <span className="small muted num">{phone(v.phone)}</span>
        </Link>
      )),
    },
    {
      key: 'low',
      title: t('Low stock', 'مخزون منخفض'),
      tone: 'error',
      n: a.lowStock.length,
      body: a.lowStock.map((s) => (
        <Link key={`${s.kind}${s.id}`} to={`/stock?q=${encodeURIComponent(s.name_en)}${s.kind === 'product' ? '&tab=products' : ''}`} className="alert-line">
          <span className="grow ellipsis">{L(s)}</span>
          <span className="small tone-error num">{num(s.qty)} {s.kind === 'fabric' ? t('m', 'م') : ''}</span>
        </Link>
      )),
    },
  ].filter((s) => s.n > 0);
  if (!sections.length) return <div className="small muted" style={{ padding: compact ? 12 : 0 }}>{t('Nothing needs attention right now.', 'لا شيء يحتاج انتباهك الآن.')}</div>;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {sections.map((s) => (
        <div key={s.key} className="stack" style={{ gap: 4 }} data-testid={`alerts-${s.key}`}>
          <div className={`overline tone-${s.tone}`}>{s.title} · {s.n}</div>
          {s.body}
        </div>
      ))}
    </div>
  );
}

/** The bell in the top bar: a count of alerts and the list when opened. */
export function AlertsBell() {
  const a = useAlerts();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const n = a.data?.count ?? 0;
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="pill" data-testid="alerts-bell" aria-label={t(`Alerts (${n})`, `التنبيهات (${n})`)} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Bell size={15} />
        {n ? <span className="bell-count" data-testid="alerts-count">{n > 99 ? '99+' : n}</span> : null}
      </button>
      {open ? (
        <div className="alerts-panel" onClick={(e) => (e.target as HTMLElement).closest('a') && setOpen(false)}>
          <div className="strong" style={{ marginBottom: 10 }}>{t('Alerts', 'التنبيهات')}</div>
          {a.data ? <AlertList a={a.data} compact /> : <div className="small muted">{t('Loading…', 'جارٍ التحميل…')}</div>}
        </div>
      ) : null}
    </div>
  );
}
