import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { fail, getSettings, need, round2 } from '../lib.js';
import { parseCsv } from '../csv.js';
import { moveStock, nextNumber, stockLevel } from '../pos.js';
import { AnyStaff, CurrentStaff, ProductsGuard, staffGuard, audit, type StaffUser } from '../staff.js';
import { range, uuidOrNull } from './pos.controller.js';
import { freeSku } from './admin-setup.controller.js';

type Line = { kind: 'product' | 'fabric'; id: string; size?: string | null; qty: number; unitCost?: number | null };

/** Checks an item exists (and the size, for products with sizes) and returns its name and cost. */
async function item(l: Line) {
  if (l?.kind === 'product') {
    const p = await db.one('select id, name_en, name_ar, sizes, cost::float as cost from products where id = $1', [l.id]);
    if (!p) fail('product_not_found', { productId: l.id });
    if (p.sizes.length && !p.sizes.includes(l.size)) fail('size_required', { productId: p.id });
    return { ...p, size: p.sizes.length ? String(l.size) : '' };
  }
  if (l?.kind === 'fabric') {
    const f = await db.one('select id, name_en, name_ar, cost::float as cost from fabrics where id = $1', [l.id]);
    if (!f) fail('fabric_not_found', { fabricId: l.id });
    return { ...f, size: '' };
  }
  return fail('invalid_kind');
}

const STOCK_ITEMS = `
  select 'product' as kind, p.id, p.sku, p.name_en, p.name_ar, s.size, p.cost::float as cost, p.price::float as price, p.alert_qty::float as alert_qty, p.category, u.short_name as unit
    from products p cross join lateral unnest(case when cardinality(p.sizes) = 0 then array[''] else p.sizes end) as s(size)
    left join units u on u.id = p.unit_id where p.track_stock and p.active
  union all
  select 'fabric', f.id, f.sku, f.name_en, f.name_ar, '', f.cost::float, f.price::float, f.alert_qty::float, 'fabric', 'm' from fabrics f where f.track_stock and f.active`;

@Controller('v1/admin')
export class InventoryController {
  /** Stock of every tracked item, per branch. */
  @Get('stock')
  @UseGuards(AnyStaff)
  async stock(@Query('branch') branch?: string, @Query('q') q?: string, @Query('low') low?: string) {
    const needle = q?.trim() ? `%${q.trim()}%` : null;
    const rows = await db.many(
      `with items as (${STOCK_ITEMS}),
            levels as (select item_kind, item_id, size, branch_id, sum(qty)::float as qty from stock_moves group by 1,2,3,4)
       select i.*, b.id as branch_id, b.name_en as branch_en, b.name_ar as branch_ar, coalesce(l.qty, 0) as qty
         from items i cross join branches b
         left join levels l on l.item_kind = i.kind and l.item_id = i.id and l.size = i.size and l.branch_id = b.id
        where b.active and ($1::uuid is null or b.id = $1)
          and ($2::text is null or i.sku ilike $2 or i.name_en ilike $2 or i.name_ar ilike $2)
        order by i.kind desc, i.name_en, i.size, b.name_en`,
      [uuidOrNull(branch), needle],
    );
    const out = rows.map((r) => ({ ...r, value: round2(r.qty * r.cost), low: r.qty <= r.alert_qty }));
    return low === '1' ? out.filter((r) => r.low) : out;
  }

  @Get('stock/history')
  @UseGuards(AnyStaff)
  history(@Query('kind') kind: string, @Query('id') id: string, @Query('branch') branch?: string) {
    return db.many(
      `select m.id, m.created_at, m.qty::float as qty, m.size, m.reason, m.ref_type, m.ref_id, m.note, m.unit_cost::float as unit_cost,
              b.name_en as branch_en, b.name_ar as branch_ar, u.name as staff_name,
              case m.ref_type when 'order' then (select number from orders where id::text = m.ref_id)
                              when 'purchase' then (select number from purchases where id::text = m.ref_id)
                              when 'adjustment' then (select number from stock_adjustments where id::text = m.ref_id)
                              when 'transfer' then (select number from stock_transfers where id::text = m.ref_id)
                              when 'return' then (select number from sales_returns where id::text = m.ref_id) end as ref_number
         from stock_moves m join branches b on b.id = m.branch_id left join staff_users u on u.id = m.staff_id
        where m.item_kind = $1 and m.item_id = $2 and ($3::uuid is null or m.branch_id = $3)
        order by m.created_at desc limit 300`,
      [kind, id, uuidOrNull(branch)],
    );
  }

