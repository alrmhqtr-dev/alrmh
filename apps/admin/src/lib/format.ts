import { locale, t } from './i18n';

const TZ = 'Asia/Qatar';
const amount = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
export const money = (n: number | string | null | undefined) => (t('x', 'y') === 'y' ? `${amount(n)} ر.ق` : `QAR ${amount(n)}`);
/** Always two decimals, for receipts and totals that must line up. */
export const money2 = (n: number | string | null | undefined) => Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const num = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const asDate = (d: string) => new Date(d.length === 10 ? d + 'T00:00:00+03:00' : d);
export const date = (d?: string | null) => (d ? asDate(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }) : '—');
export const day = (d?: string | null) => (d ? asDate(d).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }) : '—');
export const time = (d?: string | null) => (d ? new Date(d).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—');
export const dateTime = (d?: string | null) => (d ? `${day(d)} · ${time(d)}` : '—');
/** A mobile as +974 5555 1234, kept left to right inside Arabic text (otherwise the groups swap places). */
export const phone = (p?: string | null) => (p ? `\u2066${p.replace(/^\+974(\d{4})(\d{4})$/, '+974 $1 $2')}\u2069` : '—');
export const todayQatar = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
export const minuteToTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const timeToMinute = (tm: string) => {
  const [h, m] = tm.split(':').map(Number);
  return h * 60 + (m || 0);
};

export const STAGES = ['confirmed', 'measured', 'cutting', 'stitching', 'quality', 'ready', 'out_for_delivery', 'delivered'] as const;
/** Thobe orders: made to measure, collected from the branch. */
export const THOBE_FLOW = ['measured', 'cutting', 'stitching', 'quality', 'ready', 'delivered'];
/** Shop-only orders: packed and delivered. */
export const SHOP_FLOW = ['confirmed', 'ready', 'out_for_delivery', 'delivered'];
const STAGE_TEXT: Record<string, [string, string]> = {
  pending_payment: ['Awaiting payment', 'بانتظار الدفع'],
  payment_failed: ['Payment failed', 'فشل الدفع'],
  confirmed: ['Order confirmed', 'تم تأكيد الطلب'],
  measured: ['Taking measurements', 'أخذ المقاسات'],
  cutting: ['Cutting', 'القص'],
  stitching: ['Sewing', 'الخياطة'],
  quality: ['Quality inspection', 'التدقيق ومراجعة الجودة'],
  ready: ['Ready', 'جاهز'],
  out_for_delivery: ['Out for delivery', 'في الطريق'],
  delivered: ['Done', 'تم الاستلام'],
  cancelled: ['Cancelled', 'ملغي'],
};
export const STAGE_LABEL: Record<string, string> = new Proxy({} as Record<string, string>, {
  get: (_, k: string) => (STAGE_TEXT[k] ? t(STAGE_TEXT[k][0], STAGE_TEXT[k][1]) : k),
});
/** The stage name worded for the kind of order: "Ready for pickup" and "Done" (collected) for thobes, "Packed" and "Delivered" for shop orders. */
export function stageLabel(stage: string, thobes?: boolean) {
  if (thobes === true && stage === 'ready') return t('Ready for pickup', 'الملابس جاهزة');
  if (thobes === true && stage === 'delivered') return t('Done', 'تم الاستلام');
  if (thobes === false && stage === 'ready') return t('Packed', 'تم التجهيز');
  if (thobes === false && stage === 'delivered') return t('Delivered', 'تم التوصيل');
  return STAGE_LABEL[stage] ?? stage;
}
export const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const weekdays = () => WEEKDAYS_EN.map((d, i) => t(d, WEEKDAYS_AR[i]));
const RELATION_TEXT: Record<string, [string, string]> = {
  self: ['Account holder', 'صاحب الحساب'],
  father: ['Father', 'الأب'],
  son: ['Son', 'الابن'],
  brother: ['Brother', 'الأخ'],
  friend: ['Friend', 'صديق'],
  other: ['Other', 'آخر'],
};
export const RELATION: Record<string, string> = new Proxy({} as Record<string, string>, { get: (_, k: string) => (RELATION_TEXT[k] ? t(...RELATION_TEXT[k]) : k) });
export const RELATIONS = Object.keys(RELATION_TEXT);
const MEASURE_TEXT: Record<string, [string, string]> = {
  length_cm: ['Length', 'الطول'],
  shoulder_cm: ['Shoulder', 'الكتف'],
  chest_cm: ['Chest', 'الصدر'],
  waist_cm: ['Waist', 'الخصر'],
  sleeve_cm: ['Sleeve', 'الكم'],
  neck_cm: ['Neck', 'الرقبة'],
  cuff_cm: ['Cuff', 'الكبك'],
};
export const MEASURE_KEYS = ['length_cm', 'shoulder_cm', 'chest_cm', 'waist_cm', 'sleeve_cm', 'neck_cm', 'cuff_cm'] as const;
/** [field, English label] pairs; show measureLabel(field) so the label follows the language. */
export const MEASURE_FIELDS = MEASURE_KEYS.map((k) => [k, MEASURE_TEXT[k][0]] as const);
export const measureLabel = (k: string) => (MEASURE_TEXT[k] ? t(...MEASURE_TEXT[k]) : k);

const METHOD_TEXT: Record<string, [string, string]> = {
  cash: ['Cash', 'نقدًا'],
  card: ['Card', 'بطاقة'],
  card_machine: ['Card', 'بطاقة'],
  bank_transfer: ['Bank transfer', 'تحويل بنكي'],
  cheque: ['Cheque', 'شيك'],
  sadad: ['SADAD (online)', 'سداد (أونلاين)'],
  none: ['No refund', 'بدون رد'],
};
export const methodLabel = (m: string) => (METHOD_TEXT[m] ? t(...METHOD_TEXT[m]) : m);
const CHANNEL_TEXT: Record<string, [string, string]> = {
  app: ['App', 'التطبيق'],
  staff: ['At a visit', 'في الزيارة'],
  pos: ['Counter', 'نقطة البيع'],
  import: ['Imported (Mada)', 'مستورد (مدى)'],
};
export const channelLabel = (c: string) => (CHANNEL_TEXT[c] ? t(...CHANNEL_TEXT[c]) : c);
