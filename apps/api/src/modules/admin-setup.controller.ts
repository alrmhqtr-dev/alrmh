import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { db, type Queryable } from '../db.js';
import { DEFAULT_SETTINGS, fail, getSettings, listTiers, need } from '../lib.js';
import { AnyStaff, CurrentStaff, Managers, audit, staffGuard, type StaffUser } from '../staff.js';

const ProductEditors = staffGuard('products', 'manage');
const uuidOpt = (v: unknown, field: string) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) fail('invalid_input', { field });
  return v;
};
const qty = (v: unknown, field: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) fail('invalid_number', { field });
  return Math.round(n * 100) / 100;
};
/** Stock, cost and labelling fields shared by products and cloth. */
async function stockFields(b: any, table: 'products' | 'fabrics', id: string | null) {
  let sku: string | undefined;
  if (b.sku !== undefined && b.sku !== null && String(b.sku).trim() !== '') {
    sku = String(b.sku).trim().toUpperCase().slice(0, 40);
    if (!/^[A-Z0-9\-_.]+$/.test(sku)) fail('invalid_sku');
    const clash = await db.one(`select id from ${table} where upper(sku) = $1 and id <> coalesce($2, '')`, [sku, id]);
    if (clash) fail('sku_taken');
  }
  return {
    sku,
    cost: b.cost !== undefined ? money(b.cost, 'cost') : undefined,
    track_stock: typeof b.track_stock === 'boolean' ? b.track_stock : undefined,
    alert_qty: b.alert_qty !== undefined ? qty(b.alert_qty, 'alert_qty') : undefined,
    tax_rate_id: uuidOpt(b.tax_rate_id, 'tax_rate_id'),
  };
}
import { COLLAR_SHAPES } from './catalogue.controller.js';
import { MEDIA_PATH } from './media.controller.js';

const slug = (s: string) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || `item-${Date.now()}`;

const money = (v: unknown, field: string) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000) fail('invalid_number', { field });
  return Math.round(n * 100) / 100;
};
const int = (v: unknown, field: string, min: number, max: number) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail('invalid_number', { field, min, max });
  return n;
};
const text = (v: unknown, field: string, max = 120) => String(need(v as any, field)).trim().slice(0, max);
const dateOrNull = (v: unknown, field: string) => {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) fail('invalid_date', { field });
  return d.toISOString();
};
/** A product photo is either one uploaded here or a secure address elsewhere. */
const imageOrNull = (v: unknown) => {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!MEDIA_PATH.test(s) && !/^https:\/\/[^\s]+$/.test(s)) fail('invalid_image');
  return s.slice(0, 500);
};
const coordOrNull = (v: unknown, field: string, max: number) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > max) fail('invalid_number', { field });
  return n;
};
async function categoryId(v: unknown) {
  const row = await db.one<{ id: string }>('select id from categories where id = $1', [String(v ?? '')]);
  if (!row) fail('invalid_category');
  return row.id;
}
const limitOrNull = (v: unknown, field: string) => (v === undefined || v === null || v === '' ? null : int(Number(v), field, 1, 1000000));

async function uniqueId(table: string, base: string, client: Queryable = db.pool) {
  let id = slug(base);
  for (let i = 2; await db.one(`select 1 from ${table} where id = $1`, [id], client); i++) id = `${slug(base)}-${i}`;
  return id;
}

async function patchRow(table: string, id: string, fields: Record<string, unknown>) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const r = await db.pool.query(`update ${table} set ${sets} where id = $1`, [id, ...entries.map(([, v]) => v)]);
  if (!r.rowCount) throw new NotFoundException({ code: 'not_found' });
}

function tierFields(b: any, creating: boolean) {
  const out: { name_en?: string; name_ar?: string; min_points?: number; points_per_product?: number; points_per_thobe?: number; colour?: string } = {};
  if (creating || b?.name_en !== undefined) out.name_en = text(b?.name_en, 'name_en', 40);
  if (creating || b?.name_ar !== undefined) out.name_ar = text(b?.name_ar, 'name_ar', 40);
  if (creating || b?.min_points !== undefined) out.min_points = int(b?.min_points, 'min_points', 0, 1000000);
  if (creating || b?.points_per_product !== undefined) out.points_per_product = int(b?.points_per_product, 'points_per_product', 0, 10000);
  if (creating || b?.points_per_thobe !== undefined) out.points_per_thobe = int(b?.points_per_thobe, 'points_per_thobe', 0, 10000);
  if (b?.colour !== undefined) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(String(b.colour))) fail('invalid_colour');
    out.colour = String(b.colour);
  }
  return out;
}

