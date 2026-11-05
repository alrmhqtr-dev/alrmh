import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { STAGES, STAGE_LABEL, date, money, num, phone, time } from '../lib/format';
import { Empty, Loading, PageHead, StageBadge } from '../ui';

type OverviewData = {
  stages: { stage: string; n: number }[];
  today: { id: string; kind: string; starts_at: string; status: string; member_name: string; customer_name: string; phone: string; area: string | null; branch_name: string | null; order_number: string | null }[];
  sales: { week: number; month: number; week_orders: number; month_orders: number };
  customers: { total: number; week: number };
  points: { outstanding: number; expiring: { points: number; customers: number } };
  attention: { id: string; number: string; stage: string; expected_delivery: string; customer_name: string }[];
};

export default function Overview() {
  const { staff } = useAuth();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api<OverviewData>('/overview'), refetchInterval: 60_000 });
  if (!q.data) return <Loading />;
  const d = q.data;
  const count = (s: string) => d.stages.find((x) => x.stage === s)?.n ?? 0;
  const inProgress = STAGES.filter((s) => s !== 'delivered').reduce((a, s) => a + count(s), 0);

  return (
    <div className="stack lg">
      <PageHead title={`Hello, ${staff?.name.split(' ')[0]}`} sub="What's happening across AlRmh today." />
      <div className="grid k4">
        <div className="card pad kpi">
          <div className="overline">Sales · 7 days</div>
          <div className="value num">{money(d.sales.week)}</div>
          <div className="small muted">{d.sales.week_orders} paid orders · 30 days {money(d.sales.month)}</div>
        </div>
        <div className="card pad kpi">
          <div className="overline">In progress</div>
          <div className="value num">{num(inProgress)}</div>
          <div className="small muted">orders not yet delivered</div>
        </div>
        <div className="card pad kpi">
          <div className="overline">Customers</div>
          <div className="value num">{num(d.customers.total)}</div>
          <div className="small muted">{d.customers.week} new this week</div>
        </div>
        <div className="card pad kpi">
          <div className="overline">Points outstanding</div>
          <div className="value num">{num(d.points.outstanding)}</div>
          <div className="small muted">
            {d.points.expiring.points ? `${num(d.points.expiring.points)} expiring soon · ${d.points.expiring.customers} customers` : 'None expiring in the next 30 days'}
          </div>
        </div>
      </div>

      <div className="card pad stack">
        <div className="row spread">
          <h2>Workshop</h2>
          <Link to="/orders" className="btn sm secondary">Open board</Link>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
          {STAGES.map((s) => (
            <Link key={s} to={`/orders?stage=${s}`} className="card pad" style={{ padding: 14 }}>
              <div className="small secondary">{STAGE_LABEL[s]}</div>
              <div style={{ fontSize: 22, fontWeight: 600 }} className="num">{count(s)}</div>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid k2">
        <div className="card">
          <div className="row spread" style={{ padding: '16px 18px 8px' }}>
            <h2>Today's visits</h2>
            <Link to="/appointments" className="small strong">All appointments</Link>
          </div>
          {d.today.length ? (
            <table>
              <tbody>
                {d.today.map((a) => (
                  <tr key={a.id}>
                    <td className="num strong" style={{ width: 90 }}>{time(a.starts_at)}</td>
                    <td>
                      <div className="strong">{a.member_name} <span className="muted small">for {a.customer_name}</span></div>
                      <div className="small secondary">{a.kind === 'home' ? `Home visit · ${a.area}` : `Branch · ${a.branch_name}`} · {phone(a.phone)}</div>
                    </td>
                    <td className="right">{a.status === 'done' ? <span className="badge ok">Done</span> : <span className="badge outline">{a.order_number ? `#${a.order_number}` : 'Booking'}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No visits booked for today.</Empty>
          )}
        </div>
        <div className="card">
          <div className="row spread" style={{ padding: '16px 18px 8px' }}>
            <h2>Due soon</h2>
            <span className="small muted">Expected by tomorrow, not yet ready</span>
          </div>
          {d.attention.length ? (
            <table>
              <tbody>
                {d.attention.map((o) => (
                  <tr key={o.id} className="click" onClick={() => nav(`/orders/${o.id}`)}>
                    <td className="strong">#{o.number}</td>
                    <td className="secondary">{o.customer_name}</td>
                    <td><StageBadge stage={o.stage} /></td>
                    <td className="right small">{date(o.expected_delivery)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Nothing at risk. Every order is on track.</Empty>
          )}
        </div>
      </div>
    </div>
  );
}
