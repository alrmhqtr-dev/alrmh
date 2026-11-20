import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { db, type Queryable } from './db.js';
import { QATAR_OFFSET_MINUTES } from './config.js';

export type Settings = {
  delivery_fee: number;
  home_visit_fee: number;
  /** Booking a measurement appointment from the app ("New order"); 0 books it free. */
  appointment_fee: number;
  lead_working_days: number;
  measurements_valid_months: number;
  voucher_valid_days: number;
  points: { expiry_months: number; warn_days: number };
  home_visit: { open_minute: number; close_minute: number; slot_minutes: number; capacity: number; closed_weekdays: number[] };
  support: { whatsapp: string; phone: string };
  /** The business as printed on invoices and receipts. */
  company: { name_en: string; name_ar: string; cr_number: string; tax_number: string; phone: string; email: string; address_en: string; address_ar: string; logo_url: string | null; currency: string };
  invoice: { prefix: string; footer_en: string; footer_ar: string; terms_en: string; terms_ar: string; show_tax: boolean; show_points: boolean; show_qr: boolean };
  /** Product labels. Sizes in millimetres. */
  barcode: { width_mm: number; height_mm: number; per_row: number; show_name: boolean; show_price: boolean; show_business: boolean; show_size: boolean };
  /** Paper and copies per document, printed from the browser. */
  printing: { receipt_paper: '80mm' | '58mm' | 'a4'; receipt_copies: number; invoice_paper: 'a4' | 'a5'; ticket_paper: '80mm' | 'a4' | 'a5'; ticket_copies: number; auto_print: boolean };
  /** Messages opened in WhatsApp; {name}, {number}, {total}, {balance}, {link}, {branch} are filled in. */
  whatsapp: { receipt_en: string; receipt_ar: string; ready_en: string; ready_ar: string; balance_en: string; balance_ar: string };
  pos: { online_branch_id: string | null; allow_negative_stock: boolean; require_register: boolean; min_deposit_percent: number };
};

export const DEFAULT_SETTINGS: Settings = {
  delivery_fee: 25,
  home_visit_fee: 50,
  appointment_fee: 70,
  lead_working_days: 7,
  measurements_valid_months: 12,
  voucher_valid_days: 30,
  points: { expiry_months: 12, warn_days: 30 },
  home_visit: { open_minute: 960, close_minute: 1320, slot_minutes: 90, capacity: 1, closed_weekdays: [5] },
  support: { whatsapp: '+97455550000', phone: '+97444440000' },
  company: { name_en: 'AlRmh', name_ar: 'الرمح', cr_number: '', tax_number: '', phone: '', email: '', address_en: 'Doha, Qatar', address_ar: 'الدوحة، قطر', logo_url: null, currency: 'QAR' },
  invoice: { prefix: 'AR-', footer_en: 'Thank you for choosing AlRmh.', footer_ar: 'شكرًا لاختياركم الرمح.', terms_en: '', terms_ar: '', show_tax: false, show_points: true, show_qr: true },
  barcode: { width_mm: 50, height_mm: 25, per_row: 1, show_name: true, show_price: true, show_business: true, show_size: true },
  printing: { receipt_paper: '80mm', receipt_copies: 1, invoice_paper: 'a4', ticket_paper: '80mm', ticket_copies: 1, auto_print: true },
  whatsapp: {
    receipt_en: 'Hello {name}, thank you for shopping at AlRmh. Your invoice #{number} for QAR {total}: {link}',
    receipt_ar: 'مرحبًا {name}، شكرًا لتسوقك من الرمح. فاتورتك رقم {number} بمبلغ {total} ر.ق: {link}',
    ready_en: 'Hello {name}, your thobes (order #{number}) are ready to collect from {branch}. Balance due: QAR {balance}.',
    ready_ar: 'مرحبًا {name}، ثيابك (طلب رقم {number}) جاهزة للاستلام من {branch}. المبلغ المتبقي: {balance} ر.ق.',
    balance_en: 'Hello {name}, a balance of QAR {balance} is due on order #{number}. {link}',
    balance_ar: 'مرحبًا {name}، يتبقى مبلغ {balance} ر.ق على الطلب رقم {number}. {link}',
  },
  pos: { online_branch_id: null, allow_negative_stock: false, require_register: true, min_deposit_percent: 0 },
};