  /* ---------- adjustments ---------- */

  @Get('stock/adjustments')
  @UseGuards(AnyStaff)
  adjustments(@Query('from') from?: string, @Query('to') to?: string) {
    const rg = range(from, to, 90);
    return db.many(
      `select a.*, b.name_en as branch_en, b.name_ar as branch_ar, u.name as staff_name,
              (select json_agg(json_build_object('kind', m.item_kind, 'id', m.item_id, 'size', m.size, 'qty', m.qty::float, 'cost', m.unit_cost::float)) from stock_moves m where m.ref_type = 'adjustment' and m.ref_id = a.id::text) as lines,
              coalesce((select sum(m.qty * coalesce(m.unit_cost,0)) from stock_moves m where m.ref_type = 'adjustment' and m.ref_id = a.id::text),0)::float as value
         from stock_adjustments a join branches b on b.id = a.branch_id left join staff_users u on u.id = a.staff_id
        where (a.created_at at time zone 'Asia/Qatar')::date between $1::date and $2::date order by a.created_at desc`,
      [rg.from, rg.to],
    );
  }

  @Post('stock/adjustments')
  @UseGuards(ProductsGuard)
  async adjust(@CurrentStaff() me: StaffUser, @Body() b: { branchId?: string; kind?: string; reason?: string; lines?: Line[] }) {
    const branch = await db.one('select id from branches where id = $1', [uuidOrNull(b?.branchId)]);
    if (!branch) fail('branch_not_found');
    const lines = Array.isArray(b?.lines) ? b.lines : [];
    if (!lines.length || lines.length > 200) fail('invalid_lines');
    return db.tx(async (c) => {
      const number = await nextNumber('adjustment_number_seq', 'ADJ-', c);
      const a = await db.one('insert into stock_adjustments (number, branch_id, kind, reason, staff_id) values ($1,$2,$3,$4,$5) returning id', [
        number,
        branch.id,
        b.kind === 'abnormal' ? 'abnormal' : 'normal',
        b.reason ? String(b.reason).slice(0, 300) : null,
        me.id,
      ], c);
      for (const l of lines) {
        const it = await item(l);
        const q = round2(Number(l.qty));
        if (!Number.isFinite(q) || q === 0 || Math.abs(q) > 1_000_000) fail('invalid_qty');
        await moveStock(c, { branchId: branch.id, kind: l.kind, id: it.id, size: it.size, qty: q, reason: 'adjust', refType: 'adjustment', refId: a.id, unitCost: it.cost, staffId: me.id, note: b.reason ?? null });
      }
      await audit(me, 'create', 'stock_adjustment', a.id, { number, lines }, c);
      return { id: a.id, number };
    });
  }

