import { AlertList, useAlerts } from '../alerts';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { STAGES, STAGE_LABEL, addDays, date, methodLabel, money, num, phone, time } from '../lib/format';
import { BranchSelect, Empty, Loading, PageHead, StageBadge, Stat, Tiles } from '../ui';
import { LineChart } from '../chart';
import { groups } from '../nav';

type OverviewData = {
  stages: { stage: string; n: number }[];
  today: { id: string; kind: string; starts_at: string; status: string; member_name: string; customer_name: string; phone: string; area: string | null; branch_name: string | null; order_number: string | null }[];
  sales: { week: number; month: number; week_orders: number; month_orders: number };
  customers: { total: number; week: number };
  points: { outstanding: number; expiring: { points: number; customers: number } };
  attention: { id: string; number: string; stage: string; expected_delivery: string; customer_name: string }[];
  refunds: { id: string; number: string; total: number; due: number; customer_name: string }[];
};
type Period = { count: number; net: number; received: number; expenses: number; returns: number };
type Dashboard = {
  today: Period;
  month: Period;
  series: { from: string; to: string; rows: { branch_id: string | null; day: string; net: number }[] };
  branches: { id: string; name_en: string; name_ar: string }[];
  methods: { method: string; amount: number }[];
  dues: { amount: number; orders: number };
  supplierDue: number;
  lowStock: number;
  registers: { id: string; opened_at: string; staff_name: string; branch_en: string; branch_ar: string }[];
  top: { name_en: string; name_ar: string; kind: string; qty: number; revenue: number }[];
};