@Controller('v1/admin')
export class AdminSetupController {
  /* ---------- catalogue ---------- */

  @Get('catalogue')
  @UseGuards(AnyStaff)
  async catalogue() {
    const [collars, cuffs, fabrics, colours, links, products, categories] = await Promise.all([
      db.many('select * from collars order by sort, name_en'),
      db.many('select * from cuffs order by sort, name_en'),
      db.many('select * from fabrics order by sort, name_en'),
      db.many('select * from colours order by sort, name_en'),
      db.many('select * from fabric_colours'),
      db.many('select * from products order by category, sort, name_en'),
      db.many('select c.*, (select count(*)::int from products p where p.category = c.id) as product_count from categories c order by c.sort, c.name_en'),
    ]);
    return {
      categories,
      collarShapes: COLLAR_SHAPES,
      collars,
      cuffs,
      colours,
      products,
      fabrics: fabrics.map((f) => ({ ...f, colour_ids: links.filter((l) => l.fabric_id === f.id).map((l) => l.colour_id) })),
    };
  }

  @Post('products')
  @UseGuards(ProductEditors)
  async addProduct(@CurrentStaff() me: StaffUser, @Body() b: any) {
    const category = await categoryId(b?.category);
    const id = await uniqueId('products', b.name_en ?? '');
    const extra = await stockFields(b ?? {}, 'products', null);
    await db.pool.query(
      `insert into products (id, category, name_en, name_ar, description_en, description_ar, price, sizes, image_url, active, sort, sku)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,(select coalesce(max(sort),0)+1 from products),$11)`,
      [id, category, text(b.name_en, 'name_en'), text(b.name_ar, 'name_ar'), String(b.description_en ?? '').slice(0, 400), String(b.description_ar ?? '').slice(0, 400), money(b.price, 'price'), cleanSizes(b.sizes), imageOrNull(b.image_url), b.active !== false, extra.sku ?? await freeSku('products', id.toUpperCase())],
    );
    await patchRow('products', id, { ...extra, sku: undefined, ...productLinks(b) });
    await audit(me, 'create', 'product', id, b);
    return { id };
  }

  @Patch('products/:id')
  @UseGuards(ProductEditors)
  async updateProduct(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    await patchRow('products', id, {
      ...(await stockFields(b, 'products', id)),
      ...productLinks(b),
      category: b.category !== undefined ? await categoryId(b.category) : undefined,
      name_en: b.name_en !== undefined ? text(b.name_en, 'name_en') : undefined,
      name_ar: b.name_ar !== undefined ? text(b.name_ar, 'name_ar') : undefined,
      description_en: b.description_en !== undefined ? String(b.description_en).slice(0, 400) : undefined,
      description_ar: b.description_ar !== undefined ? String(b.description_ar).slice(0, 400) : undefined,
      price: b.price !== undefined ? money(b.price, 'price') : undefined,
      sizes: b.sizes !== undefined ? cleanSizes(b.sizes) : undefined,
      image_url: b.image_url !== undefined ? imageOrNull(b.image_url) : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
    });
    await audit(me, 'update', 'product', id, b);
    return { ok: true };
  }

  @Post('categories')
  @UseGuards(ProductEditors)
  async addCategory(@CurrentStaff() me: StaffUser, @Body() b: any) {
    const id = await uniqueId('categories', b?.name_en ?? '');
    await db.pool.query('insert into categories (id, name_en, name_ar, sort) values ($1,$2,$3,(select coalesce(max(sort),0)+1 from categories))', [id, text(b.name_en, 'name_en', 40), text(b.name_ar, 'name_ar', 40)]);
    await audit(me, 'create', 'category', id, b);
    return { id };
  }