  /**
   * New stock arriving: metres of cloth or a quantity of a product, added to a branch.
   * Turns on stock tracking for the item if it was off.
   */
  @Post('stock/receive')
  @UseGuards(ProductsGuard)
  async receive(@CurrentStaff() me: StaffUser, @Body() b: { branchId?: string; kind?: 'product' | 'fabric'; id?: string; size?: string | null; qty?: number; note?: string }) {
    const branch = await db.one('select id from branches where id = $1 and active', [uuidOrNull(b?.branchId)]);
    if (!branch) fail('branch_not_found');
    const it = await item({ kind: b?.kind as any, id: String(b?.id ?? ''), size: b?.size ?? null, qty: 0 });
    const q = round2(Number(b?.qty));
    if (!Number.isFinite(q) || q <= 0 || q > 1_000_000) fail('invalid_qty');
    if (b.kind === 'product' && !Number.isInteger(q)) fail('invalid_qty');
    return db.tx(async (c) => {
      await c.query(`update ${b.kind === 'fabric' ? 'fabrics' : 'products'} set track_stock = true where id = $1 and not track_stock`, [it.id]);
      await moveStock(c, { branchId: branch.id, kind: b.kind as 'product' | 'fabric', id: it.id, size: it.size, qty: q, reason: 'received', unitCost: it.cost, staffId: me.id, note: b.note ? String(b.note).slice(0, 200) : null });
      await audit(me, 'receive', 'stock', it.id, { branch: branch.id, kind: b.kind, size: it.size, qty: q }, c);
      return { level: await stockLevel({ kind: b.kind as 'product' | 'fabric', id: it.id, size: it.size }, branch.id, c) };
    });
  }

  /* ---------- transfers between branches ---------- */

  @Get('stock/transfers')
  @UseGuards(AnyStaff)
  transfers(@Query('from') from?: string, @Query('to') to?: string) {
    const rg = range(from, to, 90);
    return db.many(
      `select t.*, fb.name_en as from_en, fb.name_ar as from_ar, tb.name_en as to_en, tb.name_ar as to_ar, u.name as staff_name,
              (select json_agg(json_build_object('kind', m.item_kind, 'id', m.item_id, 'size', m.size, 'qty', m.qty::float)) from stock_moves m where m.ref_type = 'transfer' and m.ref_id = t.id::text and m.reason = 'transfer_in') as lines
         from stock_transfers t join branches fb on fb.id = t.from_branch_id join branches tb on tb.id = t.to_branch_id left join staff_users u on u.id = t.staff_id
        where (t.created_at at time zone 'Asia/Qatar')::date between $1::date and $2::date order by t.created_at desc`,
      [rg.from, rg.to],
    );
  }

  @Post('stock/transfers')
  @UseGuards(ProductsGuard)
  async transfer(@CurrentStaff() me: StaffUser, @Body() b: { fromBranchId?: string; toBranchId?: string; note?: string; lines?: Line[] }) {
    const from = uuidOrNull(b?.fromBranchId);
    const to = uuidOrNull(b?.toBranchId);
    if (!from || !to || from === to) fail('invalid_branches');
    const lines = Array.isArray(b?.lines) ? b.lines : [];
    if (!lines.length || lines.length > 200) fail('invalid_lines');
    const settings = await getSettings();
    return db.tx(async (c) => {
      const number = await nextNumber('transfer_number_seq', 'TR-', c);
      const t = await db.one('insert into stock_transfers (number, from_branch_id, to_branch_id, note, staff_id) values ($1,$2,$3,$4,$5) returning id', [number, from, to, b.note ? String(b.note).slice(0, 300) : null, me.id], c);
      for (const l of lines) {
        const it = await item(l);
        const q = round2(Number(l.qty));
        if (!(q > 0)) fail('invalid_qty');
        await c.query('select pg_advisory_xact_lock(hashtext($1))', [`stock:${l.kind}:${it.id}:${it.size}:${from}`]);
        if (!settings.pos.allow_negative_stock && (await stockLevel({ kind: l.kind, id: it.id, size: it.size }, from, c)) < q) fail('out_of_stock', { item: it.name_en, size: it.size || null });
        await moveStock(c, { branchId: from, kind: l.kind, id: it.id, size: it.size, qty: -q, reason: 'transfer_out', refType: 'transfer', refId: t.id, unitCost: it.cost, staffId: me.id });
        await moveStock(c, { branchId: to, kind: l.kind, id: it.id, size: it.size, qty: q, reason: 'transfer_in', refType: 'transfer', refId: t.id, unitCost: it.cost, staffId: me.id });
      }
      await audit(me, 'create', 'stock_transfer', t.id, { number, from, to, lines }, c);
      return { id: t.id, number };
    });
  }

  /* ---------- reorder suggestions (التوصيات) ---------- */

