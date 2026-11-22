import { Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { fail, getSettings, need, notify, round2, spendPoints } from '../lib.js';
import {
  PAY_METHODS,
  assertInStock,
  awardPoints,
  moveStock,
  nextNumber,
  openRegister,
  orderBalance,
  priceSale,
  providerFor,
  redeemPoints,
  registerTotals,
  requireRegister,
  settlePayments,
  stockNeeds,
  takeStockForOrder,
  type PayMethod,
  type PaymentInput,
  type SaleInput,
} from '../pos.js';
import { AnyStaff, CurrentStaff, ReportsGuard, ReturnsGuard, Sellers, Workshop, audit, hasPerm, staffGuard, type StaffUser } from '../staff.js';
import { MEDIA_PATH } from './media.controller.js';

/** Qatar dates like 2026-11-01; default is the last 30 days. */
export function range(from?: string, to?: string, days = 30) {
  const ok = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null);
  const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(today) - (days - 1) * 864e5).toISOString().slice(0, 10);
  const r = { from: ok(from) ?? start, to: ok(to) ?? today };
  if (r.from > r.to) fail('invalid_date', { field: 'from' });
  return r;
}
export const uuidOrNull = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

const SALE_ROW = `
  o.id, o.number, o.channel, o.stage, o.created_at, o.paid_at, o.total::float as total, o.subtotal::float as subtotal, o.discount::float as discount,
  o.tax::float as tax, o.points_used, o.expected_delivery, o.branch_id, b.name_en as branch_en, b.name_ar as branch_ar,
  o.customer_id, coalesce(c.name, o.walk_in_name) as customer_name, coalesce(c.phone, o.walk_in_phone) as phone,
  u.name as staff_name,
  coalesce((select sum(amount) from payments p where p.order_id = o.id and p.status = 'paid'),0)::float as paid,
  coalesce((select sum(amount) from refunds r where r.order_id = o.id),0)::float as refunded,
  (select string_agg(distinct p.provider, ',') from payments p where p.order_id = o.id and p.status = 'paid') as methods,
  (select coalesce(sum(qty),0)::int from order_items i where i.order_id = o.id and i.kind = 'thobe') as thobe_count,
  (select coalesce(sum(qty),0)::int from order_items i where i.order_id = o.id) as item_count`;
const SALE_FROM = `orders o left join customers c on c.id = o.customer_id left join branches b on b.id = o.branch_id
  left join staff_users u on u.id = o.placed_by_staff_id`;

@Controller('v1/admin')
export class PosController {
  /* ---------- what the counter screen needs ---------- */

  @Get('pos/items')
  @UseGuards(AnyStaff)
  async items(@CurrentStaff() me: StaffUser, @Query('branch') branch?: string) {
    const branchId = uuidOrNull(branch) ?? me.branch_id ?? (await db.one('select id from branches where active order by sort limit 1'))?.id ?? null;
    const [products, fabrics, collars, cuffs, categories, branches, stock] = await Promise.all([
      db.many(
        `select p.id, p.sku, p.category, p.brand_id, p.name_en, p.name_ar, p.price::float as price, p.sizes, p.image_url, p.track_stock, p.alert_qty::float as alert_qty, u.short_name as unit
           from products p left join units u on u.id = p.unit_id where p.active order by p.category, p.sort, p.name_en`,
      ),
      db.many('select id, sku, name_en, name_ar, price::float as price, track_stock, metres_per_thobe::float as metres_per_thobe from fabrics where active order by sort'),
      db.many('select id, name_en, name_ar, shape, image_url from collars where active order by sort'),
      db.many('select id, name_en, name_ar, image_url from cuffs where active order by sort'),
      db.many('select id, name_en, name_ar from categories where active order by sort, name_en'),
      db.many('select id, name_en, name_ar from branches where active order by sort'),
      db.many(
        `select item_kind, item_id, size, sum(qty)::float as qty from stock_moves where branch_id = $1 group by 1,2,3`,
        [branchId],
      ),
    ]);
    const level = (kind: string, id: string, size = '') => stock.find((s) => s.item_kind === kind && s.item_id === id && s.size === size)?.qty ?? 0;
    return {
      branchId,
      branches,
      categories,
      collars,
      cuffs,
      products: products.map((p) => ({
        ...p,
        stock: p.track_stock ? (p.sizes.length ? Object.fromEntries(p.sizes.map((s: string) => [s, level('product', p.id, s)])) : { '': level('product', p.id) }) : null,
      })),
      fabrics: fabrics.map((f) => ({ ...f, stock: f.track_stock ? level('fabric', f.id) : null })),
      methods: PAY_METHODS,
    };
  }

  /* ---------- cash register ---------- */

