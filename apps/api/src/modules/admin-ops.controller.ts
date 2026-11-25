import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { db } from '../db.js';
import { STAGES, addDays, addWorkingDays, expirePoints, fail, getSettings, lifetimePoints, need, notify, pointsBalance, qatarDateString, returnPoints, spendPoints, tierStatus, type Stage } from '../lib.js';
import { setStage, stagesFor } from '../orders.js';
import { addMonthsSql } from '../sql-helpers.js';
import { AnyStaff, CurrentStaff, ReportsGuard, ReturnsGuard, Managers, Measurers, Workshop, audit, type StaffUser } from '../staff.js';
import { assertInStock, openRegister, orderBalance, requireRegister, returnStockForOrder, stockNeeds, takeStockForOrder, thobeOptions } from '../pos.js';
import { toCsv } from '../csv.js';
import { assertSlotFree, slotLockKey } from './booking.controller.js';
import { round2 } from '../lib.js';

export const FIELDS = ['length_cm', 'shoulder_cm', 'chest_cm', 'waist_cm', 'sleeve_cm', 'neck_cm', 'cuff_cm'] as const;
/** The seven measurements from a request, in FIELDS order. */
export function measurementValues(body: Record<string, any>) {
  return FIELDS.map((f) => {
    const v = Number(need(body?.[f], f));
    // No size limits: only reject what isn't a number or won't fit the column (numeric(5,1)).
    if (!Number.isFinite(v) || v < 0 || v >= 10000) fail('invalid_measurement', { field: f });
    return v;
  });
}

/** Qatar dates in the form 2026-11-01; the default is the current month so far. */
function dateRange(from?: string, to?: string) {
  const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null);
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const range = { from: ok(from) ?? `${today.slice(0, 8)}01`, to: ok(to) ?? today };
  if (range.from > range.to) fail('invalid_date', { field: 'from' });
  return range;
}

function sendCsv(res: Response, filename: string, body: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(body);
}

@Controller('v1/admin')
export class AdminOpsController {
  /* ---------- orders ---------- */

  @Get('orders')
  @UseGuards(AnyStaff)
  orders(@Query('stage') stage?: string, @Query('q') q?: string, @Query('kind') kind?: string, @Query('board') board?: string) {
    // Phone and order numbers match with spaces ignored; names match as typed.
    // Old receipts say "AR-10528": the number is 10528 now.
    const needle = q?.trim() ? `%${q.trim().replace(/\s+/g, '').replace(/^#?ar-?(?=\d)/i, '')}%` : null;
    const text = q?.trim() ? `%${q.trim().replace(/\s+/g, ' ')}%` : null;
    return db.many(
      `select o.id, o.number, o.stage, o.total, o.created_at, o.paid_at, o.expected_delivery, o.customer_id, coalesce(c.name, o.walk_in_name) as customer_name, coalesce(c.phone, o.walk_in_phone) as phone,
              o.channel, o.branch_id,
              greatest(0, o.total - coalesce((select sum(amount) from payments p where p.order_id = o.id and p.status = 'paid'),0))::float as balance,
              (select coalesce(sum(qty),0)::int from order_items i where i.order_id = o.id and i.kind = 'thobe') as thobe_count,
              (select coalesce(sum(qty),0)::int from order_items i where i.order_id = o.id) as item_count,
              (select min(a.starts_at) from appointments a where a.order_id = o.id and a.status = 'confirmed') as next_appointment,
              (select max(e.at) from order_events e where e.order_id = o.id and e.stage = 'delivered') as done_at
         from orders o left join customers c on c.id = o.customer_id
        where o.stage not in ('pending_payment','payment_failed')
          and ($1::text is null or o.stage = $1)
          and ($2::text is null or o.number ilike $2 or replace(coalesce(c.phone, o.walk_in_phone, ''),' ','') ilike $2 or coalesce(c.name, o.walk_in_name, '') ilike $3)
          and ($4::text is null or ($4 = 'thobe') = exists (select 1 from order_items i where i.order_id = o.id and i.kind = 'thobe'))
          -- Counter sales handed over on the spot are sales, not workshop orders.
          and not (o.channel = 'pos' and o.stage = 'delivered' and $1::text is null and $2::text is null and $5::boolean
                   and not exists (select 1 from order_items i where i.order_id = o.id and i.kind = 'thobe'))
          -- The board shows open orders, oldest first, and what was finished in the last 30 days.
          and not ($5::boolean and (o.stage = 'cancelled' or (o.stage = 'delivered' and coalesce((select max(e.at) from order_events e where e.order_id = o.id and e.stage = 'delivered'), o.created_at) < now() - interval '30 days')))
        order by case when $5::boolean then o.created_at end asc, o.created_at desc limit 400`,
      [stage || null, needle, text, kind === 'thobe' || kind === 'shop' ? kind : null, board === '1'],
    );
  }

