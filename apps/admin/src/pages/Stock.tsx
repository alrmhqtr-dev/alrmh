import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { dateTime, money, num } from '../lib/format';
import { BranchSelect, DateRange, Empty, Field, Input, Loading, Modal, PageHead, SearchBox, Select, Stat, Tabs, lastDays, useToast, type Range } from '../ui';
import { ItemPicker, type Pickable } from '../items';

const REASON: Record<string, [string, string]> = {
  opening: ['Opening stock', 'مخزون افتتاحي'],
  purchase: ['Purchase', 'شراء'],
  purchase_return: ['Returned to supplier', 'مرتجع للمورد'],
  sale: ['Sale', 'بيع'],
  sale_return: ['Returned by customer', 'مرتجع من العميل'],
  cancel: ['Cancelled order', 'طلب ملغي'],
  adjust: ['Adjustment', 'تسوية'],
  transfer_in: ['Transfer in', 'نقل وارد'],
  transfer_out: ['Transfer out', 'نقل صادر'],
  received: ['New stock received', 'استلام مخزون جديد'],
};
const reason = (r: string) => (REASON[r] ? t(...REASON[r]) : r);

export function StockHistory({ kind, id }: { kind: string; id: string }) {
  const h = useQuery({ queryKey: ['stock-history', kind, id], queryFn: () => api<any[]>(`/stock/history?kind=${kind}&id=${encodeURIComponent(id)}`) });
  if (!h.data) return <Loading />;
  if (!h.data.length) return <Empty>{t('No stock movements yet.', 'لا حركات مخزون بعد.')}</Empty>;
  return (
    <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
      <table>
        <thead><tr><th>{t('Date', 'التاريخ')}</th><th>{t('Branch', 'الفرع')}</th><th>{t('What', 'الحركة')}</th><th>{t('Ref', 'المرجع')}</th><th>{t('Size', 'المقاس')}</th><th className="right">{t('Qty', 'الكمية')}</th></tr></thead>
        <tbody>
          {h.data.map((m) => (
            <tr key={m.id}>
              <td className="small">{dateTime(m.created_at)}</td>
              <td className="small">{L({ name_en: m.branch_en, name_ar: m.branch_ar })}</td>
              <td className="small">{reason(m.reason)}{m.staff_name ? <div className="muted">{m.staff_name}</div> : null}</td>
              <td className="small num">{m.ref_number ?? '—'}</td>
              <td className="small">{m.size || '—'}</td>
              <td className={`right num strong ${m.qty < 0 ? 'tone-error' : 'tone-ok'}`}>{m.qty > 0 ? '+' : ''}{num(m.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Adds new stock that has arrived: metres of cloth or a number of a product, at one branch. */
function ReceiveModal({ item, onClose }: { item: (Pickable & { branch_id?: string }) | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { staff } = useAuth();
  const [picked, setPicked] = useState<Pickable | null>(item);
  const [branch, setBranch] = useState(item?.branch_id ?? staff?.branch_id ?? '');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const branches = useQuery({ queryKey: ['branches'], queryFn: () => api<{ id: string; name_en: string; name_ar: string; active: boolean }[]>('/branches') });
  const branchId = branch || branches.data?.find((b) => b.active)?.id || '';
  const cloth = picked?.kind === 'fabric';
  const valid = Number(qty) > 0 && (cloth ? Math.round(Number(qty) * 100) === Number(qty) * 100 : Number.isInteger(Number(qty)));
  const save = useMutation({
    mutationFn: () => api<{ level: number }>('/stock/receive', { body: { branchId, kind: picked!.kind, id: picked!.id, size: picked!.size || null, qty: Number(qty), note: note.trim() || null } }),
    onSuccess: (r) => {
      toast(t(`Received. Now ${num(r.level)} ${cloth ? 'm' : ''} in stock.`, `تم الاستلام. المخزون الآن ${num(r.level)} ${cloth ? 'م' : ''}.`));
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['pos-items'] });
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <Modal
      title={t('Receive new stock', 'استلام مخزون جديد')}
      onClose={onClose}
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>{t('Cancel', 'إلغاء')}</button>
          <button className="btn" data-testid="receive-save" disabled={!picked || !branchId || !valid || save.isPending} onClick={() => save.mutate()}>{t('Add to stock', 'إضافة للمخزون')}</button>
        </>
      }
    >
      {picked ? (
        <div className="row spread">
          <div><div className="strong">{picked.name}</div><div className="small muted num">{picked.sku}</div></div>
          {!item ? <button className="btn sm ghost" onClick={() => setPicked(null)}>{t('Change', 'تغيير')}</button> : null}
        </div>
      ) : (
        <Field label={t('Item', 'الصنف')}><ItemPicker testid="receive-picker" onPick={setPicked} /></Field>
      )}
      <div className="grid k2">
        <Field label={t('Branch', 'الفرع')}>
          <Select value={branchId} onChange={(e) => setBranch(e.target.value)}>
            {(branches.data ?? []).filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{L(b)}</option>)}
          </Select>
        </Field>
        <Field label={cloth ? t('Metres received', 'الأمتار المستلمة') : t('Quantity received', 'الكمية المستلمة')}>
          <Input data-testid="receive-qty" type="number" inputMode="decimal" min={0} step={cloth ? '0.01' : '1'} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus={Boolean(item)} />
        </Field>
      </div>
      <Field label={t('Note (optional)', 'ملاحظة (اختياري)')}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. supplier delivery', 'مثال: توريد من المورد')} /></Field>
    </Modal>
  );
}

export function StockLevels() {
  const [params] = useSearchParams();
  const { can } = useAuth();
  const [tab, setTab] = useState<'fabric' | 'product'>(params.get('tab') === 'products' ? 'product' : 'fabric');
  const [branch, setBranch] = useState('');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [low, setLow] = useState(params.get('low') === '1');
  const [hist, setHist] = useState<any>(null);
  const [receive, setReceive] = useState<{ item: (Pickable & { branch_id?: string }) | null } | null>(null);
  const list = useQuery({ queryKey: ['stock', branch, q, low], queryFn: () => api<any[]>(`/stock?${new URLSearchParams({ ...(branch ? { branch } : {}), ...(q ? { q } : {}), ...(low ? { low: '1' } : {}) })}`) });
  const rows = (list.data ?? []).filter((r) => r.kind === tab);
  const cloth = tab === 'fabric';
  return (
    <div className="stack lg">
      <PageHead title={t('Stock', 'المخزون')} sub={t('Cloth in metres and products by quantity, per branch. Add new stock when it arrives; sales take it off.', 'القماش بالمتر والمنتجات بالكمية في كل فرع. أضف المخزون الجديد عند وصوله، والمبيعات تخصم منه.')}>
        <Tabs value={tab} onChange={setTab} options={[['fabric', t('Cloth (metres)', 'الأقمشة (بالمتر)')], ['product', t('Products', 'المنتجات')]]} />
        {can('products') ? <button className="btn" data-testid="receive-new" onClick={() => setReceive({ item: null })}><Plus size={16} /> {t('Receive stock', 'استلام مخزون')}</button> : null}
      </PageHead>
      <div className="filters">
        <BranchSelect value={branch} onChange={setBranch} />
        <SearchBox value={q} onChange={setQ} placeholder={t('Name or code', 'الاسم أو الرمز')} width={220} />
        <label className="check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> {t('Low stock only', 'المنخفض فقط')}</label>
        <div className="grow" />
        <Link className="small" to="/stock/adjustments">{t('Corrections', 'التسويات')}</Link>
        <Link className="small" to="/stock/transfers">{t('Transfers', 'النقل')}</Link>
      </div>
      <div className="card table-wrap">
        {!list.data ? <Loading /> : rows.length ? (
          <table data-testid="stock-table">
            <thead><tr><th>{cloth ? t('Cloth', 'القماش') : t('Product', 'المنتج')}</th><th>{t('Branch', 'الفرع')}</th><th className="right">{cloth ? t('Metres', 'الأمتار') : t('Quantity', 'الكمية')}</th><th><span className="sr-only">{t('Actions', 'إجراءات')}</span></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}${r.id}${r.size}${r.branch_id}`} data-testid={`stock-${r.sku}${r.size ? `-${r.size}` : ''}`}>
                  <td className="click" onClick={() => setHist(r)}><span className="strong">{L(r)}</span>{r.size ? <span className="muted"> · {r.size}</span> : null}<div className="small muted num">{r.sku}</div></td>
                  <td className="small">{L({ name_en: r.branch_en, name_ar: r.branch_ar })}</td>
                  <td className={`right num strong ${r.low ? 'tone-error' : ''}`} title={r.low ? t(`At or below the alert (${num(r.alert_qty)})`, `عند حد التنبيه أو أقل (${num(r.alert_qty)})`) : undefined}>
                    {num(r.qty)} {cloth ? t('m', 'م') : r.unit ?? ''}
                  </td>
                  <td className="right">
                    {can('products') ? (
                      <button className="btn sm secondary" data-testid={`receive-${r.sku}${r.size ? `-${r.size}` : ''}`} onClick={() => setReceive({ item: { kind: r.kind, id: r.id, sku: r.sku, name: `${L(r)}${r.size ? ` · ${r.size}` : ''}`, size: r.size, cost: r.cost, price: r.price, unit: r.unit, branch_id: r.branch_id } })}>
                        <Plus size={14} /> {t('Receive', 'استلام')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{cloth ? t('No cloth tracked yet. Use Receive stock to add metres of a cloth.', 'لا أقمشة متتبعة بعد. استخدم "استلام مخزون" لإضافة أمتار قماش.') : t('No products tracked yet. Use Receive stock when products arrive.', 'لا منتجات متتبعة بعد. استخدم "استلام مخزون" عند وصول المنتجات.')}</Empty>}
      </div>
      {hist ? <Modal title={`${L(hist)}${hist.size ? ` · ${hist.size}` : ''}`} onClose={() => setHist(null)} wide><StockHistory kind={hist.kind} id={hist.id} /></Modal> : null}
      {receive ? <ReceiveModal item={receive.item} onClose={() => setReceive(null)} /> : null}
    </div>
  );
}

type Line = Pickable & { qty: string };

function LinesEditor({ lines, setLines, signed }: { lines: Line[]; setLines: (l: Line[]) => void; signed?: boolean }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <ItemPicker testid="line-picker" onPick={(p) => (lines.some((l) => l.kind === p.kind && l.id === p.id && l.size === p.size) ? null : setLines([...lines, { ...p, qty: '' }]))} />
      {lines.length ? (
        <table>
          <thead><tr><th>{t('Item', 'الصنف')}</th><th style={{ width: 140 }}>{signed ? t('Change (+ / −)', 'التغيير (+ / −)') : t('Quantity', 'الكمية')}</th><th style={{ width: 40 }} /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>{l.name}<div className="small muted num">{l.sku}</div></td>
                <td><Input data-testid={`line-qty-${i}`} type="number" step="any" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} placeholder={signed ? '-2' : '1'} /></td>
                <td><button className="btn sm ghost" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label={t('Remove', 'حذف')}><Trash2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

export function Adjustments() {
  const { can, staff } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [range, setRange] = useState<Range>(lastDays(90));
  const [form, setForm] = useState<{ branchId: string; kind: string; reason: string; lines: Line[] } | null>(null);
  const list = useQuery({ queryKey: ['adjustments', range], queryFn: () => api<any[]>(`/stock/adjustments?from=${range.from}&to=${range.to}`) });
  const save = useMutation({
    mutationFn: () => api('/stock/adjustments', { body: { branchId: form!.branchId, kind: form!.kind, reason: form!.reason, lines: form!.lines.map((l) => ({ kind: l.kind, id: l.id, size: l.size, qty: Number(l.qty) })) } }),
    onSuccess: () => {
      toast(t('Stock adjusted.', 'تمت تسوية المخزون.'));
      setForm(null);
      qc.invalidateQueries({ queryKey: ['adjustments'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <div className="stack lg">
      <PageHead title={t('Stock adjustments', 'تسوية المخزون')} sub={t('Correct stock after a count, damage or loss. Add with +, remove with −.', 'صحّح المخزون بعد الجرد أو التلف أو الفقد. أضف بـ + واخصم بـ −.')}>
        {can('products') ? <button className="btn" data-testid="new-adjustment" onClick={() => setForm({ branchId: staff?.branch_id ?? '', kind: 'normal', reason: '', lines: [] })}><Plus size={16} /> {t('New adjustment', 'تسوية جديدة')}</button> : null}
      </PageHead>
      <DateRange value={range} onChange={setRange} />
      <div className="card table-wrap">
        {!list.data ? <Loading /> : list.data.length ? (
          <table>
            <thead><tr><th>#</th><th>{t('Date', 'التاريخ')}</th><th>{t('Branch', 'الفرع')}</th><th>{t('Type', 'النوع')}</th><th>{t('Reason', 'السبب')}</th><th>{t('Items', 'الأصناف')}</th><th>{t('By', 'بواسطة')}</th><th className="right">{t('Value', 'القيمة')}</th></tr></thead>
            <tbody>
              {list.data.map((a) => (
                <tr key={a.id}>
                  <td className="strong">{a.number}</td>
                  <td className="small">{dateTime(a.created_at)}</td>
                  <td className="small">{L({ name_en: a.branch_en, name_ar: a.branch_ar })}</td>
                  <td className="small">{a.kind === 'abnormal' ? t('Loss or damage', 'فقد أو تلف') : t('Count', 'جرد')}</td>
                  <td className="small">{a.reason ?? '—'}</td>
                  <td className="num">{a.lines?.length ?? 0}</td>
                  <td className="small">{a.staff_name}</td>
                  <td className={`right num ${a.value < 0 ? 'tone-error' : ''}`}>{money(a.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('No adjustments in this period.', 'لا تسويات في هذه الفترة.')}</Empty>}
      </div>
      {form ? (
        <Modal title={t('New stock adjustment', 'تسوية مخزون جديدة')} onClose={() => setForm(null)} wide footer={<><button className="btn secondary" onClick={() => setForm(null)}>{t('Cancel', 'إلغاء')}</button><button className="btn" data-testid="adjust-save" disabled={!form.branchId || !form.lines.length || form.lines.some((l) => !Number(l.qty)) || save.isPending} onClick={() => save.mutate()}>{t('Save', 'حفظ')}</button></>}>
          <div className="grid k3">
            <Field label={t('Branch', 'الفرع')}><BranchSelect value={form.branchId} onChange={(v) => setForm({ ...form, branchId: v })} all={false} testid="adjust-branch" /></Field>
            <Field label={t('Type', 'النوع')}>
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="normal">{t('Count', 'جرد')}</option>
                <option value="abnormal">{t('Loss or damage', 'فقد أو تلف')}</option>
              </Select>
            </Field>
            <Field label={t('Reason', 'السبب')}><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
          </div>
          <LinesEditor lines={form.lines} setLines={(lines) => setForm({ ...form, lines })} signed />
        </Modal>
      ) : null}
    </div>
  );
}

export function Transfers() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [range, setRange] = useState<Range>(lastDays(90));
  const [form, setForm] = useState<{ fromBranchId: string; toBranchId: string; note: string; lines: Line[] } | null>(null);
  const list = useQuery({ queryKey: ['transfers', range], queryFn: () => api<any[]>(`/stock/transfers?from=${range.from}&to=${range.to}`) });
  const save = useMutation({
    mutationFn: () => api('/stock/transfers', { body: { fromBranchId: form!.fromBranchId, toBranchId: form!.toBranchId, note: form!.note, lines: form!.lines.map((l) => ({ kind: l.kind, id: l.id, size: l.size, qty: Number(l.qty) })) } }),
    onSuccess: () => {
      toast(t('Stock moved.', 'تم نقل المخزون.'));
      setForm(null);
      qc.invalidateQueries({ queryKey: ['transfers'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  return (
    <div className="stack lg">
      <PageHead title={t('Stock transfers', 'نقل المخزون')} sub={t('Move stock from one branch to another.', 'انقل المخزون من فرع إلى آخر.')}>
        {can('products') ? <button className="btn" onClick={() => setForm({ fromBranchId: '', toBranchId: '', note: '', lines: [] })}><Plus size={16} /> {t('New transfer', 'نقل جديد')}</button> : null}
      </PageHead>
      <DateRange value={range} onChange={setRange} />
      <div className="card table-wrap">
        {!list.data ? <Loading /> : list.data.length ? (
          <table>
            <thead><tr><th>#</th><th>{t('Date', 'التاريخ')}</th><th>{t('From', 'من')}</th><th>{t('To', 'إلى')}</th><th>{t('Items', 'الأصناف')}</th><th>{t('Note', 'ملاحظة')}</th><th>{t('By', 'بواسطة')}</th></tr></thead>
            <tbody>
              {list.data.map((x) => (
                <tr key={x.id}>
                  <td className="strong">{x.number}</td>
                  <td className="small">{dateTime(x.created_at)}</td>
                  <td className="small">{L({ name_en: x.from_en, name_ar: x.from_ar })}</td>
                  <td className="small">{L({ name_en: x.to_en, name_ar: x.to_ar })}</td>
                  <td className="num">{x.lines?.reduce((a: number, l: any) => a + l.qty, 0) ?? 0}</td>
                  <td className="small">{x.note ?? '—'}</td>
                  <td className="small">{x.staff_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('No transfers in this period.', 'لا عمليات نقل في هذه الفترة.')}</Empty>}
      </div>
      {form ? (
        <Modal title={t('New transfer', 'نقل جديد')} onClose={() => setForm(null)} wide footer={<><button className="btn secondary" onClick={() => setForm(null)}>{t('Cancel', 'إلغاء')}</button><button className="btn" disabled={!form.fromBranchId || !form.toBranchId || form.fromBranchId === form.toBranchId || !form.lines.length || form.lines.some((l) => !(Number(l.qty) > 0)) || save.isPending} onClick={() => save.mutate()}>{t('Move stock', 'نقل المخزون')}</button></>}>
          <div className="grid k3">
            <Field label={t('From', 'من')}><BranchSelect value={form.fromBranchId} onChange={(v) => setForm({ ...form, fromBranchId: v })} all={false} /></Field>
            <Field label={t('To', 'إلى')}><BranchSelect value={form.toBranchId} onChange={(v) => setForm({ ...form, toBranchId: v })} all={false} /></Field>
            <Field label={t('Note', 'ملاحظة')}><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          </div>
          <LinesEditor lines={form.lines} setLines={(lines) => setForm({ ...form, lines })} />
        </Modal>
      ) : null}
    </div>
  );
}

/** التوصيات: what to buy again soon. */
export function Suggestions() {
  const { can } = useAuth();
  const list = useQuery({ queryKey: ['suggestions'], queryFn: () => api<any[]>('/stock/suggestions') });
  return (
    <div className="stack lg">
      <PageHead title={t('Reorder suggestions', 'التوصيات')} sub={t('Items at or below their alert level, or selling faster than the stock left. The suggestion covers about a month at the current pace.', 'أصناف وصلت حد التنبيه أو تُباع أسرع من المتبقي. الكمية المقترحة تكفي شهرًا تقريبًا بالوتيرة الحالية.')}>
        {can('purchases') ? <Link className="btn" to="/purchases/new">{t('New purchase', 'مشتريات جديدة')}</Link> : null}
      </PageHead>
      {list.data ? <div className="grid k4"><Stat label={t('Items to reorder', 'أصناف للطلب')} value={list.data.length} tone={list.data.length ? 'gold' : undefined} /></div> : null}
      <div className="card table-wrap">
        {!list.data ? <Loading /> : list.data.length ? (
          <table>
            <thead><tr><th>{t('Code', 'الرمز')}</th><th>{t('Item', 'الصنف')}</th><th className="right">{t('In stock', 'المخزون')}</th><th className="right">{t('Alert at', 'حد التنبيه')}</th><th className="right">{t('Sold · 30 days', 'المباع · 30 يومًا')}</th><th className="right">{t('Suggested order', 'الكمية المقترحة')}</th><th>{t('Last supplier', 'آخر مورد')}</th></tr></thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={`${r.kind}${r.id}${r.size}`}>
                  <td className="small num">{r.sku}</td>
                  <td className="strong">{L(r)}{r.size ? <span className="muted"> · {r.size}</span> : null}</td>
                  <td className="right num tone-error strong">{num(r.qty)}</td>
                  <td className="right num muted">{num(r.alert_qty)}</td>
                  <td className="right num">{num(r.sold_30d)}</td>
                  <td className="right num strong">{num(r.suggested)}</td>
                  <td className="small">{r.last_supplier ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('Nothing to reorder. Stock looks healthy.', 'لا شيء للطلب. المخزون جيد.')}</Empty>}
      </div>
    </div>
  );
}