  /** Items at or under their alert level, with what sold in the last 30 days to help decide how much to buy. */
  @Get('stock/suggestions')
  @UseGuards(AnyStaff)
  async suggestions() {
    const rows = await db.many(
      `with items as (${STOCK_ITEMS}),
            levels as (select item_kind, item_id, size, sum(qty)::float as qty from stock_moves group by 1,2,3),
            sold as (select item_kind, item_id, size, -sum(qty)::float as qty from stock_moves where reason = 'sale' and created_at > now() - interval '30 days' group by 1,2,3)
       select i.*, coalesce(l.qty,0) as qty, coalesce(s.qty,0) as sold_30d,
              (select sp.name from purchase_lines pl join purchases p on p.id = pl.purchase_id join suppliers sp on sp.id = p.supplier_id
                where pl.item_kind = i.kind and pl.item_id = i.id order by p.purchase_date desc limit 1) as last_supplier
         from items i left join levels l on l.item_kind = i.kind and l.item_id = i.id and l.size = i.size
         left join sold s on s.item_kind = i.kind and s.item_id = i.id and s.size = i.size
        where coalesce(l.qty,0) <= i.alert_qty or (coalesce(s.qty,0) > 0 and coalesce(l.qty,0) < coalesce(s.qty,0) / 2)
        order by coalesce(l.qty,0) - i.alert_qty, i.name_en`,
    );
    // Enough for the next month at the current pace, and at least back over the alert level.
    return rows.map((r) => ({ ...r, suggested: Math.max(0, Math.ceil(Math.max(r.sold_30d, r.alert_qty * 2) - r.qty)) }));
  }

  /* ---------- imports ---------- */

  @Post('import/products')
  @HttpCode(200)
  @UseGuards(ProductsGuard)
  async importProducts(@CurrentStaff() me: StaffUser, @Body() b: { csv?: string }) {
    const rows = parseCsv(String(need(b?.csv, 'csv')));
    if (rows.length > 10000) fail('too_many_rows');
    const categories = await db.many<{ id: string; name_en: string; name_ar: string }>('select id, name_en, name_ar from categories');
    const brands = await db.many<{ id: string; name: string }>('select id, name from brands');
    let added = 0;
    let updated = 0;
    const errors: { row: number; error: string }[] = [];
    await db.tx(async (c) => {
      for (const [i, r] of rows.entries()) {
        const nameEn = (r.name_en || r.name || r.product_name || '').slice(0, 120);
        const nameAr = (r.name_ar || r['الاسم'] || nameEn).slice(0, 120);
        const price = Number(r.price || r.selling_price || r.sell_price);
        if (!nameEn || !Number.isFinite(price) || price < 0) {
          errors.push({ row: i + 2, error: !nameEn ? 'missing_name' : 'invalid_price' });
          continue;
        }
        const catName = (r.category || '').trim();
        let cat = categories.find((x) => x.id === catName || x.name_en.toLowerCase() === catName.toLowerCase() || x.name_ar === catName);
        if (!cat && catName) {
          const id = catName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `cat-${categories.length + 1}`;
          await c.query('insert into categories (id, name_en, name_ar, sort) values ($1,$2,$3,(select coalesce(max(sort),0)+1 from categories)) on conflict (id) do nothing', [id, catName, catName]);
          cat = { id, name_en: catName, name_ar: catName };
          categories.push(cat);
        }
        cat = cat ?? categories[0];
        let brandId: string | null = null;
        if (r.brand) {
          let br = brands.find((x) => x.name.toLowerCase() === r.brand.toLowerCase());
          if (!br) {
            br = (await db.one<{ id: string; name: string }>('insert into brands (name) values ($1) returning id, name', [r.brand.slice(0, 80)], c))!;
            brands.push(br);
          }
          brandId = br.id;
        }
        const sku = (r.sku || '').trim().toUpperCase().slice(0, 40);
        const cost = Number(r.cost || r.purchase_price || 0);
        const sizes = (r.sizes || '').split(/[|,]/).map((s) => s.trim()).filter(Boolean).slice(0, 20);
        const existing = sku ? await db.one('select id from products where upper(sku) = $1', [sku], c) : null;
        if (existing) {
          await c.query('update products set name_en = $2, name_ar = $3, price = $4, cost = $5, category = $6, brand_id = coalesce($7, brand_id) where id = $1', [existing.id, nameEn, nameAr, price, Number.isFinite(cost) ? cost : 0, cat.id, brandId]);
          updated++;
          continue;
        }
        const base = nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || `item-${i}`;
        let id = base;
        for (let k = 2; await db.one('select 1 from products where id = $1', [id], c); k++) id = `${base}-${k}`;
        await c.query(
          `insert into products (id, sku, category, name_en, name_ar, description_en, description_ar, price, cost, sizes, brand_id, track_stock, alert_qty, in_app, active, sort)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true,(select coalesce(max(sort),0)+1 from products))`,
          [
            id,
            sku || (await freeSku('products', id)),
            cat.id,
            nameEn,
            nameAr,
            (r.description_en || r.description || '').slice(0, 400),
            (r.description_ar || '').slice(0, 400),
            price,
            Number.isFinite(cost) ? cost : 0,
            sizes,
            brandId,
            /^(1|yes|true|نعم)$/i.test(r.track_stock || 'yes'),
            Number(r.alert_qty || r.alert_quantity || 0) || 0,
            /^(1|yes|true|نعم)$/i.test(r.in_app || 'no'),
          ],
        );
        added++;
      }
      await audit(me, 'import', 'products', null, { added, updated, errors: errors.length }, c);
    });
    return { added, updated, skipped: 0, errors: errors.slice(0, 50), errorCount: errors.length };
  }