  @Get('pos/register')
  @UseGuards(AnyStaff)
  async myRegister(@CurrentStaff() me: StaffUser) {
    const r = await openRegister(me.id);
    if (!r) return { open: false, required: (await getSettings()).pos.require_register };
    const b = await db.one('select name_en, name_ar from branches where id = $1', [r.branch_id]);
    return { open: true, register: { ...r, branch_en: b?.name_en, branch_ar: b?.name_ar }, totals: await registerTotals(r.id) };
  }

  @Post('pos/register/open')
  @UseGuards(Sellers)
  async openReg(@CurrentStaff() me: StaffUser, @Body() b: { branchId?: string; openingCash?: number }) {
    const opening = round2(Number(b?.openingCash ?? 0));
    if (!(opening >= 0 && opening <= 1_000_000)) fail('invalid_number', { field: 'openingCash' });
    const branch = await db.one('select id from branches where id = $1 and active', [uuidOrNull(b?.branchId) ?? me.branch_id]);
    if (!branch) fail('branch_not_found');
    if (await openRegister(me.id)) fail('register_already_open');
    const r = await db.one('insert into cash_registers (branch_id, staff_id, opening_cash) values ($1,$2,$3) returning *', [branch.id, me.id, opening]);
    await audit(me, 'open', 'register', r.id, { opening, branch: branch.id });
    return r;
  }

  @Post('pos/register/cash')
  @UseGuards(Sellers)
  async cashMove(@CurrentStaff() me: StaffUser, @Body() b: { kind?: string; amount?: number; note?: string }) {
    const r = await requireRegister(me);
    if (!['cash_in', 'cash_out'].includes(String(b?.kind))) fail('invalid_kind');
    const amount = round2(Number(b?.amount));
    if (!(amount > 0)) fail('invalid_number', { field: 'amount' });
    if (b.kind === 'cash_out' && amount > (await registerTotals(r.id)).expected_cash) fail('not_enough_cash');
    await db.pool.query('insert into register_moves (register_id, kind, amount, note, staff_id) values ($1,$2,$3,$4,$5)', [r.id, b.kind, amount, b.note ? String(b.note).slice(0, 200) : null, me.id]);
    await audit(me, b.kind!, 'register', r.id, { amount, note: b.note ?? null });
    return registerTotals(r.id);
  }

  @Post('pos/register/close')
  @HttpCode(200)
  @UseGuards(Sellers)
  async closeReg(@CurrentStaff() me: StaffUser, @Body() b: { countedCash?: number; countedCard?: number; note?: string }) {
    const r = await requireRegister(me);
    const counted = round2(Number(b?.countedCash));
    if (!(counted >= 0)) fail('invalid_number', { field: 'countedCash' });
    const card = b?.countedCard === undefined || b?.countedCard === null || (b.countedCard as any) === '' ? null : round2(Number(b.countedCard));
    const t = await registerTotals(r.id);
    await db.pool.query('update cash_registers set closed_at = now(), expected_cash = $2, counted_cash = $3, counted_card = $4, note = $5, closed_by = $6 where id = $1', [
      r.id,
      t.expected_cash,
      counted,
      card,
      b?.note ? String(b.note).slice(0, 300) : null,
      me.id,
    ]);
    await audit(me, 'close', 'register', r.id, { expected: t.expected_cash, counted, difference: round2(counted - t.expected_cash) });
    return { ...t, counted_cash: counted, counted_card: card, difference: round2(counted - t.expected_cash), id: r.id };
  }

  @Get('registers')
  @UseGuards(AnyStaff)
  async registers(@CurrentStaff() me: StaffUser, @Query('from') from?: string, @Query('to') to?: string, @Query('branch') branch?: string) {
    const rg = range(from, to);
    // Without reports access, staff see only their own registers.
    const mine = hasPerm(me, 'reports') ? null : me.id;
    const rows = await db.many(
      `select r.*, u.name as staff_name, b.name_en as branch_en, b.name_ar as branch_ar, cu.name as closed_by_name
         from cash_registers r join staff_users u on u.id = r.staff_id join branches b on b.id = r.branch_id left join staff_users cu on cu.id = r.closed_by
        where (r.opened_at at time zone 'Asia/Qatar')::date between $1::date and $2::date
          and ($3::uuid is null or r.branch_id = $3) and ($4::uuid is null or r.staff_id = $4)
        order by r.opened_at desc limit 300`,
      [rg.from, rg.to, uuidOrNull(branch), mine],
    );
    const out = [];
    for (const r of rows) out.push({ ...r, totals: await registerTotals(r.id) });
    return out;
  }

  /* ---------- counter sales ---------- */

  @Post('pos/quote')
  @HttpCode(200)
  @UseGuards(Sellers)
  async quote(@CurrentStaff() me: StaffUser, @Body() body: SaleInput) {
    const q = await priceSale(body ?? ({} as SaleInput), me);
    const needs = await stockNeeds(
      q.lines.map((l) => ({ kind: l.kind, qty: l.qty, productId: l.product?.id, size: l.size, fabricId: l.thobe?.fabric?.id, metres: l.thobe?.metres ?? null })),
      db.pool,
    );
    let stockError: any = null;
    try {
      await assertInStock(needs, q.branch.id, db.pool);
    } catch (e: any) {
      stockError = e?.response ?? { code: 'out_of_stock' };
    }
    return { ...q, stockError };
  }