  /**
   * What staff should act on today: thobes due tomorrow that are not ready yet, thobes past their date,
   * thobes waiting to be collected, today's home visits and cloth or products running low.
   */
  @Get('alerts')
  @UseGuards(AnyStaff)
  async alerts() {
    const s = await getSettings();
    const today = qatarDateString(new Date());
    const tomorrow = addDays(today, 1);
    const ORDER = `select o.id, o.number, o.stage, o.expected_delivery, coalesce(c.name, o.walk_in_name) as customer_name, coalesce(c.phone, o.walk_in_phone) as phone,
                          greatest(0, o.total - coalesce((select sum(amount) from payments p where p.order_id = o.id and p.status = 'paid'),0))::float as balance,
                          (select coalesce(sum(qty),0)::int from order_items i where i.order_id = o.id and i.kind = 'thobe') as thobe_count
                     from orders o left join customers c on c.id = o.customer_id
                    where exists (select 1 from order_items i where i.order_id = o.id and i.kind = 'thobe')`;
    const [dueTomorrow, overdue, pickupTomorrow, waiting, visits, lowStock] = await Promise.all([
      db.many(`${ORDER} and o.expected_delivery = $1::date and o.stage in ('measured','cutting','stitching','quality') order by o.created_at`, [tomorrow]),
      db.many(`${ORDER} and o.expected_delivery < $1::date and o.stage in ('measured','cutting','stitching','quality') order by o.expected_delivery, o.created_at`, [today]),
      db.many(`${ORDER} and o.expected_delivery = $1::date and o.stage = 'ready' order by o.created_at`, [tomorrow]),
      db.many(
        `${ORDER} and o.stage = 'ready'
           and coalesce((select max(e.at) from order_events e where e.order_id = o.id and e.stage = 'ready'), o.created_at) < now() - ($1 || ' days')::interval
         order by o.created_at`,
        [String(s.pickup.remind_after_days)],
      ),
      db.many(
        `select a.id, a.starts_at, a.kind, c.name as customer_name, c.phone, f.name as member, ad.area
           from appointments a join customers c on c.id = a.customer_id left join family_members f on f.id = a.member_id left join addresses ad on ad.id = a.address_id
          where a.status = 'confirmed' and (a.starts_at at time zone 'Asia/Qatar')::date in ($1::date, $2::date)
          order by a.starts_at`,
        [today, tomorrow],
      ),
      db.many(
        `with lv as (
           select item_kind, item_id, sum(qty)::float as qty from stock_moves group by 1,2
         )
         select 'fabric' as kind, f.id, f.name_en, f.name_ar, coalesce(lv.qty,0) as qty, f.alert_qty::float as alert_qty
           from fabrics f left join lv on lv.item_kind = 'fabric' and lv.item_id = f.id
          where f.active and f.track_stock and coalesce(lv.qty,0) <= f.alert_qty
         union all
         select 'product', p.id, p.name_en, p.name_ar, coalesce(lv.qty,0), p.alert_qty::float
           from products p left join lv on lv.item_kind = 'product' and lv.item_id = p.id
          where p.active and p.track_stock and coalesce(lv.qty,0) <= p.alert_qty
         order by 5 limit 30`,
      ),
    ]);
    const visitsToday = visits.filter((v) => qatarDateString(new Date(v.starts_at)) === today);
    const visitsTomorrow = visits.filter((v) => qatarDateString(new Date(v.starts_at)) === tomorrow);
    return {
      today,
      tomorrow,
      remindAfterDays: s.pickup.remind_after_days,
      dueTomorrow,
      overdue,
      pickupTomorrow,
      waiting,
      visitsToday,
      visitsTomorrow,
      lowStock,
      count: dueTomorrow.length + overdue.length + pickupTomorrow.length + waiting.length + visitsToday.length + lowStock.length,
    };
  }

