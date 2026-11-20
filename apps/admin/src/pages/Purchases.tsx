import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Plus, Printer, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { date, methodLabel, money, num, todayQatar } from '../lib/format';
import { BranchSelect, DateRange, Empty, Field, Input, Loading, Modal, PageHead, Select, Stat, Tabs, TextArea, lastDays, openPrint, useToast, type Range } from '../ui';
import { ItemPicker, type Pickable } from '../items';
import { PayModal } from './Suppliers';

const statusLabel = (s: string) => (s === 'received' ? t('Received', 'مستلمة') : s === 'ordered' ? t('Ordered', 'مطلوبة') : t('Cancelled', 'ملغاة'));
const useSuppliers = () => useQuery({ queryKey: ['list', 'suppliers'], queryFn: () => api<any[]>('/lists/suppliers') });

export function Purchases() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const [range, setRange] = useState<Range>(lastDays(90));
  const [supplier, setSupplier] = useState('');
  const kind = params.get('kind') === 'return' ? 'return' : 'purchase';
  const suppliers = useSuppliers();
  const list = useQuery({ queryKey: ['purchases', range, kind, supplier], queryFn: () => api<any[]>(`/purchases?from=${range.from}&to=${range.to}&kind=${kind}${supplier ? `&supplier=${supplier}` : ''}`) });
  const rows = list.data ?? [];
  return (
    <div className="stack lg">
      <PageHead title={kind === 'return' ? t('Purchase returns', 'مرتجع المشتريات') : t('Purchases', 'المشتريات')} sub={t('Cloth and products bought from suppliers. Received goods go into stock.', 'الأقمشة والمنتجات المشتراة من الموردين. البضاعة المستلمة تُضاف للمخزون.')}>
        <Tabs value={kind} onChange={(v) => setParams(v === 'return' ? { kind: 'return' } : {})} options={[['purchase', t('Purchases', 'المشتريات')], ['return', t('Returns', 'المرتجعات')]]} />
        {can('purchases') ? <Link className="btn" to="/purchases/new" data-testid="new-purchase"><Plus size={16} /> {t('Add purchase', 'أضف مشتريات')}</Link> : null}
      </PageHead>
      <div className="filters">
        <DateRange value={range} onChange={setRange} />
        <select className="input" style={{ width: 200 }} value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label={t('Supplier', 'المورد')}>
          <option value="">{t('All suppliers', 'كل الموردين')}</option>
          {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {list.data ? (
        <div className="grid k4">
          <Stat label={t('Total', 'الإجمالي')} value={money(rows.filter((r) => r.status === 'received').reduce((a, r) => a + r.total, 0))} />
          <Stat label={t('Paid', 'المدفوع')} value={money(rows.reduce((a, r) => a + r.paid, 0))} />
          <Stat label={t('Waiting to arrive', 'بانتظار الاستلام')} value={rows.filter((r) => r.status === 'ordered').length} />
        </div>
      ) : null}
      <div className="card table-wrap">
        {!list.data ? <Loading /> : rows.length ? (
          <table data-testid="purchases-table">
            <thead><tr><th>#</th><th>{t('Date', 'التاريخ')}</th><th>{t('Supplier', 'المورد')}</th><th>{t('Branch', 'الفرع')}</th><th>{t('Reference', 'المرجع')}</th><th>{t('Status', 'الحالة')}</th><th className="right">{t('Total', 'الإجمالي')}</th><th className="right">{t('Paid', 'المدفوع')}</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav(`/purchases/${p.id}`)}>
                  <td className="strong">{p.number}{p.return_of_number ? <div className="small muted">{t('of', 'من')} {p.return_of_number}</div> : null}</td>
                  <td className="small">{date(p.purchase_date)}</td>
                  <td>{p.supplier_name}</td>
                  <td className="small">{L({ name_en: p.branch_en, name_ar: p.branch_ar })}</td>
                  <td className="small">{p.reference ?? '—'}</td>
                  <td><span className={`badge ${p.status === 'received' ? 'ok' : p.status === 'ordered' ? 'gold' : ''}`}>{statusLabel(p.status)}</span></td>
                  <td className="right num">{money(p.total)}</td>
                  <td className="right num">{p.paid ? money(p.paid) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('No purchases in this period.', 'لا مشتريات في هذه الفترة.')}</Empty>}
      </div>
    </div>
  );
}

type Line = Pickable & { qty: string; unitCost: string };

export function PurchaseForm() {
  const [params] = useSearchParams();
  const { staff } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const suppliers = useSuppliers();
  const [f, setF] = useState({ supplierId: params.get('supplier') ?? '', branchId: staff?.branch_id ?? '', status: 'received', reference: '', date: todayQatar(), discount: '', tax: '', shipping: '', notes: '', payAmount: '', payMethod: 'bank_transfer' });
  const [lines, setLines] = useState<Line[]>([]);
  const subtotal = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);
  const total = Math.round((subtotal - (Number(f.discount) || 0) + (Number(f.tax) || 0) + (Number(f.shipping) || 0)) * 100) / 100;
  const save = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>('/purchases', {
        body: {
          supplierId: f.supplierId,
          branchId: f.branchId,
          status: f.status,
          reference: f.reference,
          date: f.date,
          discount: Number(f.discount) || 0,
          tax: Number(f.tax) || 0,
          shipping: Number(f.shipping) || 0,
          notes: f.notes,
          lines: lines.map((l) => ({ kind: l.kind, id: l.id, size: l.size, qty: Number(l.qty), unitCost: Number(l.unitCost) })),
          payment: Number(f.payAmount) > 0 ? { amount: Number(f.payAmount), method: f.payMethod } : null,
        },
      }),
    onSuccess: (r) => {
      toast(t(`Purchase ${r.number} saved.`, `تم حفظ المشتريات ${r.number}.`));
      qc.invalidateQueries();
      nav(`/purchases/${r.id}`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <div className="stack lg">
      <PageHead title={t('Add purchase', 'أضف مشتريات')} sub={t('Received goods are added to the branch stock and set each item’s cost.', 'تُضاف البضاعة المستلمة لمخزون الفرع وتحدّث تكلفة كل صنف.')} />
      <div className="card pad stack">
        <div className="grid k3">
          <Field label={t('Supplier', 'المورد')}>
            <div className="row" style={{ gap: 6 }}>
              <Select data-testid="po-supplier" aria-label={t('Supplier', 'المورد')} value={f.supplierId} onChange={(e) => set('supplierId', e.target.value)}>
                <option value="">—</option>
                {(suppliers.data ?? []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Link className="btn sm secondary" to="/suppliers" aria-label={t('Suppliers', 'الموردين')}><Plus size={14} /></Link>
            </div>
          </Field>
          <Field label={t('Branch (stock goes here)', 'الفرع (يُضاف المخزون إليه)')}><BranchSelect value={f.branchId} onChange={(v) => set('branchId', v)} all={false} testid="po-branch" /></Field>
          <Field label={t('Status', 'الحالة')}>
            <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
              <option value="received">{t('Received now', 'مستلمة الآن')}</option>
              <option value="ordered">{t('Ordered, not arrived', 'مطلوبة ولم تصل')}</option>
            </Select>
          </Field>
          <Field label={t('Date', 'التاريخ')}><Input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label={t("Supplier's invoice #", 'رقم فاتورة المورد')}><Input value={f.reference} onChange={(e) => set('reference', e.target.value)} /></Field>
        </div>
      </div>
      <div className="card pad stack">
        <ItemPicker testid="po-picker" onPick={(p) => setLines((ls) => (ls.some((l) => l.kind === p.kind && l.id === p.id && l.size === p.size) ? ls : [...ls, { ...p, qty: '', unitCost: p.cost ? String(p.cost) : '' }]))} />
        {lines.length ? (
          <table>
            <thead><tr><th>{t('Item', 'الصنف')}</th><th style={{ width: 130 }}>{t('Quantity', 'الكمية')}</th><th style={{ width: 150 }}>{t('Unit cost', 'تكلفة الوحدة')}</th><th className="right">{t('Line total', 'الإجمالي')}</th><th style={{ width: 40 }} /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.name}<div className="small muted num">{l.sku}</div></td>
                  <td><Input data-testid={`po-qty-${i}`} type="number" min={0} step="any" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td><Input data-testid={`po-cost-${i}`} type="number" min={0} step="any" value={l.unitCost} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, unitCost: e.target.value } : x)))} /></td>
                  <td className="right num">{money((Number(l.qty) || 0) * (Number(l.unitCost) || 0))}</td>
                  <td><button className="btn sm ghost" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label={t('Remove', 'حذف')}><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('Add the items bought.', 'أضف الأصناف المشتراة.')}</Empty>}
      </div>
      <div className="grid k2">
        <div className="card pad stack">
          <div className="grid k3">
            <Field label={t('Discount', 'الخصم')}><Input type="number" min={0} value={f.discount} onChange={(e) => set('discount', e.target.value)} /></Field>
            <Field label={t('Tax', 'الضريبة')}><Input type="number" min={0} value={f.tax} onChange={(e) => set('tax', e.target.value)} /></Field>
            <Field label={t('Shipping', 'الشحن')}><Input type="number" min={0} value={f.shipping} onChange={(e) => set('shipping', e.target.value)} /></Field>
          </div>
          <Field label={t('Notes', 'ملاحظات')}><TextArea value={f.notes} onChange={(e) => set('notes', e.target.value)} style={{ minHeight: 60 }} /></Field>
        </div>
        <div className="card pad stack">
          <div className="sum-row"><span className="secondary">{t('Items', 'الأصناف')}</span><span>{money(subtotal)}</span></div>
          <div className="sum-row total"><span>{t('Total', 'الإجمالي')}</span><span data-testid="po-total">{money(total)}</span></div>
          <div className="grid k2">
            <Field label={t('Paid now (optional)', 'المدفوع الآن (اختياري)')}><Input data-testid="po-pay" type="number" min={0} value={f.payAmount} onChange={(e) => set('payAmount', e.target.value)} /></Field>
            <Field label={t('Method', 'الطريقة')}>
              <Select value={f.payMethod} onChange={(e) => set('payMethod', e.target.value)}>{['bank_transfer', 'cash', 'card', 'cheque'].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</Select>
            </Field>
          </div>
          <button className="btn big-btn" data-testid="po-save" disabled={!f.supplierId || !f.branchId || !lines.length || lines.some((l) => !(Number(l.qty) > 0) || l.unitCost === '') || save.isPending} onClick={() => save.mutate()}>{t('Save purchase', 'حفظ المشتريات')}</button>
        </div>
      </div>
    </div>
  );
}

