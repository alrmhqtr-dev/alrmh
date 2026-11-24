import { useEffect, useRef, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { Printer, X } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { L, t, useLang } from '../lib/i18n';
import { MEASURE_KEYS, RELATION, date, dateTime, measureLabel, methodLabel, money2, num, phone } from '../lib/format';
import { code128Svg, qrSvg } from '../lib/barcode';
import { receiptUrl } from '../lib/whatsapp';
import { LABELS_KEY } from '../pages/Labels';
import { ThobePreview } from '../thobe-preview';

type Biz = { company: any; invoice: any; barcode: any; printing: any };

function useAutoPrint(ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (ready && !done.current) {
      done.current = true;
      // Let fonts, the logo and any thobe pictures load first (at most a few seconds).
      setTimeout(() => {
        const srcs = [
          ...Array.from(document.images).map((i) => i.src),
          ...Array.from(document.querySelectorAll('svg image')).map((i) => i.getAttribute('href') ?? ''),
        ].filter(Boolean);
        const loads = srcs.map((src) => new Promise<void>((res) => { const im = new Image(); im.onload = () => res(); im.onerror = () => res(); im.src = src; }));
        Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 4000))]).then(() => setTimeout(() => window.print(), 250));
      }, 200);
    }
  }, [ready]);
}

function Bar() {
  return (
    <div className="print-bar">
      <button className="btn sm gold" onClick={() => window.print()}><Printer size={14} /> {t('Print', 'طباعة')}</button>
      <button className="btn sm secondary" onClick={() => window.close()}><X size={14} /> {t('Close', 'إغلاق')}</button>
      <span className="small" style={{ opacity: 0.7 }}>{t('Choose the receipt printer in the print window.', 'اختر طابعة الإيصالات في نافذة الطباعة.')}</span>
    </div>
  );
}

function Head({ biz, compact }: { biz: Biz; compact?: boolean }) {
  const c = biz.company;
  return (
    <div className="c" style={{ marginBottom: 6 }}>
      {c.logo_url ? <img src={mediaUrl(c.logo_url)} alt="" style={{ maxHeight: compact ? 40 : 60, maxWidth: '70%' }} /> : null}
      <h1>{L(c)}</h1>
      <div>{L(c, 'address')}</div>
      {c.phone ? <div><span className="ltr">{c.phone}</span></div> : null}
      {c.cr_number ? <div>{t('C.R.', 'س.ت')} {c.cr_number}</div> : null}
      {c.tax_number ? <div>{t('Tax no.', 'الرقم الضريبي')} {c.tax_number}</div> : null}
    </div>
  );
}

const itemName = (i: any) =>
  i.kind === 'thobe'
    ? `${t('Thobe', 'ثوب')} · ${L(i.snapshot.thobe?.collar)}${i.snapshot.thobe?.cuff ? ` · ${L(i.snapshot.thobe.cuff)}` : ''} · ${L(i.snapshot.thobe?.fabric)}${i.snapshot.thobe?.metres ? ` · ${i.snapshot.thobe.metres} ${t('m', 'م')}` : ''}${i.snapshot.thobe?.pocket ? ` · ${t('pocket', 'جيب')}` : ''}`
    : i.kind === 'product'
      ? `${L(i.snapshot.product)}${i.snapshot.size ? ` · ${i.snapshot.size}` : ''}`
      : t('Sale', 'مبيعات');

