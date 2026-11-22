import { db } from './db.js';
import { config } from './config.js';
import { addDays, getSettings, notify, qatarDateString, qatarParts } from './lib.js';

/*
 * Reminders, checked with the housekeeping every 10 minutes. They become
 * ordinary notifications, so they show in the app and are pushed to phones.
 * None are sent in quiet hours (10 PM to 8 AM Qatar time by default); they wait
 * for the morning.
 */

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
};

function time(d: Date, lang: 'en' | 'ar') {
  const q = qatarParts(d);
  const h = Math.floor(q.minute / 60);
  const t = `${h % 12 === 0 ? 12 : h % 12}:${String(q.minute % 60).padStart(2, '0')}`;
  return lang === 'ar' ? `${t} ${h < 12 ? 'ص' : 'م'}` : `${t} ${h < 12 ? 'AM' : 'PM'}`;
}

const day = (d: Date, lang: 'en' | 'ar') => {
  const q = qatarParts(d);
  return `${q.d} ${MONTHS[lang][q.m - 1]}`;
};

export function quietHours(now = new Date()) {
  const q = config.quietHours;
  if (!q) return false;
  const hour = Math.floor(qatarParts(now).minute / 60);
  return q.from > q.to ? hour >= q.from || hour < q.to : hour >= q.from && hour < q.to;
}

/** The day before a measurement visit (or the same morning, for a visit booked late). */
async function visitReminders() {
  const due = await db.many<{ id: string; customer_id: string; kind: string; starts_at: Date; member: string; branch_en: string | null; branch_ar: string | null; area: string | null }>(
    `update appointments a set reminded_at = now()
       from family_members f, appointments a2
       left join branches b on b.id = a2.branch_id
       left join addresses ad on ad.id = a2.address_id
      where a.id = a2.id and f.id = a.member_id
        and a.status = 'confirmed' and a.reminded_at is null
        and a.starts_at > now() + interval '1 hour' and a.starts_at <= now() + interval '24 hours'
        -- booked only just before the visit: the confirmation is reminder enough
        and a.created_at < a.starts_at - interval '6 hours'
      returning a.id, a.customer_id, a.kind, a.starts_at, f.name as member, b.name_en as branch_en, b.name_ar as branch_ar, ad.area`,
  );
  for (const a of due) {
    const startsAt = new Date(a.starts_at);
    const today = qatarDateString(startsAt) === qatarDateString(new Date());
    const where = {
      en: a.kind === 'home' ? `A tailor comes to ${a.area ?? 'your address'} to measure ${a.member}.` : `${a.member}'s measurements at our ${a.branch_en ?? ''} branch.`,
      ar: a.kind === 'home' ? `يزوركم الخيّاط في ${a.area ?? 'عنوانكم'} لأخذ مقاسات ${a.member}.` : `مقاسات ${a.member} في فرع ${a.branch_ar ?? ''}.`,
    };
    await notify(
      a.customer_id,
      'reminder',
      {
        en: { title: `Measurement visit ${today ? 'today' : 'tomorrow'} at ${time(startsAt, 'en')}`, body: where.en },
        ar: { title: `موعد المقاسات ${today ? 'اليوم' : 'غداً'} الساعة ${time(startsAt, 'ar')}`, body: where.ar },
      },
      '/orders',
    );
  }
  return due.length;
}

/** Points about to expire, once per award, as the settings promise (warn days before). */
async function pointsReminders() {
  const s = await getSettings();
  const due = await db.many<{ customer_id: string; points: number; expires_at: Date }>(
    `with marked as (
       update points_ledger set reminded_at = now()
        where kind = 'earn' and remaining > 0 and reminded_at is null
          and expires_at > now() and expires_at <= now() + ($1 || ' days')::interval
        returning customer_id, remaining, expires_at
     )
     select m.customer_id, sum(m.remaining)::int as points, min(m.expires_at) as expires_at
       from marked m join customers c on c.id = m.customer_id and c.deleted_at is null
      group by m.customer_id`,
    [String(s.points.warn_days)],
  );
  for (const r of due) {
    const on = new Date(r.expires_at);
    await notify(
      r.customer_id,
      'points',
      {
        en: { title: `${r.points} points expire on ${day(on, 'en')}`, body: 'Use them before they expire: redeem them for a discount or a product.' },
        ar: { title: `تنتهي صلاحية ${r.points} نقطة في ${day(on, 'ar')}`, body: 'استخدمها قبل انتهاء صلاحيتها، واستبدلها بخصم أو منتج.' },
      },
      '/rewards',
    );
  }
  return due.length;
}