  @Patch('categories/:id')
  @UseGuards(ProductEditors)
  async updateCategory(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    await patchRow('categories', id, {
      name_en: b.name_en !== undefined ? text(b.name_en, 'name_en', 40) : undefined,
      name_ar: b.name_ar !== undefined ? text(b.name_ar, 'name_ar', 40) : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
    });
    await audit(me, 'update', 'category', id, b);
    return { ok: true };
  }

  @Post('collars')
  @UseGuards(Managers)
  async addCollar(@CurrentStaff() me: StaffUser, @Body() b: any) {
    if (b?.shape !== undefined && !COLLAR_SHAPES.includes(b.shape)) fail('invalid_shape');
    const id = await uniqueId('collars', b?.name_en ?? '');
    await db.pool.query('insert into collars (id, name_en, name_ar, shape, active, image_url, sort) values ($1,$2,$3,$4,$5,$6,(select coalesce(max(sort),0)+1 from collars))', [
      id,
      text(b.name_en, 'name_en'),
      text(b.name_ar, 'name_ar'),
      b.shape ?? 'classic-qatari',
      b.active !== false,
      imageOrNull(b.image_url),
    ]);
    await audit(me, 'create', 'collar', id, b);
    return { id };
  }

  @Patch('collars/:id')
  @UseGuards(Managers)
  async updateCollar(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    if (b.shape !== undefined && !COLLAR_SHAPES.includes(b.shape)) fail('invalid_shape');
    await patchRow('collars', id, {
      name_en: b.name_en !== undefined ? text(b.name_en, 'name_en') : undefined,
      name_ar: b.name_ar !== undefined ? text(b.name_ar, 'name_ar') : undefined,
      shape: b.shape,
      image_url: b.image_url !== undefined ? imageOrNull(b.image_url) : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
    });
    await audit(me, 'update', 'collar', id, b);
    return { ok: true };
  }

  /** Cuff styles (الكبك), chosen by picture at the counter and in the app. */
  @Post('cuffs')
  @UseGuards(Managers)
  async addCuff(@CurrentStaff() me: StaffUser, @Body() b: any) {
    const id = await uniqueId('cuffs', b?.name_en ?? '');
    await db.pool.query('insert into cuffs (id, name_en, name_ar, image_url, active, sort) values ($1,$2,$3,$4,$5,(select coalesce(max(sort),0)+1 from cuffs))', [
      id,
      text(b?.name_en, 'name_en'),
      text(b?.name_ar, 'name_ar'),
      imageOrNull(b?.image_url),
      b?.active !== false,
    ]);
    await audit(me, 'create', 'cuff', id, b);
    return { id };
  }

  @Patch('cuffs/:id')
  @UseGuards(Managers)
  async updateCuff(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    await patchRow('cuffs', id, {
      name_en: b.name_en !== undefined ? text(b.name_en, 'name_en') : undefined,
      name_ar: b.name_ar !== undefined ? text(b.name_ar, 'name_ar') : undefined,
      image_url: b.image_url !== undefined ? imageOrNull(b.image_url) : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
    });
    await audit(me, 'update', 'cuff', id, b);
    return { ok: true };
  }

  @Post('fabrics')
  @UseGuards(Managers)
  async addFabric(@CurrentStaff() me: StaffUser, @Body() b: any) {
    const id = await uniqueId('fabrics', b?.name_en ?? '');
    const extra = await stockFields(b ?? {}, 'fabrics', null);
    await db.tx(async (c) => {
      await c.query(
        'insert into fabrics (id, name_en, name_ar, note_en, note_ar, price, sort, sku) values ($1,$2,$3,$4,$5,$6,(select coalesce(max(sort),0)+1 from fabrics),$7)',
        [id, text(b.name_en, 'name_en'), text(b.name_ar, 'name_ar'), String(b.note_en ?? '').slice(0, 120), String(b.note_ar ?? '').slice(0, 120), money(b.price, 'price'), extra.sku ?? await freeSku('fabrics', `F-${id.toUpperCase()}`)],
      );
      await setFabricColours(id, b.colour_ids, c);
    });
    await patchRow('fabrics', id, { ...extra, sku: undefined, metres_per_thobe: b.metres_per_thobe !== undefined ? qty(b.metres_per_thobe, 'metres_per_thobe') : undefined });
    await audit(me, 'create', 'fabric', id, b);
    return { id };
  }

