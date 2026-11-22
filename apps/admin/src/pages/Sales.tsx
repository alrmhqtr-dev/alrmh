import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Printer, Truck } from 'lucide-react';
import { api, downloadCsv, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { channelLabel, date, dateTime, methodLabel, money, phone, stageLabel } from '../lib/format';
import { BranchSelect, DateRange, Empty, Field, Input, Loading, Modal, PageHead, SearchBox, StageBadge, Tabs, lastDays, openPrint, useToast, type Range, confirmSave } from '../ui';

type SaleRow = {
  id: string;
  number: string;
  channel: string;
  stage: string;
  created_at: string;
  total: number;
  paid: number;
  balance: number;
  refunded: number;
  methods: string | null;
  branch_en: string | null;
  branch_ar: string | null;
  customer_name: string | null;
  phone: string | null;
  staff_name: string | null;
  thobe_count: number;
  item_count: number;
};

export function Sales() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [range, setRange] = useState<Range>(lastDays(30));
  const [branch, setBranch] = useState('');
  const [q, setQ] = useState('');
  const channel = params.get('channel') ?? '';
  const payment = params.get('payment') ?? '';
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p);
  };
  const qs = new URLSearchParams({ from: range.from, to: range.to, ...(branch ? { branch } : {}), ...(channel ? { channel } : {}), ...(payment ? { payment } : {}), ...(q ? { q } : {}) });
  const list = useQuery({ queryKey: ['sales', qs.toString()], queryFn: () => api<{ rows: SaleRow[]; totals: { count: number; total: number; paid: number; balance: number; refunded: number } }>(`/sales?${qs}`) });
  return (
    <div className="stack lg">
      <PageHead title={channel === 'pos' ? t('POS list', 'قائمة نقطة البيع') : t('All sales', 'كل المبيعات')} sub={t('Counter sales, app orders and orders placed at a visit, with what was paid and what is still due.', 'مبيعات نقطة البيع وطلبات التطبيق والطلبات في الزيارة، مع المدفوع والمتبقي.')}>
        <Link to="/pos" className="btn">{t('New sale', 'بيع جديد')}</Link>
      </PageHead>
      <div className="filters">
        <DateRange value={range} onChange={setRange} />
        <BranchSelect value={branch} onChange={setBranch} />
        <select className="input" style={{ width: 170 }} value={channel} onChange={(e) => set('channel', e.target.value)} aria-label={t('Channel', 'القناة')}>
          <option value="">{t('All channels', 'كل القنوات')}</option>
          {['pos', 'app', 'staff', 'import'].map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
        </select>
        <select className="input" style={{ width: 170 }} value={payment} onChange={(e) => set('payment', e.target.value)} aria-label={t('Payment', 'الدفع')}>
          <option value="">{t('Paid and due', 'المدفوع والمتبقي')}</option>
          <option value="due">{t('Balance due', 'عليها مبلغ متبقٍ')}</option>
          <option value="paid">{t('Fully paid', 'مدفوعة بالكامل')}</option>
        </select>
        <SearchBox value={q} onChange={setQ} placeholder={t('Invoice #, name or mobile', 'رقم الفاتورة أو الاسم أو الجوال')} width={230} testid="sales-search" />
      </div>
      {!list.data ? (
        <Loading />
      ) : (
        <>
          <div className="grid k4">
            <div className="card pad kpi"><div className="overline">{t('Sales', 'الفواتير')}</div><div className="value num">{list.data.totals.count}</div></div>
            <div className="card pad kpi"><div className="overline">{t('Total', 'الإجمالي')}</div><div className="value num">{money(list.data.totals.total)}</div></div>
            <div className="card pad kpi"><div className="overline">{t('Paid', 'المدفوع')}</div><div className="value num">{money(list.data.totals.paid)}</div><div className="small muted">{t('Refunded', 'المسترد')} {money(list.data.totals.refunded)}</div></div>
            <div className="card pad kpi"><div className="overline">{t('Still due', 'المتبقي')}</div><div className={`value num ${list.data.totals.balance ? 'tone-gold' : ''}`}>{money(list.data.totals.balance)}</div></div>
          </div>
          <div className="card table-wrap">
            {list.data.rows.length ? (
              <table data-testid="sales-table">
                <thead>
                  <tr>
                    <th>{t('Invoice', 'الفاتورة')}</th>
                    <th>{t('Date', 'التاريخ')}</th>
                    <th>{t('Customer', 'العميل')}</th>
                    <th>{t('Channel', 'القناة')}</th>
                    <th>{t('Branch', 'الفرع')}</th>
                    <th>{t('Status', 'الحالة')}</th>
                    <th>{t('Paid by', 'طريقة الدفع')}</th>
                    <th className="right">{t('Total', 'الإجمالي')}</th>
                    <th className="right">{t('Due', 'المتبقي')}</th>
                    <th><span className="sr-only">{t('Actions', 'إجراءات')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((r) => (
                    <tr key={r.id} className="click" onClick={() => nav(`/orders/${r.id}?view=invoice`)} data-testid={`sale-${r.number}`}>
                      <td className="strong">#{r.number}</td>
                      <td className="small">{dateTime(r.created_at)}</td>
                      <td>{r.customer_name ?? <span className="muted">{t('Walk-in', 'زبون عابر')}</span>}<div className="small muted num">{r.phone ? phone(r.phone) : ''}</div></td>
                      <td className="small">{channelLabel(r.channel)}</td>
                      <td className="small">{L({ name_en: r.branch_en, name_ar: r.branch_ar }) || t('Online', 'أونلاين')}</td>
                      <td><StageBadge stage={r.stage} thobes={r.thobe_count > 0} channel={r.channel} /></td>
                      <td className="small">{(r.methods ?? '').split(',').filter(Boolean).map(methodLabel).join(' + ') || '—'}</td>
                      <td className="right num">{money(r.total)}</td>
                      <td className={`right num ${r.balance ? 'tone-gold strong' : 'muted'}`}>{r.balance ? money(r.balance) : '—'}</td>
                      <td className="right" onClick={(e) => e.stopPropagation()}>
                        <button className="btn sm ghost" aria-label={t('Print receipt', 'طباعة الإيصال')} onClick={() => openPrint(`receipt/${r.id}`)}><Printer size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{t('No sales in this period.', 'لا مبيعات في هذه الفترة.')}</Empty>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function Drafts({ kind }: { kind: 'draft' | 'quotation' }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [open, setOpen] = useState(true);
  const list = useQuery({ queryKey: ['drafts', kind, open], queryFn: () => api<any[]>(`/drafts?kind=${kind}${open ? '&open=1' : ''}`) });
  const del = useMutation({
    mutationFn: (id: string) => api(`/drafts/${id}/delete`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['drafts'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <div className="stack lg">
      <PageHead
        title={kind === 'quotation' ? t('Quotations', 'عروض الأسعار') : t('Drafts', 'المسودات')}
        sub={kind === 'quotation' ? t('Prices given to customers. Open one to turn it into a sale.', 'أسعار مقدّمة للعملاء. افتح العرض لتحويله إلى فاتورة.') : t('Sales put aside to finish later.', 'فواتير محفوظة لإكمالها لاحقًا.')}
      >
        <Tabs value={open ? 'open' : 'all'} onChange={(v) => setOpen(v === 'open')} options={[['open', t('Open', 'مفتوحة')], ['all', t('All', 'الكل')]]} />
        {can('pos') ? <Link className="btn" to={`/pos?mode=${kind}`}>{kind === 'quotation' ? t('Add quotation', 'إضافة عرض سعر') : t('Add draft', 'إضافة مسودة')}</Link> : null}
      </PageHead>
      <div className="card table-wrap">
        {!list.data ? <Loading /> : list.data.length ? (
          <table>
            <thead>
              <tr><th>#</th><th>{t('Date', 'التاريخ')}</th><th>{t('Customer', 'العميل')}</th><th>{t('Items', 'الأصناف')}</th>{kind === 'quotation' ? <th>{t('Valid until', 'صالح حتى')}</th> : null}<th>{t('By', 'بواسطة')}</th><th className="right">{t('Total', 'الإجمالي')}</th><th><span className="sr-only">{t('Actions', 'إجراءات')}</span></th></tr>
            </thead>
            <tbody>
              {list.data.map((d) => (
                <tr key={d.id}>
                  <td className="strong">{d.number}</td>
                  <td className="small">{dateTime(d.updated_at)}</td>
                  <td>{d.customer_name ?? '—'}<div className="small muted num">{d.phone ? phone(d.phone) : ''}</div></td>
                  <td className="num">{d.line_count}</td>
                  {kind === 'quotation' ? <td className="small">{d.valid_until ? date(d.valid_until) : '—'}</td> : null}
                  <td className="small">{d.staff_name}</td>
                  <td className="right num">{money(d.total)}</td>
                  <td className="right">
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      {d.converted_order_id ? (
                        <Link className="btn sm secondary" to={`/orders/${d.converted_order_id}`}>#{d.order_number}</Link>
                      ) : (
                        <>
                          {kind === 'quotation' ? <button className="btn sm secondary" onClick={() => openPrint(`quotation/${d.id}`)}><Printer size={14} /></button> : null}
                          {can('pos') ? <button className="btn sm" data-testid={`open-draft-${d.number}`} onClick={() => nav(`/pos?draft=${d.id}`)}>{t('Open in POS', 'فتح في نقطة البيع')}</button> : null}
                          {can('pos') ? <button className="btn sm ghost" onClick={() => confirm(t('Delete this?', 'حذف؟')) && del.mutate(d.id)}>{t('Delete', 'حذف')}</button> : null}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('Nothing here yet.', 'لا شيء هنا بعد.')}</Empty>}
      </div>
    </div>
  );
}

export function Returns() {
  const [range, setRange] = useState<Range>(lastDays(30));
  const [branch, setBranch] = useState('');
  const nav = useNavigate();
  const list = useQuery({ queryKey: ['returns', range, branch], queryFn: () => api<any[]>(`/returns?from=${range.from}&to=${range.to}${branch ? `&branch=${branch}` : ''}`) });
  return (
    <div className="stack lg">
      <PageHead title={t('Sales returns', 'مرتجع المبيعات')} sub={t('Items brought back after they were handed over. Start a return from the sale.', 'أصناف أُعيدت بعد تسليمها. ابدأ الإرجاع من الفاتورة.')} />
      <div className="filters"><DateRange value={range} onChange={setRange} /><BranchSelect value={branch} onChange={setBranch} /></div>
      <div className="card table-wrap">
        {!list.data ? <Loading /> : list.data.length ? (
          <table>
            <thead><tr><th>#</th><th>{t('Date', 'التاريخ')}</th><th>{t('Sale', 'الفاتورة')}</th><th>{t('Customer', 'العميل')}</th><th>{t('Items', 'الأصناف')}</th><th>{t('Refund', 'طريقة الرد')}</th><th>{t('By', 'بواسطة')}</th><th className="right">{t('Amount', 'المبلغ')}</th></tr></thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id} className="click" onClick={() => nav(`/orders/${r.order_id}`)}>
                  <td className="strong">{r.number}</td>
                  <td className="small">{dateTime(r.created_at)}</td>
                  <td>#{r.order_number}</td>
                  <td>{r.customer_name ?? '—'}</td>
                  <td className="num">{r.qty}</td>
                  <td className="small">{methodLabel(r.method)}{r.restock ? '' : ` · ${t('not restocked', 'لم يُرجع للمخزون')}`}</td>
                  <td className="small">{r.staff_name}</td>
                  <td className="right num">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('No returns in this period.', 'لا مرتجعات في هذه الفترة.')}</Empty>}
      </div>
    </div>
  );
}

export function Shipments() {
  const [status, setStatus] = useState('open');
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const [edit, setEdit] = useState<any>(null);
  const list = useQuery({ queryKey: ['shipments', status], queryFn: () => api<any[]>(`/shipments?status=${status}`) });
  const save = useMutation({
    mutationFn: () => api(`/orders/${edit.id}/shipping`, { method: 'PATCH', body: edit.shipping }),
    onSuccess: () => {
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['shipments'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const move = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) => api(`/orders/${id}/stage`, { body: { stage } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipments'] }),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const next: Record<string, string> = { confirmed: 'ready', ready: 'out_for_delivery', out_for_delivery: 'delivered' };
  return (
    <div className="stack lg">
      <PageHead title={t('Shipments', 'الشحنات')} sub={t('Shop orders delivered to an address: courier, tracking and progress.', 'طلبات المتجر الموصّلة إلى عنوان: المندوب ورقم التتبع والحالة.')}>
        <Tabs value={status} onChange={setStatus} options={[['open', t('To deliver', 'قيد التوصيل')], ['delivered', t('Delivered', 'تم التوصيل')], ['', t('All', 'الكل')]]} />
      </PageHead>
      <div className="card table-wrap">
        {!list.data ? <Loading /> : list.data.length ? (
          <table>
            <thead><tr><th>#</th><th>{t('Customer', 'العميل')}</th><th>{t('Address', 'العنوان')}</th><th>{t('Courier', 'المندوب')}</th><th>{t('Status', 'الحالة')}</th><th className="right">{t('Total', 'الإجمالي')}</th><th><span className="sr-only">{t('Actions', 'إجراءات')}</span></th></tr></thead>
            <tbody>
              {list.data.map((o) => (
                <tr key={o.id}>
                  <td className="strong"><Link to={`/orders/${o.id}`}>#{o.number}</Link><div className="small muted">{date(o.created_at)}</div></td>
                  <td>{o.customer_name}<div className="small muted num">{phone(o.phone)}</div></td>
                  <td className="small">{o.address?.line1}{o.address?.area ? `, ${o.address.area}` : ''}</td>
                  <td className="small">{o.shipping?.courier ?? '—'}{o.shipping?.tracking ? <div className="muted">{o.shipping.tracking}</div> : null}</td>
                  <td><StageBadge stage={o.stage} thobes={false} /></td>
                  <td className="right num">{money(o.total)}</td>
                  <td className="right">
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn sm secondary" onClick={() => setEdit({ id: o.id, number: o.number, shipping: { courier: o.shipping?.courier ?? '', tracking: o.shipping?.tracking ?? '', driverPhone: o.shipping?.driverPhone ?? '', note: o.shipping?.note ?? '' } })}><Truck size={14} /></button>
                      {next[o.stage] && can('workshop') ? <button className="btn sm" onClick={() => move.mutate({ id: o.id, stage: next[o.stage] })}>{stageLabel(next[o.stage], false)}</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('No shipments here.', 'لا شحنات هنا.')}</Empty>}
      </div>
      {edit ? (
        <Modal title={`${t('Shipment', 'الشحنة')} #${edit.number}`} onClose={() => setEdit(null)} footer={<><button className="btn secondary" onClick={() => setEdit(null)}>{t('Cancel', 'إلغاء')}</button><button className="btn" onClick={async () => (await confirmSave()) && save.mutate()}>{t('Save', 'حفظ')}</button></>}>
          <div className="grid k2">
            <Field label={t('Courier', 'شركة التوصيل / المندوب')}><Input value={edit.shipping.courier} onChange={(e) => setEdit({ ...edit, shipping: { ...edit.shipping, courier: e.target.value } })} /></Field>
            <Field label={t('Tracking number', 'رقم التتبع')}><Input value={edit.shipping.tracking} onChange={(e) => setEdit({ ...edit, shipping: { ...edit.shipping, tracking: e.target.value } })} /></Field>
            <Field label={t('Driver mobile', 'جوال المندوب')}><Input dir="ltr" value={edit.shipping.driverPhone} onChange={(e) => setEdit({ ...edit, shipping: { ...edit.shipping, driverPhone: e.target.value } })} /></Field>
            <Field label={t('Note', 'ملاحظة')}><Input value={edit.shipping.note} onChange={(e) => setEdit({ ...edit, shipping: { ...edit.shipping, note: e.target.value } })} /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function Registers() {
  const [range, setRange] = useState<Range>(lastDays(30));
  const [branch, setBranch] = useState('');
  const { can } = useAuth();
  const toast = useToast();
  const list = useQuery({ queryKey: ['registers', range, branch], queryFn: () => api<any[]>(`/registers?from=${range.from}&to=${range.to}${branch ? `&branch=${branch}` : ''}`) });
  return (
    <div className="stack lg">
      <PageHead title={t('Cash registers', 'صناديق النقد')} sub={can('reports') ? t('Every register opened, with what it took and how the count came out.', 'كل صندوق فُتح، مع المبيعات ونتيجة العد.') : t('Your registers.', 'صناديقك.')}>
        {can('reports') ? <button className="btn secondary" onClick={() => downloadCsv(`/reports/registers?format=csv&from=${range.from}&to=${range.to}&lang=${t('en', 'ar')}`, 'registers.csv').catch((e) => toast(errorMessage(e), 'error'))}><Download size={16} /> CSV</button> : null}
      </PageHead>
      <div className="filters"><DateRange value={range} onChange={setRange} /><BranchSelect value={branch} onChange={setBranch} /></div>
      <div className="card table-wrap">
        {!list.data ? <Loading /> : list.data.length ? (
          <table>
            <thead><tr><th>{t('Staff', 'الموظف')}</th><th>{t('Branch', 'الفرع')}</th><th>{t('Opened', 'الفتح')}</th><th>{t('Closed', 'الإغلاق')}</th><th className="right">{t('Cash sales', 'المبيعات النقدية')}</th><th className="right">{t('Card', 'بطاقة')}</th><th className="right">{t('Expected cash', 'النقد المتوقع')}</th><th className="right">{t('Counted', 'المعدود')}</th><th className="right">{t('Difference', 'الفرق')}</th><th><span className="sr-only">{t('Actions', 'إجراءات')}</span></th></tr></thead>
            <tbody>
              {list.data.map((r) => {
                const expected = r.closed_at ? Number(r.expected_cash) : r.totals.expected_cash;
                const diff = r.closed_at ? Math.round((Number(r.counted_cash) - expected) * 100) / 100 : null;
                return (
                  <tr key={r.id}>
                    <td className="strong">{r.staff_name}</td>
                    <td className="small">{L({ name_en: r.branch_en, name_ar: r.branch_ar })}</td>
                    <td className="small">{dateTime(r.opened_at)}</td>
                    <td className="small">{r.closed_at ? dateTime(r.closed_at) : <span className="badge ok">{t('Open', 'مفتوح')}</span>}</td>
                    <td className="right num">{money(r.totals.cash_sales)}</td>
                    <td className="right num">{money(r.totals.card_sales)}</td>
                    <td className="right num">{money(expected)}</td>
                    <td className="right num">{r.closed_at ? money(r.counted_cash) : '—'}</td>
                    <td className={`right num ${diff ? 'tone-error strong' : ''}`}>{diff === null ? '—' : money(diff)}</td>
                    <td className="right">{r.closed_at && can('reports') ? <button className="btn sm ghost" aria-label={t('Print', 'طباعة')} onClick={() => openPrint(`register/${r.id}`)}><Printer size={14} /></button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty>{t('No registers in this period.', 'لا صناديق في هذه الفترة.')}</Empty>}
      </div>
    </div>
  );
}