  @Post('pos/sales')
  @UseGuards(Sellers)
  async sell(@CurrentStaff() me: StaffUser, @Body() body: { sale: SaleInput; payments: PaymentInput[]; draftId?: string }) {
    const settings = await getSettings();
    const result = await db.tx(async (c) => {
      const register = settings.pos.require_register ? await requireRegister(me, c) : await openRegister(me.id, c);
      const q = await priceSale(body?.sale ?? ({} as SaleInput), me, c);
      if (!q.lines.length) fail('basket_empty');
      // Without an account the sale must be paid in full; customers can leave a deposit or pay later.
      const settle = settlePayments(q.total, body?.payments ?? [], Boolean(q.customer));
      if (q.customer && settle.balance > 0 && settings.pos.min_deposit_percent > 0 && settle.paid < round2((q.total * settings.pos.min_deposit_percent) / 100))
        fail('deposit_too_small', { min: round2((q.total * settings.pos.min_deposit_percent) / 100) });
      const needs = await stockNeeds(
        q.lines.map((l) => ({ kind: l.kind, qty: l.qty, productId: l.product?.id, size: l.size, fabricId: l.thobe?.fabric?.id, metres: l.thobe?.metres ?? null })),
        c,
      );
      for (const n of needs) await c.query('select pg_advisory_xact_lock(hashtext($1))', [`stock:${n.kind}:${n.id}:${n.size}:${q.branch.id}`]);
      await assertInStock(needs, q.branch.id, c);

      const number = await nextNumber('order_number_seq', '', c);
      const delivery = Boolean(body.sale.deliveryAddressId);
      // Thobes start at Taking measurements; shop items are handed over (or delivered).
      const stage = q.hasThobes ? 'measured' : delivery ? 'confirmed' : 'delivered';
      const order = await db.one(
        `insert into orders (number, customer_id, stage, subtotal, delivery_fee, discount, discount_label, total, address, points_to_earn, points_used,
                             expected_delivery, paid_at, placed_by_staff_id, channel, branch_id, walk_in_name, walk_in_phone,
                             tax, notes, register_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pos',$15,$16,$17,$18,$19,$20) returning id, number, receipt_token`,
        [
          number,
          q.customer?.id ?? null,
          stage,
          q.subtotal,
          q.deliveryFee,
          q.orderDiscount,
          q.orderDiscount ? 'manual' : null,
          q.total,
          q.address,
          q.customer ? q.pointsToEarn : 0,
          q.pointsUsed,
          q.expectedDelivery,
          settle.paid > 0 || q.total === 0 ? new Date() : null,
          me.id,
          q.branch.id,
          q.customer ? null : body.sale.walkInName ? String(body.sale.walkInName).trim().slice(0, 80) : null,
          q.customer ? null : body.sale.walkInPhone ? String(body.sale.walkInPhone).trim().slice(0, 20) : null,
          q.tax,
          body.sale.notes ? String(body.sale.notes).slice(0, 2000) : null,
          register?.id ?? null,
        ],
        c,
      );
      for (const l of q.lines) {
        const snapshot =
          l.kind === 'product'
            ? { product: l.product, size: l.size, points: l.points, discountLabel: l.discountLabel, listPrice: l.listPrice, inStore: true }
            : { thobe: l.thobe, member: l.member, measureMethod: 'saved', remarks: l.remarks, points: l.points, discountLabel: l.discountLabel, listPrice: l.listPrice, inStore: true };
        await c.query(
          'insert into order_items (order_id, kind, snapshot, qty, unit_price, line_total, discount, unit_cost, tax) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [order.id, l.kind, snapshot, l.qty, l.unitPrice, l.lineTotal, l.discount, l.unitCost, (l.lineTotal * l.taxPercent) / (100 + l.taxPercent) || 0],
        );
      }
      for (const p of settle.payments)
        await c.query(
          `insert into payments (order_id, provider, amount, status, provider_ref, completed_at, register_id, staff_id) values ($1,$2,$3,'paid',$4,now(),$5,$6)`,
          [order.id, providerFor(p.method), p.amount, p.reference, register?.id ?? null, me.id],
        );
      if (q.hasThobes) await c.query(`insert into order_events (order_id, stage, staff_id, note) values ($1,'measured',$2,'saved')`, [order.id, me.id]);
      else {
        await c.query(`insert into order_events (order_id, stage, staff_id) values ($1,'confirmed',$2)`, [order.id, me.id]);
        if (!delivery) await c.query(`insert into order_events (order_id, stage, staff_id, note) values ($1,'delivered',$2,'counter')`, [order.id, me.id]);
      }
      for (const n of needs) await moveStock(c, { branchId: q.branch.id, kind: n.kind, id: n.id, size: n.size, qty: -n.qty, reason: 'sale', refType: 'order', refId: order.id, staffId: me.id });
      if (q.customer && q.pointsUsed > 0) await redeemPoints(q.customer.id, q.pointsUsed, order.id, number, c);
      if (q.customer) {
        await notify(
          q.customer.id,
          'order',
          q.hasThobes || delivery
            ? {
                en: { title: 'Order placed', body: `Order #${number} is confirmed. We'll notify you at each stage.` },
                ar: { title: 'تم استلام طلبك', body: `تم تأكيد الطلب رقم #${number}. سنبلغك في كل مرحلة.` },
              }
            : {
                en: { title: 'Thank you for your purchase', body: `Invoice #${number} · QAR ${q.total.toFixed(2)}.` },
                ar: { title: 'شكرًا لتسوقك', body: `فاتورة رقم #${number} · ${q.total.toFixed(2)} ر.ق.` },
              },
          `/orders/${order.id}`,
          c,
        );
        // Handed over at the counter: the points are earned now.
        if (stage === 'delivered' && settle.balance === 0) await awardPoints(order.id, c);
      }
      const draftId = uuidOrNull(body.draftId);
      if (draftId) await c.query('update pos_drafts set converted_order_id = $2, updated_at = now() where id = $1 and converted_order_id is null', [draftId, order.id]);
      await audit(me, 'sale', 'order', order.id, { number, total: q.total, paid: settle.paid, lines: q.lines.length, customer: q.customer?.id ?? null }, c);
      return { orderId: order.id, number, total: q.total, paid: settle.paid, balance: settle.balance, change: settle.change, receiptToken: order.receipt_token, pointsToEarn: q.customer ? q.pointsToEarn : 0 };
    });
    return result;
  }

