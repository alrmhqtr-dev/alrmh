import { db, type Queryable } from './db.js';
import { expirePoints, getSettings, pointsBalance, round2, tierStatus, type Tier } from './lib.js';
import { activeDiscounts, groupPercent, taxInside, unitDiscount } from './pos.js';

/** usePoints: spend the customer's points on this order, 1 point = QAR 1, up to the amount due. */
export type QuoteInput = { addressId?: string; branchId?: string; couponCode?: string | null; usePoints?: boolean };

export async function basketLines(customerId: string, client: Queryable = db.pool, tier?: Tier) {
  const t = tier ?? (await tierStatus(customerId, client)).tier;
  const rows = await db.many(
    `select bi.*, p.name_en as p_name_en, p.name_ar as p_name_ar, p.price as p_price, p.category as p_category, p.image_url as p_image_url,
            p.brand_id as p_brand_id, p.cost as p_cost, p.sku as p_sku, coalesce(pt.percent, 0)::float as p_tax,
            f.name as member_name, f.relation as member_relation, f.size as member_size,
            a.kind as appt_kind, a.starts_at as appt_starts_at, a.branch_id as appt_branch_id,
            b.name_en as appt_branch_en, b.name_ar as appt_branch_ar, ad.area as appt_area
       from basket_items bi
       left join products p on p.id = bi.product_id
       left join tax_rates pt on pt.id = p.tax_rate_id and pt.active
       left join family_members f on f.id = bi.member_id
       left join appointments a on a.id = bi.appointment_id
       left join branches b on b.id = a.branch_id
       left join addresses ad on ad.id = a.address_id
      where bi.customer_id = $1 order by bi.created_at`,
    [customerId],
    client,
  );
  const [collars, fabrics, cuffs] = await Promise.all([
    db.many('select id, name_en, name_ar, shape, image_url from collars', [], client),
    db.many('select f.id, f.name_en, f.name_ar, f.price::float as price, f.cost::float as cost, f.metres_per_thobe::float as metres_per_thobe, coalesce(t.percent,0)::float as tax from fabrics f left join tax_rates t on t.id = f.tax_rate_id and t.active', [], client),
    db.many('select id, name_en, name_ar, image_url from cuffs', [], client),
  ]);
  const byId = (list: any[], id: string) => list.find((x) => x.id === id);
  // The same automatic discounts as the counter (rules for the app, and the customer's group).
  const rules = await activeDiscounts('app', null, client);
  const gp = await groupPercent(customerId, client);
  return rows.map((r) => {
    if (r.kind === 'product') {
      const off = unitDiscount({ kind: 'product', id: r.product_id, category: r.p_category, brand_id: r.p_brand_id, price: r.p_price }, rules, gp);
      const discount = round2(off.amount * r.qty);
      const line = round2(r.p_price * r.qty - discount);
      return {
        id: r.id,
        kind: 'product' as const,
        qty: r.qty,
        unitPrice: r.p_price,
        discount,
        discountLabel: off.label,
        unitCost: r.p_cost ?? 0,
        tax: taxInside(line, r.p_tax),
        lineTotal: line,
        points: t.points_per_product * r.qty,
        product: { id: r.product_id, name_en: r.p_name_en, name_ar: r.p_name_ar, category: r.p_category, image_url: r.p_image_url },
        size: r.size,
      };
    }
    const fabricRow = byId(fabrics, r.thobe.fabricId);
    const fabric = fabricRow ? { id: fabricRow.id, name_en: fabricRow.name_en, name_ar: fabricRow.name_ar, price: fabricRow.price, per: 'metre' } : undefined;
    // Cloth is priced by the metre: the length chosen for this thobe, else the cloth's usual length.
    const metres = round2(Number(r.thobe.metres) || fabricRow?.metres_per_thobe || 3.5);
    const unit = round2(metres * (fabric?.price ?? 0));
    const off = unitDiscount({ kind: 'thobe', fabricId: r.thobe.fabricId, price: unit }, rules, gp);
    const discount = round2(off.amount * r.qty);
    const line = round2(unit * r.qty - discount);
    return {
      id: r.id,
      kind: 'thobe' as const,
      qty: r.qty,
      unitPrice: unit,
      discount,
      discountLabel: off.label,
      unitCost: round2((fabricRow?.cost ?? 0) * metres),
      tax: taxInside(line, fabricRow?.tax ?? 0),
      lineTotal: line,
      points: t.points_per_thobe * r.qty,
      thobe: {
        collar: byId(collars, r.thobe.collarId),
        cuff: r.thobe.cuffId ? byId(cuffs, r.thobe.cuffId) ?? null : null,
        fabric,
        metres,
        colour: null,
      },
      member: { id: r.member_id, name: r.member_name, relation: r.member_relation, size: r.member_size },
      measureMethod: r.measure_method,
      remarks: r.remarks,
      appointment: r.appointment_id
        ? { id: r.appointment_id, kind: r.appt_kind, startsAt: r.appt_starts_at, branch_en: r.appt_branch_en, branch_ar: r.appt_branch_ar, area: r.appt_area }
        : null,
    };
  });
}