export async function getSettings(client: Queryable = db.pool): Promise<Settings> {
  const rows = await db.many<{ key: string; value: any }>('select key, value from settings', [], client);
  const out: any = structuredClone(DEFAULT_SETTINGS);
  // `seed.*` rows are the seed's own bookkeeping, not settings.
  // Object settings are merged over the defaults, so a setting added later still has a value.
  for (const r of rows)
    if (!r.key.startsWith('seed.')) out[r.key] = out[r.key] && typeof out[r.key] === 'object' && !Array.isArray(out[r.key]) ? { ...out[r.key], ...r.value } : r.value;
  return out as Settings;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
export const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const sixDigits = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

export function need<T>(value: T | undefined | null, field: string): T {
  if (value === undefined || value === null || value === '') throw new BadRequestException({ code: 'missing_field', field });
  return value;
}

export function fail(code: string, extra: Record<string, unknown> = {}): never {
  throw new BadRequestException({ code, ...extra });
}

export function normaliseQatarPhone(input: string): string {
  const digits = String(input ?? '').replace(/\D/g, '').replace(/^00/, '');
  const local = digits.startsWith('974') && digits.length === 11 ? digits.slice(3) : digits;
  if (!/^[3567]\d{7}$/.test(local)) fail('invalid_phone');
  return `+974${local}`;
}

export function qatarParts(d: Date) {
  const q = new Date(d.getTime() + QATAR_OFFSET_MINUTES * 60_000);
  return { y: q.getUTCFullYear(), m: q.getUTCMonth() + 1, d: q.getUTCDate(), weekday: q.getUTCDay(), minute: q.getUTCHours() * 60 + q.getUTCMinutes() };
}

export function qatarDateString(d: Date) {
  const p = qatarParts(d);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function qatarInstant(date: string, minute: number) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, minute) - QATAR_OFFSET_MINUTES * 60_000);
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function addWorkingDays(date: string, n: number, closed = [5]) {
  let cur = date;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    if (!closed.includes(new Date(cur + 'T00:00:00Z').getUTCDay())) left--;
  }
  return cur;
}

export type Bilingual = { en: { title: string; body: string }; ar: { title: string; body: string } };

export async function notify(customerId: string, kind: string, text: Bilingual, link: string | null, client: Queryable = db.pool) {
  await client.query(
    'insert into notifications (customer_id, kind, title_en, title_ar, body_en, body_ar, link) values ($1,$2,$3,$4,$5,$6,$7)',
    [customerId, kind, text.en.title, text.ar.title, text.en.body, text.ar.body, link],
  );
}

export const STAGES = ['confirmed', 'measured', 'cutting', 'stitching', 'quality', 'ready', 'out_for_delivery', 'delivered'] as const;
export type Stage = (typeof STAGES)[number];

/** Thobes are made to measure and always collected from the branch. */
export const THOBE_FLOW: Stage[] = ['measured', 'cutting', 'stitching', 'quality', 'ready', 'delivered'];
/** Shop-only orders (no thobes) are packed and delivered like any online shop. */
export const SHOP_FLOW: Stage[] = ['confirmed', 'ready', 'out_for_delivery', 'delivered'];

const THOBE_TEXT: Partial<Record<Stage, Bilingual>> = {
  measured: { en: { title: 'Taking measurements', body: 'We have your order. Your measurements are with the tailor.' }, ar: { title: 'أخذ المقاسات', body: 'استلمنا طلبك، ومقاساتك الآن لدى الخيّاط.' } },
  cutting: { en: { title: 'Cutting', body: 'Your fabric is being cut.' }, ar: { title: 'القص', body: 'بدأنا قصّ قماش ثيابك.' } },
  stitching: { en: { title: 'Sewing', body: 'Your thobes are being sewn.' }, ar: { title: 'الخياطة', body: 'ثيابك قيد الخياطة.' } },
  quality: { en: { title: 'Quality inspection', body: 'Our team is checking every detail of your thobes.' }, ar: { title: 'قسم التدقيق ومراجعة الجودة', body: 'يراجع فريقنا كل تفاصيل ثيابك.' } },
  ready: { en: { title: 'Ready for pickup', body: 'Your thobes are ready to collect from the branch.' }, ar: { title: 'الملابس جاهزة', body: 'ثيابك جاهزة للاستلام من الفرع.' } },
  delivered: { en: { title: 'Collected', body: 'Thank you. Your points have been added.' }, ar: { title: 'تم الاستلام', body: 'شكرًا لك. أُضيفت النقاط إلى رصيدك.' } },
};
const SHOP_TEXT: Partial<Record<Stage, Bilingual>> = {
  confirmed: { en: { title: 'Order confirmed', body: 'We have your order and payment.' }, ar: { title: 'تم تأكيد طلبك', body: 'استلمنا طلبك ودفعتك.' } },
  ready: { en: { title: 'Packed', body: 'Your order is packed and will be on its way soon.' }, ar: { title: 'تم تجهيز طلبك', body: 'طلبك جاهز وسيُرسل إليك قريبًا.' } },
  out_for_delivery: { en: { title: 'Out for delivery', body: 'Your order is on its way to you.' }, ar: { title: 'في الطريق إليك', body: 'طلبك في طريقه إليك.' } },
  delivered: { en: { title: 'Order delivered', body: 'Enjoy your order. Your points have been added.' }, ar: { title: 'تم التوصيل', body: 'نتمنى أن يعجبك طلبك. أُضيفت النقاط إلى رصيدك.' } },
};