  @Get('orders/:id')
  @UseGuards(AnyStaff)
  async order(@Param('id') id: string) {
    const o = await db.one(
      `select o.*, coalesce(c.name, o.walk_in_name) as customer_name, coalesce(c.phone, o.walk_in_phone) as phone, c.email,
              b.name_en as branch_en, b.name_ar as branch_ar,
              coalesce((select sum(amount) from payments p where p.order_id = o.id and p.status = 'paid'),0)::float as paid,
              (select status from payments p where p.order_id = o.id order by created_at desc limit 1) as payment_status,
              (select provider_ref from payments p where p.order_id = o.id order by created_at desc limit 1) as payment_ref,
              (select provider from payments p where p.order_id = o.id order by created_at desc limit 1) as payment_provider,
              (select name from staff_users u where u.id = o.placed_by_staff_id) as placed_by
         from orders o left join customers c on c.id = o.customer_id left join branches b on b.id = o.branch_id
         where o.id = $1`,
      [id],
    );
    if (!o) throw new NotFoundException({ code: 'not_found' });
    const [items, events, appointments, refunds, payments, photos, returns] = await Promise.all([
      db.many('select id, kind, snapshot, qty, unit_price, line_total, discount::float as discount, returned_qty from order_items where order_id = $1 order by kind desc', [id]),
      db.many(`select e.stage, e.at, e.note, u.name as staff_name from order_events e left join staff_users u on u.id = e.staff_id where e.order_id = $1 order by e.at, array_position(array['confirmed','measured','cutting','stitching','quality','ready','out_for_delivery','delivered','cancelled'], e.stage)`, [id]),
      db.many(
        `select a.id, a.kind, a.starts_at, a.status, a.member_id, f.name as member_name, b.name_en as branch_name, ad.line1, ad.area
           from appointments a join family_members f on f.id = a.member_id left join branches b on b.id = a.branch_id left join addresses ad on ad.id = a.address_id
          where a.order_id = $1 order by a.starts_at`,
        [id],
      ),
      db.many('select r.id, r.amount::float as amount, r.reference, r.note, r.created_at, r.method, u.name as staff_name from refunds r left join staff_users u on u.id = r.staff_id where r.order_id = $1 order by r.created_at', [id]),
      db.many(`select p.id, p.provider, p.amount::float as amount, p.completed_at, p.provider_ref, u.name as staff_name from payments p left join staff_users u on u.id = p.staff_id where p.order_id = $1 and p.status = 'paid' order by p.completed_at`, [id]),
      db.many(`select id, caption, '/v1/media/' || media_id as url, created_at from order_photos where order_id = $1 order by created_at`, [id]),
      db.many(`select r.id, r.number, r.amount::float as amount, r.method, r.created_at, u.name as staff_name from sales_returns r left join staff_users u on u.id = r.staff_id where r.order_id = $1 order by r.created_at`, [id]),
    ]);
    const memberIds = [...new Set(items.filter((i) => i.kind === 'thobe').map((i) => i.snapshot.member?.id).filter(Boolean))];
    const measurements = memberIds.length
      ? await db.many(
          `select distinct on (m.member_id) m.member_id, m.taken_at, m.tailor_name, ${FIELDS.join(', ')}, m.remarks
             from measurements m where m.member_id = any($1::uuid[]) order by m.member_id, m.taken_at desc`,
          [memberIds],
        )
      : [];
    return {
      ...o,
      items,
      events,
      appointments,
      measurements,
      refunds,
      payments,
      photos,
      returns,
      refunded: round2(refunds.reduce((s, r) => s + r.amount, 0)),
      balance: o.stage === 'cancelled' ? 0 : round2(Math.max(0, Number(o.total) - o.paid)),
      stages: stagesFor(items),
    };
  }

  @Post('orders/:id/stage')
  @UseGuards(Workshop)
  async stage(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() body: { stage: Stage }) {
    if (!STAGES.includes(body?.stage)) fail('invalid_stage');
    const r = await db.tx(async (c) => {
      const out = await setStage(id, body.stage, c, me.id);
      await audit(me, 'stage', 'order', id, { stage: body.stage }, c);
      return out;
    });
    return r;
  }

  @Post('orders/:id/cancel')
  @UseGuards(ReturnsGuard)
  async cancel(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() body: { reason?: string }) {
    return db.tx(async (c) => {
      const o = await db.one('select * from orders where id = $1 for update', [id], c);
      if (!o) throw new NotFoundException({ code: 'not_found' });
      if (['delivered', 'cancelled', 'out_for_delivery'].includes(o.stage)) fail('cannot_cancel', { stage: o.stage });
      await c.query(`update orders set stage = 'cancelled' where id = $1`, [id]);
      await c.query(`insert into order_events (order_id, stage, note, staff_id) values ($1, 'cancelled', $2, $3)`, [id, body?.reason ?? null, me.id]);
      await c.query(`update appointments set status = 'cancelled' where order_id = $1 and status in ('held','confirmed')`, [id]);
      await returnStockForOrder(id, c, me.id);
      const { paid } = await orderBalance(id, c);
      // Points spent on the order go back to the customer.
      if (o.paid_at && o.points_used > 0) await returnPoints(o.customer_id, o.points_used, id, `Returned: Order #${o.number}`, c);
      if (o.customer_id) await notify(
        o.customer_id,
        'order',
        {
          en: { title: 'Order cancelled', body: `#${o.number} was cancelled. Any payment will be refunded to your card.` },
          ar: { title: 'تم إلغاء الطلب', body: `تم إلغاء الطلب #${o.number}. سيُعاد أي مبلغ مدفوع إلى بطاقتك.` },
        },
        `/orders/${id}`,
        c,
      );
      await audit(me, 'cancel', 'order', id, { reason: body?.reason ?? null, refund_due: paid }, c);
      return { ok: true, refundDue: paid };
    });
  }