export async function quote(customerId: string, input: QuoteInput, client: Queryable = db.pool) {
  const settings = await getSettings(client);
  const status = await tierStatus(customerId, client);
  const items = await basketLines(customerId, client, status.tier);
  const subtotal = round2(items.reduce((a, i) => a + i.lineTotal, 0));
  const homeAppointments = new Set(items.filter((i: any) => i.kind === 'thobe' && i.measureMethod === 'home' && i.appointment).map((i: any) => i.appointment.id));
  const homeVisitFee = round2(homeAppointments.size * settings.home_visit_fee);
  // Thobes are collected from a branch, so an order with thobes has no delivery.
  // Shop-only orders are delivered to an address.
  const pickup = items.some((i) => i.kind === 'thobe');
  const deliveryFee = items.length && !pickup ? settings.delivery_fee : 0;

  let address: any;
  if (pickup) {
    const b = await db.one(
      'select id, name_en, name_ar, address_en, address_ar from branches where active and ($1::uuid is null or id = $1) order by sort limit 1',
      [input.branchId && /^[0-9a-f-]{36}$/i.test(input.branchId) ? input.branchId : null],
      client,
    );
    address = b ? { pickup: true, branchId: b.id, label: b.name_en, label_ar: b.name_ar, line1: b.address_en, line1_ar: b.address_ar, area: '', city: 'Doha' } : null;
  } else {
    address = input.addressId
      ? await db.one('select id, label, line1, area, city, notes from addresses where id = $1 and customer_id = $2', [input.addressId, customerId], client)
      : await db.one('select id, label, line1, area, city, notes from addresses where customer_id = $1 order by is_default desc, created_at limit 1', [customerId], client);
  }

  let coupon: null | { code: string; percent?: number; maxDiscount?: number | null; error?: string; min?: number } = null;
  if (input.couponCode) {
    const code = String(input.couponCode).trim().toUpperCase();
    const c = await db.one(
      `select code, percent, max_discount, active, per_customer_limit, max_uses, min_subtotal,
              (expires_at is not null and expires_at < now()) as expired, (starts_at is not null and starts_at > now()) as early
         from coupons where upper(code) = $1`,
      [code],
      client,
    );
    if (!c || !c.active || c.early) coupon = { code, error: 'coupon_invalid' };
    else if (c.expired) coupon = { code, error: 'coupon_expired' };
    else {
      const used = await db.one<{ mine: number; total: number }>(
        `select count(*) filter (where customer_id = $2)::int as mine, count(*)::int as total
           from orders where coupon_code = $1 and paid_at is not null and stage <> 'cancelled'`,
        [c.code, customerId],
        client,
      );
      if (c.max_uses != null && used!.total >= c.max_uses) coupon = { code, error: 'coupon_expired' };
      else if (c.per_customer_limit != null && used!.mine >= c.per_customer_limit) coupon = { code, error: 'coupon_used' };
      else if (c.min_subtotal != null && subtotal < c.min_subtotal) coupon = { code, error: 'coupon_min', min: c.min_subtotal };
      else coupon = { code: c.code, percent: c.percent, maxDiscount: c.max_discount };
    }
  }

  let discount = 0;
  let discountLabel: string | null = null;
  if (coupon && !coupon.error) {
    const raw = round2((subtotal * coupon.percent!) / 100);
    discount = coupon.maxDiscount ? Math.min(raw, coupon.maxDiscount) : raw;
    discountLabel = `coupon:${coupon.code}:${coupon.percent}`;
  }
  discount = Math.min(discount, subtotal);
  const due = round2(subtotal + deliveryFee + homeVisitFee - discount);

  // Points are whole QAR, so they can cover the whole riyals of what's due.
  await expirePoints(customerId, client);
  const pointsBalance_ = await pointsBalance(customerId, client);
  const pointsUsed = input.usePoints ? Math.max(0, Math.min(pointsBalance_, Math.floor(due))) : 0;
  const total = round2(due - pointsUsed);
  const pointsToEarn = items.reduce((a, i) => a + i.points, 0);
  const lineTax = items.reduce((a, i) => a + i.tax, 0);
  const tax = subtotal > 0 ? round2((lineTax * (subtotal - discount)) / subtotal) : 0;

  return {
    items,
    count: items.reduce((a, i) => a + i.qty, 0),
    subtotal,
    deliveryFee,
    homeVisitFee,
    discount,
    discountLabel,
    pointsBalance: pointsBalance_,
    pointsUsed,
    total,
    pointsToEarn,
    tax,
    tier: status.tier,
    address: address ?? null,
    pickup,
    coupon,
  };
}