function Totals({ r, biz }: { r: any; biz: Biz }) {
  const row = (label: string, v: number, strong = false) => (
    <tr style={strong ? { fontWeight: 700, fontSize: '1.15em' } : undefined}><td colSpan={2}>{label}</td><td className="e num">{money2(v)}</td></tr>
  );
  return (
    <>
      {r.discount > 0 ? row(t('Discount', 'الخصم'), -r.discount) : null}
      {r.service_charge > 0 ? row(`${t('Service', 'الخدمة')}${r.service_en ? ` · ${L({ name_en: r.service_en, name_ar: r.service_ar })}` : ''}`, r.service_charge) : null}
      {r.delivery_fee > 0 ? row(t('Delivery', 'التوصيل'), r.delivery_fee) : null}
      {r.points_used > 0 ? row(t('Points used', 'النقاط المستخدمة'), -r.points_used) : null}
      {row(`${t('Total', 'الإجمالي')} (${t('QAR', 'ر.ق')})`, r.total, true)}
      {biz.invoice.show_tax && r.tax > 0 ? row(t('Includes tax', 'شامل الضريبة'), r.tax) : null}
      {r.payments.map((p: any, i: number) => <tr key={i}><td colSpan={2}>{t('Paid', 'مدفوع')} · {methodLabel(p.provider)}</td><td className="e num">{money2(p.amount)}</td></tr>)}
      {r.refunded > 0 ? row(t('Refunded', 'مسترد'), -r.refunded) : null}
      {r.balance > 0 ? row(t('Balance due', 'المبلغ المتبقي'), r.balance, true) : null}
    </>
  );
}

function Receipt({ r, biz }: { r: any; biz: Biz }) {
  const paper = biz.printing.receipt_paper === '58mm' ? 'p58' : biz.printing.receipt_paper === 'a4' ? 'pa4' : 'p80';
  return (
    <div className={`print-page ${paper}`}>
      <Head biz={biz} compact />
      <div className="hr" />
      <div className="c strong">{t('Tax invoice', 'فاتورة')} #{r.number}</div>
      <div className="c">{dateTime(r.created_at)} · {L({ name_en: r.branch_en, name_ar: r.branch_ar })}</div>
      {r.customer_name ? <div className="c">{r.customer_name}{r.phone ? ` · ${phone(r.phone)}` : ''}</div> : null}
      <div className="c">{t('Served by', 'الموظف')}: {r.staff_name ?? '—'}</div>
      <div className="hr" />
      <table>
        <thead><tr><th>{t('Item', 'الصنف')}</th><th className="e">{t('Qty', 'الكمية')}</th><th className="e">{t('Amount', 'المبلغ')}</th></tr></thead>
        <tbody>
          {r.items.map((i: any) => (
            <tr key={i.id}>
              <td>{itemName(i)}{i.kind === 'thobe' ? <div>{i.snapshot.member?.name}</div> : null}{i.discount > 0 ? <div>{t('Discount', 'خصم')} −{money2(i.discount)}</div> : null}{i.returned_qty ? <div>{t('Returned', 'مرتجع')} {i.returned_qty}</div> : null}</td>
              <td className="e num">{i.qty}</td>
              <td className="e num">{money2(i.line_total)}</td>
            </tr>
          ))}
          <Totals r={r} biz={biz} />
        </tbody>
      </table>
      {r.expected_delivery && r.thobe_count > 0 ? <div className="c strong" style={{ marginTop: 6 }}>{t('Ready by', 'موعد الاستلام')} {date(r.expected_delivery)}</div> : null}
      {biz.invoice.show_points && r.customer_id && r.points_to_earn > 0 ? <div className="c">{t(`You earn ${r.points_to_earn} points`, `تكسب ${r.points_to_earn} نقطة`)}</div> : null}
      {biz.invoice.show_qr ? <div className="c" style={{ marginTop: 6 }} dangerouslySetInnerHTML={{ __html: qrSvg(receiptUrl(r.receipt_token), 22) }} /> : null}
      <div className="c" style={{ marginTop: 6, whiteSpace: 'pre-line' }}>{L(biz.invoice, 'footer')}</div>
      {L(biz.invoice, 'terms') ? <div style={{ marginTop: 4, whiteSpace: 'pre-line', fontSize: '0.9em' }}>{L(biz.invoice, 'terms')}</div> : null}
    </div>
  );
}

