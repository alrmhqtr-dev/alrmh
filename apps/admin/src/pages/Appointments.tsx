import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Ruler } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays, day, phone, time, todayQatar } from '../lib/format';
import { MeasureModal } from '../measure';
import { Empty, Loading, PageHead, Tabs, useToast } from '../ui';

type Appt = {
  id: string;
  kind: 'branch' | 'home';
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
};

export default function Appointments() {
  const [from, setFrom] = useState(todayQatar());
  const [kind, setKind] = useState<'all' | 'branch' | 'home'>('all');
  const [measure, setMeasure] = useState<{ id: string; name: string } | null>(null);
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['appointments', from, kind], queryFn: () => api<Appt[]>(`/appointments?from=${from}&days=7${kind !== 'all' ? `&kind=${kind}` : ''}`) });
  const status = useMutation({
    mutationFn: ({ id, s }: { id: string; s: string }) => api(`/appointments/${id}/status`, { body: { status: s } }),
    onSuccess: (_, v) => {
      toast(v.s === 'cancelled' ? 'Visit cancelled. The customer was notified.' : 'Visit marked as done.');
      qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const byDay = (d: string) => (q.data ?? []).filter((a) => new Date(new Date(a.starts_at).getTime() + 3 * 3600_000).toISOString().slice(0, 10) === d);

  return (
    <div className="stack lg">
      <PageHead title="Appointments" sub="Branch and home measurement visits for the next 7 days.">
        <Tabs value={kind} onChange={setKind} options={[['all', 'All'], ['branch', 'Branch'], ['home', 'Home visits']]} />
        <div className="row" style={{ gap: 4 }}>
          <button className="btn secondary icon-btn" aria-label="Previous week" onClick={() => setFrom(addDays(from, -7))}><ChevronLeft size={16} /></button>
          <button className="btn secondary" onClick={() => setFrom(todayQatar())}>Today</button>
          <button className="btn secondary icon-btn" aria-label="Next week" onClick={() => setFrom(addDays(from, 7))}><ChevronRight size={16} /></button>
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
              <h3>{day(d)}</h3>
              <div className="card table-wrap">
                <table>
                  <tbody>
                    {list.map((a) => (
                      <tr key={a.id} data-testid={`appt-${a.member_name}`}>
                        <td className="num strong" style={{ width: 92 }}>{time(a.starts_at)}</td>
                        <td>
                          <div className="strong">{a.member_name} <span className="small muted">· <Link to={`/customers/${a.customer_id}`}>{a.customer_name}</Link> · {phone(a.phone)}</span></div>
                          <div className="small secondary">
                            {a.kind === 'home' ? `Home visit · ${a.line1}, ${a.area}${a.address_notes ? ` · ${a.address_notes}` : ''}` : `Branch · ${a.branch_name}`}
                          </div>
                        </td>
                        <td>{a.order_number ? <Link className="badge outline" to={`/orders/${a.order_id}`}>#{a.order_number}</Link> : <span className="badge outline">Measurement only</span>}</td>
                        <td>{a.status === 'done' || a.measured ? <span className="badge ok">Measured</span> : <span className="badge">Booked</span>}</td>
                        <td className="right">
                          {can('owner', 'manager', 'tailor') && a.status !== 'done' ? (
                            <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
                              <button className="btn sm" data-testid={`appt-measure-${a.member_name}`} onClick={() => setMeasure({ id: a.member_id, name: a.member_name })}>
                                <Ruler size={14} /> Record
                              </button>
                              <button className="btn sm secondary" onClick={() => status.mutate({ id: a.id, s: 'done' })}>Done</button>
                              <button className="btn sm ghost" onClick={() => confirm(`Cancel ${a.member_name}'s visit? The customer will be notified.`) && status.mutate({ id: a.id, s: 'cancelled' })}>Cancel</button>
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
      {q.data && !q.data.length ? <div className="card"><Empty>No visits booked this week.</Empty></div> : null}
      {measure ? <MeasureModal memberId={measure.id} memberName={measure.name} onClose={() => setMeasure(null)} /> : null}
    </div>
  );
}