  /** A later payment on an order: the balance at pickup, or a credit sale settled. */
  @Post('orders/:id/payments')
  @UseGuards(Sellers)
  async pay(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: { method?: PayMethod; amount?: number; reference?: string }) {
    const settings = await getSettings();
    return db.tx(async (c) => {
      const o = await db.one('select * from orders where id = $1 for update', [id], c);
      if (!o) throw new NotFoundException({ code: 'not_found' });
      if (['cancelled', 'pending_payment', 'payment_failed'].includes(o.stage)) fail('cannot_pay');
      const register = settings.pos.require_register ? await requireRegister(me, c) : await openRegister(me.id, c);
      if (!PAY_METHODS.includes(b?.method as PayMethod)) fail('invalid_payment');
      const { balance } = await orderBalance(id, c);
      const amount = round2(Number(b?.amount));
      if (!(amount > 0)) fail('invalid_number', { field: 'amount' });
      if (amount > balance) fail('more_than_due', { due: balance });
      await c.query(`insert into payments (order_id, provider, amount, status, provider_ref, completed_at, register_id, staff_id) values ($1,$2,$3,'paid',$4,now(),$5,$6)`, [
        id,
        providerFor(b.method!),
        amount,
        b.reference ? String(b.reference).slice(0, 80) : null,
        register?.id ?? null,
        me.id,
      ]);
      if (!o.paid_at) await c.query('update orders set paid_at = now() where id = $1', [id]);
      const after = round2(balance - amount);
      // A counter sale on credit earns its points once it is paid in full.
      if (after === 0 && o.stage === 'delivered') await awardPoints(id, c);
      await audit(me, 'payment', 'order', id, { amount, method: b.method }, c);
      return { ok: true, paid: amount, balance: after };
    });
  }

  @Get('sales')
  @UseGuards(AnyStaff)
  async sales(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branch') branch?: string,
    @Query('channel') channel?: string,
    @Query('payment') payment?: string,
    @Query('kind') kind?: string,
    @Query('q') q?: string,
  ) {
    const rg = range(from, to);
    const needle = q?.trim() ? `%${q.trim().replace(/\s+/g, '')}%` : null;
    const words = q?.trim() ? `%${q.trim().replace(/\s+/g, ' ')}%` : null;
    const rows = await db.many(
      `select ${SALE_ROW} from ${SALE_FROM}
        where o.stage not in ('pending_payment','payment_failed')
          and (o.created_at at time zone 'Asia/Qatar')::date between $1::date and $2::date
          and ($3::uuid is null or o.branch_id = $3)
          and ($4::text is null or o.channel = $4)
          and ($5::text is null or o.number ilike $5 or replace(coalesce(c.phone, o.walk_in_phone, ''),' ','') ilike $5 or coalesce(c.name, o.walk_in_name, '') ilike $6)
          and ($7::text is null or ($7 = 'thobe') = exists (select 1 from order_items i where i.order_id = o.id and i.kind = 'thobe'))
        order by o.created_at desc limit 500`,
      [rg.from, rg.to, uuidOrNull(branch), channel || null, needle, words, kind === 'thobe' || kind === 'shop' ? kind : null],
    );
    const withBalance = rows.map((r) => ({ ...r, balance: r.stage === 'cancelled' ? 0 : round2(Math.max(0, r.total - r.paid)) }));
    const list = payment === 'due' ? withBalance.filter((r) => r.balance > 0) : payment === 'paid' ? withBalance.filter((r) => r.balance === 0) : withBalance;
    const live = list.filter((r) => r.stage !== 'cancelled');
    return {
      range: rg,
      rows: list,
      totals: {
        count: live.length,
        total: round2(live.reduce((a, r) => a + r.total, 0)),
        paid: round2(live.reduce((a, r) => a + r.paid, 0)),
        balance: round2(live.reduce((a, r) => a + r.balance, 0)),
        refunded: round2(list.reduce((a, r) => a + r.refunded, 0)),
      },
    };
  }