  /** Records a refund already made in SADAD. Payment is not sent back from here. */
  @Post('orders/:id/refunds')
  @UseGuards(ReturnsGuard)
  async refund(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() body: { amount?: number; reference?: string; note?: string; method?: string }) {
    return db.tx(async (c) => {
      const o = await db.one('select id, number, customer_id, total::float as total, paid_at from orders where id = $1 for update', [id], c);
      if (!o) throw new NotFoundException({ code: 'not_found' });
      if (!o.paid_at) fail('not_paid');
      const method = body?.method ?? 'sadad';
      if (!['sadad', 'cash', 'card', 'bank_transfer'].includes(method)) fail('invalid_payment');
      // Cash comes out of the drawer, so it needs the staff member's open register.
      const register = method === 'cash' ? await requireRegister(me, c) : await openRegister(me.id, c);
      const { paid } = await orderBalance(id, c);
      const done = await db.one<{ sum: number }>('select coalesce(sum(amount),0)::float as sum from refunds where order_id = $1', [id], c);
      const left = round2(paid - done!.sum);
      const amount = round2(Number(body?.amount));
      if (!(amount > 0)) fail('invalid_number', { field: 'amount' });
      if (amount > left) fail('refund_too_large', { left });
      const reference = body?.reference ? String(body.reference).trim().slice(0, 80) : null;
      await c.query('insert into refunds (order_id, amount, reference, note, staff_id, method, register_id) values ($1,$2,$3,$4,$5,$6,$7)', [id, amount, reference, body?.note ? String(body.note).slice(0, 300) : null, me.id, method, register?.id ?? null]);
      if (o.customer_id) await notify(
        o.customer_id,
        'order',
        {
          en: method === 'cash'
            ? { title: 'Refund given', body: `#${o.number} · QAR ${amount.toFixed(2)} was refunded in cash.` }
            : { title: 'Refund on its way', body: `#${o.number} · QAR ${amount.toFixed(2)} is being returned to your card. Banks can take a few working days.` },
          ar: method === 'cash'
            ? { title: 'تم رد المبلغ', body: `#${o.number} · تم رد ${amount.toFixed(2)} ر.ق نقدًا.` }
            : { title: 'تم إصدار الاسترداد', body: `#${o.number} · يُعاد مبلغ ${amount.toFixed(2)} ر.ق إلى بطاقتك. قد يستغرق البنك بضعة أيام عمل.` },
        },
        `/orders/${id}`,
        c,
      );
      await audit(me, 'refund', 'order', id, { amount, reference, method }, c);
      return { ok: true, refunded: round2(done!.sum + amount), left: round2(left - amount) };
    });
  }

  /* ---------- exports ---------- */

  @Get('export/orders.csv')
  @UseGuards(ReportsGuard)
  async exportOrders(@CurrentStaff() me: StaffUser, @Query('from') from: string | undefined, @Query('to') to: string | undefined, @Res() res: Response) {
    const range = dateRange(from, to);
    const rows = await db.many(
      `select o.number, o.created_at, o.paid_at, o.stage, coalesce(c.name, o.walk_in_name) as name, coalesce(c.phone, o.walk_in_phone) as phone, o.subtotal, o.delivery_fee, o.home_visit_fee, o.discount, o.discount_label, o.total, o.channel,
              coalesce((select sum(amount) from payments p where p.order_id = o.id and p.status = 'paid'), 0) as paid,
              coalesce((select sum(amount) from refunds r where r.order_id = o.id), 0) as refunded,
              (select coalesce(sum(qty),0) from order_items i where i.order_id = o.id and i.kind = 'thobe') as thobes,
              (select coalesce(sum(qty),0) from order_items i where i.order_id = o.id and i.kind = 'product') as products,
              o.address->>'area' as area, o.expected_delivery
         from orders o left join customers c on c.id = o.customer_id
        where o.paid_at is not null and (o.paid_at at time zone 'Asia/Qatar')::date between $1::date and $2::date
        order by o.paid_at`,
      [range.from, range.to],
    );
    await audit(me, 'export', 'orders', null, range);
    sendCsv(res, `alrmh-orders-${range.from}-to-${range.to}.csv`, toCsv(
      ['Order', 'Placed', 'Paid', 'Stage', 'Customer', 'Mobile', 'Subtotal', 'Delivery', 'Home visit', 'Discount', 'Discount code', 'Total', 'Refunded', 'Thobes', 'Products', 'Area', 'Due', 'Channel', 'Amount paid'],
      rows.map((r) => [r.number, r.created_at, r.paid_at, r.stage, r.name, r.phone, r.subtotal, r.delivery_fee, r.home_visit_fee, r.discount, r.discount_label?.split(':')[1] ?? '', r.total, r.refunded, r.thobes, r.products, r.area, r.expected_delivery, r.channel, r.paid]),
    ));
  }