function Invoice({ r, biz, title, number, dateText, valid }: { r: any; biz: Biz; title: string; number: string; dateText: string; valid?: string | null }) {
  const paper = biz.printing.invoice_paper === 'a5' ? 'pa5' : 'pa4';
  return (
    <div className={`print-page ${paper}`}>
      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ textAlign: 'start' }}>
          {biz.company.logo_url ? <img src={mediaUrl(biz.company.logo_url)} alt="" style={{ maxHeight: 64 }} /> : null}
          <div className="strong" style={{ fontSize: 18 }}>{L(biz.company)}</div>
          <div>{L(biz.company, 'address')}</div>
          <div>{[biz.company.phone, biz.company.email].filter(Boolean).join(' · ')}</div>
          {biz.company.cr_number ? <div>{t('C.R.', 'س.ت')} {biz.company.cr_number}</div> : null}
          {biz.company.tax_number ? <div>{t('Tax no.', 'الرقم الضريبي')} {biz.company.tax_number}</div> : null}
        </div>
        <div style={{ textAlign: 'end' }}>
          <div className="strong" style={{ fontSize: 22 }}>{title}</div>
          <div>#{number}</div>
          <div>{dateText}</div>
          {valid ? <div>{t('Valid until', 'صالح حتى')} {date(valid)}</div> : null}
        </div>
      </div>
      <div className="hr" />
      <div className="row spread">
        <div>{t('Customer', 'العميل')}: <b>{r.customer_name ?? t('Walk-in', 'زبون')}</b>{r.phone ? ` · ${phone(r.phone)}` : ''}</div>
        <div>{L({ name_en: r.branch_en, name_ar: r.branch_ar })}</div>
      </div>
      <table style={{ marginTop: 10 }}>
        <thead><tr><th>#</th><th>{t('Description', 'الوصف')}</th><th className="e">{t('Qty', 'الكمية')}</th><th className="e">{t('Unit price', 'سعر الوحدة')}</th><th className="e">{t('Discount', 'الخصم')}</th><th className="e">{t('Total', 'الإجمالي')}</th></tr></thead>
        <tbody>
          {r.items.map((i: any, k: number) => (
            <tr key={i.id ?? k}>
              <td>{k + 1}</td>
              <td>{itemName(i)}{i.kind === 'thobe' && i.snapshot.member ? ` · ${i.snapshot.member.name}` : ''}</td>
              <td className="e num">{i.qty}</td>
              <td className="e num">{money2(i.unit_price)}</td>
              <td className="e num">{i.discount ? money2(i.discount) : '—'}</td>
              <td className="e num">{money2(i.line_total)}</td>
            </tr>
          ))}
          <tr><td colSpan={6} style={{ border: 0 }} /></tr>
        </tbody>
      </table>
      <table style={{ width: '50%', marginInlineStart: 'auto' }}>
        <tbody>
          <tr><td colSpan={2}>{t('Subtotal', 'المجموع')}</td><td className="e num">{money2(r.subtotal)}</td></tr>
          <Totals r={r} biz={biz} />
        </tbody>
      </table>
      {r.notes ? <div style={{ marginTop: 10 }}>{t('Notes', 'ملاحظات')}: {r.notes}</div> : null}
      <div style={{ marginTop: 18, whiteSpace: 'pre-line' }}>{L(biz.invoice, 'footer')}</div>
      {L(biz.invoice, 'terms') ? <div style={{ marginTop: 6, whiteSpace: 'pre-line' }}>{L(biz.invoice, 'terms')}</div> : null}
    </div>
  );
}