  /** Everything a printed receipt, invoice or tailor ticket needs. */
  @Get('orders/:id/receipt')
  @UseGuards(AnyStaff)
  async receipt(@Param('id') id: string) {
    return receiptData(id);
  }

  /* ---------- drafts and quotations ---------- */

  @Get('drafts')
  @UseGuards(AnyStaff)
  drafts(@Query('kind') kind?: string, @Query('open') open?: string) {
    return db.many(
      `select d.id, d.number, d.kind, d.total::float as total, d.notes, d.valid_until, d.created_at, d.updated_at, d.converted_order_id, o.number as order_number,
              coalesce(c.name, d.walk_in_name) as customer_name, coalesce(c.phone, d.walk_in_phone) as phone, u.name as staff_name, b.name_en as branch_en, b.name_ar as branch_ar,
              jsonb_array_length(d.cart->'lines') as line_count
         from pos_drafts d left join customers c on c.id = d.customer_id left join staff_users u on u.id = d.staff_id left join branches b on b.id = d.branch_id
         left join orders o on o.id = d.converted_order_id
        where ($1::text is null or d.kind = $1) and ($2::text is null or d.converted_order_id is null)
        order by d.updated_at desc limit 300`,
      [kind === 'draft' || kind === 'quotation' ? kind : null, open === '1' ? '1' : null],
    );
  }

  @Get('drafts/:id')
  @UseGuards(AnyStaff)
  async draft(@CurrentStaff() me: StaffUser, @Param('id') id: string) {
    const d = await db.one(
      `select d.*, d.total::float as total, coalesce(c.name, d.walk_in_name) as customer_name, coalesce(c.phone, d.walk_in_phone) as phone, u.name as staff_name
         from pos_drafts d left join customers c on c.id = d.customer_id left join staff_users u on u.id = d.staff_id where d.id = $1`,
      [id],
    );
    if (!d) throw new NotFoundException({ code: 'not_found' });
    let priced: any = null;
    try {
      priced = await priceSale(d.cart, { ...me, permissions: ['*'] });
    } catch (e: any) {
      priced = { error: e?.response?.code ?? 'invalid' };
    }
    return { ...d, priced, company: (await getSettings()).company };
  }

  @Post('drafts')
  @UseGuards(Sellers)
  async saveDraft(@CurrentStaff() me: StaffUser, @Body() b: { kind?: string; sale?: SaleInput; validUntil?: string; notes?: string }) {
    if (!['draft', 'quotation'].includes(String(b?.kind))) fail('invalid_kind');
    const q = await priceSale(b.sale ?? ({} as SaleInput), me);
    if (!q.lines.length) fail('basket_empty');
    const number = await nextNumber('draft_number_seq', b.kind === 'quotation' ? 'QT-' : 'DR-', db.pool);
    const r = await db.one(
      `insert into pos_drafts (number, kind, branch_id, customer_id, walk_in_name, walk_in_phone, cart, total, notes, valid_until, staff_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, number`,
      [number, b.kind, q.branch.id, q.customer?.id ?? null, b.sale?.walkInName ?? null, b.sale?.walkInPhone ?? null, { ...b.sale, branchId: q.branch.id }, q.total, b.notes ? String(b.notes).slice(0, 500) : null, validDate(b.validUntil), me.id],
    );
    await audit(me, 'create', b.kind!, r.id, { number, total: q.total });
    return r;
  }