export function PurchaseDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [paying, setPaying] = useState(false);
  const [returning, setReturning] = useState<Record<string, string> | null>(null);
  const p = useQuery({ queryKey: ['purchase', id], queryFn: () => api<any>(`/purchases/${id}`) });
  const act = useMutation({
    mutationFn: (what: 'receive' | 'cancel') => api(`/purchases/${id}/${what}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const ret = useMutation({
    mutationFn: () => api<{ id: string; number: string }>(`/purchases/${id}/return`, { body: { lines: Object.entries(returning!).filter(([, v]) => Number(v) > 0).map(([lineId, v]) => ({ lineId, qty: Number(v) })) } }),
    onSuccess: (r) => {
      toast(t(`Return ${r.number} saved.`, `تم حفظ المرتجع ${r.number}.`));
      setReturning(null);
      qc.invalidateQueries();
      nav(`/purchases/${r.id}`);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  if (!p.data) return <Loading />;
  const d = p.data;
  return (
    <div className="stack lg">
      <PageHead title={`${d.kind === 'return' ? t('Purchase return', 'مرتجع مشتريات') : t('Purchase', 'مشتريات')} ${d.number}`} sub={`${d.supplier_name} · ${L({ name_en: d.branch_en, name_ar: d.branch_ar })} · ${date(d.purchase_date)}${d.reference ? ` · ${d.reference}` : ''}`}>
        <span className={`badge ${d.status === 'received' ? 'ok' : d.status === 'ordered' ? 'gold' : ''}`}>{statusLabel(d.status)}</span>
        <button className="btn secondary" onClick={() => openPrint(`purchase/${d.id}`)}><Printer size={15} /> {t('Print', 'طباعة')}</button>
        {can('purchases') && d.status === 'ordered' ? (
          <>
            <button className="btn secondary" onClick={() => confirm(t('Cancel this order?', 'إلغاء هذا الطلب؟')) && act.mutate('cancel')}>{t('Cancel order', 'إلغاء الطلب')}</button>
            <button className="btn" data-testid="po-receive" onClick={() => act.mutate('receive')}>{t('Mark received', 'تم الاستلام')}</button>
          </>
        ) : null}
        {can('purchases') && d.kind === 'purchase' && d.status === 'received' ? <button className="btn secondary" onClick={() => setReturning({})}>{t('Return goods', 'إرجاع بضاعة')}</button> : null}
        {can('purchases') && d.kind === 'purchase' && d.due > 0 && d.status !== 'cancelled' ? <button className="btn" onClick={() => setPaying(true)}>{t('Pay', 'دفع')}</button> : null}
      </PageHead>
      <div className="grid k4">
        <Stat label={t('Total', 'الإجمالي')} value={money(d.total)} sub={`${t('Items', 'الأصناف')} ${money(d.subtotal)}${d.discount ? ` − ${money(d.discount)}` : ''}${d.tax ? ` + ${t('tax', 'ضريبة')} ${money(d.tax)}` : ''}${d.shipping ? ` + ${t('shipping', 'شحن')} ${money(d.shipping)}` : ''}`} />
        {d.kind === 'purchase' ? <Stat label={t('Paid', 'المدفوع')} value={money(d.paid)} /> : null}
        {d.kind === 'purchase' ? <Stat label={t('Due', 'المتبقي')} value={money(d.due)} tone={d.due > 0 ? 'gold' : undefined} /> : null}
        <Stat label={t('Supplier', 'المورد')} value={<Link to={`/suppliers/${d.supplier_id}`} style={{ fontSize: 18 }}>{d.supplier_name}</Link>} />
      </div>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>{t('Item', 'الصنف')}</th><th className="right">{t('Quantity', 'الكمية')}</th><th className="right">{t('Unit cost', 'تكلفة الوحدة')}</th><th className="right">{t('Total', 'الإجمالي')}</th>{d.kind === 'purchase' ? <th className="right">{t('Returned', 'المرتجع')}</th> : null}</tr></thead>
          <tbody>
            {d.lines.map((l: any) => (
              <tr key={l.id}>
                <td className="strong">{l.name}</td>
                <td className="right num">{num(l.qty)}</td>
                <td className="right num">{money(l.unit_cost)}</td>
                <td className="right num">{money(l.line_total)}</td>
                {d.kind === 'purchase' ? <td className="right num">{l.returned ? num(l.returned) : '—'}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.payments.length ? (
        <div className="card table-wrap">
          <div style={{ padding: '16px 18px 8px' }}><h2>{t('Payments', 'الدفعات')}</h2></div>
          <table><tbody>{d.payments.map((x: any) => <tr key={x.id}><td className="small">{date(x.paid_on)}</td><td className="small">{methodLabel(x.method)}</td><td className="small">{x.reference ?? ''}</td><td className="small">{x.staff_name}</td><td className="right num">{money(x.amount)}</td></tr>)}</tbody></table>
        </div>
      ) : null}
      {d.returns.length ? <div className="small secondary">{t('Returns:', 'المرتجعات:')} {d.returns.map((r: any) => <Link key={r.id} to={`/purchases/${r.id}`} style={{ marginInlineEnd: 10 }}>{r.number} ({money(r.total)})</Link>)}</div> : null}
      {d.notes ? <div className="note">{d.notes}</div> : null}
      {paying ? <PayModal supplierId={d.supplier_id} purchaseId={d.id} due={d.due} onClose={() => setPaying(false)} /> : null}
      {returning ? (
        <Modal title={t('Return goods to the supplier', 'إرجاع بضاعة للمورد')} onClose={() => setReturning(null)} wide footer={<><button className="btn secondary" onClick={() => setReturning(null)}>{t('Cancel', 'إلغاء')}</button><button className="btn" disabled={!Object.values(returning).some((v) => Number(v) > 0) || ret.isPending} onClick={() => ret.mutate()}>{t('Save return', 'حفظ المرتجع')}</button></>}>
          <table>
            <thead><tr><th>{t('Item', 'الصنف')}</th><th className="right">{t('Can return', 'يمكن إرجاع')}</th><th style={{ width: 140 }}>{t('Return', 'إرجاع')}</th></tr></thead>
            <tbody>
              {d.lines.map((l: any) => (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td className="right num">{num(l.qty - l.returned)}</td>
                  <td><Input type="number" min={0} max={l.qty - l.returned} value={returning[l.id] ?? ''} onChange={(e) => setReturning({ ...returning, [l.id]: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      ) : null}
    </div>
  );
}
