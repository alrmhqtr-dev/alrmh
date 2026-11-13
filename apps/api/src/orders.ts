import { NotFoundException } from '@nestjs/common';
import { db, type Queryable } from './db.js';
import { addMonthsSql } from './sql-helpers.js';
import { STAGES, STAGE_TEXT, addWorkingDays, fail, getSettings, notify, qatarDateString, type Stage } from './lib.js';
import { quote, type QuoteInput } from './pricing.js';
import { assertSlotFree, slotLockKey } from './modules/booking.controller.js';

export function stagesFor(items: { kind: string }[]): Stage[] {
  return items.some((i) => i.kind === 'thobe') ? [...STAGES] : ['confirmed', 'ready', 'out_for_delivery', 'delivered'];
}

export async function createOrder(customerId: string, input: QuoteInput) {
  return db.tx(async (c) => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`checkout:${customerId}`]);
    // One open checkout per customer: starting a new one closes any earlier unpaid
    // attempt, so the same voucher, coupon or basket cannot be paid for twice.
    const stale = await db.many<{ order_id: string }>(
      `update payments p set status = 'cancelled', completed_at = now() from orders o
        where o.id = p.order_id and o.customer_id = $1 and p.status = 'pending' returning p.order_id`,
      [customerId],
      c,
    );
    if (stale.length) await c.query(`update orders set stage = 'payment_failed' where id = any($1::uuid[]) and stage = 'pending_payment'`, [stale.map((s) => s.order_id)]);
    const q = await quote(customerId, input, c);
    if (!q.items.length) fail('basket_empty');
    if (!q.address) fail('address_required');
    if (q.coupon?.error) fail(q.coupon.error, q.coupon.min != null ? { min: q.coupon.min } : {});
    // Every measurement visit in the basket must still be bookable.
    const holds = new Map<string, { itemId: string; kind: string; branchId: string | null; startsAt: Date; key: string }>();
    for (const i of q.items as any[]) {
      if (i.kind !== 'thobe' || i.measureMethod === 'saved') continue;
      const apptId: string | undefined = i.appointment?.id;
      if (!apptId) fail('appointment_expired', { itemId: i.id });
      if (holds.has(apptId)) continue;
      const a = await db.one('select id, kind, branch_id, starts_at, status from appointments where id = $1 and customer_id = $2 for update', [apptId, customerId], c);
      if (!a || (a.status !== 'held' && a.status !== 'confirmed')) fail('appointment_expired', { itemId: i.id });
      if (a.status !== 'held') continue;
      const startsAt = new Date(a.starts_at);
      holds.set(apptId, { itemId: i.id, kind: a.kind, branchId: a.branch_id, startsAt, key: slotLockKey(a.kind, a.branch_id, startsAt) });
    }
    // A hold lapses after 30 minutes and someone else may have the time by now,
    // so check each one again before taking payment. Slots are locked in a fixed
    // order so two checkouts can never wait on each other.
    for (const [apptId, h] of [...holds].sort((x, y) => x[1].key.localeCompare(y[1].key))) {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [h.key]);
      try {
        await assertSlotFree(h.kind, h.branchId, h.startsAt, c, apptId);
      } catch {
        fail('appointment_expired', { itemId: h.itemId });
      }
      await c.query('update appointments set created_at = now() where id = $1', [apptId]);
    }
    const number = `AR-${(await db.one<{ n: number }>(`select nextval('order_number_seq')::int as n`, [], c))!.n}`;
    const order = await db.one(
      `insert into orders (number, customer_id, subtotal, delivery_fee, home_visit_fee, discount, discount_label, total, voucher_id, coupon_code, address, points_to_earn)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id, number, total`,
      [
        number,
        customerId,
        q.subtotal,
        q.deliveryFee,
        q.homeVisitFee,
        q.discount,
        q.discountLabel,
        q.total,
        q.appliedVoucher?.id ?? null,
        q.coupon && !q.coupon.error ? q.coupon.code : null,
        q.address,
        q.pointsToEarn,
      ],
      c,
    );
    for (const i of q.items as any[]) {
      const { id: _id, qty, unitPrice, lineTotal, kind, ...rest } = i;
      await c.query('insert into order_items (order_id, kind, snapshot, qty, unit_price, line_total) values ($1,$2,$3,$4,$5,$6)', [
        order!.id,
        kind,
        { ...rest, basketItemId: i.id },
        qty,
        unitPrice,
        lineTotal,
      ]);
    }
    if (q.rewardItem) {
      await c.query(`insert into order_items (order_id, kind, snapshot, qty, unit_price, line_total) values ($1,'reward',$2,1,0,0)`, [
        order!.id,
        { product: q.rewardItem, voucherCode: q.appliedVoucher.code },
      ]);
    }
    const payment = await db.one(`insert into payments (order_id, amount) values ($1,$2) returning id`, [order!.id, q.total], c);
    return { orderId: order!.id, number: order!.number, total: order!.total, paymentId: payment!.id };
  });
}