  /** Opening stock: what is on the shelves when the POS starts. Columns: sku, size, branch, qty, unit_cost. */
  @Post('import/opening-stock')
  @HttpCode(200)
  @UseGuards(ProductsGuard)
  async importOpening(@CurrentStaff() me: StaffUser, @Body() b: { csv?: string; branchId?: string }) {
    const rows = parseCsv(String(need(b?.csv, 'csv')));
    if (rows.length > 20000) fail('too_many_rows');
    const branches = await db.many<{ id: string; name_en: string; name_ar: string }>('select id, name_en, name_ar from branches');
    const fallback = uuidOrNull(b?.branchId) ?? branches[0]?.id;
    let added = 0;
    const errors: { row: number; error: string }[] = [];
    await db.tx(async (c) => {
      for (const [i, r] of rows.entries()) {
        const sku = (r.sku || '').trim().toUpperCase();
        const qty = Number(r.qty || r.quantity);
        const branch = r.branch ? branches.find((x) => x.name_en.toLowerCase() === r.branch.toLowerCase() || x.name_ar === r.branch || x.id === r.branch)?.id : fallback;
        if (!branch) {
          errors.push({ row: i + 2, error: 'unknown_branch' });
          continue;
        }
        if (!Number.isFinite(qty) || qty === 0) {
          errors.push({ row: i + 2, error: 'invalid_qty' });
          continue;
        }
        const p = await db.one('select id, sizes, cost::float as cost from products where upper(sku) = $1', [sku], c);
        const f = p ? null : await db.one('select id, cost::float as cost from fabrics where upper(sku) = $1', [sku], c);
        if (!p && !f) {
          errors.push({ row: i + 2, error: 'unknown_sku' });
          continue;
        }
        const size = p && p.sizes.length ? r.size : '';
        if (p && p.sizes.length && !p.sizes.includes(size)) {
          errors.push({ row: i + 2, error: 'unknown_size' });
          continue;
        }
        const cost = r.unit_cost ? Number(r.unit_cost) : (p ?? f).cost;
        await moveStock(c, { branchId: branch, kind: p ? 'product' : 'fabric', id: (p ?? f).id, size, qty, reason: 'opening', refType: 'import', unitCost: Number.isFinite(cost) ? cost : null, staffId: me.id });
        await c.query(`update ${p ? 'products' : 'fabrics'} set track_stock = true${r.unit_cost && Number.isFinite(cost) ? ', cost = $2' : ''} where id = $1`, r.unit_cost && Number.isFinite(cost) ? [(p ?? f).id, cost] : [(p ?? f).id]);
        added++;
      }
      await audit(me, 'import', 'opening_stock', null, { added, errors: errors.length }, c);
    });
    return { added, skipped: 0, errors: errors.slice(0, 50), errorCount: errors.length };
  }