  @Patch('drafts/:id')
  @UseGuards(Sellers)
  async updateDraft(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: { sale?: SaleInput; validUntil?: string; notes?: string }) {
    const d = await db.one('select id, converted_order_id from pos_drafts where id = $1', [id]);
    if (!d) throw new NotFoundException({ code: 'not_found' });
    if (d.converted_order_id) fail('draft_converted');
    if (b.sale) {
      const q = await priceSale(b.sale, me);
      await db.pool.query('update pos_drafts set cart = $2, total = $3, customer_id = $4, walk_in_name = $5, walk_in_phone = $6, branch_id = $7, updated_at = now() where id = $1', [
        id,
        { ...b.sale, branchId: q.branch.id },
        q.total,
        q.customer?.id ?? null,
        b.sale.walkInName ?? null,
        b.sale.walkInPhone ?? null,
        q.branch.id,
      ]);
    }
    if (b.notes !== undefined || b.validUntil !== undefined)
      await db.pool.query('update pos_drafts set notes = coalesce($2, notes), valid_until = coalesce($3, valid_until), updated_at = now() where id = $1', [id, b.notes ?? null, validDate(b.validUntil)]);
    await audit(me, 'update', 'draft', id);
    return { ok: true };
  }

  @Post('drafts/:id/delete')
  @HttpCode(200)
  @UseGuards(Sellers)
  async deleteDraft(@CurrentStaff() me: StaffUser, @Param('id') id: string) {
    const r = await db.pool.query('delete from pos_drafts where id = $1 and converted_order_id is null', [id]);
    if (!r.rowCount) fail('cannot_delete');
    await audit(me, 'delete', 'draft', id);
    return { ok: true };
  }

  /* ---------- sales returns ---------- */

