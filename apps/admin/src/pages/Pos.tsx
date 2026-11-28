import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Minus, Plus, Printer, Ruler, Send, Shirt, Trash2, UserPlus, X } from 'lucide-react';
import { ApiError, api, errorMessage, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, t } from '../lib/i18n';
import { MEASURE_KEYS, date, measureLabel, methodLabel, money, money2, num, phone, RELATION } from '../lib/format';
import { fill, receiptUrl, waLink, type Templates } from '../lib/whatsapp';
import { Empty, Field, Input, Loading, Modal, Select, TextArea, openPrint, useToast } from '../ui';
import { OpenRegisterForm, useRegister } from '../register';
import { type Cloth, type Style } from '../thobe-options';
import { type Measurement } from '../measure';
import { ThobeDesk } from '../pos-thobe';
import { CustomerStart } from '../pos-start';
import { CART_PRINT_KEY } from '../print/cart';

type Items = {
  branchId: string;
  branches: { id: string; name_en: string; name_ar: string }[];
  categories: { id: string; name_en: string; name_ar: string }[];
  collars: Style[];
  cuffs: Style[];
  details: Style[];
  products: { id: string; sku: string; category: string; name_en: string; name_ar: string; price: number; sizes: string[]; image_url: string | null; track_stock: boolean; unit: string | null; stock: Record<string, number> | null }[];
  fabrics: (Cloth & { sku: string; stock: number | null })[];
};
type Line =
  | { key: string; kind: 'product'; productId: string; size?: string | null; qty: number; price?: number | null; discount?: number | null }
  | { key: string; kind: 'thobe'; memberId: string; collarId: string | null; cuffId?: string | null; fabricId: string; metres: number; pocket?: boolean; styleNotes?: Record<string, string> | null; qty: number; price?: number | null; discount?: number | null; remarks?: string | null };
type Cust = { id: string; name: string | null; phone: string };
type CustomerFull = {
  id: string;
  name: string | null;
  phone: string;
  group_id: string | null;
  family: { id: string; name: string; relation: string; size: string; latest: Measurement | null }[];
  addresses: { id: string; label: string; line1: string; area: string }[];
  balance: number;
  tier: { tier: { name_en: string; name_ar: string } };
};
type Quote = {
  lines: any[];
  subtotal: number;
  orderDiscount: number;
  deliveryFee: number;
  pointsUsed: number;
  pointsBalance: number;
  pointsToEarn: number;
  total: number;
  tax: number;
  hasThobes: boolean;
  expectedDelivery: string | null;
  stockError: { code: string; item?: string; size?: string; available?: number } | null;
};
type SaleResult = { orderId: string; number: string; total: number; paid: number; balance: number; change: number; receiptToken: string; pointsToEarn: number };

const key = () => Math.random().toString(36).slice(2);

/** Who the sale is for, in the sale panel, with a way to change. Every sale has a customer. */
function SaleCustomer({ customer, onChange }: { customer: Cust; onChange: () => void }) {
  return (
    <div className="row spread" data-testid="pos-customer">
      <div>
        <bdi className="strong">{customer.name}</bdi>
        <div className="small secondary num">{phone(customer.phone)}</div>
      </div>
      <button className="btn sm ghost" data-testid="pos-change-customer" onClick={onChange}>{t('Change', 'تغيير')}</button>
    </div>
  );
}

