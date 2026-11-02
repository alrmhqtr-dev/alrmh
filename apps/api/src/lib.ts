import { createHash, randomBytes, randomInt } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { db, type Queryable } from './db.js';
import { QATAR_OFFSET_MINUTES } from './config.js';

export type Settings = {
  delivery_fee: number;
  home_visit_fee: number;
  lead_working_days: number;
  measurements_valid_months: number;
  voucher_valid_days: number;
  points: { thobe_fixed: number; product_per_qar: number; expiry_months: number; warn_days: number };
  home_visit: { open_minute: number; close_minute: number; slot_minutes: number; capacity: number; closed_weekdays: number[] };
  support: { whatsapp: string; phone: string };
};

export const DEFAULT_SETTINGS: Settings = {
  delivery_fee: 25,
  home_visit_fee: 50,
  lead_working_days: 7,
  measurements_valid_months: 12,
  voucher_valid_days: 30,
  points: { thobe_fixed: 32, product_per_qar: 0.1, expiry_months: 12, warn_days: 30 },
  home_visit: { open_minute: 960, close_minute: 1320, slot_minutes: 90, capacity: 1, closed_weekdays: [5] },
  support: { whatsapp: '+97455550000', phone: '+97444440000' },
};

export async function getSettings(client: Queryable = db.pool): Promise<Settings> {
  const rows = await db.many<{ key: string; value: any }>('select key, value from settings', [], client);
  const out: any = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) out[r.key] = r.value;
  return out as Settings;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');
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

export const STAGES = ['confirmed', 'measured', 'cutting', 'stitching', 'ready', 'out_for_delivery', 'delivered'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_TEXT: Record<Stage, Bilingual> = {
  confirmed: { en: { title: 'Order confirmed', body: 'We have your order and payment.' }, ar: { title: 'تم تأكيد طلبك', body: 'استلمنا طلبك ودفعتك.' } },
  measured: { en: { title: 'Measurements ready', body: 'Your measurements are with the tailor.' }, ar: { title: 'المقاسات جاهزة', body: 'مقاساتك الآن لدى الخيّاط.' } },
  cutting: { en: { title: 'Your fabric is being cut', body: 'Cutting has started on your thobes.' }, ar: { title: 'بدأ قصّ القماش', body: 'بدأنا قصّ قماش ثيابك.' } },
  stitching: { en: { title: 'Your thobes are being stitched', body: 'Your order moved to Stitching.' }, ar: { title: 'ثيابك قيد الخياطة', body: 'انتقل طلبك إلى مرحلة الخياطة.' } },
  ready: { en: { title: 'Your order is ready', body: 'Your thobes are finished and checked.' }, ar: { title: 'طلبك جاهز', body: 'ثيابك جاهزة وتم فحصها.' } },
  out_for_delivery: { en: { title: 'Out for delivery', body: 'Your order is on its way to you.' }, ar: { title: 'في الطريق إليك', body: 'طلبك في طريقه إليك.' } },
  delivered: { en: { title: 'Order delivered', body: 'Enjoy your thobes. Points have been added.' }, ar: { title: 'تم التوصيل', body: 'نتمنى أن تعجبك ثيابك. أُضيفت النقاط إلى رصيدك.' } },
};

/* ---------- points ---------- */

export async function expirePoints(customerId: string | null, client: Queryable = db.pool) {
  const due = await db.many<{ id: string; customer_id: string; remaining: number; label: string | null }>(
    `select id, customer_id, remaining, label from points_ledger
      where kind = 'earn' and remaining > 0 and expires_at <= now() ${customerId ? 'and customer_id = $1' : ''}`,
    customerId ? [customerId] : [],
    client,
  );
  for (const e of due) {
    await client.query('update points_ledger set remaining = 0 where id = $1', [e.id]);
    await client.query(
      `insert into points_ledger (customer_id, kind, points, label) values ($1, 'expire', $2, $3)`,
      [e.customer_id, -e.remaining, e.label ? `Expired: ${e.label}` : 'Expired points'],
    );
  }
  await client.query(`update vouchers set status = 'expired' where status = 'active' and expires_at <= now() ${customerId ? 'and customer_id = $1' : ''}`, customerId ? [customerId] : []);
}

export async function pointsBalance(customerId: string, client: Queryable = db.pool) {
  const r = await db.one<{ balance: number }>('select coalesce(sum(points),0)::int as balance from points_ledger where customer_id = $1', [customerId], client);
  return r?.balance ?? 0;
}

export async function spendPoints(customerId: string, cost: number, client: Queryable) {
  const rows = await db.many<{ id: string; remaining: number }>(
    `select id, remaining from points_ledger where customer_id = $1 and kind = 'earn' and remaining > 0 order by expires_at asc for update`,
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

export function voucherCode(percent: number | null) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[randomInt(0, alphabet.length)];
  return `AR${percent ?? 'P'}-${s}`;
}
