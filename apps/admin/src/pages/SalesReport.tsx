import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { L, t } from '../lib/i18n';
import { addDays, channelLabel, date, money, num, todayQatar } from '../lib/format';
import { BranchSelect, Empty, Loading, PageHead, Select, Stat, type Range } from '../ui';
import { LineChart } from '../chart';

type Named = { name_en: string; name_ar: string };
type Summary = {
  range: Range;
  totals: { orders: number; net: number; average: number; original: number; discount: number; products: number; thobes: number; metres: number; received: number; returns: number };
  days: { day: string; net: number; orders: number; discount: number }[];
  products: (Named & { sku: string; qty: number; original: number; discount: number; net: number })[];
  cloth: (Named & { thobes: number; metres: number; discount: number; net: number })[];
  discounts: { id: string; number: string; created_at: string; channel: string; customer: string | null; staff: string | null; original: number; discount: number; discount_label: string | null; total: number }[];
  channels: { channel: string; orders: number; net: number }[];
};

/** The first and last day of the month a date falls in. */
const monthOf = (d: string): Range => {
  const [y, m] = d.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from: `${d.slice(0, 8)}01`, to: last };
};

/**
 * Sales for a period, this month unless chosen otherwise: what was sold, the discounts given and the cloth used,
 * by branch and by channel.
 */