function PayModal({ total, allowPartial, onClose, onPay, busy }: { total: number; allowPartial: boolean; onClose: () => void; onPay: (p: { method: string; amount: number; reference?: string }[]) => void; busy: boolean }) {
  const [amounts, setAmounts] = useState<Record<string, string>>({ cash: '', card: '', bank_transfer: '', cheque: '' });
  const [ref, setRef] = useState('');
  const given = Object.values(amounts).reduce((a, v) => a + (Number(v) || 0), 0);
  const cash = Number(amounts.cash) || 0;
  const over = Math.round((given - total) * 100) / 100;
  const change = over > 0 ? Math.min(over, cash) : 0;
  const left = Math.max(0, Math.round((total - given) * 100) / 100);
  const invalid = over > cash + 0.001 || given <= 0 && total > 0 || (left > 0 && !allowPartial);
  const set = (m: string, v: string) => setAmounts((a) => ({ ...a, [m]: v }));
  const quick = [total, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);
  return (
    <Modal
      title={t('Payment', 'الدفع')}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn secondary" onClick={onClose}>{t('Back', 'رجوع')}</button>
          <button
            className="btn"
            data-testid="pay-confirm"
            disabled={invalid || busy}
            onClick={() => onPay(Object.entries(amounts).filter(([, v]) => Number(v) > 0).map(([method, v]) => ({ method, amount: Number(v), reference: method !== 'cash' ? ref || undefined : undefined })))}
          >
            {left > 0 ? t(`Take ${money(given)} now`, `استلام ${money(given)} الآن`) : t('Complete sale', 'إتمام البيع')}
          </button>
        </>
      }
    >
      <div className="sum-row total"><span>{t('Total due', 'الإجمالي المستحق')}</span><span data-testid="pay-total">{money(total)}</span></div>
      <div className="grid k2">
        {(['cash', 'card', 'bank_transfer', 'cheque'] as const).map((m) => (
          <Field key={m} label={methodLabel(m)}>
            <div className="row" style={{ gap: 6 }}>
              <Input data-testid={`pay-${m}`} type="number" inputMode="decimal" min={0} value={amounts[m]} onChange={(e) => set(m, e.target.value)} autoFocus={m === 'cash'} />
              <button className="btn sm secondary" onClick={() => setAmounts({ cash: '', card: '', bank_transfer: '', cheque: '', [m]: String(Math.max(0, Math.round((total - (given - (Number(amounts[m]) || 0))) * 100) / 100)) })}>{t('Rest', 'الباقي')}</button>
            </div>
          </Field>
        ))}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="small muted">{t('Cash given:', 'النقد المستلم:')}</span>
        {quick.map((v) => (
          <button key={v} className="chip" onClick={() => setAmounts({ cash: String(v), card: '', bank_transfer: '', cheque: '' })}>{money(v)}</button>
        ))}
      </div>
      {(Number(amounts.card) || Number(amounts.bank_transfer) || Number(amounts.cheque)) ? (
        <Field label={t('Card / transfer / cheque reference (optional)', 'مرجع البطاقة / التحويل / الشيك (اختياري)')}><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      ) : null}
      {change > 0 ? <div className="note gold" data-testid="pay-change">{t('Change to give', 'الباقي للعميل')}: <b className="num">{money(change)}</b></div> : null}
      {left > 0 ? (
        allowPartial ? (
          <div className="note">{t(`Balance left on the order: ${money(left)}. It is collected at pickup.`, `المتبقي على الطلب: ${money(left)}، يُستلم عند الاستلام.`)}</div>
        ) : (
          <div className="note error">{t(`${money(left)} still to pay. Walk-in sales are paid in full; choose a customer to leave a balance.`, `يتبقى ${money(left)}. مبيعات الزبون العابر تُدفع كاملة؛ اختر عميلًا لترك مبلغ متبقٍ.`)}</div>
        )
      ) : null}
      {over > cash + 0.001 ? <div className="note error">{t('Change can only be given from cash.', 'الباقي يُعاد من النقد فقط.')}</div> : null}
    </Modal>
  );
}

