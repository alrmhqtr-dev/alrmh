import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowRight, Printer, Receipt, RotateCcw, Ruler, Send, Wallet } from 'lucide-react';
import { api, errorMessage, mediaUrl } from '../lib/api';
import { useAuth } from '../lib/auth';
import { L, isAr, t } from '../lib/i18n';
import { RELATION, channelLabel, date, dateTime, methodLabel, money, money2, num, phone, stageLabel } from '../lib/format';
import { fill, receiptUrl, waLink, type Templates } from '../lib/whatsapp';
import { MeasurementGrid, openMeasure, type Measurement } from '../measure';
import { Field, Input, Loading, Modal, PageHead, Select, StageBadge, TextArea, openPrint, useToast, confirmSave } from '../ui';
import { nextStage } from './Orders';
import { PhotoUploader } from './Factory';

type Detail = {
  id: string;
  number: string;
  stage: string;
  channel: string;
  total: number;
  subtotal: number;
  delivery_fee: number;
  home_visit_fee: number;
  service_charge: number;
  discount: number;
  discount_label: string | null;
  created_at: string;
  paid_at: string | null;
  expected_delivery: string | null;
  address: { label: string; label_ar?: string; line1: string; area: string; city: string; notes?: string | null; pickup?: boolean; counter?: boolean; imported?: boolean };
  customer_id: string | null;
  customer_name: string | null;
  phone: string | null;
  branch_en: string | null;
  branch_ar: string | null;
  notes: string | null;
  shipping: { courier?: string; tracking?: string } | null;
  receipt_token: string;
  payment_status: string;
  payment_ref: string | null;
  payment_provider: string | null;
  placed_by: string | null;
  points_used: number;
  points_to_earn: number;
  points_awarded: boolean;
  paid: number;
  balance: number;
  items: { id: string; kind: string; snapshot: any; qty: number; unit_price: number; line_total: number; discount: number; returned_qty: number }[];
  events: { stage: string; at: string; note: string | null; staff_name: string | null }[];
  appointments: { id: string; kind: string; starts_at: string; status: string; member_id: string; member_name: string; branch_name: string | null; line1: string | null; area: string | null }[];
  measurements: (Measurement & { member_id: string })[];
  refunds: { id: string; amount: number; reference: string | null; note: string | null; created_at: string; staff_name: string | null; method: string }[];
  payments: { id: string; provider: string; amount: number; completed_at: string; provider_ref: string | null; staff_name: string | null }[];
  photos: { id: string; caption: string | null; url: string; created_at: string }[];
  returns: { id: string; number: string; amount: number; method: string; created_at: string; staff_name: string | null }[];
  refunded: number;
  stages: string[];
};

