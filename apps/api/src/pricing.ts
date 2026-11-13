import { db, type Queryable } from './db.js';
import { getSettings, round2, type Settings } from './lib.js';

export type QuoteInput = { addressId?: string; voucherId?: string | null; couponCode?: string | null };

export async function basketLines(customerId: string, client: Queryable = db.pool, settings?: Settings) {
  const s = settings ?? (await getSettings(client));
  const rows = await db.many(
    `select bi.*, p.name_en as p_name_en, p.name_ar as p_name_ar, p.price as p_price, p.category as p_category, p.image_url as p_image_url,
            f.name as member_name, f.relation as member_relation, f.size as member_size,
            a.kind as appt_kind, a.starts_at as appt_starts_at, a.branch_id as appt_branch_id,
            b.name_en as appt_branch_en, b.name_ar as appt_branch_ar, ad.area as appt_area
       from basket_items bi
       left join products p on p.id = bi.product_id
       left join family_members f on f.id = bi.member_id
       left join appointments a on a.id = bi.appointment_id
       left join branches b on b.id = a.branch_id
       left join addresses ad on ad.id = a.address_id
      where bi.customer_id = $1 order by bi.created_at`,
    [customerId],
    client,
  );
  const [collars, fabrics, colours] = await Promise.all([
    db.many('select id, name_en, name_ar, shape from collars', [], client),
    db.many('select id, name_en, name_ar, price from fabrics', [], client),
    db.many('select id, name_en, name_ar, hex from colours', [], client),
  ]);
  const byId = (list: any[], id: string) => list.find((x) => x.id === id);
  return rows.map((r) => {
    if (r.kind === 'product') {
      const line = round2(r.p_price * r.qty);
      return {
        id: r.id,
        kind: 'product' as const,
        qty: r.qty,
        unitPrice: r.p_price,
        lineTotal: line,
        points: Math.round(line * s.points.product_per_qar),
        product: { id: r.product_id, name_en: r.p_name_en, name_ar: r.p_name_ar, category: r.p_category, image_url: r.p_image_url },
        size: r.size,
      };
    }
    const fabric = byId(fabrics, r.thobe.fabricId);
    const unit = fabric?.price ?? 0;
    return {
      id: r.id,
      kind: 'thobe' as const,
      qty: r.qty,
      unitPrice: unit,
      lineTotal: round2(unit * r.qty),
      points: s.points.thobe_fixed * r.qty,
      thobe: {
        collar: byId(collars, r.thobe.collarId),
        fabric,
        colour: byId(colours, r.thobe.colourId),
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
  const items = await basketLines(customerId, client, settings);
  const subtotal = round2(items.reduce((a, i) => a + i.lineTotal, 0));
  const homeAppointments = new Set(items.filter((i: any) => i.kind === 'thobe' && i.measureMethod === 'home' && i.appointment).map((i: any) => i.appointment.id));
  const homeVisitFee = round2(homeAppointments.size * settings.home_visit_fee);
  const deliveryFee = items.length ? settings.delivery_fee : 0;

  const address = input.addressId
    ? await db.one('select id, label, line1, area, city, notes from addresses where id = $1 and customer_id = $2', [input.addressId, customerId], client)
    : await db.one('select id, label, line1, area, city, notes from addresses where customer_id = $1 order by is_default desc, created_at limit 1', [customerId], client);

  const vouchers = await db.many(
    `select v.id, v.code, v.kind, v.percent, v.product_id, v.expires_at, v.cost_points, p.name_en as product_name_en, p.name_ar as product_name_ar, p.price as product_price
       from vouchers v left join products p on p.id = v.product_id
      where v.customer_id = $1 and v.status = 'active' and v.expires_at > now() order by v.percent desc nulls last, v.expires_at`,
    [customerId],
    client,
  );

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
  let appliedVoucher: any = null;
  let rewardItem: any = null;
  const couponOk = coupon && !coupon.error;
  if (couponOk) {
    const raw = round2((subtotal * coupon!.percent!) / 100);
    discount = coupon!.maxDiscount ? Math.min(raw, coupon!.maxDiscount) : raw;
    discountLabel = `coupon:${coupon!.code}:${coupon!.percent}`;
  } else if (input.voucherId !== null && vouchers.length) {
    appliedVoucher = input.voucherId ? vouchers.find((v) => v.id === input.voucherId) ?? null : vouchers[0];
    if (appliedVoucher?.kind === 'discount') {
      discount = round2((subtotal * appliedVoucher.percent) / 100);
      discountLabel = `voucher:${appliedVoucher.code}:${appliedVoucher.percent}`;
    } else if (appliedVoucher?.kind === 'product') {
      discountLabel = `reward:${appliedVoucher.code}`;
      rewardItem = { product_id: appliedVoucher.product_id, name_en: appliedVoucher.product_name_en, name_ar: appliedVoucher.product_name_ar };
    }
  }
  discount = Math.min(discount, subtotal);
  const total = round2(subtotal + deliveryFee + homeVisitFee - discount);
  const pointsToEarn = items.reduce((a, i) => a + i.points, 0);

  return {
    items,
    count: items.reduce((a, i) => a + i.qty, 0),
    subtotal,
    deliveryFee,
    homeVisitFee,
    discount,
    discountLabel,
    total,
    pointsToEarn,
    address: address ?? null,
    coupon,
    couponReplacesVoucher: Boolean(couponOk && vouchers.length),
    appliedVoucher,
    rewardItem,
    vouchers,
  };
}