function Done({ result, customer, phoneHint, hasThobes, onNew }: { result: SaleResult; customer: Cust | null; phoneHint: string; hasThobes: boolean; onNew: () => void }) {
  const biz = useQuery({ queryKey: ['business'], queryFn: () => api<{ whatsapp: Templates; printing: { auto_print: boolean } }>('/business') });
  const printed = useRef(false);
  useEffect(() => {
    if (biz.data?.printing.auto_print && !printed.current) {
      printed.current = true;
      openPrint(`receipt/${result.orderId}`);
    }
  }, [biz.data, result.orderId]);
  const tel = customer?.phone ?? phoneHint;
  const text = biz.data ? fill(t(biz.data.whatsapp.receipt_en, biz.data.whatsapp.receipt_ar), { name: customer?.name ?? '', number: result.number, total: money2(result.total), balance: money2(result.balance), link: receiptUrl(result.receiptToken) }) : '';
  return (
    <div className="card pad stack lg" data-testid="sale-done" style={{ maxWidth: 560, margin: '24px auto' }}>
      <div className="stack" style={{ gap: 4, alignItems: 'center' }}>
        <div className="overline">{t('Sale complete', 'تمت عملية البيع')}</div>
        <h1 data-testid="sale-number">#{result.number}</h1>
        <div className="secondary">{t('Total', 'الإجمالي')} {money(result.total)} · {t('paid', 'المدفوع')} {money(result.paid)}</div>
      </div>
      {result.change > 0 ? <div className="note gold" style={{ fontSize: 18, textAlign: 'center' }}>{t('Change', 'الباقي')}: <b className="num">{money(result.change)}</b></div> : null}
      {result.balance > 0 ? <div className="note">{t('Balance due at pickup', 'المتبقي عند الاستلام')}: <b className="num">{money(result.balance)}</b></div> : null}
      {result.pointsToEarn > 0 ? <div className="small muted" style={{ textAlign: 'center' }}>{t(`${result.pointsToEarn} points when the order is complete.`, `${result.pointsToEarn} نقطة عند اكتمال الطلب.`)}</div> : null}
      <div className="grid k2">
        <button className="btn secondary" data-testid="print-receipt" onClick={() => openPrint(`receipt/${result.orderId}`)}><Printer size={16} /> {t('Print receipt', 'طباعة الإيصال')}</button>
        <button className="btn secondary" onClick={() => openPrint(`invoice/${result.orderId}`)}><Printer size={16} /> {t('A4 invoice', 'فاتورة A4')}</button>
        {hasThobes ? <button className="btn secondary" data-testid="print-thobe-sheet" onClick={() => openPrint(`order/${result.orderId}`)}><Ruler size={16} /> {t('Thobe sheet (A4)', 'ورقة الثوب A4')}</button> : null}
        {hasThobes ? <button className="btn secondary" onClick={() => openPrint(`ticket/${result.orderId}`)}><Ruler size={16} /> {t('Tailor ticket', 'ورقة الخياط')}</button> : null}
        {tel ? (
          <a className="btn secondary" data-testid="send-whatsapp" href={waLink(tel, text)} target="_blank" rel="noreferrer"><Send size={16} /> WhatsApp</a>
        ) : null}
      </div>
      <div className="row">
        <Link className="btn ghost" to={`/orders/${result.orderId}`}>{t('Open order', 'فتح الطلب')}</Link>
        <div className="grow" />
        <button className="btn big-btn" style={{ width: 'auto' }} data-testid="new-sale" onClick={onNew} autoFocus>{t('New sale', 'عملية بيع جديدة')}</button>
      </div>
    </div>
  );
}