  @Get('export/customers.csv')
  @UseGuards(ReportsGuard)
  async exportCustomers(@CurrentStaff() me: StaffUser, @Res() res: Response) {
    const rows = await db.many(
      `select c.name, c.phone, c.email, c.language, c.created_at,
              (select count(*) from orders o where o.customer_id = c.id and o.paid_at is not null) as orders,
              (select coalesce(sum(total),0) from orders o where o.customer_id = c.id and o.paid_at is not null and o.stage <> 'cancelled') as spent,
              (select coalesce(sum(points),0) from points_ledger p where p.customer_id = c.id) as points,
              (select max(paid_at) from orders o where o.customer_id = c.id) as last_order
         from customers c where c.deleted_at is null order by c.created_at`,
    );
    await audit(me, 'export', 'customers', null, { rows: rows.length });
    sendCsv(res, `alrmh-customers-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
      ['Name', 'Mobile', 'Email', 'Language', 'Joined', 'Paid orders', 'Spent', 'Points', 'Last order'],
      rows.map((r) => [r.name, r.phone, r.email, r.language, r.created_at, r.orders, r.spent, r.points, r.last_order]),
    ));
  }

  /* ---------- appointments ---------- */

  @Get('appointments')
  @UseGuards(AnyStaff)
  appointments(@Query('from') from?: string, @Query('days') days?: string, @Query('kind') kind?: string) {
    const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
    return db.many(
      `select a.id, a.kind, a.branch_id, a.starts_at, a.status, a.order_id, a.fee::float as fee, a.fee_paid_at, o.number as order_number, a.member_id, f.name as member_name, f.relation, f.size,
              c.id as customer_id, c.name as customer_name, c.phone, ad.line1, ad.area, ad.notes as address_notes, b.name_en as branch_name,
              exists (select 1 from measurements m where m.member_id = a.member_id and m.taken_at >= a.created_at) as measured
         from appointments a join family_members f on f.id = a.member_id join customers c on c.id = a.customer_id
         left join orders o on o.id = a.order_id left join addresses ad on ad.id = a.address_id left join branches b on b.id = a.branch_id
        where a.status in ('confirmed','done')
          and (a.starts_at at time zone 'Asia/Qatar')::date >= coalesce($1::date, (now() at time zone 'Asia/Qatar')::date)
          and (a.starts_at at time zone 'Asia/Qatar')::date < coalesce($1::date, (now() at time zone 'Asia/Qatar')::date) + $2::int
          and ($3::text is null or a.kind = $3)
        order by a.starts_at`,
      [start, Math.min(Number(days ?? 7), 31), kind || null],
    );
  }

  @Post('appointments/:id/status')
  @UseGuards(Workshop)
  async apptStatus(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() body: { status: 'done' | 'cancelled' | 'confirmed' }) {
    if (!['done', 'cancelled', 'confirmed'].includes(body?.status)) fail('invalid_status');
    const a = await db.tx(async (c) => {
      const cur = await db.one('select id, kind, branch_id, starts_at, status from appointments where id = $1 for update', [id], c);
      if (!cur) throw new NotFoundException({ code: 'not_found' });
      // Bringing a visit back takes its place again, so the time must still have room.
      if (body.status === 'confirmed' && cur.status !== 'confirmed') {
        const startsAt = new Date(cur.starts_at);
        await c.query('select pg_advisory_xact_lock(hashtext($1))', [slotLockKey(cur.kind, cur.branch_id, startsAt)]);
        await assertSlotFree(cur.kind, cur.branch_id, startsAt, c, id);
      }
      return db.one('update appointments set status = $2 where id = $1 returning id, customer_id, kind, starts_at', [id, body.status], c);
    });
    if (body.status === 'cancelled')
      await notify(
        a.customer_id,
        'appointment',
        {
          en: { title: 'Appointment cancelled', body: 'Your measurement visit was cancelled. Book a new time in the app or message us.' },
          ar: { title: 'تم إلغاء الموعد', body: 'تم إلغاء موعد المقاسات. احجز وقتاً جديداً من التطبيق أو راسلنا.' },
        },
        '/orders',
      );
    await audit(me, 'status', 'appointment', id, { status: body.status });
    return { ok: true };
  }

  /** The home-visit fee for a visit booked on its own is collected at the door. */
  @Post('appointments/:id/fee-paid')
  @UseGuards(Workshop)
  async feePaid(@CurrentStaff() me: StaffUser, @Param('id') id: string) {
    const a = await db.one('update appointments set fee_paid_at = now() where id = $1 and fee > 0 and fee_paid_at is null returning id, fee::float as fee', [id]);
    if (!a) fail('no_fee_due');
    await audit(me, 'fee_paid', 'appointment', id, { fee: a.fee });
    return { ok: true };
  }

  /* ---------- customers ---------- */

  @Get('customers')
  @UseGuards(AnyStaff)
  customers(@Query('q') q?: string) {
    // Old receipts say "AR-10528": the number is 10528 now.
    const needle = q?.trim() ? `%${q.trim().replace(/\s+/g, '').replace(/^#?ar-?(?=\d)/i, '')}%` : null;
    const text = q?.trim() ? `%${q.trim().replace(/\s+/g, ' ')}%` : null;
    return db.many(
      `select c.id, c.name, c.phone, c.email, c.language, c.created_at, c.source, c.group_id, g.name_en as group_en, g.name_ar as group_ar,
              (select count(*)::int from orders o where o.customer_id = c.id and o.paid_at is not null) as orders,
              (select coalesce(sum(greatest(0, o.total - coalesce((select sum(amount) from payments p where p.order_id = o.id and p.status = 'paid'),0))),0)::float
                 from orders o where o.customer_id = c.id and o.stage not in ('cancelled','pending_payment','payment_failed')) as due,
              (select coalesce(sum(total),0)::float from orders o where o.customer_id = c.id and o.paid_at is not null and o.stage <> 'cancelled') as spent,
              (select coalesce(sum(points),0)::int from points_ledger p where p.customer_id = c.id) as points
         from customers c left join customer_groups g on g.id = c.group_id
        where c.deleted_at is null and ($1::text is null or replace(c.phone,' ','') ilike $1 or c.name ilike $2 or c.email ilike $1)
        order by c.created_at desc limit 200`,
      [needle, text],
    );
  }

  @Get('customers/:id')
  @UseGuards(AnyStaff)
  async customer(@Param('id') id: string) {
    await expirePoints(id);
    const c = await db.one('select id, name, phone, email, language, created_at, source, notes, group_id from customers where id = $1 and deleted_at is null', [id]);
    if (!c) throw new NotFoundException({ code: 'not_found' });
    const [family, addresses, orders, ledger, tier, balance] = await Promise.all([
      db.many(
        `select f.id, f.name, f.relation, f.size,
                (select row_to_json(m) from (select id, taken_at, tailor_name, method, ${FIELDS.join(', ')}, remarks from measurements where member_id = f.id order by taken_at desc limit 1) m) as latest,
                (select count(*)::int from measurements where member_id = f.id) as measurement_count,
                (select oi.snapshot->'thobe' from order_items oi join orders o on o.id = oi.order_id
                  where oi.kind = 'thobe' and oi.snapshot->'member'->>'id' = f.id::text and o.stage <> 'cancelled'
                  order by o.created_at desc limit 1) as last_thobe
           from family_members f where f.customer_id = $1 order by (f.relation = 'self') desc, f.created_at`,
        [id],
      ),
      db.many('select id, label, line1, area, city, notes, is_default from addresses where customer_id = $1 order by is_default desc', [id]),
      db.many(
        `select o.id, o.number, o.stage, o.total, o.created_at, o.channel,
                greatest(0, o.total - coalesce((select sum(amount) from payments p where p.order_id = o.id and p.status = 'paid'),0))::float as balance
           from orders o where o.customer_id = $1 and o.stage not in ('pending_payment','payment_failed') order by o.created_at desc`,
        [id],
      ),
      db.many(
        `select p.id, p.kind, p.points, p.remaining, p.expires_at, p.label, p.created_at, u.name as staff_name
           from points_ledger p left join staff_users u on u.id = p.staff_id where p.customer_id = $1 order by p.created_at desc limit 50`,
        [id],
      ),
      tierStatus(id),
      pointsBalance(id),
    ]);
    return { ...c, family, addresses, orders, ledger, tier, balance };
  }

  /**
   * An order staff place at the visit: the customer chose the type (collar) and
   * cloth (fabric) with the tailor and paid on the card machine. It shows in the
   * customer's app like any other order and earns points for their tier.
   */
  @Post('customers/:id/orders')
  @UseGuards(Workshop)
  async placeOrder(
    @CurrentStaff() me: StaffUser,
    @Param('id') id: string,
    @Body() body: { memberId: string; lines: { collarId: string; cuffId?: string | null; fabricId: string; metres?: number | null; pocket?: boolean; styleNotes?: { collar?: string; cuff?: string; pocket?: string } | null; qty: number; remarks?: string | null }[]; branchId?: string; appointmentId?: string; paidByCard?: boolean },
  ) {
    if (body?.paidByCard !== true) fail('payment_not_confirmed');
    const lines = Array.isArray(body?.lines) ? body.lines : [];
    if (!lines.length || lines.length > 10) fail('invalid_lines');
    return db.tx(async (c) => {
      const cust = await db.one('select id from customers where id = $1 and deleted_at is null', [id], c);
      if (!cust) throw new NotFoundException({ code: 'not_found' });
      const member = await db.one('select id, name, relation, size from family_members where id = $1 and customer_id = $2', [need(body.memberId, 'memberId'), id], c);
      if (!member) fail('member_not_found');
      const s = await getSettings(c);
      const { tier } = await tierStatus(id, c);
      const items: any[] = [];
      for (const l of lines) {
        const qty = Math.trunc(Number(l?.qty));
        if (!(qty >= 1 && qty <= 20)) fail('invalid_qty');
        const th = await thobeOptions(l, c, true);
        items.push({ qty, unit: th.unit, th, remarks: l.remarks ? String(l.remarks).slice(0, 1000) : null });
      }
      // Thobes are always collected from the branch.
      const b = await db.one('select id, name_en, name_ar, address_en, address_ar from branches where active and ($1::uuid is null or id = $1) order by sort limit 1', [body.branchId || null], c);
      if (!b) fail('branch_not_found');
      await assertInStock(await stockNeeds(items.map((i) => ({ kind: 'thobe', qty: i.qty, fabricId: i.th.fabric.id, metres: i.th.metres })), c), b.id, c);
      const address = { pickup: true, branchId: b.id, label: b.name_en, label_ar: b.name_ar, line1: b.address_en, line1_ar: b.address_ar, area: '', city: 'Doha' };
      const deliveryFee = 0;
      const subtotal = round2(items.reduce((a, i) => a + i.unit * i.qty, 0));
      const total = round2(subtotal + deliveryFee);
      const pointsToEarn = items.reduce((a, i) => a + i.qty * tier.points_per_thobe, 0);
      const measured = await db.one('select 1 from measurements where member_id = $1 limit 1', [member.id], c);
      const stage = 'measured';
      const number = String((await db.one<{ n: number }>(`select nextval('order_number_seq')::int as n`, [], c))!.n);
      const expected = addWorkingDays(qatarDateString(new Date()), s.lead_working_days);
      const order = await db.one(
        `insert into orders (number, customer_id, stage, subtotal, delivery_fee, total, address, points_to_earn, expected_delivery, paid_at, placed_by_staff_id, channel, branch_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), $10, 'staff', $11) returning id, number, total`,
        [number, id, stage, subtotal, deliveryFee, total, address, pointsToEarn, expected, me.id, b.id],
        c,
      );
      for (const i of items)
        await c.query('insert into order_items (order_id, kind, snapshot, qty, unit_price, line_total, unit_cost) values ($1,$2,$3,$4,$5,$6,$7)', [
          order!.id,
          'thobe',
          {
            thobe: i.th.snapshot,
            member: { id: member.id, name: member.name, relation: member.relation, size: member.size },
            measureMethod: 'saved',
            remarks: i.remarks,
            points: i.qty * tier.points_per_thobe,
            inStore: true,
          },
          i.qty,
          i.unit,
          round2(i.unit * i.qty),
          i.th.unitCost,
        ]);
      const register = await openRegister(me.id, c);
      await c.query(`insert into payments (order_id, provider, amount, status, provider_ref, completed_at, staff_id, register_id) values ($1, 'card_machine', $2, 'paid', $3, now(), $4, $5)`, [
        order!.id,
        total,
        `CARD-${me.id.slice(0, 8)}`,
        me.id,
        register?.id ?? null,
      ]);
      await takeStockForOrder(order!.id, c, me.id);
      await c.query(`insert into order_events (order_id, stage, note, staff_id) values ($1, 'measured', $2, $3)`, [order!.id, measured ? 'saved' : null, me.id]);
      if (body.appointmentId)
        await c.query(`update appointments set order_id = $2, status = 'done' where id = $1 and customer_id = $3 and status in ('confirmed','done')`, [body.appointmentId, order!.id, id]);
      await notify(
        id,
        'order',
        {
          en: { title: 'Order placed', body: `Order #${order!.number} is confirmed. We'll notify you at each stage.` },
          ar: { title: 'تم استلام طلبك', body: `تم تأكيد الطلب رقم #${order!.number}. سنبلغك في كل مرحلة.` },
        },
        `/orders/${order!.id}`,
        c,
      );
      await audit(me, 'place_order', 'order', order!.id, { customer: id, total, lines: items.map((i) => ({ collar: i.th.collar.id, cuff: i.th.cuff?.id ?? null, fabric: i.th.fabric.id, metres: i.th.metres, pocket: i.th.pocket, qty: i.qty })) }, c);
      return { orderId: order!.id, number: order!.number, total: order!.total, pointsToEarn };
    });
  }

  @Post('customers/:id/points')
  @UseGuards(Managers)
  async adjustPoints(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() body: { points: number; reason: string }) {
    const points = Math.trunc(Number(body?.points));
    if (!points || Math.abs(points) > 100000) fail('invalid_points');
    const reason = String(need(body.reason, 'reason')).trim().slice(0, 120);
    const s = await getSettings();
    await db.tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`points:${id}`]);
      if (points > 0) {
        await c.query(
          `insert into points_ledger (customer_id, kind, points, remaining, expires_at, label, staff_id)
           values ($1, 'earn', $2, $2, ${addMonthsSql('now()', '$3')}, $4, $5)`,
          [id, points, s.points.expiry_months, `Adjustment: ${reason}`, me.id],
        );
      } else {
        await expirePoints(id, c);
        if ((await pointsBalance(id, c)) < -points) fail('not_enough_points');
        await spendPoints(id, -points, c);
        await c.query(`insert into points_ledger (customer_id, kind, points, label, staff_id) values ($1, 'adjust', $2, $3, $4)`, [id, points, `Adjustment: ${reason}`, me.id]);
      }
      await audit(me, 'adjust_points', 'customer', id, { points, reason }, c);
    });
    return { balance: await pointsBalance(id) };
  }

  /* ---------- measurements ---------- */

  @Get('members/:id/measurements')
  @UseGuards(AnyStaff)
  memberMeasurements(@Param('id') id: string) {
    return db.many(
      `select m.id, m.taken_at, m.method, m.tailor_name, ${FIELDS.map((f) => 'm.' + f).join(', ')}, m.remarks, b.name_en as branch_name
         from measurements m left join branches b on b.id = m.branch_id where m.member_id = $1 order by m.taken_at desc`,
      [id],
    );
  }

  @Post('members/:id/measurements')
  @UseGuards(Measurers)
  async measure(@CurrentStaff() me: StaffUser, @Param('id') memberId: string, @Body() body: Record<string, any>) {
    const member = await db.one('select id, customer_id, name from family_members where id = $1', [memberId]);
    if (!member) throw new NotFoundException({ code: 'member_not_found' });
    const values = measurementValues(body);
    const tailor = String(body.tailorName ?? me.name).trim() || me.name;
    const m = await db.one(
      `insert into measurements (member_id, method, branch_id, tailor_name, ${FIELDS.join(', ')}, remarks, staff_id)
       values ($1,$2,$3,$4,${FIELDS.map((_, i) => `$${i + 5}`).join(',')},$12,$13) returning id, taken_at`,
      [memberId, body.method === 'home' ? 'home' : 'branch', body.branchId || me.branch_id || null, tailor, ...values, body.remarks ? String(body.remarks).slice(0, 300) : null, me.id],
    );
    await db.pool.query(
      `update appointments set status = 'done' where member_id = $1 and status = 'confirmed' and (starts_at at time zone 'Asia/Qatar')::date <= (now() at time zone 'Asia/Qatar')::date`,
      [memberId],
    );
    await notify(
      member.customer_id,
      'measurement',
      {
        en: { title: 'Measurements saved', body: `${member.name}'s new measurements are in your account.` },
        ar: { title: 'تم حفظ المقاسات', body: `مقاسات ${member.name} الجديدة متاحة في حسابك.` },
      },
      `/account/member/${memberId}`,
    );
    await audit(me, 'create', 'measurement', m!.id, { member: memberId });
    return m;
  }

  /** Corrects a measurement that was saved wrongly (the date it was taken stays). */
  @Patch('measurements/:id')
  @UseGuards(Measurers)
  async editMeasurement(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() body: Record<string, any>) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException({ code: 'not_found' });
    const cur = await db.one(`select m.*, f.customer_id from measurements m join family_members f on f.id = m.member_id where m.id = $1`, [id]);
    if (!cur) throw new NotFoundException({ code: 'not_found' });
    const values = measurementValues(body);
    const tailor = body.tailorName !== undefined ? String(body.tailorName).trim().slice(0, 80) || cur.tailor_name : cur.tailor_name;
    const remarks = body.remarks !== undefined ? (body.remarks ? String(body.remarks).slice(0, 300) : null) : cur.remarks;
    const m = await db.one(
      `update measurements set ${FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ')}, tailor_name = $9, remarks = $10 where id = $1 returning id, taken_at`,
      [id, ...values, tailor, remarks],
    );
    await audit(me, 'update', 'measurement', id, { member: cur.member_id, before: Object.fromEntries(FIELDS.map((f) => [f, Number(cur[f])])), after: Object.fromEntries(FIELDS.map((f, i) => [f, values[i]])) });
    return m;
  }
}