export default function Home() {
  const alerts = useAlerts();
  const { staff, can } = useAuth();
  const nav = useNavigate();
  const [branch, setBranch] = useState('');
  const q = useQuery({ queryKey: ['overview'], queryFn: () => api<OverviewData>('/overview'), refetchInterval: 60_000 });
  const dash = useQuery({ queryKey: ['dashboard', branch], queryFn: () => api<Dashboard>(`/dashboard${branch ? `?branch=${branch}` : ''}`), refetchInterval: 60_000 });
  if (!q.data) return <Loading />;
  const d = q.data;
  const count = (s: string) => d.stages.find((x) => x.stage === s)?.n ?? 0;
  const inProgress = STAGES.filter((s) => s !== 'delivered').reduce((a, s) => a + count(s), 0);
  const ds = dash.data;
  const days: string[] = [];
  if (ds) for (let x = ds.series.from; x <= ds.series.to; x = addDays(x, 1)) days.push(x);
  const series = ds
    ? ds.branches
        .filter((b) => !branch || b.id === branch)
        .map((b) => ({ id: b.id, name: L(b), values: days.map((dd) => ds.series.rows.filter((r) => r.branch_id === b.id && r.day === dd).reduce((a, r) => a + r.net, 0)) }))
        .concat(ds.series.rows.some((r) => !r.branch_id) && !branch ? [{ id: 'online', name: t('Online (app)', 'أونلاين (التطبيق)'), values: days.map((dd) => ds.series.rows.filter((r) => !r.branch_id && r.day === dd).reduce((a, r) => a + r.net, 0)) }] : [])
    : [];

  // The owner account starts as "Owner" until its holder adds a real name.
  const unnamed = !staff?.name || staff.name === 'Owner';
  const first = staff?.name.split(' ')[0] ?? '';
  return (
    <div className="stack lg">
      <PageHead
        title={unnamed ? t('Hello', 'أهلًا') : t(`Hello, ${first}`, `أهلًا ${first}`)}
        sub={unnamed ? (
          <>
            {t("What's happening across AlRmh today.", 'ما يحدث في الرمح اليوم.')}{' '}
            <button className="linklike strong" data-testid="add-your-name" onClick={() => window.dispatchEvent(new Event('alrmh:account'))}>{t('Add your name', 'أضف اسمك')}</button>
          </>
        ) : t("What's happening across AlRmh today.", 'ما يحدث في الرمح اليوم.')}
      >
        <BranchSelect value={branch} onChange={setBranch} testid="home-branch" />
      </PageHead>

      {alerts.data && alerts.data.count ? (
        <div className="card pad stack" data-testid="home-alerts">
          <div className="row spread"><h2>{t('Needs attention', 'يحتاج انتباهك')}</h2><span className="badge gold">{alerts.data.count}</span></div>
          <AlertList a={alerts.data} />
        </div>
      ) : null}

      <Tiles items={groups().map((g) => ({ to: g.items.length === 1 ? g.items[0].to : `/m/${g.key}`, label: g.label, icon: g.icon, testid: `tile-${g.key}`, hidden: Boolean(g.perms && !can(...g.perms)) }))} />

      {ds ? (
        <div className="grid k4">
          <Stat label={t('Sales today', 'مبيعات اليوم')} value={money(ds.today.net)} sub={t(`${ds.today.count} sales · received ${money(ds.today.received)}`, `${ds.today.count} فاتورة · المقبوض ${money(ds.today.received)}`)} />
          <Stat label={t('This month', 'هذا الشهر')} value={money(ds.month.net)} sub={t(`${ds.month.count} sales · expenses ${money(ds.month.expenses)}`, `${ds.month.count} فاتورة · المصاريف ${money(ds.month.expenses)}`)} />
          <Stat label={t('Customers owe', 'مستحق على العملاء')} value={money(ds.dues.amount)} sub={t(`${ds.dues.orders} orders with a balance`, `${ds.dues.orders} طلب بمبلغ متبقٍ`)} tone={ds.dues.amount > 0 ? 'gold' : undefined} />
          <Stat label={t('Owed to suppliers', 'مستحق للموردين')} value={money(ds.supplierDue)} sub={
            <Link to="/stock?low=1" className={ds.lowStock ? 'tone-error' : ''}>{t(`${ds.lowStock} items low on stock`, `${ds.lowStock} صنف منخفض المخزون`)}</Link>
          } />
        </div>
      ) : null}

      {ds ? (
        <div className="card pad stack">
          <div className="row spread">
            <h2>{t('Sales in the last 30 days', 'المبيعات في آخر 30 يومًا')}</h2>
            <span className="small muted">{t('Net sales per day, QAR', 'صافي المبيعات يوميًا، ر.ق')}</span>
          </div>
          <LineChart days={days} series={series} label={t('Sales in the last 30 days by branch', 'المبيعات في آخر 30 يومًا حسب الفرع')} />
        </div>
      ) : null}

      {ds ? (
        <div className="grid k3">
          <div className="card">
            <div className="row spread" style={{ padding: '16px 18px 8px' }}><h2>{t('Taken today', 'المقبوض اليوم')}</h2></div>
            {ds.methods.length ? (
              <table><tbody>{ds.methods.map((m) => <tr key={m.method}><td>{methodLabel(m.method)}</td><td className="right num strong">{money(m.amount)}</td></tr>)}</tbody></table>
            ) : <Empty>{t('No payments yet today.', 'لا دفعات اليوم بعد.')}</Empty>}
          </div>
          <div className="card">
            <div className="row spread" style={{ padding: '16px 18px 8px' }}><h2>{t('Best sellers · 30 days', 'الأكثر مبيعًا · 30 يومًا')}</h2></div>
            {ds.top.length ? (
              <table><tbody>{ds.top.map((x, i) => <tr key={i}><td>{L(x)} <span className="small muted">× {num(x.qty)}</span></td><td className="right num">{money(x.revenue)}</td></tr>)}</tbody></table>
            ) : <Empty>{t('No sales yet.', 'لا مبيعات بعد.')}</Empty>}
          </div>
          <div className="card">
            <div className="row spread" style={{ padding: '16px 18px 8px' }}><h2>{t('Open registers', 'الصناديق المفتوحة')}</h2><Link to="/registers" className="small strong">{t('All', 'الكل')}</Link></div>
            {ds.registers.length ? (
              <table><tbody>{ds.registers.map((r) => <tr key={r.id}><td>{r.staff_name}<div className="small muted">{L({ name_en: r.branch_en, name_ar: r.branch_ar })}</div></td><td className="right small">{time(r.opened_at)}</td></tr>)}</tbody></table>
            ) : <Empty>{t('No register is open.', 'لا يوجد صندوق مفتوح.')}</Empty>}
          </div>
        </div>
      ) : null}

      {d.refunds.length ? (
        <div className="card" data-testid="refunds-due">
          <div className="row spread" style={{ padding: '16px 18px 8px' }}>
            <h2>{t('Refunds due', 'مبالغ مستحقة الاسترداد')}</h2>
            <span className="small muted">{t('Cancelled after payment. Refund, then record it on the order.', 'أُلغيت بعد الدفع. ردّ المبلغ ثم سجّله في الطلب.')}</span>
          </div>
          <table>
            <tbody>
              {d.refunds.map((r) => (
                <tr key={r.id} className="click" onClick={() => nav(`/orders/${r.id}`)}>
                  <td className="strong">#{r.number}</td>
                  <td className="secondary">{r.customer_name}</td>
                  <td className="right num strong">{money(r.due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="card pad stack">
        <div className="row spread">
          <h2>{t('Workshop', 'الورشة')} <span className="small muted">· {t(`${num(inProgress)} in progress`, `${num(inProgress)} قيد التنفيذ`)}</span></h2>
          <Link to="/orders" className="btn sm secondary">{t('Open board', 'فتح اللوحة')}</Link>
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
            <h2>{t("Today's visits", 'زيارات اليوم')}</h2>
            <Link to="/appointments" className="small strong">{t('All appointments', 'كل المواعيد')}</Link>
          </div>
          {d.today.length ? (
            <table>
              <tbody>
                {d.today.map((a) => (
                  <tr key={a.id}>
                    <td className="num strong" style={{ width: 90 }}>{time(a.starts_at)}</td>
                    <td>
                      <div className="strong">{a.member_name} <span className="muted small">{t('for', 'لـ')} {a.customer_name}</span></div>
                      <div className="small secondary">{a.kind === 'home' ? `${t('Home visit', 'زيارة منزلية')} · ${a.area}` : `${t('Branch', 'الفرع')} · ${a.branch_name}`} · {phone(a.phone)}</div>
                    </td>
                    <td className="right">{a.status === 'done' ? <span className="badge ok">{t('Done', 'تمت')}</span> : <span className="badge outline">{a.order_number ? `#${a.order_number}` : t('Booking', 'حجز')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>{t('No visits booked for today.', 'لا زيارات محجوزة اليوم.')}</Empty>
          )}
        </div>
        <div className="card">
          <div className="row spread" style={{ padding: '16px 18px 8px' }}>
            <h2>{t('Due soon', 'مستحقة قريبًا')}</h2>
            <span className="small muted">{t('Expected by tomorrow, not yet ready', 'موعدها حتى الغد ولم تجهز')}</span>
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
            <Empty>{t('Nothing at risk. Every order is on track.', 'لا شيء متأخر. كل الطلبات في موعدها.')}</Empty>
          )}
        </div>
      </div>
      <div className="small muted">
        {t(`${num(d.customers.total)} customers (${d.customers.week} new this week) · ${num(d.points.outstanding)} points outstanding`, `${num(d.customers.total)} عميل (${d.customers.week} جديد هذا الأسبوع) · ${num(d.points.outstanding)} نقطة قائمة`)}
      </div>
    </div>
  );
}