  @Post('orders/:id/returns')
  @UseGuards(ReturnsGuard)
  async createReturn(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: { lines?: { itemId: string; qty: number }[]; method?: string; restock?: boolean; note?: string }) {
    return db.tx(async (c) => {
      const o = await db.one('select * from orders where id = $1 for update', [id], c);
      if (!o) throw new NotFoundException({ code: 'not_found' });
      if (o.stage !== 'delivered') fail('return_not_delivered');
      const method = String(b?.method ?? '');
      if (!['cash', 'card', 'bank_transfer', 'sadad', 'none'].includes(method)) fail('invalid_payment');
      const register = method === 'cash' ? await requireRegister(me, c) : await openRegister(me.id, c);
      const lines = Array.isArray(b?.lines) ? b.lines : [];
      if (!lines.length) fail('invalid_lines');
      const items = await db.many('select * from order_items where order_id = $1', [id], c);
      const grossLines = items.reduce((a, i) => a + Number(i.line_total), 0);
      // The whole-sale discount and points are shared across lines in proportion.
      const ratio = grossLines > 0 ? (Number(o.total) - Number(o.delivery_fee) - Number(o.service_charge)) / grossLines : 0;
      let amount = 0;
      let points = 0;
      const picked: { item: any; qty: number; amount: number }[] = [];
      for (const l of lines) {
        const it = items.find((i) => i.id === l.itemId);
        const qty = Math.trunc(Number(l?.qty));
        if (!it || !(qty >= 1) || qty > it.qty - it.returned_qty) fail('invalid_return_qty');
        const a = round2((Number(it.line_total) / it.qty) * qty * ratio);
        picked.push({ item: it, qty, amount: a });
        amount += a;
        points += Math.round(((it.snapshot.points ?? 0) / it.qty) * qty);
      }
      amount = round2(amount);
      const { paid } = await orderBalance(id, c);
      const refundedBefore = Number((await db.one('select coalesce(sum(amount),0) as s from refunds where order_id = $1', [id], c))!.s);
      const refundable = round2(Math.max(0, paid - refundedBefore));
      const refund = method === 'none' ? 0 : Math.min(amount, refundable);
      const number = await nextNumber('return_number_seq', 'RT-', c);
      // Points earned on what came back are taken off again (never below zero).
      let removed = 0;
      if (o.customer_id && o.points_awarded && points > 0) {
        await c.query('select pg_advisory_xact_lock(hashtext($1))', [`points:${o.customer_id}`]);
        const bal = Number((await db.one('select coalesce(sum(points),0) as s from points_ledger where customer_id = $1', [o.customer_id], c))!.s);
        removed = Math.max(0, Math.min(points, bal));
        if (removed > 0) {
          await spendPoints(o.customer_id, removed, c);
          await c.query(`insert into points_ledger (customer_id, kind, points, order_id, label, staff_id) values ($1,'adjust',$2,$3,$4,$5)`, [o.customer_id, -removed, id, `Return ${number}`, me.id]);
        }
      }
      const r = await db.one(
        `insert into sales_returns (number, order_id, branch_id, amount, method, restock, points_removed, note, register_id, staff_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
        [number, id, o.branch_id, refund, method, b.restock !== false, removed, b.note ? String(b.note).slice(0, 300) : null, register?.id ?? null, me.id],
        c,
      );
      for (const p of picked) {
        await c.query('insert into sales_return_lines (return_id, order_item_id, qty, amount) values ($1,$2,$3,$4)', [r.id, p.item.id, p.qty, p.amount]);
        await c.query('update order_items set returned_qty = returned_qty + $2 where id = $1', [p.item.id, p.qty]);
      }
      if (refund > 0) await c.query('insert into refunds (order_id, amount, reference, note, staff_id, method, return_id, register_id) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, refund, number, b.note ?? null, me.id, method, r.id, register?.id ?? null]);
      if (b.restock !== false) {
        const branchId = o.branch_id ?? (await db.one('select branch_id from stock_moves where ref_type = $1 and ref_id = $2 limit 1', ['order', id], c))?.branch_id;
        if (branchId) {
          const needs = await stockNeeds(
            picked.map((p) => ({ kind: p.item.kind, qty: p.qty, productId: p.item.snapshot.product?.id, size: p.item.snapshot.size, fabricId: undefined })),
            c,
          );
          for (const n of needs) await moveStock(c, { branchId, kind: n.kind, id: n.id, size: n.size, qty: n.qty, reason: 'sale_return', refType: 'return', refId: r.id, staffId: me.id });
        }
      }
      if (o.customer_id && refund > 0)
        await notify(
          o.customer_id,
          'order',
          {
            en: { title: 'Return processed', body: `#${o.number} · QAR ${refund.toFixed(2)} refunded.` },
            ar: { title: 'تمت معالجة الإرجاع', body: `#${o.number} · تم رد ${refund.toFixed(2)} ر.ق.` },
          },
          `/orders/${id}`,
          c,
        );
      await audit(me, 'return', 'order', id, { number, amount: refund, method, lines: picked.map((p) => ({ item: p.item.id, qty: p.qty })) }, c);
      return { id: r.id, number, amount: refund, pointsRemoved: removed };
    });
  }

  @Get('returns')
  @UseGuards(AnyStaff)
  returns(@Query('from') from?: string, @Query('to') to?: string, @Query('branch') branch?: string) {
    const rg = range(from, to);
    return db.many(
      `select r.id, r.number, r.amount::float as amount, r.method, r.restock, r.points_removed, r.note, r.created_at, o.id as order_id, o.number as order_number,
              coalesce(c.name, o.walk_in_name) as customer_name, u.name as staff_name, b.name_en as branch_en, b.name_ar as branch_ar,
              (select sum(qty)::int from sales_return_lines l where l.return_id = r.id) as qty
         from sales_returns r join orders o on o.id = r.order_id left join customers c on c.id = o.customer_id
         left join staff_users u on u.id = r.staff_id left join branches b on b.id = r.branch_id
        where (r.created_at at time zone 'Asia/Qatar')::date between $1::date and $2::date and ($3::uuid is null or r.branch_id = $3)
        order by r.created_at desc`,
      [rg.from, rg.to, uuidOrNull(branch)],
    );
  }

  /* ---------- shipments ---------- */

  @Get('shipments')
  @UseGuards(AnyStaff)
  shipments(@Query('status') status?: string) {
    return db.many(
      `select o.id, o.number, o.stage, o.created_at, o.total::float as total, o.address, o.shipping, o.channel,
              coalesce(c.name, o.walk_in_name) as customer_name, coalesce(c.phone, o.walk_in_phone) as phone,
              (select max(at) from order_events e where e.order_id = o.id and e.stage = o.stage) as stage_at,
              (select coalesce(sum(qty),0)::int from order_items i where i.order_id = o.id) as item_count
         from orders o left join customers c on c.id = o.customer_id
        where coalesce((o.address->>'pickup')::boolean, false) = false
          and o.stage in ('confirmed','ready','out_for_delivery','delivered')
          and not exists (select 1 from order_items i where i.order_id = o.id and i.kind = 'thobe')
          and ($1::text is null or ($1 = 'open' and o.stage <> 'delivered') or o.stage = $1)
        order by o.created_at desc limit 300`,
      [status || null],
    );
  }

  @Patch('orders/:id/shipping')
  @UseGuards(staffGuard('workshop', 'pos'))
  async shipping(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: { courier?: string; tracking?: string; note?: string; driverPhone?: string }) {
    const shipping = {
      courier: b?.courier ? String(b.courier).slice(0, 80) : null,
      tracking: b?.tracking ? String(b.tracking).slice(0, 80) : null,
      driverPhone: b?.driverPhone ? String(b.driverPhone).slice(0, 30) : null,
      note: b?.note ? String(b.note).slice(0, 300) : null,
    };
    const r = await db.pool.query('update orders set shipping = $2 where id = $1', [id, shipping]);
    if (!r.rowCount) throw new NotFoundException({ code: 'not_found' });
    await audit(me, 'shipping', 'order', id, shipping);
    return { ok: true };
  }

  /* ---------- thobe photos ---------- */

  @Get('thobe-photos')
  @UseGuards(AnyStaff)
  photos(@Query('q') q?: string, @Query('order') order?: string) {
    const needle = q?.trim() ? `%${q.trim()}%` : null;
    return db.many(
      `select p.id, p.caption, p.created_at, '/v1/media/' || p.media_id as url, o.id as order_id, o.number, o.stage,
              coalesce(c.name, o.walk_in_name) as customer_name, u.name as staff_name
         from order_photos p join orders o on o.id = p.order_id left join customers c on c.id = o.customer_id left join staff_users u on u.id = p.staff_id
        where ($1::text is null or o.number ilike $1 or coalesce(c.name,'') ilike $1 or coalesce(p.caption,'') ilike $1) and ($2::uuid is null or o.id = $2)
        order by p.created_at desc limit 200`,
      [needle, uuidOrNull(order)],
    );
  }

  @Post('orders/:id/photos')
  @UseGuards(Workshop)
  async addPhoto(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: { url?: string; caption?: string }) {
    const url = String(need(b?.url, 'url'));
    if (!MEDIA_PATH.test(url)) fail('invalid_image');
    const mediaId = url.split('/').pop();
    const o = await db.one('select id from orders where id = $1', [id]);
    if (!o) throw new NotFoundException({ code: 'not_found' });
    const r = await db.one('insert into order_photos (order_id, media_id, caption, staff_id) values ($1,$2,$3,$4) returning id', [id, mediaId, b.caption ? String(b.caption).slice(0, 120) : null, me.id]);
    await audit(me, 'create', 'thobe_photo', r.id, { order: id });
    return r;
  }

  @Post('thobe-photos/:id/delete')
  @HttpCode(200)
  @UseGuards(Workshop)
  async deletePhoto(@CurrentStaff() me: StaffUser, @Param('id') id: string) {
    const r = await db.pool.query('delete from order_photos where id = $1', [id]);
    if (!r.rowCount) throw new NotFoundException({ code: 'not_found' });
    await audit(me, 'delete', 'thobe_photo', id);
    return { ok: true };
  }

  @Get('registers/:id')
  @UseGuards(ReportsGuard)
  async register(@Param('id') id: string) {
    const r = await db.one(
      `select r.*, u.name as staff_name, b.name_en as branch_en, b.name_ar as branch_ar from cash_registers r join staff_users u on u.id = r.staff_id join branches b on b.id = r.branch_id where r.id = $1`,
      [id],
    );
    if (!r) throw new NotFoundException({ code: 'not_found' });
    const payments = await db.many(
      `select p.amount::float as amount, p.provider, p.completed_at, o.id as order_id, o.number from payments p join orders o on o.id = p.order_id where p.register_id = $1 and p.status = 'paid' order by p.completed_at`,
      [id],
    );
    return { ...r, payments, totals: await registerTotals(id) };
  }
}