export default function Pos() {
  const { can, staff } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const reg = useRegister();
  const [branchId, setBranchId] = useState<string>('');
  const items = useQuery({ queryKey: ['pos-items', branchId], queryFn: () => api<Items>(`/pos/items${branchId ? `?branch=${branchId}` : ''}`) });
  const [tab, setTab] = useState<'products' | 'thobes'>('products');
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const [sizeFor, setSizeFor] = useState<Items['products'][number] | null>(null);
  const [customer, setCustomer] = useState<Cust | null>(null);
  const [walkIn, setWalkIn] = useState({ name: '', phone: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [points, setPoints] = useState('');
  const [notes, setNotes] = useState('');
  const [deliver, setDeliver] = useState('');
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<SaleResult | null>(null);
  const [draftId, setDraftId] = useState<string | null>(params.get('draft'));
  const [thobe, setThobe] = useState({ memberId: '', collarId: '', cuffId: '', fabricId: '', metres: '', qty: '1', remarks: '' });
  const [addMember, setAddMember] = useState<{ name: string; relation: string; size: string } | null>(null);
  const mode = (params.get('mode') as 'draft' | 'quotation' | null) ?? null;
  const searchRef = useRef<HTMLInputElement>(null);

  // The register's branch is where this sale happens.
  useEffect(() => {
    if (reg.data?.open && !branchId) setBranchId(reg.data.register.branch_id);
    else if (!branchId && items.data?.branchId) setBranchId(items.data.branchId);
  }, [reg.data, items.data, branchId]);

  // Arriving from the tailor or a customer page with ?customer=… starts the sale for them.
  const fromParam = params.get('customer');
  useEffect(() => {
    if (fromParam && !customer)
      api<CustomerFull>(`/customers/${fromParam}`).then((c) => {
        setCustomer({ id: c.id, name: c.name, phone: c.phone });
        setTab('thobes');
      }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromParam]);

  const cust = useQuery({ queryKey: ['customer', customer?.id], queryFn: () => api<CustomerFull>(`/customers/${customer!.id}`), enabled: Boolean(customer) });

  // Opening a saved draft or quotation loads its basket.
  const draft = useQuery({ queryKey: ['draft', draftId], queryFn: () => api<any>(`/drafts/${draftId}`), enabled: Boolean(draftId) });
  const loadedDraft = useRef<string | null>(null);
  useEffect(() => {
    const d = draft.data;
    if (!d || loadedDraft.current === d.id) return;
    loadedDraft.current = d.id;
    const c = d.cart;
    setLines((c.lines ?? []).map((l: any) => ({ ...l, key: key() })));
    if (c.customerId) setCustomer({ id: c.customerId, name: d.customer_name, phone: d.phone });
    setWalkIn({ name: c.walkInName ?? '', phone: c.walkInPhone ?? '' });
    setNotes(c.notes ?? '');
    if (c.branchId) setBranchId(c.branchId);
  }, [draft.data]);

  const sale = useMemo(
    () => ({
      branchId: branchId || undefined,
      customerId: customer?.id ?? null,
      walkInName: customer ? null : walkIn.name || null,
      walkInPhone: customer ? null : walkIn.phone || null,
      lines: lines.map(({ key: _k, ...l }) => l),
      // Discounts are given per item only; there's no discount on the whole sale.
      orderDiscount: null,
      points: customer && Number(points) > 0 ? Math.trunc(Number(points)) : 0,
      notes: notes || null,
      deliveryAddressId: customer && deliver ? deliver : null,
    }),
    [branchId, customer, walkIn, lines, points, notes, deliver],
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  useEffect(() => {
    if (!lines.length) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const h = setTimeout(() => {
      api<Quote>('/pos/quote', { body: sale })
        .then((q) => {
          setQuote(q);
          setQuoteError(null);
        })
        .catch((e) => setQuoteError(errorMessage(e)));
    }, 180);
    return () => clearTimeout(h);
  }, [sale, lines.length]);

  const reset = () => {
    setLines([]);
    setCustomer(null);
    setWalkIn({ name: '', phone: '' });
    setPoints('');
    setNotes('');
    setDeliver('');
    setDone(null);
    setDraftId(null);
    loadedDraft.current = null;
    setParams({});
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const sell = useMutation({
    mutationFn: (payments: { method: string; amount: number; reference?: string }[]) => api<SaleResult>('/pos/sales', { body: { sale, payments, draftId: draftId ?? undefined } }),
    onSuccess: (r) => {
      setPaying(false);
      setDone(r);
      qc.invalidateQueries({ queryKey: ['register'] });
      qc.invalidateQueries({ queryKey: ['pos-items'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const save = useMutation({
    mutationFn: (kind: 'draft' | 'quotation') =>
      draftId && draft.data?.kind === kind ? api(`/drafts/${draftId}`, { method: 'PATCH', body: { sale } }).then(() => ({ id: draftId, number: draft.data.number })) : api<{ id: string; number: string }>('/drafts', { body: { kind, sale } }),
    onSuccess: (r: any, kind) => {
      toast(kind === 'quotation' ? t(`Quotation ${r.number} saved.`, `تم حفظ عرض السعر ${r.number}.`) : t(`Draft ${r.number} saved.`, `تم حفظ المسودة ${r.number}.`));
      if (kind === 'quotation') openPrint(`quotation/${r.id}`);
      reset();
      navigate(kind === 'quotation' ? '/quotations' : '/drafts');
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const newMember = useMutation({
    mutationFn: () => api<{ id: string }>(`/customers/${customer!.id}/members`, { body: addMember }),
    onSuccess: (m) => {
      qc.invalidateQueries({ queryKey: ['customer', customer?.id] });
      setThobe((x) => ({ ...x, memberId: m.id }));
      setAddMember(null);
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  const data = items.data;
  const products = useMemo(() => {
    if (!data) return [];
    const s = search.trim().toLowerCase();
    return data.products.filter((p) => (!cat || p.category === cat) && (!s || p.sku.toLowerCase().includes(s) || p.name_en.toLowerCase().includes(s) || p.name_ar.includes(search.trim())));
  }, [data, search, cat]);

  if (reg.data && !reg.data.open && reg.data.required)
    return (
      <div className="card pad stack lg" style={{ maxWidth: 560, margin: '24px auto' }} data-testid="register-gate">
        <h2>{t('Open your cash register', 'افتح صندوق النقد')}</h2>
        <div className="secondary">{t('Count the cash in the drawer to start selling. Every sale and payment is counted against your register until you close it.', 'عُدّ النقد في الدرج لتبدأ البيع. تُحسب كل عملية بيع ودفعة على صندوقك حتى تغلقه.')}</div>
        <OpenRegisterForm />
      </div>
    );
  if (!data) return <Loading />;
  if (done) return <Done result={done} customer={customer} phoneHint={walkIn.phone} hasThobes={lines.some((l) => l.kind === 'thobe')} onNew={reset} />;

  const addProduct = (p: Items['products'][number], size?: string) => {
    if (p.sizes.length && !size) return setSizeFor(p);
    setSizeFor(null);
    setLines((ls) => {
      const i = ls.findIndex((l) => l.kind === 'product' && l.productId === p.id && (l.size ?? null) === (size ?? null) && l.price == null);
      if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      return [...ls, { key: key(), kind: 'product', productId: p.id, size: size ?? null, qty: 1 }];
    });
  };
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    // A barcode scanner types the code and presses Enter.
    const code = search.trim().toUpperCase();
    const hit = data.products.find((p) => p.sku.toUpperCase() === code) ?? (products.length === 1 ? products[0] : null);
    if (hit) {
      addProduct(hit);
      setSearch('');
    }
  };
  const setLine = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? ({ ...l, ...patch } as Line) : l)));
  const family = cust.data?.family ?? [];
  const member = family.find((m) => m.id === (thobe.memberId || family[0]?.id));
  const fabric = data.fabrics.find((f) => f.id === thobe.fabricId);
  const canDiscount = can('pos.discount');
  const nameOf = (l: Line) => {
    if (l.kind === 'product') {
      const p = data.products.find((x) => x.id === l.productId);
      return `${L(p)}${l.size ? ` · ${l.size}` : ''}`;
    }
    const f = data.fabrics.find((x) => x.id === l.fabricId);
    const m = family.find((x) => x.id === l.memberId);
    return `${t('Thobe', 'ثوب')} · ${L(f)} · ${num(l.metres)} ${t('m', 'م')}${m ? ` · ${m.name}` : ''}`;
  };
  const q = quote;
  /** Print the sale as it stands, before it's paid: the receipt, or the thobes drawn with their measurements. */
  const printCart = (kind: 'receipt' | 'thobe') => {
    if (!q) return;
    const br = data.branches.find((b) => b.id === branchId);
    const r = {
      unpaid: true,
      number: '',
      created_at: new Date().toISOString(),
      branch_en: br?.name_en, branch_ar: br?.name_ar,
      customer_id: customer?.id ?? null,
      customer_name: customer?.name ?? (walkIn.name || null),
      phone: customer?.phone ?? (walkIn.phone || null),
      staff_name: staff?.name ?? null,
      items: q.lines.map((l: any, i: number) => ({
        id: i, kind: l.kind, qty: l.qty, unit_price: l.unitPrice, discount: l.discount, line_total: l.lineTotal,
        snapshot: { product: l.product, size: l.size, thobe: l.thobe, member: l.member, remarks: l.remarks },
      })),
      discount: q.orderDiscount, delivery_fee: q.deliveryFee, points_used: q.pointsUsed, total: q.total, tax: q.tax,
      payments: [], refunded: 0, balance: 0,
      expected_delivery: q.expectedDelivery, thobe_count: q.lines.filter((l: any) => l.kind === 'thobe').reduce((a: number, l: any) => a + l.qty, 0),
      measurements: family.filter((m) => m.latest).map((m) => ({ ...m.latest, member_id: m.id })),
      notes: notes || null,
    };
    localStorage.setItem(CART_PRINT_KEY, JSON.stringify(r));
    openPrint(kind === 'receipt' ? 'cart-receipt' : 'cart-thobe');
  };

  return (
    <div className="stack">
      <div className="row spread wrap">
        <div className="row wrap">
          <h1>{mode === 'quotation' ? t('New quotation', 'عرض سعر جديد') : mode === 'draft' ? t('New draft', 'مسودة جديدة') : t('Point of sale', 'نقطة البيع')}</h1>
          {draft.data ? <span className="badge gold">{draft.data.kind === 'quotation' ? t('Quotation', 'عرض سعر') : t('Draft', 'مسودة')} {draft.data.number}</span> : null}
        </div>
        <div className="row wrap">
          <select className="input" style={{ width: 200 }} value={branchId} onChange={(e) => setBranchId(e.target.value)} disabled={Boolean(reg.data?.open)} aria-label={t('Branch', 'الفرع')}>
            {data.branches.map((b) => <option key={b.id} value={b.id}>{L(b)}</option>)}
          </select>
        </div>
      </div>
      {/* Every sale starts with the customer: new or existing. A draft keeps its basket while one is chosen. */}
      {!customer && !fromParam && !(draftId && draft.isLoading) ? (
        <CustomerStart onPick={(c) => { setCustomer(c); setPoints(''); setDeliver(''); }} />
      ) : (
      <>
      {/* While making thobes the sale stays out of the way until something is in it. */}
      <div className={`pos ${tab === 'thobes' ? 'thobes' : ''} ${tab === 'thobes' && lines.length === 0 ? 'solo' : ''}`}>
        <div className="stack">
          <div className="row wrap">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'products'} className={tab === 'products' ? 'on' : ''} onClick={() => setTab('products')} data-testid="pos-tab-products">{t('Products', 'المنتجات')}</button>
              <button role="tab" aria-selected={tab === 'thobes'} className={tab === 'thobes' ? 'on' : ''} onClick={() => setTab('thobes')} data-testid="pos-tab-thobes"><Shirt size={14} /> {t('Thobes', 'الثياب')}</button>
            </div>
            {tab === 'products' ? (
              <input ref={searchRef} className="input" style={{ maxWidth: 320 }} data-testid="pos-search" placeholder={t('Search or scan barcode', 'ابحث أو امسح الباركود')} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey} autoFocus aria-label={t('Search or scan barcode', 'ابحث أو امسح الباركود')} />
            ) : null}
          </div>
          {tab === 'products' ? (
            <>
              <div className="chips">
                <button className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>{t('All', 'الكل')}</button>
                {data.categories.map((c) => <button key={c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>{L(c)}</button>)}
              </div>
              {products.length ? (
                <div className="pos-items">
                  {products.map((p) => {
                    const stock = p.stock ? Object.values(p.stock).reduce((a, b) => a + b, 0) : null;
                    return (
                      <button key={p.id} className="pos-item" data-testid={`pos-item-${p.sku}`} onClick={() => addProduct(p)}>
                        {p.image_url ? <img src={mediaUrl(p.image_url)} alt="" /> : <div className="ph" />}
                        <span className="strong small">{L(p)}</span>
                        <span className="row spread small">
                          <span className="num">{money(p.price)}</span>
                          {stock !== null ? <span className={stock <= 0 ? 'tone-error' : 'muted'}>{num(stock)} {p.unit ?? ''}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <Empty>{t('No products match.', 'لا منتجات مطابقة.')}</Empty>
              )}
            </>
          ) : (
            <ThobeDesk
              items={data}
              customer={customer}
              onCustomer={(c) => { setCustomer(c); setPoints(''); setDeliver(''); }}
              onAdd={(l) => setLines((ls) => [...ls, { key: key(), kind: 'thobe', ...l }])}
            />
          )}
        </div>

        <div className="pos-cart">
          <div className="card pad stack">
            {customer ? <SaleCustomer customer={customer} onChange={() => { setCustomer(null); setPoints(''); setDeliver(''); }} /> : null}
            {cust.data ? (
              <div className="small secondary">{L(cust.data.tier.tier)} · {t('points', 'النقاط')} <b className="num">{num(cust.data.balance)}</b></div>
            ) : null}
          </div>
          <div className="card pad stack" style={{ gap: 8 }}>
            {lines.length ? (
              <div className="cart-lines" data-testid="cart-lines">
                {lines.map((l, i) => {
                  const ql = q?.lines?.[i];
                  return (
                    <div key={l.key} className="cart-line">
                      <div className="stack" style={{ gap: 4 }}>
                        <span className="strong small">{nameOf(l)}</span>
                        <div className="row" style={{ gap: 8 }}>
                          <span className="stepper">
                            <button onClick={() => (l.qty > 1 ? setLine(l.key, { qty: l.qty - 1 }) : setLines((ls) => ls.filter((x) => x.key !== l.key)))} aria-label={t('One less', 'نقص واحد')}><Minus size={14} /></button>
                            <span data-testid={`qty-${i}`}>{l.qty}</span>
                            <button onClick={() => setLine(l.key, { qty: l.qty + 1 })} aria-label={t('One more', 'زد واحدًا')}><Plus size={14} /></button>
                          </span>
                          {canDiscount ? (
                            <input className="input" style={{ width: 96, height: 30 }} type="number" min={0} data-testid={`line-discount-${i}`} placeholder={t('Discount', 'خصم')} aria-label={t('Discount on this item (QAR)', 'خصم على هذا الصنف (ر.ق)')} value={l.discount ?? ''} onChange={(e) => setLine(l.key, { discount: e.target.value === '' ? null : Number(e.target.value) })} />
                          ) : null}
                        </div>
                        {ql?.discount > 0 ? <span className="small tone-ok">{t('Discount', 'خصم')} −{money(ql.discount)}{ql.discountLabel && ql.discountLabel !== 'group' ? ` · ${ql.discountLabel}` : ql.discountLabel === 'group' ? ` · ${t('customer group', 'مجموعة العميل')}` : ''}</span> : null}
                      </div>
                      <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                        {/* With a discount the original price stays in view, then the discount, then what's due. */}
                        {ql?.discount > 0 ? <span className="num small muted strike" data-testid={`line-original-${i}`}>{money(ql.unitPrice * ql.qty)}</span> : null}
                        <span className="num strong" data-testid={`line-total-${i}`}>{ql ? money(ql.lineTotal) : '…'}</span>
                        <button className="btn sm ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={t('Remove', 'حذف')}><Trash2 size={14} /></button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty>{t('Scan or tap items to add them.', 'امسح الأصناف أو اضغط عليها لإضافتها.')}</Empty>
            )}
            <div className="grid k2" style={{ gap: 8 }}>
              {customer && cust.data && cust.data.balance > 0 ? (
                <input className="input" type="number" min={0} max={cust.data.balance} data-testid="use-points" placeholder={t(`Use points (up to ${cust.data.balance})`, `استخدم النقاط (حتى ${cust.data.balance})`)} aria-label={t('Points to use', 'النقاط المستخدمة')} value={points} onChange={(e) => setPoints(e.target.value)} />
              ) : null}
              {customer && cust.data?.addresses.length && !lines.some((l) => l.kind === 'thobe') ? (
                <Select value={deliver} onChange={(e) => setDeliver(e.target.value)} aria-label={t('Delivery', 'التوصيل')}>
                  <option value="">{t('Hand over now', 'التسليم الآن')}</option>
                  {cust.data.addresses.map((a) => <option key={a.id} value={a.id}>{t('Deliver to', 'التوصيل إلى')} {a.label} · {a.area}</option>)}
                </Select>
              ) : null}
            </div>
            <TextArea className="input notes" data-testid="sale-notes" maxLength={2000} placeholder={t('Notes on the sale', 'ملاحظات على الفاتورة')} value={notes} onChange={(e) => setNotes(e.target.value)} />
            {quoteError ? <div className="note error">{quoteError}</div> : null}
            {q?.stockError ? <div className="note error">{errorMessage(new ApiError(q.stockError.code, 400, q.stockError))}</div> : null}
            {q ? (
              <div className="stack" style={{ gap: 4 }}>
                {(() => {
                  // The original price, every discount (on items and on the sale) together, then the total below.
                  const original = q.lines.reduce((a: number, l: any) => a + l.unitPrice * l.qty, 0);
                  const discount = q.lines.reduce((a: number, l: any) => a + (l.discount || 0), 0) + (q.orderDiscount || 0);
                  return (
                    <>
                      <div className="sum-row"><span className="secondary">{t('Original price', 'السعر الأصلي')}</span><span data-testid="cart-original">{money(original)}</span></div>
                      {discount > 0 ? <div className="sum-row tone-ok"><span>{t('Discount', 'الخصم')}</span><span data-testid="cart-discount">−{money(discount)}</span></div> : null}
                    </>
                  );
                })()}
                {q.deliveryFee ? <div className="sum-row"><span className="secondary">{t('Delivery', 'التوصيل')}</span><span>{money(q.deliveryFee)}</span></div> : null}
                {q.pointsUsed ? <div className="sum-row"><span className="secondary">{t('Points', 'النقاط')}</span><span>−{money(q.pointsUsed)}</span></div> : null}
                <div className="sum-row total"><span>{t('Total', 'الإجمالي')}</span><span data-testid="cart-total">{money(q.total)}</span></div>
                {q.tax ? <div className="sum-row small muted"><span>{t('Includes tax', 'شامل الضريبة')}</span><span>{money(q.tax)}</span></div> : null}
                {q.expectedDelivery ? <div className="small muted">{t('Thobes ready by', 'الثياب جاهزة في')} {date(q.expectedDelivery)}</div> : null}
                {customer && q.pointsToEarn ? <div className="small muted">{t(`Earns ${q.pointsToEarn} points`, `يكسب ${q.pointsToEarn} نقطة`)}</div> : null}
              </div>
            ) : null}
            {q && lines.length ? (
              <div className="grid k2" style={{ gap: 8 }} data-testid="cart-print">
                <button className="btn secondary" data-testid="print-cart-receipt" onClick={() => printCart('receipt')}><Printer size={16} /> {t('Print receipt', 'طباعة الإيصال')}</button>
                {q.hasThobes ? <button className="btn secondary" data-testid="print-cart-thobe" onClick={() => printCart('thobe')}><Ruler size={16} /> {t('Print thobe', 'طباعة الثوب')}</button> : null}
              </div>
            ) : null}
            <div className="grid k2" style={{ gap: 8 }}>
              <button className="btn secondary" data-testid="save-draft" disabled={!lines.length || save.isPending} onClick={() => save.mutate('draft')}>{t('Save draft', 'حفظ مسودة')}</button>
              <button className="btn secondary" data-testid="save-quotation" disabled={!lines.length || save.isPending} onClick={() => save.mutate('quotation')}>{t('Quotation', 'عرض سعر')}</button>
            </div>
            {mode !== 'draft' && mode !== 'quotation' ? (
              <button className="btn big-btn" data-testid="pay" disabled={!q || !customer || Boolean(quoteError) || Boolean(q.stockError) || Boolean(reg.data && !reg.data.open && reg.data.required)} onClick={() => setPaying(true)}>
                {t('Pay', 'الدفع')} {q ? money(q.total) : ''}
              </button>
            ) : null}
            {lines.length ? <button className="btn ghost sm" onClick={reset}>{t('Clear', 'مسح الفاتورة')}</button> : null}
          </div>
          {staff && !can('pos.discount') ? <div className="small muted">{t('Discounts can be given by a manager.', 'يمكن للمدير إعطاء الخصومات.')}</div> : null}
        </div>
      </div>

      {sizeFor ? (
        <Modal title={L(sizeFor)} onClose={() => setSizeFor(null)}>
          <div className="chips">
            {sizeFor.sizes.map((s) => {
              const left = sizeFor.stock ? sizeFor.stock[s] ?? 0 : null;
              return (
                <button key={s} className="chip" data-testid={`size-${s}`} onClick={() => addProduct(sizeFor, s)} disabled={left !== null && left <= 0}>
                  {s}{left !== null ? <span className="small muted"> · {num(left)}</span> : null}
                </button>
              );
            })}
          </div>
        </Modal>
      ) : null}
      </>
      )}
      {paying && q ? <PayModal total={q.total} allowPartial={Boolean(customer)} busy={sell.isPending} onClose={() => setPaying(false)} onPay={(p) => sell.mutate(p)} /> : null}
    </div>
  );
}