export function stageText(stage: Stage, thobes: boolean): Bilingual {
  return (thobes ? THOBE_TEXT : SHOP_TEXT)[stage]!;
}

/* ---------- points ---------- */

export async function expirePoints(customerId: string | null, client: Queryable = db.pool) {
  // One statement, so two requests arriving together cannot both expire the
  // same award: the second waits on the row lock, then sees remaining = 0.
  await client.query(
    `with due as (
       select id, customer_id, remaining, label from points_ledger
        where kind in ('earn','refund') and remaining > 0 and expires_at <= now() ${customerId ? 'and customer_id = $1' : ''}
        for update
     ), zeroed as (
       update points_ledger p set remaining = 0 from due where p.id = due.id
     )
     insert into points_ledger (customer_id, kind, points, label)
     select customer_id, 'expire', -remaining, case when label is null then 'Expired points' else 'Expired: ' || label end from due`,
    customerId ? [customerId] : [],
  );
  await client.query(`update vouchers set status = 'expired' where status = 'active' and expires_at <= now() ${customerId ? 'and customer_id = $1' : ''}`, customerId ? [customerId] : []);
}

export async function pointsBalance(customerId: string, client: Queryable = db.pool) {
  const r = await db.one<{ balance: number }>('select coalesce(sum(points),0)::int as balance from points_ledger where customer_id = $1', [customerId], client);
  return r?.balance ?? 0;
}

export async function spendPoints(customerId: string, cost: number, client: Queryable) {
  const rows = await db.many<{ id: string; remaining: number }>(
    `select id, remaining from points_ledger where customer_id = $1 and kind in ('earn','refund') and remaining > 0 order by expires_at asc for update`,
    [customerId],
    client,
  );
  let left = cost;
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(r.remaining, left);
    await client.query('update points_ledger set remaining = remaining - $2 where id = $1', [r.id, take]);
    left -= take;
  }
  if (left > 0) fail('not_enough_points');
}

/* ---------- tiers ---------- */

export type Tier = { id: string; name_en: string; name_ar: string; min_points: number; points_per_product: number; points_per_thobe: number; colour: string };

export async function listTiers(client: Queryable = db.pool): Promise<Tier[]> {
  return db.many<Tier>('select id, name_en, name_ar, min_points, points_per_product, points_per_thobe, colour from tiers order by min_points, id', [], client);
}

/** Every point ever earned, less staff corrections. Spending, expiry and returned points don't change it. */
export async function lifetimePoints(customerId: string, client: Queryable = db.pool) {
  const r = await db.one<{ n: number }>(`select greatest(coalesce(sum(points),0),0)::int as n from points_ledger where customer_id = $1 and kind in ('earn','adjust')`, [customerId], client);
  return r?.n ?? 0;
}

/** The customer's tier, the next one up, and how far they are from it. Guests and new customers get the first tier. */
export async function tierStatus(customerId: string | null, client: Queryable = db.pool) {
  const tiers = await listTiers(client);
  const lifetime = customerId ? await lifetimePoints(customerId, client) : 0;
  let i = 0;
  tiers.forEach((t, k) => {
    if (lifetime >= t.min_points) i = k;
  });
  const tier = tiers[i] ?? { id: 'none', name_en: '', name_ar: '', min_points: 0, points_per_product: 0, points_per_thobe: 0, colour: '#B8B8B8' };
  const next = tiers[i + 1] ?? null;
  return { tier, next, lifetime, toNext: next ? Math.max(0, next.min_points - lifetime) : 0 };
}

/** Points given back (an order that used them was cancelled). Spendable again; not counted towards a tier. */
export async function returnPoints(customerId: string, points: number, orderId: string | null, label: string, client: Queryable) {
  if (points <= 0) return;
  const s = await getSettings(client);
  await client.query(
    `insert into points_ledger (customer_id, kind, points, remaining, expires_at, order_id, label)
     values ($1, 'refund', $2, $2, now() + make_interval(months => $3::int), $4, $5)`,
    [customerId, points, s.points.expiry_months, orderId, label],
  );
}

export function voucherCode(percent: number | null) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[randomInt(0, alphabet.length)];
  return `AR${percent ?? 'P'}-${s}`;
}