  @Patch('fabrics/:id')
  @UseGuards(Managers)
  async updateFabric(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    await patchRow('fabrics', id, {
      ...(await stockFields(b, 'fabrics', id)),
      metres_per_thobe: b.metres_per_thobe !== undefined ? qty(b.metres_per_thobe, 'metres_per_thobe') : undefined,
      name_en: b.name_en !== undefined ? text(b.name_en, 'name_en') : undefined,
      name_ar: b.name_ar !== undefined ? text(b.name_ar, 'name_ar') : undefined,
      note_en: b.note_en !== undefined ? String(b.note_en).slice(0, 120) : undefined,
      note_ar: b.note_ar !== undefined ? String(b.note_ar).slice(0, 120) : undefined,
      price: b.price !== undefined ? money(b.price, 'price') : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
    });
    if (b.colour_ids !== undefined) await db.tx((c) => setFabricColours(id, b.colour_ids, c));
    await audit(me, 'update', 'fabric', id, b);
    return { ok: true };
  }

  @Post('colours')
  @UseGuards(Managers)
  async addColour(@CurrentStaff() me: StaffUser, @Body() b: any) {
    if (!/^#[0-9a-fA-F]{6}$/.test(b?.hex ?? '')) fail('invalid_hex');
    const id = await uniqueId('colours', b.name_en ?? '');
    await db.pool.query('insert into colours (id, name_en, name_ar, hex, sort) values ($1,$2,$3,$4,(select coalesce(max(sort),0)+1 from colours))', [id, text(b.name_en, 'name_en'), text(b.name_ar, 'name_ar'), b.hex.toUpperCase()]);
    await audit(me, 'create', 'colour', id, b);
    return { id };
  }

  @Patch('colours/:id')
  @UseGuards(Managers)
  async updateColour(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    if (b.hex !== undefined && !/^#[0-9a-fA-F]{6}$/.test(b.hex)) fail('invalid_hex');
    await patchRow('colours', id, {
      name_en: b.name_en !== undefined ? text(b.name_en, 'name_en') : undefined,
      name_ar: b.name_ar !== undefined ? text(b.name_ar, 'name_ar') : undefined,
      hex: b.hex?.toUpperCase(),
    });
    await audit(me, 'update', 'colour', id, b);
    return { ok: true };
  }

  /* ---------- branches ---------- */

  @Get('branches')
  @UseGuards(AnyStaff)
  branches() {
    return db.many('select * from branches order by sort, name_en');
  }

  @Post('branches')
  @UseGuards(Managers)
  async addBranch(@CurrentStaff() me: StaffUser, @Body() b: any) {
    const extra = branchSlotFields(b ?? {});
    const r = await db.one(
      `insert into branches (name_en, name_ar, address_en, address_ar, phone, whatsapp, hours_en, hours_ar, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,(select coalesce(max(sort),0)+1 from branches)) returning id`,
      [text(b?.name_en, 'name_en'), text(b.name_ar, 'name_ar'), text(b.address_en, 'address_en'), text(b.address_ar, 'address_ar'), text(b.phone, 'phone'), text(b.whatsapp || b.phone, 'whatsapp'), text(b.hours_en, 'hours_en'), text(b.hours_ar, 'hours_ar')],
    );
    await patchRow('branches', r!.id, extra);
    await audit(me, 'create', 'branch', r!.id, b);
    return r;
  }

  @Patch('branches/:id')
  @UseGuards(Managers)
  async updateBranch(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    const cur = await db.one('select open_minute, close_minute from branches where id = $1', [id]);
    if (!cur) throw new NotFoundException({ code: 'not_found' });
    const slots = branchSlotFields(b, cur);
    await patchRow('branches', id, {
      name_en: b.name_en !== undefined ? text(b.name_en, 'name_en') : undefined,
      name_ar: b.name_ar !== undefined ? text(b.name_ar, 'name_ar') : undefined,
      address_en: b.address_en !== undefined ? text(b.address_en, 'address_en') : undefined,
      address_ar: b.address_ar !== undefined ? text(b.address_ar, 'address_ar') : undefined,
      phone: b.phone !== undefined ? text(b.phone, 'phone') : undefined,
      whatsapp: b.whatsapp !== undefined ? text(b.whatsapp, 'whatsapp') : undefined,
      hours_en: b.hours_en !== undefined ? text(b.hours_en, 'hours_en') : undefined,
      hours_ar: b.hours_ar !== undefined ? text(b.hours_ar, 'hours_ar') : undefined,
      ...slots,
    });
    await audit(me, 'update', 'branch', id, b);
    return { ok: true };
  }

  /* ---------- settings ---------- */

  @Get('settings')
  @UseGuards(AnyStaff)
  settings() {
    return getSettings();
  }

  @Patch('settings')
  @UseGuards(Managers)
  async updateSettings(@CurrentStaff() me: StaffUser, @Body() b: any) {
    const cur = await getSettings();
    const next = structuredClone(cur);
    if (b.delivery_fee !== undefined) next.delivery_fee = money(b.delivery_fee, 'delivery_fee');
    if (b.home_visit_fee !== undefined) next.home_visit_fee = money(b.home_visit_fee, 'home_visit_fee');
    if (b.lead_working_days !== undefined) next.lead_working_days = int(b.lead_working_days, 'lead_working_days', 1, 60);
    if (b.measurements_valid_months !== undefined) next.measurements_valid_months = int(b.measurements_valid_months, 'measurements_valid_months', 1, 60);
    if (b.appointment_fee !== undefined) next.appointment_fee = money(b.appointment_fee, 'appointment_fee');
    if (b.points) {
      const p = b.points;
      if (p.expiry_months !== undefined) next.points.expiry_months = int(p.expiry_months, 'expiry_months', 1, 60);
      if (p.warn_days !== undefined) next.points.warn_days = int(p.warn_days, 'warn_days', 1, 180);
    }
    if (b.home_visit) {
      const h = b.home_visit;
      if (h.windows !== undefined) {
        if (!Array.isArray(h.windows) || !h.windows.length || h.windows.length > 8) fail('invalid_windows');
        const ws = h.windows.map((w: any) => ({ start: int(w?.start, 'start', 0, 1440), end: int(w?.end, 'end', 0, 1440) })).sort((a: any, b: any) => a.start - b.start);
        for (const [i, w] of ws.entries()) {
          if (w.end <= w.start) fail('close_before_open');
          if (i > 0 && w.start < ws[i - 1].end) fail('windows_overlap');
        }
        next.home_visit.windows = ws;
      }
      if (h.capacity !== undefined) next.home_visit.capacity = int(h.capacity, 'capacity', 1, 50);
      if (h.closed_weekdays !== undefined) next.home_visit.closed_weekdays = cleanWeekdays(h.closed_weekdays);
    }
    if (b.pickup?.remind_after_days !== undefined) next.pickup.remind_after_days = int(b.pickup.remind_after_days, 'remind_after_days', 1, 30);
    if (b.support) {
      if (b.support.whatsapp !== undefined) next.support.whatsapp = text(b.support.whatsapp, 'whatsapp', 20);
      if (b.support.phone !== undefined) next.support.phone = text(b.support.phone, 'phone', 20);
    }
    await db.tx(async (c) => {
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof typeof next)[]) {
        if (JSON.stringify(next[key]) !== JSON.stringify(cur[key]))
          await c.query('insert into settings (key, value) values ($1,$2) on conflict (key) do update set value = excluded.value', [key, JSON.stringify(next[key])]);
      }
      await audit(me, 'update', 'settings', null, b, c);
    });
    return next;
  }