  /**
   * Past sales from Mada, for reports and the sales chart. They are kept as
   * finished sales without item detail and are not shown in the customer app.
   * Columns: invoice, date, customer, mobile, branch, total, paid, method.
   */
  @Post('import/sales')
  @HttpCode(200)
  @UseGuards(staffGuard('reports', 'manage'))
  async importSales(@CurrentStaff() me: StaffUser, @Body() b: { csv?: string }) {
    const rows = parseCsv(String(need(b?.csv, 'csv')));
    if (rows.length > 50000) fail('too_many_rows');
    const branches = await db.many<{ id: string; name_en: string; name_ar: string }>('select id, name_en, name_ar from branches order by sort');
    let added = 0;
    let skipped = 0;
    const errors: { row: number; error: string }[] = [];
    await db.tx(async (c) => {
      for (const [i, r] of rows.entries()) {
        const invoice = (r.invoice || r.invoice_no || r.number || r['رقم_الفاتورة'] || '').trim().slice(0, 40);
        const when = new Date(r.date || r.transaction_date || '');
        const total = Number(r.total || r.total_amount);
        if (!invoice || Number.isNaN(when.getTime()) || !Number.isFinite(total) || total < 0) {
          errors.push({ row: i + 2, error: !invoice ? 'missing_invoice' : Number.isNaN(when.getTime()) ? 'invalid_date' : 'invalid_total' });
          continue;
        }
        const number = `M-${invoice}`;
        if (await db.one('select 1 from orders where number = $1', [number], c)) {
          skipped++;
          continue;
        }
        const branch = r.branch ? branches.find((x) => x.name_en.toLowerCase() === r.branch.toLowerCase() || x.name_ar === r.branch)?.id ?? branches[0]?.id : branches[0]?.id;
        const paid = r.paid !== undefined && r.paid !== '' ? Math.min(total, Number(r.paid) || 0) : total;
        const o = await db.one(
          `insert into orders (number, customer_id, stage, subtotal, delivery_fee, total, address, created_at, paid_at, channel, branch_id, walk_in_name, walk_in_phone, points_awarded)
           values ($1, null, 'delivered', $2, 0, $2, $3, $4, $5, 'import', $6, $7, $8, true) returning id`,
          [number, total, { pickup: true, counter: true, branchId: branch, imported: true }, when, paid > 0 ? when : null, branch, (r.customer || r.customer_name || '').slice(0, 80) || null, (r.mobile || r.phone || '').slice(0, 20) || null],
          c,
        );
        await c.query(`insert into order_items (order_id, kind, snapshot, qty, unit_price, line_total) values ($1, 'imported', $2, 1, $3, $3)`, [o!.id, { imported: true, invoice }, total]);
        if (paid > 0) {
          const method = /card|بطاق|mada|visa/i.test(r.method || '') ? 'card_machine' : /bank|تحويل/i.test(r.method || '') ? 'bank_transfer' : 'cash';
          await c.query(`insert into payments (order_id, provider, amount, status, provider_ref, created_at, completed_at) values ($1,$2,$3,'paid',$4,$5,$5)`, [o!.id, method, paid, `MADA-${invoice}`, when]);
        }
        await c.query(`insert into order_events (order_id, stage, at, note) values ($1, 'delivered', $2, 'imported')`, [o!.id, when]);
        added++;
      }
      await audit(me, 'import', 'sales', null, { added, skipped, errors: errors.length }, c);
    });
    return { added, skipped, errors: errors.slice(0, 50), errorCount: errors.length };
  }
}
