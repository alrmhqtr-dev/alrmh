/**
 * Shared rules for selling: automatic discounts, tax, stock and counter sales.
 * The customer app and the counter use the same discounts and stock, so a
 * price or a sold-out item is the same wherever the customer looks.
 */
import { NotFoundException } from '@nestjs/common';
import { db, type Queryable } from './db.js';
import { addMonthsSql } from './sql-helpers.js';
import {
  addWorkingDays,
  expirePoints,
  fail,
  getSettings,
  notify,
  pointsBalance,
  qatarDateString,
  round2,
  spendPoints,
  tierStatus,
  type Tier,
} from './lib.js';
import type { StaffUser } from './staff.js';
import { hasPerm } from './staff.js';

export const PAY_METHODS = ['cash', 'card', 'bank_transfer', 'cheque'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
/** How a method is stored on a payment row (the card machine was already 'card_machine'). */
export const providerFor = (m: PayMethod) => (m === 'card' ? 'card_machine' : m);

/* ---------- automatic discounts ---------- */

export type DiscountRule = {
  id: string;
  name: string;
  applies_to: 'all' | 'category' | 'product' | 'brand' | 'fabric';
  target_ids: string[];
  kind: 'percent' | 'fixed';
  amount: number;
  priority: number;
};

export async function activeDiscounts(channel: 'pos' | 'app', branchId: string | null, client: Queryable = db.pool): Promise<DiscountRule[]> {
  return db.many<DiscountRule>(
    `select id, name, applies_to, target_ids, kind, amount::float as amount, priority from discounts
      where active and channel in ('all', $1)
        and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())
        and (branch_id is null or branch_id = $2::uuid)
      order by priority desc, created_at`,
    [channel, branchId],
    client,
  );
}

type Priceable = { kind: 'product'; id: string; category: string; brand_id: string | null; price: number } | { kind: 'thobe'; fabricId: string; price: number };

/** The biggest discount per unit from the rules and the customer's group (they don't add up). */
export function unitDiscount(item: Priceable, rules: DiscountRule[], groupPercent = 0): { amount: number; label: string | null } {
  let best = { amount: 0, label: null as string | null };
  const consider = (amount: number, label: string) => {
    const a = round2(Math.min(item.price, Math.max(0, amount)));
    if (a > best.amount) best = { amount: a, label };
  };
  for (const r of rules) {
    const hit =
      r.applies_to === 'all' ||
      (item.kind === 'product' && r.applies_to === 'product' && r.target_ids.includes(item.id)) ||
      (item.kind === 'product' && r.applies_to === 'category' && r.target_ids.includes(item.category)) ||
      (item.kind === 'product' && r.applies_to === 'brand' && item.brand_id != null && r.target_ids.includes(item.brand_id)) ||
      (item.kind === 'thobe' && r.applies_to === 'fabric' && (r.target_ids.length === 0 || r.target_ids.includes(item.fabricId)));
    if (!hit) continue;
    consider(r.kind === 'percent' ? (item.price * r.amount) / 100 : r.amount, r.name);
  }
  if (groupPercent > 0) consider((item.price * groupPercent) / 100, 'group');
  return best;
}

export async function groupPercent(customerId: string | null, client: Queryable = db.pool) {
  if (!customerId) return 0;
  const g = await db.one<{ p: number }>(
    'select g.discount_percent::float as p from customers c join customer_groups g on g.id = c.group_id where c.id = $1 and g.active',
    [customerId],
    client,
  );
  return g?.p ?? 0;
}

/** Tax already inside a price. */
export const taxInside = (amount: number, percent: number) => (percent > 0 ? round2((amount * percent) / (100 + percent)) : 0);

/* ---------- thobes ---------- */

/** Cloth for one thobe: 0.5 to 20 metres, to the centimetre. */
export function cleanMetres(v: unknown, fallback: number) {
  if (v === null || v === undefined || v === '') return round2(fallback);
  const m = Number(v);
  if (!Number.isFinite(m) || m < 0.5 || m > 20) fail('invalid_metres');
  return round2(m);
}

/**
 * The options of one thobe as they are sold: collar, cuff (when the business has cuff styles) and
 * cloth, priced by the metre. Without a length the cloth's usual metres per thobe are used.
 */
export async function thobeOptions(o: { collarId?: string | null; cuffId?: string | null; fabricId?: string | null; metres?: unknown; pocket?: unknown }, client: Queryable, needCuff = false) {
  const collar = await db.one('select id, name_en, name_ar, shape, image_url from collars where id = $1 and active', [o.collarId ?? null], client);
  const fabric = await db.one(
    'select id, sku, name_en, name_ar, price::float as price, cost::float as cost, metres_per_thobe::float as metres, tax_rate_id from fabrics where id = $1 and active',
    [o.fabricId ?? null],
    client,
  );
  if (!collar || !fabric) fail('invalid_thobe_options');
  let cuff = null;
  if (o.cuffId) {
    cuff = await db.one('select id, name_en, name_ar, image_url from cuffs where id = $1 and active', [o.cuffId], client);
    if (!cuff) fail('invalid_thobe_options');
  } else if (needCuff && (await db.one('select 1 from cuffs where active limit 1', [], client))) fail('cuff_required');
  const metres = cleanMetres(o.metres, fabric.metres || 3.5);
  /** A chest pocket, or none. */
  const pocket = o.pocket === true;
  return {
    collar,
    cuff,
    fabric,
    metres,
    pocket,
    /** One thobe: metres × the cloth's price per metre. */
    unit: round2(metres * fabric.price),
    unitCost: round2(fabric.cost * metres),
    snapshot: { collar, cuff, fabric: { id: fabric.id, name_en: fabric.name_en, name_ar: fabric.name_ar, price: fabric.price, per: 'metre' }, metres, pocket, colour: null },
  };
}

/* ---------- stock ---------- */

export type StockKey = { kind: 'product' | 'fabric'; id: string; size?: string | null };

export async function stockLevel(key: StockKey, branchId: string, client: Queryable = db.pool) {
  const r = await db.one<{ q: number }>(
    `select coalesce(sum(qty),0)::float as q from stock_moves where item_kind = $1 and item_id = $2 and size = $3 and branch_id = $4`,
    [key.kind, key.id, key.size ?? '', branchId],
    client,
  );
  return r?.q ?? 0;
}

export async function moveStock(
  client: Queryable,
  m: { branchId: string; kind: 'product' | 'fabric'; id: string; size?: string | null; qty: number; reason: string; refType?: string; refId?: string; unitCost?: number | null; note?: string | null; staffId?: string | null },
) {
  if (!m.qty) return;
  await client.query(
    `insert into stock_moves (branch_id, item_kind, item_id, size, qty, unit_cost, reason, ref_type, ref_id, note, staff_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [m.branchId, m.kind, m.id, m.size ?? '', m.qty, m.unitCost ?? null, m.reason, m.refType ?? null, m.refId ?? null, m.note ?? null, m.staffId ?? null],
  );
}

/** Where online shop orders are packed from: the branch set in POS settings, else the first branch. */
export async function onlineBranchId(client: Queryable = db.pool) {
  const s = await getSettings(client);
  const b = await db.one<{ id: string }>('select id from branches where ($1::uuid is null or id = $1::uuid) and active order by sort limit 1', [s.pos.online_branch_id || null], client);
  return b?.id ?? null;
}

type StockNeed = { kind: 'product' | 'fabric'; id: string; size: string; qty: number; name: string };

/** What an order's lines take from stock: tracked products, and the cloth for each thobe. */
export async function stockNeeds(lines: { kind: string; qty: number; productId?: string; size?: string | null; fabricId?: string; metres?: number | null }[], client: Queryable): Promise<StockNeed[]> {
  const out = new Map<string, StockNeed>();
  for (const l of lines) {
    if (l.kind === 'product' && l.productId) {
      const p = await db.one('select id, name_en, track_stock from products where id = $1', [l.productId], client);
      if (!p?.track_stock) continue;
      const key = `product:${p.id}:${l.size ?? ''}`;
      const cur = out.get(key) ?? { kind: 'product' as const, id: p.id, size: l.size ?? '', qty: 0, name: p.name_en };
      cur.qty += l.qty;
      out.set(key, cur);
    } else if (l.kind === 'thobe' && l.fabricId) {
      const f = await db.one('select id, name_en, track_stock, metres_per_thobe::float as m from fabrics where id = $1', [l.fabricId], client);
      const metres = l.metres ?? f?.m ?? 0;
      if (!f?.track_stock || !(metres > 0)) continue;
      const key = `fabric:${f.id}:`;
      const cur = out.get(key) ?? { kind: 'fabric' as const, id: f.id, size: '', qty: 0, name: f.name_en };
      cur.qty = round2(cur.qty + metres * l.qty);
      out.set(key, cur);
    }
  }
  return [...out.values()];
}

/** Refuses when a tracked item would go below zero, unless the business allows selling into negative stock. */
export async function assertInStock(needs: StockNeed[], branchId: string, client: Queryable) {
  const s = await getSettings(client);
  if (s.pos.allow_negative_stock) return;
  for (const n of needs) {
    const have = await stockLevel(n, branchId, client);
    if (have < n.qty) fail('out_of_stock', { item: n.name, size: n.size || null, available: have });
  }
}

/** Takes an order's items out of stock (once). */
export async function takeStockForOrder(orderId: string, client: Queryable, staffId: string | null = null) {
  const done = await db.one(`select 1 from stock_moves where ref_type = 'order' and ref_id = $1 and reason = 'sale' limit 1`, [orderId], client);
  if (done) return;
  const o = await db.one('select id, number, branch_id, address from orders where id = $1', [orderId], client);
  const items = await db.many('select kind, qty, snapshot from order_items where order_id = $1', [orderId], client);
  const hasThobes = items.some((i) => i.kind === 'thobe');
  // Thobe cloth comes from the branch making them; shop items from the sale's branch, or the online branch for app orders.
  const branchId = o.branch_id ?? (hasThobes ? o.address?.branchId : null) ?? (await onlineBranchId(client));
  if (!branchId) return;
  const needs = await stockNeeds(
    items.map((i) => ({ kind: i.kind, qty: i.qty, productId: i.snapshot.product?.id, size: i.snapshot.size, fabricId: i.snapshot.thobe?.fabric?.id, metres: i.snapshot.thobe?.metres ?? null })),
    client,
  );
  for (const n of needs) await moveStock(client, { branchId, kind: n.kind, id: n.id, size: n.size, qty: -n.qty, reason: 'sale', refType: 'order', refId: orderId, staffId });
}

/** Puts back whatever an order took from stock (a cancelled order). */
export async function returnStockForOrder(orderId: string, client: Queryable, staffId: string | null = null) {
  const moves = await db.many(
    `select branch_id, item_kind, item_id, size, sum(qty)::float as qty from stock_moves where ref_type = 'order' and ref_id = $1 group by 1,2,3,4 having sum(qty) <> 0`,
    [orderId],
    client,
  );
  for (const m of moves) await moveStock(client, { branchId: m.branch_id, kind: m.item_kind, id: m.item_id, size: m.size, qty: -m.qty, reason: 'cancel', refType: 'order', refId: orderId, staffId });
}

/* ---------- cash register ---------- */

export async function openRegister(staffId: string, client: Queryable = db.pool) {
  return db.one('select * from cash_registers where staff_id = $1 and closed_at is null', [staffId], client);
}

export async function requireRegister(staff: StaffUser, client: Queryable = db.pool) {
  const r = await openRegister(staff.id, client);
  if (!r) fail('register_closed');
  return r;
}

/** Cash expected in the drawer: opening cash, cash taken, less cash paid out. */
export async function registerTotals(registerId: string, client: Queryable = db.pool) {
  const r = await db.one(
    `select r.opening_cash::float as opening,
            coalesce((select sum(amount) from payments p where p.register_id = r.id and p.status = 'paid' and p.provider = 'cash'),0)::float as cash_sales,
            coalesce((select sum(amount) from payments p where p.register_id = r.id and p.status = 'paid' and p.provider = 'card_machine'),0)::float as card_sales,
            coalesce((select sum(amount) from payments p where p.register_id = r.id and p.status = 'paid' and p.provider in ('bank_transfer','cheque')),0)::float as other_sales,
            coalesce((select sum(amount) from refunds f where f.register_id = r.id and f.method = 'cash'),0)::float as cash_refunds,
            coalesce((select sum(amount) from refunds f where f.register_id = r.id and f.method = 'card'),0)::float as card_refunds,
            coalesce((select sum(amount) from expenses e where e.register_id = r.id and e.method = 'cash'),0)::float as cash_expenses,
            coalesce((select sum(amount) from supplier_payments s where s.register_id = r.id and s.method = 'cash'),0)::float as cash_supplier,
            coalesce((select sum(amount) from register_moves m where m.register_id = r.id and m.kind = 'cash_in'),0)::float as cash_in,
            coalesce((select sum(amount) from register_moves m where m.register_id = r.id and m.kind = 'cash_out'),0)::float as cash_out,
            (select count(distinct order_id)::int from payments p where p.register_id = r.id and p.status = 'paid') as sales_count
       from cash_registers r where r.id = $1`,
    [registerId],
    client,
  );
  if (!r) throw new NotFoundException({ code: 'not_found' });
  const expected = round2(r.opening + r.cash_sales - r.cash_refunds - r.cash_expenses - r.cash_supplier + r.cash_in - r.cash_out);
  return { ...r, expected_cash: expected };
}

/* ---------- counter sales ---------- */

export type SaleLineInput =
  | { kind: 'product'; productId: string; size?: string | null; qty: number; price?: number | null; discount?: number | null }
  | { kind: 'thobe'; memberId: string; collarId: string; cuffId?: string | null; fabricId: string; metres?: number | null; pocket?: boolean; qty: number; price?: number | null; discount?: number | null; remarks?: string | null };

export type SaleInput = {
  branchId?: string;
  customerId?: string | null;
  walkInName?: string | null;
  walkInPhone?: string | null;
  lines: SaleLineInput[];
  /** A discount on the whole sale, given at the counter. */
  orderDiscount?: { kind: 'percent' | 'fixed'; amount: number } | null;
  points?: number | null;
  notes?: string | null;
  /** Deliver a shop-only sale to one of the customer's addresses. */
  deliveryAddressId?: string | null;
};

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

/** Prices a counter sale exactly as it will be charged. Used for the live basket, drafts and the sale itself. */
export async function priceSale(input: SaleInput, staff: StaffUser, client: Queryable = db.pool) {
  const lines = Array.isArray(input?.lines) ? input.lines : [];
  if (lines.length > 60) fail('invalid_lines');
  const branch = await db.one('select id, name_en, name_ar, address_en, address_ar from branches where id = $1 and active', [input.branchId || staff.branch_id || null], client)
    ?? await db.one('select id, name_en, name_ar, address_en, address_ar from branches where active order by sort limit 1', [], client);
  if (!branch) fail('branch_not_found');
  const customer = input.customerId ? await db.one('select id, name, phone from customers where id = $1 and deleted_at is null', [input.customerId], client) : null;
  if (input.customerId && !customer) fail('customer_not_found');
  const canDiscount = hasPerm(staff, 'pos.discount');
  const rules = await activeDiscounts('pos', branch.id, client);
  const gp = await groupPercent(customer?.id ?? null, client);
  const tier: Tier = (await tierStatus(customer?.id ?? null, client)).tier;
  const taxes = new Map((await db.many<{ id: string; percent: number }>('select id, percent::float as percent from tax_rates where active', [], client)).map((t) => [t.id, t.percent]));

  const out: any[] = [];
  for (const raw of lines) {
    const qty = Math.trunc(Number(raw?.qty));
    if (!(qty >= 1 && qty <= 500)) fail('invalid_qty');
    const override = num(raw.price);
    const manual = num(raw.discount);
    if ((override !== null || (manual !== null && manual !== 0)) && !canDiscount) fail('forbidden_discount');
    if (raw.kind === 'product') {
      const p = await db.one(
        `select id, sku, category, brand_id, name_en, name_ar, price::float as price, cost::float as cost, sizes, image_url, tax_rate_id, track_stock from products where id = $1 and active`,
        [raw.productId],
        client,
      );
      if (!p) fail('product_not_found', { productId: raw.productId });
      if (p.sizes.length && !p.sizes.includes(raw.size)) fail('size_required', { productId: p.id });
      const unit = override !== null ? round2(Math.max(0, override)) : p.price;
      const auto = override !== null ? { amount: 0, label: null } : unitDiscount({ kind: 'product', id: p.id, category: p.category, brand_id: p.brand_id, price: unit }, rules, gp);
      const lineDiscount = round2(Math.min(unit * qty, auto.amount * qty + Math.max(0, manual ?? 0)));
      const lineTotal = round2(unit * qty - lineDiscount);
      out.push({
        kind: 'product',
        qty,
        unitPrice: unit,
        listPrice: p.price,
        discount: lineDiscount,
        discountLabel: auto.label,
        lineTotal,
        unitCost: p.cost,
        taxPercent: p.tax_rate_id ? taxes.get(p.tax_rate_id) ?? 0 : 0,
        points: tier.points_per_product * qty,
        product: { id: p.id, sku: p.sku, name_en: p.name_en, name_ar: p.name_ar, category: p.category, image_url: p.image_url },
        size: p.sizes.length ? raw.size : null,
      });
    } else if (raw.kind === 'thobe') {
      if (!customer) fail('customer_required');
      const member = await db.one('select id, name, relation, size from family_members where id = $1 and customer_id = $2', [raw.memberId, customer.id], client);
      if (!member) fail('member_not_found');
      const th = await thobeOptions(raw, client, true);
      const fabric = th.fabric;
      const unit = override !== null ? round2(Math.max(0, override)) : th.unit;
      const auto = override !== null ? { amount: 0, label: null } : unitDiscount({ kind: 'thobe', fabricId: fabric.id, price: unit }, rules, gp);
      const lineDiscount = round2(Math.min(unit * qty, auto.amount * qty + Math.max(0, manual ?? 0)));
      const measured = await db.one('select 1 from measurements where member_id = $1 limit 1', [member.id], client);
      out.push({
        kind: 'thobe',
        qty,
        unitPrice: unit,
        listPrice: th.unit,
        discount: lineDiscount,
        discountLabel: auto.label,
        lineTotal: round2(unit * qty - lineDiscount),
        unitCost: th.unitCost,
        taxPercent: fabric.tax_rate_id ? taxes.get(fabric.tax_rate_id) ?? 0 : 0,
        points: tier.points_per_thobe * qty,
        thobe: th.snapshot,
        member: { id: member.id, name: member.name, relation: member.relation, size: member.size },
        measured: Boolean(measured),
        remarks: raw.remarks ? String(raw.remarks).slice(0, 1000) : null,
      });
    } else fail('invalid_kind');
  }

  const subtotal = round2(out.reduce((a, l) => a + l.lineTotal, 0));
  let orderDiscount = 0;
  if (input.orderDiscount && Number(input.orderDiscount.amount) > 0) {
    if (!canDiscount) fail('forbidden_discount');
    const a = Number(input.orderDiscount.amount);
    orderDiscount = round2(Math.min(subtotal, input.orderDiscount.kind === 'percent' ? (subtotal * Math.min(a, 100)) / 100 : a));
  }
  const hasThobes = out.some((l) => l.kind === 'thobe');
  const settings = await getSettings(client);

  let address: any = { pickup: true, counter: !hasThobes, branchId: branch.id, label: branch.name_en, label_ar: branch.name_ar, line1: branch.address_en, line1_ar: branch.address_ar, area: '', city: 'Doha' };
  let deliveryFee = 0;
  if (input.deliveryAddressId) {
    if (hasThobes) fail('thobes_collected');
    if (!customer) fail('customer_required');
    const a = await db.one('select id, label, line1, area, city, notes from addresses where id = $1 and customer_id = $2', [input.deliveryAddressId, customer.id], client);
    if (!a) fail('address_not_found');
    address = a;
    deliveryFee = settings.delivery_fee;
  }
  const due = round2(subtotal - orderDiscount + deliveryFee);
  let points = 0;
  let balance = 0;
  if (customer) {
    await expirePoints(customer.id, client);
    balance = await pointsBalance(customer.id, client);
    const asked = Math.trunc(Number(input.points ?? 0));
    if (asked < 0) fail('invalid_points');
    if (asked > balance) fail('not_enough_points');
    points = Math.min(asked, Math.floor(due));
  }
  const total = round2(due - points);
  // Prices include tax: the tax part shrinks in step with any discount on the whole sale.
  const lineTax = out.reduce((a, l) => a + taxInside(l.lineTotal, l.taxPercent), 0);
  const tax = subtotal > 0 ? round2((lineTax * (subtotal - orderDiscount)) / subtotal) : 0;
  const lead = settings.lead_working_days;
  return {
    branch,
    customer,
    lines: out,
    hasThobes,
    subtotal,
    orderDiscount,
    deliveryFee,
    address,
    pointsUsed: points,
    pointsBalance: balance,
    pointsToEarn: out.reduce((a, l) => a + l.points, 0),
    total,
    tax,
    expectedDelivery: hasThobes ? addWorkingDays(qatarDateString(new Date()), lead) : null,
    tier: customer ? tier : null,
  };
}

export type PaymentInput = { method: PayMethod; amount: number; reference?: string | null };

/** Splits what the customer handed over into payments, giving change from cash only. */
export function settlePayments(total: number, payments: PaymentInput[], allowPartial: boolean) {
  const list = (Array.isArray(payments) ? payments : [])
    .map((p) => ({ method: p?.method, amount: round2(Number(p?.amount)), reference: p?.reference ? String(p.reference).slice(0, 80) : null }))
    .filter((p) => p.amount > 0);
  for (const p of list) if (!PAY_METHODS.includes(p.method as PayMethod) || !Number.isFinite(p.amount)) fail('invalid_payment');
  const given = round2(list.reduce((a, p) => a + p.amount, 0));
  let change = 0;
  if (given > total) {
    const over = round2(given - total);
    const cash = list.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0);
    if (cash < over) fail('overpaid');
    change = over;
    let left = over;
    for (const p of [...list].reverse()) {
      if (p.method !== 'cash' || left <= 0) continue;
      const take = Math.min(p.amount, left);
      p.amount = round2(p.amount - take);
      left = round2(left - take);
    }
  }
  const paid = round2(Math.min(given, total));
  if (paid < total && !allowPartial) fail('payment_short', { due: round2(total - paid) });
  return { payments: list.filter((p) => p.amount > 0) as { method: PayMethod; amount: number; reference: string | null }[], paid, change, balance: round2(total - paid) };
}

/** Points earned on an order, given when it is collected or delivered (or straight away at the counter). */
export async function awardPoints(orderId: string, client: Queryable) {
  const order = await db.one('select * from orders where id = $1', [orderId], client);
  if (!order?.customer_id || order.points_awarded || !(order.points_to_earn > 0)) return;
  const s = await getSettings(client);
  const before = await tierStatus(order.customer_id, client);
  const thobes = Boolean(await db.one(`select 1 from order_items where order_id = $1 and kind = 'thobe' limit 1`, [orderId], client));
  await client.query(
    `insert into points_ledger (customer_id, kind, points, remaining, expires_at, order_id, label)
     values ($1, 'earn', $2, $2, ${addMonthsSql('now()', '$3')}, $4, $5)`,
    [order.customer_id, order.points_to_earn, s.points.expiry_months, orderId, `Order #${order.number}`],
  );
  await client.query('update orders set points_awarded = true where id = $1', [orderId]);
  await notify(
    order.customer_id,
    'points',
    {
      en: { title: `You earned ${order.points_to_earn} points`, body: `Order #${order.number} ${thobes ? 'collected' : 'delivered'}. Points expire in ${s.points.expiry_months} months.` },
      ar: { title: `ربحت ${order.points_to_earn} نقطة`, body: `${thobes ? 'تم استلام' : 'تم توصيل'} الطلب #${order.number}. تنتهي صلاحية النقاط بعد ${s.points.expiry_months} شهرًا.` },
    },
    '/rewards',
    client,
  );
  const after = await tierStatus(order.customer_id, client);
  if (after.tier.id !== before.tier.id && after.tier.min_points > before.tier.min_points)
    await notify(
      order.customer_id,
      'points',
      {
        en: { title: `You're now ${after.tier.name_en}`, body: `Every thobe now earns ${after.tier.points_per_thobe} points and every product ${after.tier.points_per_product}.` },
        ar: { title: `أصبحت في الفئة ${after.tier.name_ar}`, body: `كل ثوب يمنحك الآن ${after.tier.points_per_thobe} نقطة وكل منتج ${after.tier.points_per_product} نقاط.` },
      },
      '/rewards',
      client,
    );
}

/** Spends points on an order that is being paid now. */
export async function redeemPoints(customerId: string, points: number, orderId: string, number: string, client: Queryable) {
  if (points <= 0) return;
  await client.query('select pg_advisory_xact_lock(hashtext($1))', [`points:${customerId}`]);
  await expirePoints(customerId, client);
  if ((await pointsBalance(customerId, client)) < points) fail('not_enough_points');
  await spendPoints(customerId, points, client);
  await client.query(`insert into points_ledger (customer_id, kind, points, order_id, label) values ($1, 'redeem', $2, $3, $4)`, [customerId, -points, orderId, `Order #${number}`]);
}

/** Paid so far and still to pay, for any order. */
export async function orderBalance(orderId: string, client: Queryable = db.pool) {
  const r = await db.one<{ total: number; paid: number }>(
    `select o.total::float as total, coalesce((select sum(amount) from payments p where p.order_id = o.id and p.status = 'paid'),0)::float as paid from orders o where o.id = $1`,
    [orderId],
    client,
  );
  if (!r) throw new NotFoundException({ code: 'not_found' });
  return { total: r.total, paid: r.paid, balance: round2(Math.max(0, r.total - r.paid)) };
}

export const nextNumber = async (seq: string, prefix: string, client: Queryable) => `${prefix}${(await db.one<{ n: number }>(`select nextval('${seq}')::int as n`, [], client))!.n}`;