function MeasureTable({ m }: { m: any }) {
  return (
    <table>
      <tbody>
        {MEASURE_KEYS.map((k) => (
          <tr key={k}><td>{measureLabel(k)}</td><td className="e num strong" style={{ fontSize: '1.2em' }}>{Number(m[k])}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

/** The ticket that travels with the cloth: who, what, measurements, when. */
function Ticket({ r, biz }: { r: any; biz: Biz }) {
  const paper = biz.printing.ticket_paper === 'a4' ? 'pa4' : biz.printing.ticket_paper === 'a5' ? 'pa5' : 'p80';
  const thobes = r.items.filter((i: any) => i.kind === 'thobe');
  const members = [...new Map(thobes.map((i: any) => [i.snapshot.member?.id, i.snapshot.member])).values()] as any[];
  return (
    <div className={`print-page ${paper}`}>
      <div className="c strong" style={{ fontSize: '1.4em' }}>{t('Tailor ticket', 'ورقة الخياط')} #{r.number}</div>
      <div className="c">{L(biz.company)} · {L({ name_en: r.branch_en, name_ar: r.branch_ar })}</div>
      <div className="c">{t('Ordered', 'تاريخ الطلب')} {date(r.created_at)} · <b>{t('Ready by', 'التسليم')} {date(r.expected_delivery)}</b></div>
      {r.service_en ? <div className="c strong">{L({ name_en: r.service_en, name_ar: r.service_ar })}</div> : null}
      <div className="c">{r.customer_name} · {phone(r.phone)}</div>
      <div className="c" dangerouslySetInnerHTML={{ __html: code128Svg(r.number, 50, 10) }} />
      {members.map((m) => {
        const meas = r.measurements.find((x: any) => x.member_id === m?.id);
        return (
          <div key={m?.id} style={{ marginTop: 8, breakInside: 'avoid' }}>
            <div className="hr" />
            <div className="strong" style={{ fontSize: '1.15em' }}>{m?.name} · {RELATION[m?.relation] ?? ''}</div>
            {thobes.filter((i: any) => i.snapshot.member?.id === m?.id).map((i: any) => (
              <div key={i.id}>
                <b>{i.qty} ×</b> {L(i.snapshot.thobe?.collar)}{i.snapshot.thobe?.cuff ? ` · ${t('cuff', 'كبك')} ${L(i.snapshot.thobe.cuff)}` : ''} · {L(i.snapshot.thobe?.fabric)}{i.snapshot.thobe?.metres ? ` · ${i.snapshot.thobe.metres} ${t('m', 'م')}` : ''}{i.snapshot.thobe?.pocket ? ` · ${t('chest pocket', 'جيب صدر')}` : ''}
                {i.snapshot.remarks ? <div>{t('Note', 'ملاحظة')}: {i.snapshot.remarks}</div> : null}
              </div>
            ))}
            {meas ? (
              <>
                <MeasureTable m={meas} />
                <div style={{ fontSize: '0.9em' }}>{t('Measured', 'المقاسات')} {date(meas.taken_at)} · {meas.tailor_name}{meas.remarks ? ` · ${meas.remarks}` : ''}</div>
              </>
            ) : <div className="strong">{t('No measurements yet', 'لا توجد مقاسات بعد')}</div>}
          </div>
        );
      })}
      {r.notes ? <div style={{ marginTop: 6 }}>{t('Notes', 'ملاحظات')}: {r.notes}</div> : null}
    </div>
  );
}

/** The complete order on A4: each thobe drawn with its collar, cuff, pocket and the measurements marked, then the bill. */
function OrderSheet({ r, biz }: { r: any; biz: Biz }) {
  const thobes = r.items.filter((i: any) => i.kind === 'thobe');
  const others = r.items.filter((i: any) => i.kind !== 'thobe');
  const count = thobes.reduce((n: number, i: any) => n + i.qty, 0);
  return (
    <div className="print-page pa4 order-sheet" data-testid="order-sheet">
      <div className="row spread" style={{ alignItems: 'flex-start' }}>
        <div style={{ textAlign: 'start' }}>
          {biz.company.logo_url ? <img src={mediaUrl(biz.company.logo_url)} alt="" style={{ maxHeight: 56 }} /> : null}
          <div className="strong" style={{ fontSize: 17 }}>{L(biz.company)}</div>
          <div>{L({ name_en: r.branch_en, name_ar: r.branch_ar })}{biz.company.phone ? <> · <span className="ltr">{biz.company.phone}</span></> : null}</div>
        </div>
        <div style={{ textAlign: 'end' }}>
          <div className="strong" style={{ fontSize: 22 }}>{t('Order', 'طلب')} #{r.number}</div>
          <div>{t('Ordered', 'تاريخ الطلب')} {date(r.created_at)}</div>
          {r.expected_delivery ? <div className="strong">{t('Ready by', 'التسليم')} {date(r.expected_delivery)}</div> : null}
          <div dangerouslySetInnerHTML={{ __html: code128Svg(r.number, 36, 8) }} />
        </div>
      </div>
      <div className="hr" />
      <div className="row spread">
        <div>{t('Customer', 'العميل')}: <b>{r.customer_name ?? t('Walk-in', 'زبون')}</b>{r.phone ? <> · <span className="ltr">{phone(r.phone)}</span></> : null}</div>
        <div>{t('Thobes', 'الثياب')}: <b className="num">{count}</b></div>
      </div>

      {thobes.map((i: any, k: number) => {
        const th = i.snapshot.thobe ?? {};
        const meas = r.measurements?.find((x: any) => x.member_id === i.snapshot.member?.id);
        const rows: [string, ReactNode][] = [
          [t('Collar', 'الياقة'), L(th.collar)],
          [t('Cuff', 'الكبك'), th.cuff ? L(th.cuff) : '—'],
          [t('Pocket', 'الجيب'), th.pocket ? t('Chest pocket', 'جيب صدر') : t('No pocket', 'بدون جيب')],
          [t('Cloth', 'القماش'), L(th.fabric)],
          [t('Cloth length', 'طول القماش'), th.metres ? `${th.metres} ${t('m', 'م')}` : '—'],
          [t('Thobes', 'عدد الثياب'), String(i.qty)],
        ];
        return (
          <section key={i.id} className="order-thobe" data-testid={`order-thobe-${k}`}>
            <div className="strong" style={{ fontSize: 15 }}>
              {thobes.length > 1 ? `${k + 1}. ` : ''}{i.snapshot.member?.name ?? r.customer_name}{i.snapshot.member?.relation && i.snapshot.member.relation !== 'self' ? ` · ${RELATION[i.snapshot.member.relation] ?? ''}` : ''}
            </div>
            <div className="order-thobe-body">
              <ThobePreview m={meas ?? {}} collar={th.collar} cuff={th.cuff} pocket={th.pocket === true} className="print" />
              <div>
                <table>
                  <tbody>{rows.map(([a, b]) => <tr key={a}><td>{a}</td><td className="e strong">{b}</td></tr>)}</tbody>
                </table>
                {i.snapshot.remarks ? <div style={{ marginTop: 8, whiteSpace: 'pre-line' }}><b>{t('Notes for the tailor', 'ملاحظات للخياط')}:</b> {i.snapshot.remarks}</div> : null}
                {meas ? (
                  <div style={{ marginTop: 8 }}>
                    {t('Measured', 'المقاسات')} {date(meas.taken_at)}{meas.tailor_name ? ` · ${meas.tailor_name}` : ''}
                    {meas.remarks ? <div style={{ whiteSpace: 'pre-line' }}>{meas.remarks}</div> : null}
                  </div>
                ) : <div className="strong" style={{ marginTop: 8 }}>{t('No measurements yet', 'لا توجد مقاسات بعد')}</div>}
              </div>
            </div>
          </section>
        );
      })}

      <section className="order-bill">
        <table>
          <thead><tr><th>{t('Item', 'الصنف')}</th><th className="e">{t('Qty', 'الكمية')}</th><th className="e">{t('Amount', 'المبلغ')}</th></tr></thead>
          <tbody>
            {[...thobes, ...others].map((i: any) => (
              <tr key={i.id}>
                <td>{itemName(i)}{i.kind === 'thobe' && i.snapshot.member ? ` · ${i.snapshot.member.name}` : ''}</td>
                <td className="e num">{i.qty}</td>
                <td className="e num">{money2(i.line_total)}</td>
              </tr>
            ))}
            <Totals r={r} biz={biz} />
          </tbody>
        </table>
        {r.notes ? <div style={{ marginTop: 8 }}>{t('Notes', 'ملاحظات')}: {r.notes}</div> : null}
      </section>
    </div>
  );
}

function Labels({ biz }: { biz: Biz }) {
  const b = biz.barcode;
  let items: { sku: string; name: string; price: number; size: string; count: number }[] = [];
  try {
    items = JSON.parse(localStorage.getItem(LABELS_KEY) ?? '[]');
  } catch {}
  const all = items.flatMap((i) => Array.from({ length: i.count }, () => i));
  return (
    <div className="labels" style={{ gridTemplateColumns: `repeat(${b.per_row}, ${b.width_mm}mm)`, padding: '2mm' }}>
      {all.map((i, k) => (
        <div key={k} className="label" style={{ width: `${b.width_mm}mm`, height: `${b.height_mm}mm` }}>
          {b.show_business ? <div className="strong">{L(biz.company)}</div> : null}
          {b.show_name ? <div>{i.name}</div> : null}
          <div dangerouslySetInnerHTML={{ __html: code128Svg(i.sku, b.width_mm - 6, Math.max(6, b.height_mm * 0.38)) }} />
          <div style={{ letterSpacing: 1 }}>{i.sku}</div>
          {b.show_price ? <div className="strong">{money2(i.price)} {t('QAR', 'ر.ق')}</div> : null}
        </div>
      ))}
    </div>
  );
}

function Register({ r }: { r: any }) {
  const tt = r.totals;
  const row = (label: string, v: number | null | undefined) => <tr><td>{label}</td><td className="e num">{v == null ? '—' : money2(v)}</td></tr>;
  return (
    <div className="print-page p80">
      <div className="c strong" style={{ fontSize: '1.2em' }}>{t('Register summary', 'ملخص الصندوق')}</div>
      <div className="c">{r.staff_name} · {L({ name_en: r.branch_en, name_ar: r.branch_ar })}</div>
      <div className="c">{dateTime(r.opened_at)} → {r.closed_at ? dateTime(r.closed_at) : t('open', 'مفتوح')}</div>
      <div className="hr" />
      <table>
        <tbody>
          {row(t('Opening cash', 'النقد الافتتاحي'), tt.opening)}
          {row(t('Cash sales', 'المبيعات النقدية'), tt.cash_sales)}
          {row(t('Card', 'بطاقة'), tt.card_sales)}
          {row(t('Transfer / cheque', 'تحويل / شيك'), tt.other_sales)}
          {row(t('Cash refunds', 'المردود نقدًا'), -tt.cash_refunds)}
          {row(t('Cash expenses', 'المصاريف النقدية'), -tt.cash_expenses)}
          {row(t('Paid to suppliers', 'للموردين'), -tt.cash_supplier)}
          {row(t('Cash in / out', 'إيداع / سحب'), tt.cash_in - tt.cash_out)}
          {row(t('Expected cash', 'النقد المتوقع'), r.closed_at ? Number(r.expected_cash) : tt.expected_cash)}
          {row(t('Counted cash', 'النقد المعدود'), r.counted_cash != null ? Number(r.counted_cash) : null)}
          {r.closed_at ? row(t('Difference', 'الفرق'), Number(r.counted_cash) - Number(r.expected_cash)) : null}
          {r.counted_card != null ? row(t('Card machine total', 'إجمالي جهاز البطاقة'), Number(r.counted_card)) : null}
        </tbody>
      </table>
      <div style={{ marginTop: 6 }}>{t('Sales', 'المبيعات')}: {tt.sales_count}</div>
      {r.note ? <div>{r.note}</div> : null}
      <div style={{ marginTop: 18 }}>{t('Signature', 'التوقيع')}: ____________</div>
    </div>
  );
}

function PurchaseDoc({ p, biz }: { p: any; biz: Biz }) {
  return (
    <div className="print-page pa4">
      <Head biz={biz} />
      <div className="c strong" style={{ fontSize: 18 }}>{p.kind === 'return' ? t('Purchase return', 'مرتجع مشتريات') : t('Purchase', 'أمر شراء')} {p.number}</div>
      <div className="row spread"><div>{t('Supplier', 'المورد')}: <b>{p.supplier_name}</b>{p.supplier_phone ? ` · ${p.supplier_phone}` : ''}</div><div>{date(p.purchase_date)} · {L({ name_en: p.branch_en, name_ar: p.branch_ar })}</div></div>
      <table style={{ marginTop: 10 }}>
        <thead><tr><th>{t('Item', 'الصنف')}</th><th className="e">{t('Qty', 'الكمية')}</th><th className="e">{t('Unit cost', 'التكلفة')}</th><th className="e">{t('Total', 'الإجمالي')}</th></tr></thead>
        <tbody>
          {p.lines.map((l: any) => <tr key={l.id}><td>{l.name}</td><td className="e num">{num(l.qty)}</td><td className="e num">{money2(l.unit_cost)}</td><td className="e num">{money2(l.line_total)}</td></tr>)}
          {p.discount ? <tr><td colSpan={3}>{t('Discount', 'الخصم')}</td><td className="e num">−{money2(p.discount)}</td></tr> : null}
          {p.tax ? <tr><td colSpan={3}>{t('Tax', 'الضريبة')}</td><td className="e num">{money2(p.tax)}</td></tr> : null}
          {p.shipping ? <tr><td colSpan={3}>{t('Shipping', 'الشحن')}</td><td className="e num">{money2(p.shipping)}</td></tr> : null}
          <tr style={{ fontWeight: 700 }}><td colSpan={3}>{t('Total', 'الإجمالي')}</td><td className="e num">{money2(p.total)}</td></tr>
        </tbody>
      </table>
      {p.notes ? <div style={{ marginTop: 10 }}>{p.notes}</div> : null}
    </div>
  );
}

/** Print views, opened in their own window: receipt, invoice, tailor ticket, quotation, labels and more. */
export default function Print() {
  useLang();
  const loc = useLocation();
  const [kind, id] = loc.pathname.replace(/^.*\/print\//, '').split('/');
  const biz = useQuery({ queryKey: ['business'], queryFn: () => api<Biz>('/business') });
  const order = useQuery({ queryKey: ['receipt', id], queryFn: () => api<any>(`/orders/${id}/receipt`), enabled: ['receipt', 'invoice', 'ticket', 'order'].includes(kind) });
  const draft = useQuery({ queryKey: ['draft', id], queryFn: () => api<any>(`/drafts/${id}`), enabled: kind === 'quotation' });
  const member = useQuery({ queryKey: ['member', id], queryFn: () => api<any>(`/members/${id}`), enabled: kind === 'measure' });
  const reg = useQuery({ queryKey: ['register-print', id], queryFn: () => api<any>(`/registers/${id}`), enabled: kind === 'register' });
  const purchase = useQuery({ queryKey: ['purchase', id], queryFn: () => api<any>(`/purchases/${id}`), enabled: kind === 'purchase' });
  const b = biz.data;
  let body: ReactNode = null;
  let ready = false;
  if (b) {
    if (kind === 'receipt' && order.data) {
      ready = true;
      body = Array.from({ length: b.printing.receipt_copies || 1 }, (_, i) => <div key={i} style={{ breakAfter: 'page' }}><Receipt r={order.data} biz={b} /></div>);
    } else if (kind === 'invoice' && order.data) {
      ready = true;
      body = <Invoice r={order.data} biz={b} title={t('Invoice', 'فاتورة')} number={order.data.number} dateText={dateTime(order.data.created_at)} />;
    } else if (kind === 'order' && order.data) {
      ready = true;
      body = <OrderSheet r={order.data} biz={b} />;
    } else if (kind === 'ticket' && order.data) {
      ready = true;
      body = Array.from({ length: b.printing.ticket_copies || 1 }, (_, i) => <div key={i} style={{ breakAfter: 'page' }}><Ticket r={order.data} biz={b} /></div>);
    } else if (kind === 'quotation' && draft.data?.priced) {
      ready = true;
      const p = draft.data.priced;
      const r = {
        ...p,
        items: (p.lines ?? []).map((l: any, k: number) => ({ id: k, kind: l.kind, qty: l.qty, unit_price: l.unitPrice, discount: l.discount, line_total: l.lineTotal, snapshot: { product: l.product, size: l.size, thobe: l.thobe, member: l.member } })),
        customer_name: draft.data.customer_name,
        phone: draft.data.phone,
        branch_en: p.branch?.name_en,
        branch_ar: p.branch?.name_ar,
        discount: p.orderDiscount,
        service_charge: p.serviceCharge,
        delivery_fee: p.deliveryFee,
        points_used: 0,
        total: p.total + p.pointsUsed,
        payments: [],
        refunded: 0,
        balance: 0,
        notes: draft.data.notes,
      };
      body = <Invoice r={r} biz={b} title={draft.data.kind === 'quotation' ? t('Quotation', 'عرض سعر') : t('Draft', 'مسودة')} number={draft.data.number} dateText={date(draft.data.created_at)} valid={draft.data.valid_until} />;
    } else if (kind === 'measure' && member.data) {
      ready = true;
      const m = member.data;
      body = (
        <div className={`print-page ${b.printing.ticket_paper === 'a4' ? 'pa4' : b.printing.ticket_paper === 'a5' ? 'pa5' : 'p80'}`}>
          <div className="c strong" style={{ fontSize: '1.3em' }}>{t('Measurements', 'المقاسات')}</div>
          <div className="c">{L(b.company)}</div>
          <div className="c strong">{m.name} · {RELATION[m.relation]}</div>
          <div className="c">{m.customer_name} · {phone(m.phone)}</div>
          <div className="hr" />
          {m.latest ? <><MeasureTable m={m.latest} /><div>{date(m.latest.taken_at)} · {m.latest.tailor_name}{m.latest.remarks ? ` · ${m.latest.remarks}` : ''}</div></> : <div>{t('No measurements yet', 'لا توجد مقاسات')}</div>}
        </div>
      );
    } else if (kind === 'register' && reg.data) {
      ready = true;
      body = <Register r={reg.data} />;
    } else if (kind === 'purchase' && purchase.data) {
      ready = true;
      body = <PurchaseDoc p={purchase.data} biz={b} />;
    } else if (kind === 'labels') {
      ready = true;
      body = <Labels biz={b} />;
    } else if (kind === 'test') {
      ready = true;
      if (id === 'labels') {
        localStorage.setItem(LABELS_KEY, JSON.stringify([{ sku: 'TEST-123', name: t('Test label', 'ملصق تجريبي'), price: 95, size: '', count: 1 }]));
        body = <Labels biz={b} />;
      } else
        body = (
          <Receipt
            biz={b}
            r={{ number: 'TEST', created_at: new Date().toISOString(), branch_en: 'Branch', branch_ar: 'الفرع', customer_name: t('Test customer', 'عميل تجريبي'), phone: '+97455551234', staff_name: '—', items: [{ id: 1, kind: 'product', qty: 1, line_total: 95, snapshot: { product: { name_en: 'Test item', name_ar: 'صنف تجريبي' } } }], discount: 0, service_charge: 0, delivery_fee: 0, points_used: 0, total: 95, tax: 0, payments: [{ provider: 'cash', amount: 95 }], refunded: 0, balance: 0, receipt_token: '0'.repeat(32), points_to_earn: 0 }}
          />
        );
    }
  }
  useAutoPrint(ready);
  return (
    <div style={{ background: '#fff', minHeight: '100vh' }}>
      <Bar />
      {body ?? <div className="empty">{t('Loading…', 'جارٍ التحميل…')}</div>}
    </div>
  );
}
