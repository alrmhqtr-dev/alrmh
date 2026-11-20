import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Download, Printer } from 'lucide-react';
import { api, downloadCsv, errorMessage } from '../lib/api';
import { L, t } from '../lib/i18n';
import { channelLabel, date, dateTime, money, num } from '../lib/format';
import { BranchSelect, DateRange, Empty, Loading, PageHead, lastDays, useToast, type Range } from '../ui';

type Col = { key: string; en: string; ar: string; type?: string };
type Report = { columns: Col[]; rows: any[]; totals?: Record<string, number>; range: Range };

const REPORTS: [string, string, string, string, string][] = [
  ['profit-loss', 'Profit and loss', 'الأرباح والخسائر', 'Sales, cost, expenses and what is left.', 'المبيعات والتكلفة والمصاريف والصافي.'],
  ['sales-daily', 'Daily sales', 'المبيعات اليومية', 'Each day: sales, payments, returns and expenses.', 'لكل يوم: المبيعات والمقبوضات والمرتجعات والمصاريف.'],
  ['sales-by-branch', 'Sales by branch', 'المبيعات حسب الفرع', '', ''],
  ['sales-by-channel', 'Sales by channel', 'المبيعات حسب القناة', 'Counter, app, visits and imported sales.', 'نقطة البيع والتطبيق والزيارات والمبيعات المستوردة.'],
  ['products', 'Items sold', 'الأصناف المباعة', 'Best sellers with revenue, cost and margin.', 'الأكثر مبيعًا مع الإيراد والتكلفة والهامش.'],
  ['stock', 'Stock', 'المخزون', 'Stock now, its value, and what sold in the period.', 'المخزون الحالي وقيمته والمباع في الفترة.'],
  ['purchases', 'Purchases by supplier', 'المشتريات حسب المورد', '', ''],
  ['suppliers', 'Supplier balances', 'أرصدة الموردين', 'What is owed to each supplier now.', 'المستحق لكل مورد الآن.'],
  ['expenses', 'Expenses by category', 'المصاريف حسب الفئة', '', ''],
  ['payments', 'Payments by method', 'الدفعات حسب الطريقة', 'Money in and out by cash, card, transfer and SADAD.', 'الداخل والخارج نقدًا وبطاقة وتحويلًا وسداد.'],
  ['customers', 'Top customers', 'أفضل العملاء', '', ''],
  ['groups', 'Customer groups', 'مجموعات العملاء', '', ''],
  ['agents', 'Agents and commission', 'الوكلاء والعمولات', '', ''],
  ['staff', 'Sales by staff', 'المبيعات حسب الموظف', '', ''],
  ['tax', 'Tax', 'الضرائب', 'Tax included in sales, purchases and expenses, by month.', 'الضريبة في المبيعات والمشتريات والمصاريف شهريًا.'],
  ['registers', 'Cash registers', 'صناديق النقد', '', ''],
  ['adjustments', 'Stock adjustments', 'تسويات المخزون', '', ''],
];

function value(row: any, c: Col) {
  const v = c.key === 'name' ? L(row) : c.key === 'label' ? L(row, 'label') : row[c.key];
  if (v === null || v === undefined || v === '') return '—';
  const type = c.key === 'value' && row.type ? row.type : c.type;
  switch (type) {
    case 'money':
      return money(v);
    case 'int':
    case 'num':
      return num(v);
    case 'percent':
      return `${num(v)}%`;
    case 'date':
      return date(v);
    case 'datetime':
      return dateTime(v);
    default:
      return c.key === 'name' && row.name_en && ['app', 'pos', 'staff', 'import'].includes(row.name_en) ? channelLabel(row.name_en) : String(v);
  }
}

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const name = params.get('r') ?? 'profit-loss';
  const [range, setRange] = useState<Range>(lastDays(30));
  const [branch, setBranch] = useState('');
  const toast = useToast();
  const qs = `from=${range.from}&to=${range.to}${branch ? `&branch=${branch}` : ''}`;
  const r = useQuery({ queryKey: ['report', name, qs], queryFn: () => api<Report>(`/reports/${name}?${qs}`) });
  const meta = REPORTS.find((x) => x[0] === name)!;
  const numeric = (c: Col) => ['money', 'int', 'num', 'percent'].includes(c.type ?? '');
  return (
    <div className="stack lg">
      <PageHead title={t('Reports', 'التقارير')} sub={t(meta[3] || meta[1], meta[4] || meta[2])}>
        <button className="btn secondary no-print" onClick={() => window.print()}><Printer size={16} /> {t('Print', 'طباعة')}</button>
        <button className="btn secondary no-print" data-testid="report-csv" onClick={() => downloadCsv(`/reports/${name}?${qs}&format=csv&lang=${t('en', 'ar')}`, `${name}.csv`).catch((e) => toast(errorMessage(e), 'error'))}><Download size={16} /> CSV</button>
      </PageHead>
      <div className="chips no-print">
        {REPORTS.map(([k, en, ar]) => (
          <button key={k} className={`chip ${k === name ? 'on' : ''}`} data-testid={`report-${k}`} onClick={() => setParams({ r: k })}>{t(en, ar)}</button>
        ))}
      </div>
      <div className="filters no-print">
        <DateRange value={range} onChange={setRange} />
        <BranchSelect value={branch} onChange={setBranch} />
      </div>
      <div className="card table-wrap">
        <div style={{ padding: '16px 18px 4px' }}>
          <h2>{t(meta[1], meta[2])}</h2>
          <div className="small muted">{date(range.from)} – {date(range.to)}</div>
        </div>
        {!r.data ? (
          <Loading />
        ) : r.data.rows.length ? (
          <table data-testid="report-table">
            <thead><tr>{r.data.columns.map((c) => <th key={c.key} className={numeric(c) ? 'right' : ''}>{t(c.en, c.ar)}</th>)}</tr></thead>
            <tbody>
              {r.data.rows.map((row, i) => (
                <tr key={i} className={['net', 'gross_profit', 'net_profit'].includes(row.key) ? 'totals-row' : ''}>
                  {r.data!.columns.map((c, k) => (
                    <td key={c.key} className={`${numeric(c) || (c.key === 'value') ? 'right num' : ''} ${k === 0 ? 'strong' : ''} ${typeof row[c.key] === 'number' && row[c.key] < 0 && (c.type === 'money' || c.key === 'value') ? 'tone-error' : ''}`}>{value(row, c)}</td>
                  ))}
                </tr>
              ))}
              {r.data.totals ? (
                <tr className="totals-row">
                  {r.data.columns.map((c, k) => <td key={c.key} className={numeric(c) ? 'right num' : ''}>{k === 0 ? t('Total', 'الإجمالي') : r.data!.totals![c.key] !== undefined ? value(r.data!.totals, c) : ''}</td>)}
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : (
          <Empty>{t('Nothing in this period.', 'لا بيانات في هذه الفترة.')}</Empty>
        )}
      </div>
    </div>
  );
}