  /* ---------- tiers & coupons ---------- */

  @Get('tiers')
  @UseGuards(AnyStaff)
  async tiers() {
    const tiers = await listTiers();
    const counts = await db.many<{ id: string; n: number }>(
      `with life as (
         select c.id, greatest(coalesce((select sum(points) from points_ledger p where p.customer_id = c.id and p.kind in ('earn','adjust')),0),0) as pts
           from customers c where c.deleted_at is null
       )
       select t.id, (select count(*)::int from life where life.pts >= t.min_points
                       and not exists (select 1 from tiers u where u.min_points > t.min_points and life.pts >= u.min_points)) as n
         from tiers t`,
    );
    return tiers.map((t) => ({ ...t, customers: counts.find((x) => x.id === t.id)?.n ?? 0 }));
  }

  @Post('tiers')
  @UseGuards(Managers)
  async addTier(@CurrentStaff() me: StaffUser, @Body() b: any) {
    const fields = tierFields(b, true);
    const id = await uniqueId('tiers', slug(fields.name_en!));
    await this.assertThresholds(id, fields.min_points!);
    await db.pool.query(
      'insert into tiers (id, name_en, name_ar, min_points, points_per_product, points_per_thobe, colour) values ($1,$2,$3,$4,$5,$6,$7)',
      [id, fields.name_en, fields.name_ar, fields.min_points, fields.points_per_product, fields.points_per_thobe, fields.colour ?? '#B8B8B8'],
    );
    await audit(me, 'create', 'tier', id, b);
    return { id };
  }