/** The day before a thobe order's pickup date, once it has reached quality inspection or is ready. */
async function pickupTomorrowReminders() {
  const tomorrow = addDays(qatarDateString(new Date()), 1);
  const due = await db.many<{ id: string; number: string; customer_id: string; branch_en: string | null; branch_ar: string | null }>(
    `update orders o set due_reminded_at = now()
       from orders o2 left join branches b on b.id = coalesce(o2.branch_id, nullif(o2.address->>'branchId','')::uuid)
      where o.id = o2.id and o.customer_id is not null and o.due_reminded_at is null
        and o.stage in ('quality','ready') and o.expected_delivery = $1::date
        and exists (select 1 from order_items i where i.order_id = o.id and i.kind = 'thobe')
      returning o.id, o.number, o.customer_id, b.name_en as branch_en, b.name_ar as branch_ar`,
    [tomorrow],
  );
  for (const o of due)
    await notify(
      o.customer_id,
      'order',
      {
        en: { title: 'Pickup tomorrow', body: `Your thobes (order #${o.number}) will be ready to collect tomorrow${o.branch_en ? ` from our ${o.branch_en} branch` : ''}.` },
        ar: { title: 'الاستلام غداً', body: `ثيابك (طلب رقم #${o.number}) ستكون جاهزة للاستلام غداً${o.branch_ar ? ` من فرع ${o.branch_ar}` : ''}.` },
      },
      `/orders/${o.id}`,
    );
  return due.length;
}

/** Thobes ready but not collected after the set number of days: one nudge, with any balance due. */
async function waitingPickupReminders() {
  const s = await getSettings();
  const due = await db.many<{ id: string; number: string; customer_id: string; branch_en: string | null; branch_ar: string | null; balance: number }>(
    `update orders o set pickup_reminded_at = now()
       from orders o2 left join branches b on b.id = coalesce(o2.branch_id, nullif(o2.address->>'branchId','')::uuid)
      where o.id = o2.id and o.customer_id is not null and o.pickup_reminded_at is null and o.stage = 'ready'
        and exists (select 1 from order_items i where i.order_id = o.id and i.kind = 'thobe')
        and coalesce((select max(e.at) from order_events e where e.order_id = o.id and e.stage = 'ready'), o.created_at) < now() - ($1 || ' days')::interval
      returning o.id, o.number, o.customer_id, b.name_en as branch_en, b.name_ar as branch_ar,
                greatest(0, o.total - coalesce((select sum(amount) from payments p where p.order_id = o.id and p.status = 'paid'),0))::float as balance`,
    [String(s.pickup.remind_after_days)],
  );
  for (const o of due)
    await notify(
      o.customer_id,
      'reminder',
      {
        en: {
          title: 'Your thobes are waiting for you',
          body: `Order #${o.number} is ready to collect${o.branch_en ? ` at our ${o.branch_en} branch` : ''}.${o.balance > 0 ? ` Balance due: QAR ${o.balance}.` : ''}`,
        },
        ar: {
          title: 'ثيابك بانتظارك',
          body: `الطلب رقم #${o.number} جاهز للاستلام${o.branch_ar ? ` من فرع ${o.branch_ar}` : ''}.${o.balance > 0 ? ` المبلغ المتبقي: ${o.balance} ر.ق.` : ''}`,
        },
      },
      `/orders/${o.id}`,
    );
  return due.length;
}

export async function sendReminders(now = new Date()) {
  if (quietHours(now)) return { visits: 0, points: 0, pickupTomorrow: 0, waiting: 0 };
  return { visits: await visitReminders(), points: await pointsReminders(), pickupTomorrow: await pickupTomorrowReminders(), waiting: await waitingPickupReminders() };
}
