import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import { Printer, Send } from 'lucide-react';
import { api, errorMessage, mediaUrl, shrinkImage, uploadImage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { t } from '../lib/i18n';
import { fill, waLink } from '../lib/whatsapp';
import { BranchSelect, Field, Input, Loading, PageHead, Select, TextArea, openPrint, useToast } from '../ui';

type Section = 'company' | 'invoice' | 'barcode' | 'pos' | 'printing' | 'whatsapp';
const TITLES: Record<Section, [string, string, string, string]> = {
  company: ['Company settings', 'إعدادات الشركة', 'The business details printed on receipts and invoices.', 'بيانات النشاط المطبوعة على الإيصالات والفواتير.'],
  invoice: ['Invoice settings', 'إعدادات الفواتير', 'What appears on receipts, invoices and quotations.', 'ما يظهر في الإيصالات والفواتير وعروض الأسعار.'],
  barcode: ['Barcode settings', 'إعدادات الباركود', 'Size and content of product labels.', 'مقاس ومحتوى ملصقات المنتجات.'],
  pos: ['Point of sale', 'نقطة البيع', 'How the counter works.', 'طريقة عمل نقطة البيع.'],
  printing: ['Printing', 'الطباعة', 'Receipts, invoices and tailor tickets print from the browser to the printer installed on the counter PC (80 mm receipt printers included).', 'تُطبع الإيصالات والفواتير وأوراق الخياط من المتصفح إلى الطابعة المثبتة على جهاز المحل (بما فيها طابعات الإيصالات 80 مم).'],
  whatsapp: ['WhatsApp messages', 'رسائل واتساب', 'Messages opened in WhatsApp from a sale or an order, ready to send. Use {name}, {number}, {total}, {balance}, {link}, {branch}.', 'رسائل تُفتح في واتساب من الفاتورة أو الطلب جاهزة للإرسال. استخدم {name} و{number} و{total} و{balance} و{link} و{branch}.'],
};

export function BusinessPage({ section: fixed }: { section?: Section }) {
  const params = useParams();
  const section = (fixed ?? params.section) as Section;
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const biz = useQuery({ queryKey: ['business'], queryFn: () => api<Record<Section, any>>('/business') });
  const [v, setV] = useState<any>(null);
  useEffect(() => {
    if (biz.data && TITLES[section]) setV(structuredClone(biz.data[section]));
  }, [biz.data, section]);
  const save = useMutation({
    mutationFn: () => api('/business', { method: 'PATCH', body: { [section]: v } }),
    onSuccess: () => {
      toast(t('Saved.', 'تم الحفظ.'));
      qc.invalidateQueries({ queryKey: ['business'] });
    },
    onError: (e) => toast(errorMessage(e), 'error'),
  });
  const [logoBusy, setLogoBusy] = useState(false);
  const [wa, setWa] = useState({ phone: '', template: 'receipt' });
  if (!TITLES[section]) return <Navigate to="/" replace />;
  if (!v) return <Loading />;
  const editable = can('manage');
  const set = (k: string, val: unknown) => setV({ ...v, [k]: val });
  const text = (k: string, label: string, dir?: 'ltr' | 'rtl') => <Field key={k} label={label}><Input dir={dir} disabled={!editable} value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></Field>;
  const area = (k: string, label: string, dir?: 'ltr' | 'rtl') => <Field key={k} label={label}><TextArea dir={dir} disabled={!editable} value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} style={{ minHeight: 70 }} /></Field>;
  const numf = (k: string, label: string, hint?: string) => <Field key={k} label={label} hint={hint}><Input type="number" disabled={!editable} value={v[k]} onChange={(e) => set(k, Number(e.target.value))} /></Field>;
  const check = (k: string, label: string) => <label key={k} className="check"><input type="checkbox" disabled={!editable} checked={Boolean(v[k])} onChange={(e) => set(k, e.target.checked)} /> {label}</label>;
  const pick = (k: string, label: string, opts: [string, string][]) => <Field key={k} label={label}><Select disabled={!editable} value={v[k]} onChange={(e) => set(k, e.target.value)}>{opts.map(([o, l]) => <option key={o} value={o}>{l}</option>)}</Select></Field>;
  const [en, ar, subEn, subAr] = TITLES[section];
  return (
    <div className="stack lg">
      <PageHead title={t(en, ar)} sub={t(subEn, subAr)}>
        {editable ? <button className="btn" data-testid="business-save" disabled={save.isPending} onClick={() => save.mutate()}>{t('Save', 'حفظ')}</button> : null}
      </PageHead>
      <div className="card pad stack" style={{ maxWidth: 880 }}>
        {section === 'company' ? (
          <>
            <div className="grid k2">
              {text('name_en', t('Business name (English)', 'اسم النشاط (إنجليزي)'), 'ltr')}
              {text('name_ar', t('Business name (Arabic)', 'اسم النشاط (عربي)'), 'rtl')}
              {text('cr_number', t('Commercial registration', 'السجل التجاري'), 'ltr')}
              {text('tax_number', t('Tax number', 'الرقم الضريبي'), 'ltr')}
              {text('phone', t('Phone', 'الهاتف'), 'ltr')}
              {text('email', t('Email', 'البريد الإلكتروني'), 'ltr')}
              {text('address_en', t('Address (English)', 'العنوان (إنجليزي)'), 'ltr')}
              {text('address_ar', t('Address (Arabic)', 'العنوان (عربي)'), 'rtl')}
            </div>
            <Field label={t('Logo', 'الشعار')} hint={t('Printed at the top of receipts and invoices.', 'يُطبع أعلى الإيصالات والفواتير.')}>
              <div className="row">
                {v.logo_url ? <img src={mediaUrl(v.logo_url)} alt="" style={{ height: 56, borderRadius: 8, border: '1px solid var(--border)' }} /> : <span className="small muted">{t('No logo', 'بدون شعار')}</span>}
                {editable ? (
                  <input type="file" aria-label={t('Logo', 'الشعار')} accept="image/png,image/jpeg,image/webp" disabled={logoBusy} onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setLogoBusy(true);
                    try {
                      set('logo_url', (await uploadImage(await shrinkImage(f, 600))).url);
                    } catch (err) {
                      toast(errorMessage(err), 'error');
                    } finally {
                      setLogoBusy(false);
                    }
                  }} />
                ) : null}
                {v.logo_url && editable ? <button className="btn sm secondary" onClick={() => set('logo_url', null)}>{t('Remove', 'إزالة')}</button> : null}
              </div>
            </Field>
          </>
        ) : section === 'invoice' ? (
          <>
            {area('footer_en', t('Thank-you line (English)', 'سطر الشكر (إنجليزي)'), 'ltr')}
            {area('footer_ar', t('Thank-you line (Arabic)', 'سطر الشكر (عربي)'), 'rtl')}
            {area('terms_en', t('Terms (English)', 'الشروط (إنجليزي)'), 'ltr')}
            {area('terms_ar', t('Terms (Arabic)', 'الشروط (عربي)'), 'rtl')}
            <div className="row wrap" style={{ gap: 18 }}>
              {check('show_tax', t('Show the tax included', 'إظهار الضريبة المشمولة'))}
              {check('show_points', t('Show points earned', 'إظهار النقاط المكتسبة'))}
              {check('show_qr', t('QR code to the online receipt', 'رمز QR للإيصال الإلكتروني'))}
            </div>
          </>
        ) : section === 'barcode' ? (
          <>
            <div className="grid k3">
              {numf('width_mm', t('Label width (mm)', 'عرض الملصق (مم)'))}
              {numf('height_mm', t('Label height (mm)', 'ارتفاع الملصق (مم)'))}
              {numf('per_row', t('Labels per row', 'ملصقات في الصف'), t('1 for a label roll; more for A4 sheets.', '1 لرول الملصقات؛ أكثر لأوراق A4.'))}
            </div>
            <div className="row wrap" style={{ gap: 18 }}>
              {check('show_business', t('Business name', 'اسم النشاط'))}
              {check('show_name', t('Product name', 'اسم المنتج'))}
              {check('show_size', t('Size', 'المقاس'))}
              {check('show_price', t('Price', 'السعر'))}
            </div>
          </>
        ) : section === 'pos' ? (
          <>
            <Field label={t('Online shop orders are packed from', 'طلبات متجر التطبيق تُجهز من')} hint={t('Stock for app orders comes out of this branch.', 'يُخصم مخزون طلبات التطبيق من هذا الفرع.')}>
              <BranchSelect value={v.online_branch_id ?? ''} onChange={(b) => set('online_branch_id', b || null)} />
            </Field>
            {numf('min_deposit_percent', t('Minimum deposit on orders (%)', 'الحد الأدنى للعربون (%)'), t('0 lets staff take any deposit, or none.', '0 يسمح بأي عربون أو بدونه.'))}
            {check('require_register', t('Staff must open a cash register before selling', 'يجب فتح صندوق النقد قبل البيع'))}
            {check('allow_negative_stock', t('Allow selling items that show no stock', 'السماح ببيع أصناف رصيدها صفر'))}
          </>
        ) : section === 'printing' ? (
          <>
            <div className="grid k3">
              {pick('receipt_paper', t('Receipt paper', 'ورق الإيصال'), [['80mm', '80 mm'], ['58mm', '58 mm'], ['a4', 'A4']])}
              {numf('receipt_copies', t('Receipt copies', 'نسخ الإيصال'))}
              {pick('invoice_paper', t('Invoice paper', 'ورق الفاتورة'), [['a4', 'A4'], ['a5', 'A5']])}
              {pick('ticket_paper', t('Tailor ticket paper', 'ورق ورقة الخياط'), [['80mm', '80 mm'], ['a5', 'A5'], ['a4', 'A4']])}
              {numf('ticket_copies', t('Ticket copies', 'نسخ ورقة الخياط'), t('e.g. one for the cutter and one for the tailor.', 'مثلًا: نسخة للقصاص ونسخة للخياط.'))}
            </div>
            {check('auto_print', t('Open the receipt to print as soon as a sale is complete', 'فتح الإيصال للطباعة فور إتمام البيع'))}
            <div className="note">
              {t(
                'Set the receipt printer as the default printer on the counter PC, with no margins. In Chrome, "Print without asking" (kiosk printing) can skip the print dialog. Network printers are reached through the PC, so no IP address is needed here.',
                'اجعل طابعة الإيصالات الطابعة الافتراضية على جهاز المحل بدون هوامش. في كروم يمكن تفعيل الطباعة المباشرة (kiosk printing) لتخطي نافذة الطباعة. الطابعات الشبكية تعمل عبر الجهاز، فلا حاجة لعنوان IP هنا.',
              )}
            </div>
            <div className="row wrap">
              <button className="btn secondary" onClick={() => openPrint('test/receipt')}><Printer size={16} /> {t('Test receipt', 'تجربة الإيصال')}</button>
              <button className="btn secondary" onClick={() => openPrint('test/labels')}><Printer size={16} /> {t('Test label', 'تجربة الملصق')}</button>
            </div>
          </>
        ) : (
          <>
            {area('receipt_en', t('Receipt (English)', 'الإيصال (إنجليزي)'), 'ltr')}
            {area('receipt_ar', t('Receipt (Arabic)', 'الإيصال (عربي)'), 'rtl')}
            {area('ready_en', t('Thobes ready (English)', 'الثياب جاهزة (إنجليزي)'), 'ltr')}
            {area('ready_ar', t('Thobes ready (Arabic)', 'الثياب جاهزة (عربي)'), 'rtl')}
            {area('balance_en', t('Balance reminder (English)', 'تذكير بالمتبقي (إنجليزي)'), 'ltr')}
            {area('balance_ar', t('Balance reminder (Arabic)', 'تذكير بالمتبقي (عربي)'), 'rtl')}
            <div className="divider" />
            <h2 className="h3">{t('Send a message', 'إرسال رسالة')}</h2>
            <div className="grid k3">
              <Field label={t('Mobile', 'الجوال')}><Input dir="ltr" value={wa.phone} onChange={(e) => setWa({ ...wa, phone: e.target.value })} placeholder="5555 1234" /></Field>
              <Field label={t('Message', 'الرسالة')}>
                <Select value={wa.template} onChange={(e) => setWa({ ...wa, template: e.target.value })}>
                  <option value="receipt">{t('Receipt', 'الإيصال')}</option>
                  <option value="ready">{t('Thobes ready', 'الثياب جاهزة')}</option>
                  <option value="balance">{t('Balance reminder', 'تذكير بالمتبقي')}</option>
                  <option value="blank">{t('Blank', 'فارغة')}</option>
                </Select>
              </Field>
              <a className="btn" style={{ alignSelf: 'end' }} href={waLink(wa.phone, wa.template === 'blank' ? '' : fill(v[`${wa.template}_${t('en', 'ar')}`], {}))} target="_blank" rel="noreferrer"><Send size={16} /> WhatsApp</a>
            </div>
            <div className="small muted">{t('From a sale or an order, these open with the customer’s details filled in.', 'من الفاتورة أو الطلب تُفتح الرسائل وبيانات العميل معبأة.')}</div>
          </>
        )}
      </div>
    </div>
  );
}