  @Patch('tiers/:id')
  @UseGuards(Managers)
  async updateTier(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    const fields = tierFields(b, false);
    if (fields.min_points !== undefined) await this.assertThresholds(id, fields.min_points);
    await patchRow('tiers', id, fields);
    await audit(me, 'update', 'tier', id, b);
    return { ok: true };
  }

  @Delete('tiers/:id')
  @UseGuards(Managers)
  async deleteTier(@CurrentStaff() me: StaffUser, @Param('id') id: string) {
    const t = await db.one('select id, min_points from tiers where id = $1', [id]);
    if (!t) throw new NotFoundException({ code: 'not_found' });
    if (t.min_points === 0) fail('starting_tier');
    await db.pool.query('delete from tiers where id = $1', [id]);
    await audit(me, 'delete', 'tier', id);
    return { ok: true };
  }

  /** Every customer starts on the tier at 0 points, and no two tiers share a threshold. */
  private async assertThresholds(id: string, minPoints: number) {
    const others = await db.many<{ id: string; min_points: number }>('select id, min_points from tiers where id <> $1', [id]);
    if (others.some((o) => o.min_points === minPoints)) fail('tier_threshold_taken');
    const current = await db.one('select min_points from tiers where id = $1', [id]);
    if (current?.min_points === 0 && minPoints !== 0) fail('starting_tier');
  }

  @Get('coupons')
  @UseGuards(AnyStaff)
  coupons() {
    return db.many(
      `select c.*, (select count(*)::int from orders o where o.coupon_code = c.code and o.paid_at is not null) as uses
         from coupons c order by c.active desc, c.expires_at desc nulls first`,
    );
  }

