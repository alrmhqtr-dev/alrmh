import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Ruler, ShoppingBag } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays, day, minuteToTime, money, phone, time, todayQatar } from '../lib/format';
import { t } from '../lib/i18n';
import { openMeasure } from '../measure';
import { PlaceOrderModal } from '../place-order';
import { Empty, Loading, PageHead, Tabs, useToast } from '../ui';

type Appt = {
  id: string;
  kind: 'branch' | 'home';
  branch_id: string | null;
  starts_at: string;
  status: string;
  order_id: string | null;
  order_number: string | null;
  member_id: string;
  member_name: string;
  relation: string;
  customer_id: string;
  customer_name: string;
  phone: string;
  line1: string | null;
  area: string | null;
  address_notes: string | null;
  branch_name: string | null;
  measured: boolean;
  fee: number;
  fee_paid_at: string | null;
};

export default function Appointments() {
  const [from, setFrom] = useState(todayQatar());
  const [kind, setKind] = useState<'all' | 'branch' | 'home'>('home');
  const [ordering, setOrdering] = useState<Appt | null>(null);
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ home_visit: { windows: { start: number; end: number }[] } }>('/settings') });
  /** A home visit shows its window (9:00–13:00); a branch visit its time. */
  const when = (a: Appt) => {
    const q = new Date(new Date(a.starts_at).getTime() + 3 * 3600_000);
    const m = q.getUTCHours() * 60 + q.getUTCMinutes();
    const w = a.kind === 'home' ? settings.data?.home_visit.windows.find((x) => x.start === m) : null;
    return w ? `${minuteToTime(w.start)}–${minuteToTime(w.end)}` : time(a.starts_at);
  };
  const q = useQuery({ queryKey: ['appointments', from, kind], queryFn: () => api<Appt[]>(`/appointments?from=${from}&days=7${kind !== 'all' ? `&kind=${kind}` : ''}`) });
  const status = useMutation({
    mutationFn: ({ id, s }: { id: string; s: string }) => api(`/appointments/${id}/status`, { body: { status: s } }),
    onSuccess: (_, v) => {
      toast(v.s === 'cancelled' ? t('Visit cancelled. The customer was notified.', 'أُلغيت الزيارة وأُبلغ العميل.') : t('Visit marked as done.', 'تم تسجيل الزيارة كمكتملة.'));
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const feePaid = useMutation({
    mutationFn: (id: string) => api(`/appointments/${id}/fee-paid`, { body: {} }),
    onSuccess: () => {
      toast(t('Fee marked as collected.', 'تم تسجيل استلام الرسوم.'));
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const byDay = (d: string) => (q.data ?? []).filter((a) => new Date(new Date(a.starts_at).getTime() + 3 * 3600_000).toISOString().slice(0, 10) === d);

  return (
    <div className="stack lg">
      <PageHead title={t('Home orders', 'الطلبات المنزلية')} sub={t('Home visits booked from the app for the next 7 days: measure, then place the order.', 'الزيارات المنزلية المحجوزة من التطبيق للأيام السبعة القادمة: خذ المقاسات ثم سجّل الطلب.')}>
        <Tabs value={kind} onChange={setKind} options={[['home', t('Home visits', 'زيارات منزلية')], ['branch', t('Branch (earlier bookings)', 'الفرع (حجوزات سابقة)')], ['all', t('All', 'الكل')]]} />
        <div className="row" style={{ gap: 4 }}>
          <button className="btn secondary icon-btn" aria-label={t('Previous week', 'الأسبوع السابق')} onClick={() => setFrom(addDays(from, -7))}><ChevronLeft size={16} className="flip-rtl" /></button>
          <button className="btn secondary" onClick={() => setFrom(todayQatar())}>{t('Today', 'اليوم')}</button>
          <button className="btn secondary icon-btn" aria-label={t('Next week', 'الأسبوع التالي')} onClick={() => setFrom(addDays(from, 7))}><ChevronRight size={16} className="flip-rtl" /></button>
        </div>
      </PageHead>
      {!q.data ? (
        <Loading />
      ) : (
        days.map((d) => {
          const list = byDay(d);
          if (!list.length) return null;
          return (
            <div key={d} className="stack" style={{ gap: 8 }}>
              <h2 className="h3">{day(d)}</h2>
              <div className="card table-wrap">
                <table>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.id} data-testid={`appt-${a.member_name}`}>
                        <td className="num strong" style={{ width: 120 }}><span className="ltr">{when(a)}</span></td>
                        <td>
                          <div className="strong">{a.member_name} <span className="small muted">· <Link to={`/customers/${a.customer_id}`}>{a.customer_name}</Link> · {phone(a.phone)}</span></div>
                          <div className="small secondary">
                            {a.kind === 'home' ? `${t('Home visit', 'زيارة منزلية')} · ${a.line1}, ${a.area}${a.address_notes ? ` · ${a.address_notes}` : ''}` : `${t('Branch', 'الفرع')} · ${a.branch_name}`}
                          </div>
                        </td>
                        <td>
                          {a.order_number ? <Link className="badge outline" to={`/orders/${a.order_id}`}>#{a.order_number}</Link> : <span className="badge outline">{t('Measurement only', 'قياس فقط')}</span>}
                          {a.fee ? (
                            <div style={{ marginTop: 4 }}>
                              {a.fee_paid_at ? <span className="badge ok">{t('Fee paid', 'الرسوم مدفوعة')} · {money(a.fee)}</span> : <span className="badge gold" data-testid={`fee-due-${a.member_name}`}>{t('Collect', 'استلم')} {money(a.fee)}</span>}
                            </div>
                          ) : null}
                        </td>
                        <td>{a.status === 'done' || a.measured ? <span className="badge ok">{t('Measured', 'تم القياس')}</span> : <span className="badge">{t('Booked', 'محجوز')}</span>}</td>
                        <td className="right">
                          {can('pos') && !a.order_id ? (
                            <Link className="btn sm secondary" style={{ marginBottom: 6, marginInlineEnd: 6 }} to={`/pos?customer=${a.customer_id}`}>{t('At the counter', 'في نقطة البيع')}</Link>
                          ) : null}
                          {can('workshop') && !a.order_id ? (
                            <button className="btn sm" style={{ marginBottom: 6 }} data-testid={`appt-order-${a.member_name}`} onClick={() => setOrdering(a)}>
                              <ShoppingBag size={14} /> {t('Place order', 'تسجيل طلب')}
                            </button>
                          ) : null}
                          {can('workshop') && a.status === 'done' && a.fee && !a.fee_paid_at ? (
                            <button className="btn sm secondary" data-testid={`fee-paid-${a.member_name}`} onClick={() => feePaid.mutate(a.id)}>{t('Fee paid', 'الرسوم مدفوعة')}</button>
                          ) : null}
                          {can('workshop') && a.status !== 'done' ? (
                            <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                              <button className="btn sm" data-testid={`appt-measure-${a.member_name}`} onClick={() => openMeasure(a.member_id)}>
                                <Ruler size={14} /> {t('Record', 'تسجيل')}
                              </button>
                              {a.fee && !a.fee_paid_at ? (
                                <button className="btn sm secondary" data-testid={`fee-paid-${a.member_name}`} onClick={() => feePaid.mutate(a.id)}>{t('Fee paid', 'الرسوم مدفوعة')}</button>
                              ) : null}
                              <button className="btn sm secondary" onClick={() => status.mutate({ id: a.id, s: 'done' })}>{t('Done', 'تمت')}</button>
                              <button className="btn sm ghost" onClick={() => confirm(t(`Cancel ${a.member_name}'s visit? The customer will be notified.`, `إلغاء زيارة ${a.member_name}؟ سيُبلّغ العميل.`)) && status.mutate({ id: a.id, s: 'cancelled' })}>{t('Cancel', 'إلغاء')}</button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
      {q.data && !q.data.length ? <div className="card"><Empty>{t('No visits booked this week.', 'لا زيارات محجوزة هذا الأسبوع.')}</Empty></div> : null}
      {ordering ? (
        <PlaceOrderModal customerId={ordering.customer_id} memberId={ordering.member_id} appointmentId={ordering.id} branchId={ordering.branch_id} onClose={() => setOrdering(null)} />
      ) : null}
    </div>
  );
}