export default function SalesReport() {
  const today = todayQatar();
  const [range, setRange] = useState<Range>(monthOf(today));
  const [branch, setBranch] = useState('');
  const [channel, setChannel] = useState('');
  const q = useQuery({
    queryKey: ['sales-summary', range, branch, channel],
    queryFn: () => api<Summary>(`/sales-summary?${new URLSearchParams({ from: range.from, to: range.to, ...(branch ? { branch } : {}), ...(channel ? { channel } : {}) })}`),
    enabled: Boolean(range.from && range.to && range.from <= range.to),
  });
  const lastMonth = monthOf(addDays(`${today.slice(0, 8)}01`, -1));
  const picks: [string, Range][] = [
    [t('This month', 'هذا الشهر'), monthOf(today)],
    [t('Last month', 'الشهر الماضي'), lastMonth],
    [t('Today', 'اليوم'), { from: today, to: today }],
    [t('Last 7 days', 'آخر 7 أيام'), { from: addDays(today, -6), to: today }],
  ];

  const d = q.data;
  const days: string[] = [];
  if (d) for (let x = d.range.from; x <= d.range.to && days.length < 400; x = addDays(x, 1)) days.push(x);

  return (
    <div className="stack lg sales-report">
      <PageHead title={t('Sales report', 'تقرير المبيعات')} sub={t('What sold, the discounts given and the cloth used.', 'ما بيع والخصومات الممنوحة والقماش المستخدم.')}>
        <button className="btn secondary no-print" onClick={() => window.print()}><Printer size={16} /> {t('Print', 'طباعة')}</button>
      </PageHead>

      <div className="card pad row wrap no-print" style={{ gap: 10 }} data-testid="sales-filters">
        <input className="input" type="date" style={{ width: 150 }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label={t('From', 'من')} data-testid="sales-from" />
        <span className="muted">–</span>
        <input className="input" type="date" style={{ width: 150 }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label={t('To', 'إلى')} data-testid="sales-to" />
        {picks.map(([label, r]) => (
          <button key={label} className={`chip ${r.from === range.from && r.to === range.to ? 'on' : ''}`} onClick={() => setRange(r)}>{label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <BranchSelect value={branch} onChange={setBranch} testid="sales-branch" />
        <Select style={{ width: 170 }} value={channel} onChange={(e) => setChannel(e.target.value)} aria-label={t('Channel', 'القناة')} data-testid="sales-channel">
          <option value="">{t('All channels', 'كل القنوات')}</option>
          {['pos', 'app', 'staff', 'import'].map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
        </Select>
      </div>
      <div className="print-only small">{date(range.from)} – {date(range.to)}</div>

      {q.isLoading ? <Loading /> : q.error ? <Empty>{errorMessage(q.error)}</Empty> : !d ? null : (
        <>
          <div className="grid k4" data-testid="sales-totals">
            <Stat label={t('Sales', 'المبيعات')} value={money(d.totals.net)} sub={t(`${d.totals.orders} sales · average ${money(d.totals.average)}`, `${d.totals.orders} فاتورة · المتوسط ${money(d.totals.average)}`)} />
            <Stat
              label={t('Discounts given', 'الخصومات الممنوحة')}
              value={<span data-testid="sales-discount">{money(d.totals.discount)}</span>}
              sub={t(`on ${money(d.totals.original)} original price`, `من سعر أصلي ${money(d.totals.original)}`)}
              tone={d.totals.discount > 0 ? 'gold' : undefined}
            />
            <Stat label={t('Cloth sold', 'القماش المباع')} value={<span data-testid="sales-metres">{`${num(d.totals.metres)} ${t('m', 'م')}`}</span>} sub={t(`${d.totals.thobes} thobes`, `${d.totals.thobes} ثوب`)} />
            <Stat label={t('Products sold', 'المنتجات المباعة')} value={<span data-testid="sales-products">{d.totals.products}</span>} sub={t(`received ${money(d.totals.received)} · returns ${money(d.totals.returns)}`, `المقبوض ${money(d.totals.received)} · المرتجعات ${money(d.totals.returns)}`)} />
          </div>

          <div className="card pad stack">
            <div className="row spread">
              <h2>{t('Sales by day', 'المبيعات يوميًا')}</h2>
              <span className="small muted">{t('Sales and discounts per day, QAR', 'المبيعات والخصومات يوميًا، ر.ق')}</span>
            </div>
            {d.days.length ? (
              <LineChart
                days={days}
                height={220}
                label={t('Sales and discounts per day', 'المبيعات والخصومات يوميًا')}
                series={[
                  { id: 'net', name: t('Sales', 'المبيعات'), values: days.map((x) => d.days.find((r) => r.day === x)?.net ?? 0) },
                  { id: 'discount', name: t('Discounts', 'الخصومات'), values: days.map((x) => d.days.find((r) => r.day === x)?.discount ?? 0) },
                ]}
              />
            ) : <Empty>{t('No sales in this period.', 'لا مبيعات في هذه الفترة.')}</Empty>}
          </div>

          <div className="grid k2 sales-split">
            <div className="card table-wrap" data-testid="sales-cloth">
              <div className="pad-h"><h2>{t('Cloth sold', 'القماش المباع')}</h2></div>
              {d.cloth.length ? (
                <table>
                  <thead><tr><th>{t('Cloth', 'القماش')}</th><th className="right">{t('Thobes', 'الثياب')}</th><th className="right">{t('Metres', 'الأمتار')}</th><th className="right">{t('Discount', 'الخصم')}</th><th className="right">{t('Sales', 'المبيعات')}</th></tr></thead>
                  <tbody>
                    {d.cloth.map((c) => (
                      <tr key={c.name_en}><td>{L(c)}</td><td className="right num">{c.thobes}</td><td className="right num strong">{num(c.metres)}</td><td className="right num">{c.discount ? `−${money(c.discount)}` : '—'}</td><td className="right num">{money(c.net)}</td></tr>
                    ))}
                  </tbody>
                  <tfoot><tr><td>{t('Total', 'الإجمالي')}</td><td className="right num">{d.totals.thobes}</td><td className="right num">{num(d.totals.metres)}</td><td /><td className="right num">{money(d.cloth.reduce((a, c) => a + c.net, 0))}</td></tr></tfoot>
                </table>
              ) : <Empty>{t('No thobes sold in this period.', 'لا ثياب مباعة في هذه الفترة.')}</Empty>}
            </div>

            <div className="card table-wrap" data-testid="sales-channels">
              <div className="pad-h"><h2>{t('By channel', 'حسب القناة')}</h2></div>
              {d.channels.length ? (
                <table>
                  <thead><tr><th>{t('Channel', 'القناة')}</th><th className="right">{t('Sales', 'الفواتير')}</th><th className="right">{t('Amount', 'المبلغ')}</th></tr></thead>
                  <tbody>{d.channels.map((c) => <tr key={c.channel}><td>{channelLabel(c.channel)}</td><td className="right num">{c.orders}</td><td className="right num">{money(c.net)}</td></tr>)}</tbody>
                </table>
              ) : <Empty>{t('No sales in this period.', 'لا مبيعات في هذه الفترة.')}</Empty>}
            </div>
          </div>

          <div className="card table-wrap" data-testid="sales-products-table">
            <div className="pad-h"><h2>{t('Products sold', 'المنتجات المباعة')}</h2></div>
            {d.products.length ? (
              <table>
                <thead><tr><th>{t('Product', 'المنتج')}</th><th>{t('SKU', 'الرمز')}</th><th className="right">{t('Sold', 'الكمية')}</th><th className="right">{t('Original price', 'السعر الأصلي')}</th><th className="right">{t('Discount', 'الخصم')}</th><th className="right">{t('Sales', 'المبيعات')}</th></tr></thead>
                <tbody>
                  {d.products.map((r) => (
                    <tr key={`${r.sku}-${r.name_en}`}><td>{L(r)}</td><td className="small muted">{r.sku}</td><td className="right num strong">{r.qty}</td><td className="right num">{money(r.original)}</td><td className="right num">{r.discount ? `−${money(r.discount)}` : '—'}</td><td className="right num">{money(r.net)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>{t('Total', 'الإجمالي')}</td>
                    <td className="right num">{d.totals.products}</td>
                    <td className="right num">{money(d.products.reduce((a, r) => a + r.original, 0))}</td>
                    <td className="right num">{(() => { const x = d.products.reduce((a, r) => a + r.discount, 0); return x ? `−${money(x)}` : '—'; })()}</td>
                    <td className="right num">{money(d.products.reduce((a, r) => a + r.net, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            ) : <Empty>{t('No products sold in this period.', 'لا منتجات مباعة في هذه الفترة.')}</Empty>}
          </div>

          <div className="card table-wrap" data-testid="sales-discounts">
            <div className="pad-h"><h2>{t('Discounts given', 'الخصومات الممنوحة')}</h2></div>
            {d.discounts.length ? (
              <table>
                <thead><tr><th>{t('Sale', 'الفاتورة')}</th><th>{t('Date', 'التاريخ')}</th><th>{t('Customer', 'العميل')}</th><th>{t('By', 'بواسطة')}</th><th className="right">{t('Original price', 'السعر الأصلي')}</th><th className="right">{t('Discount', 'الخصم')}</th><th className="right">{t('Total', 'الإجمالي')}</th></tr></thead>
                <tbody>
                  {d.discounts.map((o) => (
                    <tr key={o.id}>
                      <td><Link to={`/orders/${o.id}`} className="strong num">#{o.number}</Link><div className="small muted">{channelLabel(o.channel)}</div></td>
                      <td className="small">{date(o.created_at)}</td>
                      <td><bdi>{o.customer ?? t('Walk-in', 'زبون')}</bdi></td>
                      <td className="small">{o.staff ?? '—'}</td>
                      <td className="right num">{money(o.original)}</td>
                      <td className="right num tone-ok">−{money(o.discount)}{o.discount_label ? <div className="small muted">{o.discount_label}</div> : null}</td>
                      <td className="right num strong">{money(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <Empty>{t('No discounts in this period.', 'لا خصومات في هذه الفترة.')}</Empty>}
          </div>
        </>
      )}
    </div>
  );
}