  @Post('coupons')
  @UseGuards(Managers)
  async addCoupon(@CurrentStaff() me: StaffUser, @Body() b: any) {
    const code = String(need(b?.code, 'code')).trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) fail('invalid_code');
    if (await db.one('select 1 from coupons where upper(code) = $1', [code])) fail('code_taken');
    await db.pool.query(
      `insert into coupons (code, percent, max_discount, starts_at, expires_at, active, per_customer_limit, max_uses, min_subtotal) values ($1,$2,$3,$4,$5,true,$6,$7,$8)`,
      [
        code,
        int(b.percent, 'percent', 1, 100),
        b.max_discount ? money(b.max_discount, 'max_discount') : null,
        dateOrNull(b.starts_at, 'starts_at'),
        dateOrNull(b.expires_at, 'expires_at'),
        // One use per customer unless the form says otherwise (an empty value means no limit).
        b.per_customer_limit === undefined ? 1 : limitOrNull(b.per_customer_limit, 'per_customer_limit'),
        limitOrNull(b.max_uses, 'max_uses'),
        b.min_subtotal ? money(b.min_subtotal, 'min_subtotal') : null,
      ],
    );
    await audit(me, 'create', 'coupon', code, b);
    return { code };
  }

  @Patch('coupons/:code')
  @UseGuards(Managers)
  async updateCoupon(@CurrentStaff() me: StaffUser, @Param('code') code: string, @Body() b: any) {
    const sets: string[] = [];
    const vals: unknown[] = [code.toUpperCase()];
    const add = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}`);
    };
    if (b.percent !== undefined) add('percent', int(b.percent, 'percent', 1, 100));
    if (b.max_discount !== undefined) add('max_discount', b.max_discount ? money(b.max_discount, 'max_discount') : null);
    if (b.expires_at !== undefined) add('expires_at', dateOrNull(b.expires_at, 'expires_at'));
    if (b.starts_at !== undefined) add('starts_at', dateOrNull(b.starts_at, 'starts_at'));
    if (b.per_customer_limit !== undefined) add('per_customer_limit', limitOrNull(b.per_customer_limit, 'per_customer_limit'));
    if (b.max_uses !== undefined) add('max_uses', limitOrNull(b.max_uses, 'max_uses'));
    if (b.min_subtotal !== undefined) add('min_subtotal', b.min_subtotal ? money(b.min_subtotal, 'min_subtotal') : null);
    if (typeof b.active === 'boolean') add('active', b.active);
    if (sets.length) {
      const r = await db.pool.query(`update coupons set ${sets.join(', ')} where upper(code) = $1`, vals);
      if (!r.rowCount) throw new NotFoundException({ code: 'not_found' });
    }
    await audit(me, 'update', 'coupon', code, b);
    return { ok: true };
  }
}

/** Booking times, map position and visibility of a branch. Opening must stay before closing, also when only one of them changes. */
function branchSlotFields(b: any, current: { open_minute: number; close_minute: number } = { open_minute: 960, close_minute: 1260 }) {
  const open = b.open_minute !== undefined ? int(b.open_minute, 'open_minute', 0, 1440) : undefined;
  const close = b.close_minute !== undefined ? int(b.close_minute, 'close_minute', 0, 1440) : undefined;
  if ((open !== undefined || close !== undefined) && (close ?? current.close_minute) <= (open ?? current.open_minute)) fail('close_before_open');
  return {
    open_minute: open,
    close_minute: close,
    slot_minutes: b.slot_minutes !== undefined ? int(b.slot_minutes, 'slot_minutes', 15, 240) : undefined,
    slot_capacity: b.slot_capacity !== undefined ? int(b.slot_capacity, 'slot_capacity', 1, 50) : undefined,
    closed_weekdays: b.closed_weekdays !== undefined ? cleanWeekdays(b.closed_weekdays) : undefined,
    lat: b.lat !== undefined ? coordOrNull(b.lat, 'lat', 90) : undefined,
    lng: b.lng !== undefined ? coordOrNull(b.lng, 'lng', 180) : undefined,
    active: typeof b.active === 'boolean' ? b.active : undefined,
  };
}

function productLinks(b: any) {
  return {
    brand_id: uuidOpt(b.brand_id, 'brand_id'),
    unit_id: uuidOpt(b.unit_id, 'unit_id'),
    warranty_id: uuidOpt(b.warranty_id, 'warranty_id'),
    in_app: typeof b.in_app === 'boolean' ? b.in_app : undefined,
  };
}

/** The suggested code if free, else the same with a number after it. */
export async function freeSku(table: 'products' | 'fabrics', base: string) {
  const root = base.toUpperCase().replace(/[^A-Z0-9\-_.]+/g, '-').slice(0, 36) || 'ITEM';
  let sku = root;
  for (let i = 2; await db.one(`select 1 from ${table} where upper(sku) = $1`, [sku]); i++) sku = `${root}-${i}`;
  return sku;
}

function cleanSizes(v: unknown): string[] {
  const list = Array.isArray(v) ? v : String(v ?? '').split(',');
  return list.map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
}

function cleanWeekdays(v: unknown): number[] {
  if (!Array.isArray(v)) fail('invalid_weekdays');
  const days = [...new Set((v as unknown[]).map(Number))];
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) fail('invalid_weekdays');
  return days.sort();
}

async function setFabricColours(fabricId: string, ids: unknown, c: Queryable) {
  if (ids === undefined) return;
  if (!Array.isArray(ids) || !ids.length) fail('colours_required');
  const known = await db.many<{ id: string }>('select id from colours where id = any($1::text[])', [ids], c);
  if (known.length !== new Set(ids as string[]).size) fail('unknown_colour');
  await c.query('delete from fabric_colours where fabric_id = $1', [fabricId]);
  for (const id of new Set(ids as string[])) await c.query('insert into fabric_colours (fabric_id, colour_id) values ($1,$2)', [fabricId, id]);
}