function validDate(v: unknown) {
  if (!v) return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) fail('invalid_date', { field: 'validUntil' });
  return s;
}

export async function receiptData(idOrToken: { id?: string; token?: string } | string) {
  const by = typeof idOrToken === 'string' ? { id: idOrToken } : idOrToken;
  const o = await db.one(
    `select ${SALE_ROW}, o.delivery_fee::float as delivery_fee, o.home_visit_fee::float as home_visit_fee, o.service_charge::float as service_charge, o.address,
            o.discount_label, o.points_to_earn, o.receipt_token, o.notes, o.walk_in_name,
            b.address_en as branch_address_en, b.address_ar as branch_address_ar, b.phone as branch_phone
       from ${SALE_FROM}
      where ${by.id ? 'o.id = $1' : 'o.receipt_token = $1'}`,
    [by.id ?? by.token],
  );
  if (!o) throw new NotFoundException({ code: 'not_found' });
  const [items, payments, refunds, settings] = await Promise.all([
    db.many('select id, kind, snapshot, qty, unit_price::float as unit_price, line_total::float as line_total, discount::float as discount, tax::float as tax, returned_qty from order_items where order_id = $1 order by kind desc, id', [o.id]),
    db.many(`select provider, amount::float as amount, completed_at, provider_ref from payments where order_id = $1 and status = 'paid' order by completed_at`, [o.id]),
    db.many(`select amount::float as amount, method, created_at, reference from refunds where order_id = $1 order by created_at`, [o.id]),
    getSettings(),
  ]);
  const memberIds = [...new Set(items.filter((i) => i.kind === 'thobe').map((i) => i.snapshot.member?.id).filter(Boolean))];
  const measurements = memberIds.length
    ? await db.many(
        `select distinct on (m.member_id) m.member_id, m.taken_at, m.tailor_name, m.length_cm, m.shoulder_cm, m.chest_cm, m.waist_cm, m.sleeve_cm, m.neck_cm, m.cuff_cm, m.remarks
           from measurements m where m.member_id = any($1::uuid[]) order by m.member_id, m.taken_at desc`,
        [memberIds],
      )
    : [];
  return {
    ...o,
    balance: o.stage === 'cancelled' ? 0 : round2(Math.max(0, o.total - o.paid)),
    items,
    payments,
    refunds,
    measurements,
    company: settings.company,
    invoice: settings.invoice,
    printing: settings.printing,
  };
}