export async function markPaid(paymentId: string, providerRef: string) {
  return db.tx(async (c) => {
    const p = await db.one('select * from payments where id = $1 for update', [paymentId], c);
    if (!p) throw new NotFoundException({ code: 'payment_not_found' });
    if (p.status === 'paid') return p.order_id as string;
    if (p.status !== 'pending') fail('payment_closed');
    const order = await db.one('select * from orders where id = $1 for update', [p.order_id], c);
    const settings = await getSettings(c);
    await c.query(`update payments set status = 'paid', provider_ref = $2, completed_at = now() where id = $1`, [paymentId, providerRef]);
    const items = await db.many('select kind, snapshot from order_items where order_id = $1', [order.id], c);
    const thobes = items.filter((i) => i.kind === 'thobe');
    const apptIds = thobes.map((t) => t.snapshot.appointment?.id).filter(Boolean);
    if (apptIds.length) await c.query(`update appointments set status = 'confirmed', order_id = $2 where id = any($1::uuid[])`, [apptIds, order.id]);
    const lastAppt = apptIds.length
      ? (await db.one<{ at: Date }>('select max(starts_at) as at from appointments where id = any($1::uuid[])', [apptIds], c))!.at
      : new Date();
    const expected = addWorkingDays(qatarDateString(new Date(Math.max(Date.now(), new Date(lastAppt).getTime()))), settings.lead_working_days);
    const allSaved = thobes.length > 0 && thobes.every((t) => t.snapshot.measureMethod === 'saved');
    await c.query(`update orders set stage = $2, paid_at = now(), expected_delivery = $3 where id = $1`, [order.id, allSaved ? 'measured' : 'confirmed', expected]);
    await c.query(`insert into order_events (order_id, stage) values ($1, 'confirmed')`, [order.id]);
    if (allSaved) await c.query(`insert into order_events (order_id, stage, note) values ($1, 'measured', 'saved')`, [order.id]);
    if (order.voucher_id) await c.query(`update vouchers set status = 'used', used_order_id = $2 where id = $1`, [order.voucher_id, order.id]);
    const basketIds = items.map((i) => i.snapshot.basketItemId).filter(Boolean);
    await c.query('delete from basket_items where id = any($1::uuid[])', [basketIds]);
    await notify(
      order.customer_id,
      'order',
      {
        en: { title: 'Order placed', body: `Order #${order.number} is confirmed. We'll notify you at each stage.` },
        ar: { title: 'تم استلام طلبك', body: `تم تأكيد الطلب رقم #${order.number}. سنبلغك في كل مرحلة.` },
      },
      `/orders/${order.id}`,
      c,
    );
    return order.id as string;
  });
}

export async function closePayment(paymentId: string, status: 'failed' | 'cancelled') {
  const p = await db.one(`update payments set status = $2, completed_at = now() where id = $1 and status = 'pending' returning order_id`, [paymentId, status]);
  if (p) await db.pool.query(`update orders set stage = 'payment_failed' where id = $1 and stage = 'pending_payment'`, [p.order_id]);
  return p?.order_id as string | undefined;
}

export async function setStage(orderId: string, stage: Stage, client?: Queryable, staffId: string | null = null) {
  const run = async (c: Queryable) => {
    // Locked, so two staff pressing the same button cannot both move the order (and both award the points).
    const order = await db.one('select * from orders where id = $1 for update', [orderId], c);
    if (!order) throw new NotFoundException({ code: 'order_not_found' });
    const items = await db.many('select kind from order_items where order_id = $1', [orderId], c);
    const flow = stagesFor(items);
    const from = flow.indexOf(order.stage);
    const to = flow.indexOf(stage);
    if (to < 0) fail('invalid_stage');
    if (from < 0 || to <= from) fail('stage_not_forward', { current: order.stage });
    for (const s of flow.slice(from + 1, to + 1)) await c.query('insert into order_events (order_id, stage, staff_id) values ($1, $2, $3)', [orderId, s, staffId]);
    await c.query('update orders set stage = $2 where id = $1', [orderId, stage]);
    await notify(order.customer_id, 'order', withNumber(STAGE_TEXT[stage], order.number), `/orders/${orderId}`, c);
    if (stage === 'delivered' && !order.points_awarded && order.points_to_earn > 0) {
      const s = await getSettings(c);
      await c.query(
        `insert into points_ledger (customer_id, kind, points, remaining, expires_at, order_id, label)
         values ($1, 'earn', $2, $2, ${addMonthsSql('now()', '$3')}, $4, $5)`,
        [order.customer_id, order.points_to_earn, s.points.expiry_months, orderId, `Order #${order.number}`],
      );
      await c.query('update orders set points_awarded = true where id = $1', [orderId]);
      await c.query(`update appointments set status = 'done' where order_id = $1`, [orderId]);
      await notify(
        order.customer_id,
        'points',
        {
          en: { title: `You earned ${order.points_to_earn} points`, body: `Order #${order.number} delivered. Points expire in ${s.points.expiry_months} months.` },
          ar: { title: `ربحت ${order.points_to_earn} نقطة`, body: `تم توصيل الطلب #${order.number}. تنتهي صلاحية النقاط بعد ${s.points.expiry_months} شهرًا.` },
        },
        '/rewards',
        c,
      );
    }
    return { ok: true, stage };
  };
  return client ? run(client) : db.tx(run);
}

function withNumber(t: (typeof STAGE_TEXT)[Stage], number: string) {
  return {
    en: { title: t.en.title, body: `#${number} · ${t.en.body}` },
    ar: { title: t.ar.title, body: `#${number} · ${t.ar.body}` },
  };
}