export default function OrderDetail() {
  const { id = '' } = useParams();
  // Opened from the invoices: the sale and its payments only, without measurements and workshop details.
  const invoice = new URLSearchParams(useLocation().search).get('view') === 'invoice';
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<Detail>(`/orders/${id}`) });
  const biz = useQuery({ queryKey: ['business'], queryFn: () => api<{ whatsapp: Templates }>('/business') });
  const isThobe = (q.data?.items ?? []).some((i) => i.kind === 'thobe');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [refund, setRefund] = useState({ amount: '', reference: '', note: '', method: 'sadad' });
  const [payOpen, setPayOpen] = useState<{ amount: string; method: string; reference: string } | null>(null);
  const [returnOpen, setReturnOpen] = useState<{ qty: Record<string, string>; method: string; restock: boolean; note: string } | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['order', id] });
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['overview'] });
    qc.invalidateQueries({ queryKey: ['register'] });
  };
  const recordRefund = useMutation({
    mutationFn: () => api<{ left: number }>(`/orders/${id}/refunds`, { body: { amount: Number(refund.amount), reference: refund.reference, note: refund.note, method: refund.method } }),
    onSuccess: (r) => {
      toast(r.left ? t(`Refund recorded. ${money(r.left)} could still be refunded.`, `تم تسجيل الاسترداد. يمكن استرداد ${money(r.left)} إضافية.`) : t('Refund recorded. The customer was notified.', 'تم تسجيل الاسترداد وإبلاغ العميل.'));
      setRefundOpen(false);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const move = useMutation({
    mutationFn: (to: string) => api(`/orders/${id}/stage`, { body: { stage: to } }),
    onSuccess: (_, to) => {
      toast(t(`Moved to ${stageLabel(to, isThobe)}. The customer was notified.`, `نُقل إلى ${stageLabel(to, isThobe)} وأُبلغ العميل.`));
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const cancel = useMutation({
    mutationFn: () => api<{ refundDue: number }>(`/orders/${id}/cancel`, { body: { reason } }),
    onSuccess: (r) => {
      toast(r.refundDue ? t(`Order cancelled. ${money(r.refundDue)} to refund.`, `أُلغي الطلب. يجب رد ${money(r.refundDue)}.`) : t('Order cancelled.', 'أُلغي الطلب.'));
      setCancelOpen(false);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const takePayment = useMutation({
    mutationFn: () => api<{ balance: number }>(`/orders/${id}/payments`, { body: { amount: Number(payOpen!.amount), method: payOpen!.method, reference: payOpen!.reference || undefined } }),
    onSuccess: (r) => {
      toast(r.balance ? t(`Payment taken. ${money(r.balance)} still due.`, `تم استلام الدفعة. يتبقى ${money(r.balance)}.`) : t('Paid in full.', 'تم السداد بالكامل.'));
      setPayOpen(null);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const doReturn = useMutation({
    mutationFn: () =>
      api<{ number: string; amount: number }>(`/orders/${id}/returns`, {
        body: { lines: Object.entries(returnOpen!.qty).filter(([, v]) => Number(v) > 0).map(([itemId, v]) => ({ itemId, qty: Number(v) })), method: returnOpen!.method, restock: returnOpen!.restock, note: returnOpen!.note },
      }),
    onSuccess: (r) => {
      toast(t(`Return ${r.number} saved · ${money(r.amount)} refunded.`, `تم حفظ المرتجع ${r.number} · رُد ${money(r.amount)}.`));
      setReturnOpen(null);
      refresh();
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });

  if (!q.data) return <Loading />;
  const o = q.data;
  const thobes = o.items.filter((i) => i.kind === 'thobe');
  const next = nextStage(o.stage, thobes.length > 0);
  const discount = o.discount_label?.split(':') ?? [];
  const refundable = Math.round((o.paid - o.refunded) * 100) / 100;
  const waVars = { name: o.customer_name ?? '', number: o.number, total: money2(o.total), balance: money2(o.balance), link: receiptUrl(o.receipt_token), branch: L({ name_en: o.branch_en ?? o.address.label, name_ar: o.branch_ar ?? o.address.label_ar }) };
  const wa = biz.data?.whatsapp;

  return (
    <div className="stack lg">
      <PageHead
        title={`${invoice ? t('Invoice', 'الفاتورة') : t('Order', 'الطلب')} #${o.number}`}
        sub={
          <span className="row wrap" style={{ gap: 8 }}>
            <StageBadge stage={o.stage} thobes={isThobe} /> <span className="badge outline">{channelLabel(o.channel)}</span> {t('Placed', 'التاريخ')} {dateTime(o.created_at)}{o.expected_delivery ? ` · ${t('Due', 'التسليم')} ${date(o.expected_delivery)}` : ''}
          </span>
        }
      >
        <button className="btn secondary" onClick={() => openPrint(`receipt/${o.id}`)}><Receipt size={16} /> {t('Receipt', 'إيصال')}</button>
        <button className="btn secondary" onClick={() => openPrint(`invoice/${o.id}`)}><Printer size={16} /> {t('Invoice', 'فاتورة')}</button>
        {isThobe ? <button className="btn secondary" data-testid="print-thobe-sheet" onClick={() => openPrint(`order/${o.id}`)}><Ruler size={16} /> {t('Thobe sheet (A4)', 'ورقة الثوب A4')}</button> : null}
        {isThobe && !invoice ? <button className="btn secondary" onClick={() => openPrint(`ticket/${o.id}`)}><Ruler size={16} /> {t('Tailor ticket', 'ورقة الخياط')}</button> : null}
        {invoice ? <Link className="btn ghost" to={`/orders/${o.id}`}>{t('Open the order', 'فتح الطلب')}</Link> : null}
        {next && can('workshop') && !invoice ? (
          <button className="btn" data-testid="detail-advance" disabled={move.isPending || (next === 'delivered' && o.balance > 0)} title={next === 'delivered' && o.balance > 0 ? t('Take the balance first', 'استلم المتبقي أولًا') : undefined} onClick={async () => (await confirmSave({ title: t(`Move #${o.number} to ${stageLabel(next, isThobe)}?`, `نقل الطلب #${o.number} إلى ${stageLabel(next, isThobe)}؟`), message: t('The customer will be notified.', 'سيتم إبلاغ العميل.'), ok: t('Move', 'نقل') })) && move.mutate(next)}>
            {t('Move to', 'نقل إلى')} {stageLabel(next, isThobe)} <ArrowRight size={16} className="flip-rtl" />
          </button>
        ) : null}
      </PageHead>

      {o.balance > 0 && o.stage !== 'cancelled' ? (
        <div className="note gold row spread wrap" data-testid="balance-due">
          <span>{t('Balance due', 'المبلغ المتبقي')}: <b className="num">{money(o.balance)}</b> · {t(`paid ${money(o.paid)} of ${money(o.total)}`, `دُفع ${money(o.paid)} من ${money(o.total)}`)}</span>
          {can('pos') ? <button className="btn sm" data-testid="take-payment" onClick={() => setPayOpen({ amount: String(o.balance), method: 'cash', reference: '' })}><Wallet size={14} /> {t('Take payment', 'استلام دفعة')}</button> : null}
        </div>
      ) : null}
      {o.stage === 'cancelled' && refundable > 0 ? (
        <div className="note gold" data-testid="refund-due">{t(`Refund due: ${money(refundable)}. Refund the customer, then record it here so they are told.`, `مبلغ مستحق للرد: ${money(refundable)}. رُدّه للعميل ثم سجّله هنا ليُبلّغ.`)}</div>
      ) : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', alignItems: 'start' }}>
        <div className="stack lg">
          {thobes.map((it) => {
            const s = it.snapshot;
            const m = o.measurements.find((x) => x.member_id === s.member?.id);
            const appt = o.appointments.find((a) => a.member_id === s.member?.id);
            return (
              <div key={it.id} className="card pad stack">
                <div className="row spread">
                  <div>
                    <h3>{t('Thobe for', 'ثوب لـ')} {s.member?.name} {it.qty > 1 ? <span className="badge dark">×{it.qty}</span> : null}</h3>
                    <div className="small secondary">{RELATION[s.member?.relation ?? 'self']}</div>
                  </div>
                  <span className="num strong">{money(it.line_total)}</span>
                </div>
                <div className="grid k4">
                  <div style={{ gridColumn: 'span 2' }}>
                    <div className="overline">{t('Collar, cuff and details', 'الياقة والكبك والتفاصيل')}</div>
                    {s.thobe?.style_remarks?.length ? (
                      <div className="stack" style={{ gap: 2 }} data-testid={`style-remarks-${it.id}`}>
                        {s.thobe.style_remarks.map((x: any, i: number) => <div key={i} className="small"><span className="strong">{L(x)}</span>: <span dir="auto">{x.note}</span></div>)}
                      </div>
                    ) : s.thobe?.collar && !Object.keys(s.thobe?.style_notes ?? {}).some((k) => k.includes(':')) ? (
                      <div className="strong">
                        {L(s.thobe.collar)}{s.thobe.cuff ? ` · ${L(s.thobe.cuff)}` : ''}{s.thobe.pocket ? ` · ${t('chest pocket', 'جيب صدر')}` : ''}
                        {['collar', 'cuff', 'pocket'].map((k) => (s.thobe?.style_notes?.[k] ? <div key={k} className="small secondary" dir="auto">{s.thobe.style_notes[k]}</div> : null))}
                      </div>
                    ) : <div className="small secondary">{t('No remarks', 'لا ملاحظات')}</div>}
                  </div>
                  <div><div className="overline">{t('Cloth', 'القماش')}</div><div className="strong">{L(s.thobe?.fabric)}{s.thobe?.colour ? <span className="small secondary"> · {L(s.thobe.colour)}</span> : null}</div></div>
                  <div><div className="overline">{t('Length', 'الطول')}</div><div className="strong num">{s.thobe?.metres ? `${num(s.thobe.metres)} ${t('m', 'م')}` : '—'}</div></div>
                </div>
                {it.discount > 0 ? <div className="small tone-ok">{t('Discount', 'خصم')} −{money(it.discount)}</div> : null}
                {s.remarks && !invoice ? <div className="note gold" style={{ whiteSpace: 'pre-line' }}>{t('Remarks', 'ملاحظات')}: “{s.remarks}”</div> : null}
                {invoice ? null : <>
                <div className="divider" />
                <div className="row spread">
                  <div className="overline">{t('Measurements', 'المقاسات')} · {s.measureMethod === 'saved' ? t('saved', 'محفوظة') : s.measureMethod === 'home' ? t('home visit', 'زيارة منزلية') : t('branch visit', 'زيارة الفرع')}</div>
                  {can('workshop', 'pos') && s.member?.id ? (
                    <button className="btn sm secondary no-print" data-testid={`measure-${s.member.name}`} onClick={() => openMeasure(s.member.id)}>
                      <Ruler size={14} /> {t('Measurements', 'المقاسات')}
                    </button>
                  ) : null}
                </div>
                {m ? <MeasurementGrid m={m} /> : <div className="note">{t('Not measured yet', 'لم تؤخذ المقاسات بعد')}{appt ? ` · ${t('visit booked', 'زيارة محجوزة')} ${dateTime(appt.starts_at)}` : ''}.</div>}
                </>}
              </div>
            );
          })}
          {o.items.filter((i) => i.kind !== 'thobe').length ? (
            <div className="card table-wrap">
              <table>
                <thead>
                  <tr><th>{t('Item', 'الصنف')}</th><th>{t('Size', 'المقاس')}</th><th>{t('Qty', 'الكمية')}</th><th className="right">{t('Total', 'الإجمالي')}</th></tr>
                </thead>
                <tbody>
                  {o.items.filter((i) => i.kind !== 'thobe').map((i) => (
                    <tr key={i.id}>
                      <td>{i.kind === 'reward' ? `${t('Reward', 'مكافأة')}: ${L(i.snapshot.product)}` : i.kind === 'imported' ? t(`Imported sale (Mada #${i.snapshot.invoice})`, `مبيعات مستوردة (مدى #${i.snapshot.invoice})`) : L(i.snapshot.product)}{i.discount > 0 ? <div className="small tone-ok">{t('Discount', 'خصم')} −{money(i.discount)}</div> : null}</td>
                      <td>{i.snapshot.size ?? '—'}</td>
                      <td>{i.qty}{i.returned_qty ? <span className="small muted"> ({t('returned', 'مرتجع')} {i.returned_qty})</span> : null}</td>
                      <td className="right num">{i.kind === 'reward' ? t('Free', 'مجاني') : money(i.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {!invoice && (isThobe || o.photos.length) ? (
            <div className="card pad stack">
              <div className="overline">{t('Thobe photos', 'صور الأثواب')}</div>
              {o.photos.length ? (
                <div className="row wrap" style={{ gap: 10 }}>
                  {o.photos.map((p) => <a key={p.id} href={mediaUrl(p.url)} target="_blank" rel="noreferrer"><img src={mediaUrl(p.url)} alt={p.caption ?? ''} title={p.caption ?? ''} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10 }} /></a>)}
                </div>
              ) : null}
              {can('workshop') ? <PhotoUploader orderId={o.id} onDone={refresh} /> : null}
            </div>
          ) : null}
          {invoice ? null : <div className="card pad" data-testid="order-stages">
            <div className="overline" style={{ marginBottom: 10 }}>{t('Stages', 'المراحل')}</div>
            <div className="timeline">
              {o.events.map((e, i) => (
                <div key={i} className="tl-item">
                  <div className="tl-dot"><span />{i < o.events.length - 1 ? <i /> : null}</div>
                  <div className="tl-body">
                    <div className="strong">{stageLabel(e.stage, isThobe)}</div>
                    <div className="small muted">{dateTime(e.at)}{e.staff_name ? ` · ${e.staff_name}` : ''}{e.note === 'saved' ? ` · ${t('saved measurements', 'مقاسات محفوظة')}` : e.note === 'counter' ? ` · ${t('handed over at the counter', 'سُلّم في المحل')}` : e.note ? ` · ${e.note}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>}
          {o.notes ? <div className="note" style={{ whiteSpace: 'pre-line' }}>{t('Notes', 'ملاحظات')}: {o.notes}</div> : null}
        </div>

        <div className="stack lg">
          <div className="card pad stack">
            <div className="overline">{t('Customer', 'العميل')}</div>
            {o.customer_id ? <Link to={`/customers/${o.customer_id}`} className="strong">{o.customer_name}</Link> : <span className="strong">{o.customer_name ?? t('Walk-in', 'زبون عابر')}</span>}
            <div className="secondary num">{o.phone ? phone(o.phone) : ''}</div>
            {o.phone && wa ? (
              <div className="row wrap" style={{ gap: 6 }}>
                <a className="btn sm secondary" href={waLink(o.phone, fill(t(wa.receipt_en, wa.receipt_ar), waVars))} target="_blank" rel="noreferrer"><Send size={13} /> {t('Receipt', 'الإيصال')}</a>
                {isThobe && o.stage === 'ready' ? <a className="btn sm secondary" href={waLink(o.phone, fill(t(wa.ready_en, wa.ready_ar), waVars))} target="_blank" rel="noreferrer"><Send size={13} /> {t('Ready', 'جاهز')}</a> : null}
                {o.balance > 0 ? <a className="btn sm secondary" href={waLink(o.phone, fill(t(wa.balance_en, wa.balance_ar), waVars))} target="_blank" rel="noreferrer"><Send size={13} /> {t('Balance', 'المتبقي')}</a> : null}
              </div>
            ) : null}
            <div className="divider" />
            <div className="overline">{o.address.counter ? t('Sold at', 'البيع في') : o.address.pickup ? t('Collect from', 'الاستلام من') : t('Deliver to', 'التوصيل إلى')}</div>
            <div data-testid="order-address">{o.address.pickup ? (isAr() ? `فرع ${L({ name_en: o.address.label ?? o.branch_en, name_ar: o.address.label_ar ?? o.branch_ar })}` : `${L({ name_en: o.address.label ?? o.branch_en, name_ar: o.address.label_ar ?? o.branch_ar })} branch`) : `${o.address.label} · ${o.address.line1}, ${o.address.area}, ${o.address.city}`}</div>
            {o.address.notes ? <div className="small muted">{o.address.notes}</div> : null}
            {o.shipping?.courier ? <div className="small secondary">{o.shipping.courier}{o.shipping.tracking ? ` · ${o.shipping.tracking}` : ''}</div> : null}
          </div>
          {!invoice && o.appointments.length ? (
            <div className="card pad stack">
              <div className="overline">{t('Measurement visits', 'زيارات القياس')}</div>
              {o.appointments.map((a) => (
                <div key={a.id} className="row spread">
                  <div>
                    <div className="strong">{a.member_name}</div>
                    <div className="small secondary">{a.kind === 'home' ? `${t('Home', 'منزلية')} · ${a.line1}, ${a.area}` : `${t('Branch', 'الفرع')} · ${a.branch_name}`}</div>
                  </div>
                  <div className="right small">{dateTime(a.starts_at)}<br /><span className={`badge ${a.status === 'done' ? 'ok' : a.status === 'cancelled' ? 'error' : 'outline'}`}>{a.status}</span></div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="card pad stack" style={{ gap: 8 }}>
            <div className="overline">{t('Payment', 'الدفع')}</div>
            {[
              [t('Subtotal', 'المجموع'), money(o.subtotal)],
              ...(o.delivery_fee ? [[t('Delivery', 'التوصيل'), money(o.delivery_fee)]] : []),
              ...(o.home_visit_fee ? [[t('Home visit', 'الزيارة المنزلية'), money(o.home_visit_fee)]] : []),
              ...(o.service_charge ? [[t('Service', 'الخدمة'), money(o.service_charge)]] : []),
              ...(o.discount ? [[discount[0] === 'coupon' ? `${t('Coupon', 'القسيمة')} ${discount[1]} (${discount[2]}%)` : t('Discount', 'الخصم'), `− ${money(o.discount)}`]] : []),
              ...(o.points_used ? [[`${t('Points', 'النقاط')} (${o.points_used})`, `− ${money(o.points_used)}`]] : []),
            ].map(([a, b]) => (
              <div key={a} className="row spread small"><span className="secondary">{a}</span><span className="num">{b}</span></div>
            ))}
            <div className="divider" />
            <div className="row spread"><span className="strong">{t('Total', 'الإجمالي')}</span><span className="strong num">{money(o.total)}</span></div>
            {o.payments.map((p) => (
              <div key={p.id} className="row spread small" data-testid="payment-row">
                <span className="secondary">{methodLabel(p.provider)} · {dateTime(p.completed_at)}{p.staff_name ? ` · ${p.staff_name}` : ''}{p.provider_ref && !p.provider_ref.startsWith('CARD-') ? ` · ${p.provider_ref}` : ''}</span>
                <span className="num">{money(p.amount)}</span>
              </div>
            ))}
            {o.refunds.map((r) => (
              <div key={r.id} className="row spread small">
                <span className="secondary">{t('Refunded', 'مسترد')} · {methodLabel(r.method)} · {date(r.created_at)}{r.reference ? ` · ${r.reference}` : ''}{r.staff_name ? ` · ${r.staff_name}` : ''}</span>
                <span className="num">− {money(r.amount)}</span>
              </div>
            ))}
            <div className="small muted" data-testid="payment-method">
              {o.payment_provider === 'card_machine' ? `${t('Card machine in store', 'جهاز البطاقة في المحل')}${o.placed_by ? ` · ${t('placed by', 'بواسطة')} ${o.placed_by}` : ''}` : o.payment_provider && o.payment_provider !== 'sadad' ? methodLabel(o.payment_provider) : `SADAD · ${o.payment_status ?? '—'}${o.payment_ref ? ` · ${o.payment_ref}` : ''}`}
            </div>
            {o.customer_id ? <div className="small muted">{o.points_awarded ? t(`${o.points_to_earn} points awarded`, `مُنحت ${o.points_to_earn} نقطة`) : t(`${o.points_to_earn} points ${isThobe ? 'when collected' : 'on delivery'}`, `${o.points_to_earn} نقطة عند ${isThobe ? 'الاستلام' : 'التوصيل'}`)}</div> : null}
            <div className="row wrap" style={{ gap: 6 }}>
              {can('returns') && o.stage === 'delivered' && o.items.some((i) => i.kind !== 'imported' && i.qty > i.returned_qty) ? (
                <button className="btn sm secondary" data-testid="start-return" onClick={() => setReturnOpen({ qty: {}, method: o.payments.some((p) => p.provider === 'cash') ? 'cash' : o.payments[0]?.provider === 'card_machine' ? 'card' : 'sadad', restock: true, note: '' })}><RotateCcw size={13} /> {t('Return items', 'إرجاع أصناف')}</button>
              ) : null}
              {can('returns') && o.paid_at && refundable > 0 ? (
                <button className="btn sm secondary" data-testid="record-refund" onClick={() => { setRefund({ amount: o.stage === 'cancelled' ? String(refundable) : '', reference: '', note: '', method: o.channel === 'app' ? 'sadad' : 'cash' }); setRefundOpen(true); }}>{t('Record refund', 'تسجيل استرداد')}</button>
              ) : null}
              {can('returns') && !['delivered', 'cancelled', 'out_for_delivery'].includes(o.stage) ? (
                <button className="btn sm danger" onClick={() => setCancelOpen(true)}>{t('Cancel order', 'إلغاء الطلب')}</button>
              ) : null}
            </div>
            {o.returns.length ? <div className="small secondary">{t('Returns', 'المرتجعات')}: {o.returns.map((r) => `${r.number} (${money(r.amount)})`).join(' · ')}</div> : null}
          </div>
        </div>
      </div>

      {payOpen ? (
        <Modal title={t('Take payment', 'استلام دفعة')} onClose={() => setPayOpen(null)} footer={<><button className="btn secondary" onClick={() => setPayOpen(null)}>{t('Cancel', 'إلغاء')}</button><button className="btn" data-testid="payment-save" disabled={!(Number(payOpen.amount) > 0) || takePayment.isPending} onClick={() => takePayment.mutate()}>{t('Save', 'حفظ')}</button></>}>
          <div className="note">{t(`Due: ${money(o.balance)}`, `المستحق: ${money(o.balance)}`)}</div>
          <div className="grid k2">
            <Field label={t('Amount', 'المبلغ')}><Input data-testid="payment-amount" type="number" min={0} max={o.balance} value={payOpen.amount} onChange={(e) => setPayOpen({ ...payOpen, amount: e.target.value })} /></Field>
            <Field label={t('Method', 'الطريقة')}>
              <Select value={payOpen.method} onChange={(e) => setPayOpen({ ...payOpen, method: e.target.value })}>{['cash', 'card', 'bank_transfer', 'cheque'].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</Select>
            </Field>
          </div>
          {payOpen.method !== 'cash' ? <Field label={t('Reference (optional)', 'المرجع (اختياري)')}><Input value={payOpen.reference} onChange={(e) => setPayOpen({ ...payOpen, reference: e.target.value })} /></Field> : null}
        </Modal>
      ) : null}
      {returnOpen ? (
        <Modal title={`${t('Return items from', 'إرجاع أصناف من')} #${o.number}`} onClose={() => setReturnOpen(null)} wide footer={<><button className="btn secondary" onClick={() => setReturnOpen(null)}>{t('Cancel', 'إلغاء')}</button><button className="btn" data-testid="return-save" disabled={!Object.values(returnOpen.qty).some((v) => Number(v) > 0) || doReturn.isPending} onClick={() => doReturn.mutate()}>{t('Save return', 'حفظ المرتجع')}</button></>}>
          <table>
            <thead><tr><th>{t('Item', 'الصنف')}</th><th className="right">{t('Bought', 'المشترى')}</th><th className="right">{t('Already returned', 'مرتجع سابقًا')}</th><th style={{ width: 120 }}>{t('Return now', 'إرجاع الآن')}</th></tr></thead>
            <tbody>
              {o.items.filter((i) => i.kind !== 'imported').map((i) => (
                <tr key={i.id}>
                  <td>{i.kind === 'thobe' ? `${t('Thobe', 'ثوب')} · ${L(i.snapshot.thobe?.fabric)} · ${i.snapshot.member?.name}` : `${L(i.snapshot.product)}${i.snapshot.size ? ` · ${i.snapshot.size}` : ''}`}</td>
                  <td className="right num">{i.qty}</td>
                  <td className="right num">{i.returned_qty || '—'}</td>
                  <td><Input data-testid={`return-qty-${i.id}`} type="number" min={0} max={i.qty - i.returned_qty} value={returnOpen.qty[i.id] ?? ''} onChange={(e) => setReturnOpen({ ...returnOpen, qty: { ...returnOpen.qty, [i.id]: e.target.value } })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid k2">
            <Field label={t('Refund by', 'طريقة الرد')}>
              <Select value={returnOpen.method} onChange={(e) => setReturnOpen({ ...returnOpen, method: e.target.value })}>{['cash', 'card', 'bank_transfer', 'sadad', 'none'].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</Select>
            </Field>
            <Field label={t('Note', 'ملاحظة')}><Input value={returnOpen.note} onChange={(e) => setReturnOpen({ ...returnOpen, note: e.target.value })} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={returnOpen.restock} onChange={(e) => setReturnOpen({ ...returnOpen, restock: e.target.checked })} /> {t('Put the items back in stock', 'إعادة الأصناف إلى المخزون')}</label>
          <div className="small muted">{t('The refund is worked out from what was paid for each item, after discounts. Points earned on them are taken back.', 'يُحسب المبلغ المسترد مما دُفع لكل صنف بعد الخصومات، وتُسحب النقاط المكتسبة عنها.')}</div>
        </Modal>
      ) : null}
      {refundOpen ? (
        <Modal
          title={`${t('Record a refund on', 'تسجيل استرداد على')} #${o.number}`}
          onClose={() => setRefundOpen(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setRefundOpen(false)}>{t('Cancel', 'إلغاء')}</button>
              <button className="btn" data-testid="refund-save" disabled={recordRefund.isPending || !(Number(refund.amount) > 0)} onClick={() => recordRefund.mutate()}>{t('Record refund', 'تسجيل الاسترداد')}</button>
            </>
          }
        >
          <div className="note">{refund.method === 'sadad' ? t('This records a refund you have already made in SADAD. It does not send money.', 'هذا يسجل استردادًا تم في سداد، ولا يرسل أموالًا.') : refund.method === 'cash' ? t('Cash is taken from your open register.', 'يُخصم النقد من صندوقك المفتوح.') : ''} {t(`Up to ${money(refundable)} is left on this order.`, `المتبقي للاسترداد ${money(refundable)}.`)}</div>
          <div className="grid k2">
            <Field label={t('Amount (QAR)', 'المبلغ (ر.ق)')}><Input data-testid="refund-amount" type="number" min={0} step="0.01" max={refundable} value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} /></Field>
            <Field label={t('Refunded by', 'طريقة الرد')}>
              <Select data-testid="refund-method" value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value })}>{['sadad', 'cash', 'card', 'bank_transfer'].map((m) => <option key={m} value={m}>{methodLabel(m)}</option>)}</Select>
            </Field>
          </div>
          <Field label={t('Reference', 'المرجع')} hint={t('Optional', 'اختياري')}><Input data-testid="refund-reference" value={refund.reference} onChange={(e) => setRefund({ ...refund, reference: e.target.value })} /></Field>
          <Field label={t('Note (internal)', 'ملاحظة (داخلية)')}><TextArea value={refund.note} onChange={(e) => setRefund({ ...refund, note: e.target.value })} /></Field>
        </Modal>
      ) : null}
      {cancelOpen ? (
        <Modal
          title={`${t('Cancel', 'إلغاء')} #${o.number}?`}
          onClose={() => setCancelOpen(false)}
          footer={
            <>
              <button className="btn secondary" onClick={() => setCancelOpen(false)}>{t('Keep order', 'إبقاء الطلب')}</button>
              <button className="btn danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t('Cancel order', 'إلغاء الطلب')}</button>
            </>
          }
        >
          <div className="note">{t('The customer is notified, booked visits are cancelled, items go back to stock and any points they spent are returned.', 'يُبلّغ العميل، وتُلغى الزيارات المحجوزة، وتعود الأصناف للمخزون، وتُعاد النقاط المستخدمة.')} {o.paid ? t(`Then refund ${money(o.paid)} and record it.`, `ثم رُدّ ${money(o.paid)} وسجّل ذلك.`) : ''}</div>
          <Field label={t('Reason (internal)', 'السبب (داخلي)')}>
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}
