import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { db, type Queryable } from '../db.js';
import { DEFAULT_SETTINGS, fail, getSettings, need } from '../lib.js';
import { AnyStaff, CurrentStaff, Managers, audit, type StaffUser } from '../staff.js';
import { CATEGORIES } from './catalogue.controller.js';

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

@Controller('v1/admin')
export class AdminSetupController {
  /* ---------- catalogue ---------- */

  @Get('catalogue')
  @UseGuards(AnyStaff)
  async catalogue() {
    const [collars, fabrics, colours, links, products] = await Promise.all([
      db.many('select * from collars order by sort, name_en'),
      db.many('select * from fabrics order by sort, name_en'),
      db.many('select * from colours order by sort, name_en'),
      db.many('select * from fabric_colours'),
      db.many('select * from products order by category, sort, name_en'),
    ]);
    return {
      categories: CATEGORIES,
      collars,
      colours,
      products,
      fabrics: fabrics.map((f) => ({ ...f, colour_ids: links.filter((l) => l.fabric_id === f.id).map((l) => l.colour_id) })),
    };
  }

  @Post('products')
  @UseGuards(Managers)
  async addProduct(@CurrentStaff() me: StaffUser, @Body() b: any) {
    if (!CATEGORIES.includes(b?.category)) fail('invalid_category');
    const id = await uniqueId('products', b.name_en ?? '');
    await db.pool.query(
      `insert into products (id, category, name_en, name_ar, description_en, description_ar, price, sizes, image_url, active, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,(select coalesce(max(sort),0)+1 from products))`,
      [id, b.category, text(b.name_en, 'name_en'), text(b.name_ar, 'name_ar'), String(b.description_en ?? '').slice(0, 400), String(b.description_ar ?? '').slice(0, 400), money(b.price, 'price'), cleanSizes(b.sizes), b.image_url || null, b.active !== false],
    );
    await audit(me, 'create', 'product', id, b);
    return { id };
  }

  @Patch('products/:id')
  @UseGuards(Managers)
  async updateProduct(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    if (b.category !== undefined && !CATEGORIES.includes(b.category)) fail('invalid_category');
    await patchRow('products', id, {
      category: b.category,
      name_en: b.name_en !== undefined ? text(b.name_en, 'name_en') : undefined,
      name_ar: b.name_ar !== undefined ? text(b.name_ar, 'name_ar') : undefined,
      description_en: b.description_en !== undefined ? String(b.description_en).slice(0, 400) : undefined,
      description_ar: b.description_ar !== undefined ? String(b.description_ar).slice(0, 400) : undefined,
      price: b.price !== undefined ? money(b.price, 'price') : undefined,
      sizes: b.sizes !== undefined ? cleanSizes(b.sizes) : undefined,
      image_url: b.image_url !== undefined ? b.image_url || null : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
    });
    await audit(me, 'update', 'product', id, b);
    return { ok: true };
  }

  @Post('collars')
  @UseGuards(Managers)
  async addCollar(@CurrentStaff() me: StaffUser, @Body() b: any) {
    const id = await uniqueId('collars', b?.name_en ?? '');
    await db.pool.query('insert into collars (id, name_en, name_ar, sort) values ($1,$2,$3,(select coalesce(max(sort),0)+1 from collars))', [id, text(b.name_en, 'name_en'), text(b.name_ar, 'name_ar')]);
    await audit(me, 'create', 'collar', id, b);
    return { id };
  }

  @Patch('collars/:id')
  @UseGuards(Managers)
  async updateCollar(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    await patchRow('collars', id, {
      name_en: b.name_en !== undefined ? text(b.name_en, 'name_en') : undefined,
      name_ar: b.name_ar !== undefined ? text(b.name_ar, 'name_ar') : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
    });
    await audit(me, 'update', 'collar', id, b);
    return { ok: true };
  }

  @Post('fabrics')
  @UseGuards(Managers)
  async addFabric(@CurrentStaff() me: StaffUser, @Body() b: any) {
    const id = await uniqueId('fabrics', b?.name_en ?? '');
    await db.tx(async (c) => {
      await c.query(
        'insert into fabrics (id, name_en, name_ar, note_en, note_ar, price, sort) values ($1,$2,$3,$4,$5,$6,(select coalesce(max(sort),0)+1 from fabrics))',
        [id, text(b.name_en, 'name_en'), text(b.name_ar, 'name_ar'), String(b.note_en ?? '').slice(0, 120), String(b.note_ar ?? '').slice(0, 120), money(b.price, 'price')],
      );
      await setFabricColours(id, b.colour_ids, c);
    });
    await audit(me, 'create', 'fabric', id, b);
    return { id };
  }

  @Patch('fabrics/:id')
  @UseGuards(Managers)
  async updateFabric(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    await patchRow('fabrics', id, {
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
    const r = await db.one(
      `insert into branches (name_en, name_ar, address_en, address_ar, phone, whatsapp, hours_en, hours_ar, sort)
       values ($1,$2,$3,$4,$5,$6,$7,$8,(select coalesce(max(sort),0)+1 from branches)) returning id`,
      [text(b?.name_en, 'name_en'), text(b.name_ar, 'name_ar'), text(b.address_en, 'address_en'), text(b.address_ar, 'address_ar'), text(b.phone, 'phone'), text(b.whatsapp ?? b.phone, 'whatsapp'), text(b.hours_en, 'hours_en'), text(b.hours_ar, 'hours_ar')],
    );
    await audit(me, 'create', 'branch', r!.id, b);
    return r;
  }

  @Patch('branches/:id')
  @UseGuards(Managers)
  async updateBranch(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    const open = b.open_minute !== undefined ? int(b.open_minute, 'open_minute', 0, 1440) : undefined;
    const close = b.close_minute !== undefined ? int(b.close_minute, 'close_minute', 0, 1440) : undefined;
    if (open !== undefined && close !== undefined && close <= open) fail('close_before_open');
    await patchRow('branches', id, {
      name_en: b.name_en !== undefined ? text(b.name_en, 'name_en') : undefined,
      name_ar: b.name_ar !== undefined ? text(b.name_ar, 'name_ar') : undefined,
      address_en: b.address_en !== undefined ? text(b.address_en, 'address_en') : undefined,
      address_ar: b.address_ar !== undefined ? text(b.address_ar, 'address_ar') : undefined,
      phone: b.phone !== undefined ? text(b.phone, 'phone') : undefined,
      whatsapp: b.whatsapp !== undefined ? text(b.whatsapp, 'whatsapp') : undefined,
      hours_en: b.hours_en !== undefined ? text(b.hours_en, 'hours_en') : undefined,
      hours_ar: b.hours_ar !== undefined ? text(b.hours_ar, 'hours_ar') : undefined,
      open_minute: open,
      close_minute: close,
      slot_minutes: b.slot_minutes !== undefined ? int(b.slot_minutes, 'slot_minutes', 15, 240) : undefined,
      slot_capacity: b.slot_capacity !== undefined ? int(b.slot_capacity, 'slot_capacity', 1, 50) : undefined,
      closed_weekdays: b.closed_weekdays !== undefined ? cleanWeekdays(b.closed_weekdays) : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
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
    if (b.voucher_valid_days !== undefined) next.voucher_valid_days = int(b.voucher_valid_days, 'voucher_valid_days', 1, 365);
    if (b.points) {
      const p = b.points;
      if (p.thobe_fixed !== undefined) next.points.thobe_fixed = int(p.thobe_fixed, 'thobe_fixed', 0, 10000);
      if (p.product_per_qar !== undefined) {
        const v = Number(p.product_per_qar);
        if (!(v >= 0 && v <= 10)) fail('invalid_number', { field: 'product_per_qar' });
        next.points.product_per_qar = v;
      }
      if (p.expiry_months !== undefined) next.points.expiry_months = int(p.expiry_months, 'expiry_months', 1, 60);
      if (p.warn_days !== undefined) next.points.warn_days = int(p.warn_days, 'warn_days', 1, 180);
    }
    if (b.home_visit) {
      const h = b.home_visit;
      if (h.open_minute !== undefined) next.home_visit.open_minute = int(h.open_minute, 'open_minute', 0, 1440);
      if (h.close_minute !== undefined) next.home_visit.close_minute = int(h.close_minute, 'close_minute', 0, 1440);
      if (h.slot_minutes !== undefined) next.home_visit.slot_minutes = int(h.slot_minutes, 'slot_minutes', 15, 240);
      if (h.capacity !== undefined) next.home_visit.capacity = int(h.capacity, 'capacity', 1, 50);
      if (h.closed_weekdays !== undefined) next.home_visit.closed_weekdays = cleanWeekdays(h.closed_weekdays);
      if (next.home_visit.close_minute <= next.home_visit.open_minute) fail('close_before_open');
    }
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

  /* ---------- rewards & coupons ---------- */

  @Get('reward-options')
  @UseGuards(AnyStaff)
  rewardOptions() {
    return db.many(
      `select r.*, p.name_en as product_name_en,
              (select count(*)::int from vouchers v where v.option_id = r.id) as redeemed_count
         from reward_options r left join products p on p.id = r.product_id order by r.kind, r.sort, r.cost_points`,
    );
  }

  @Post('reward-options')
  @UseGuards(Managers)
  async addRewardOption(@CurrentStaff() me: StaffUser, @Body() b: any) {
    const kind = b?.kind;
    if (kind !== 'discount' && kind !== 'product') fail('invalid_kind');
    const percent = kind === 'discount' ? int(b.percent, 'percent', 1, 100) : null;
    let productId: string | null = null;
    if (kind === 'product') {
      const p = await db.one('select id from products where id = $1', [need(b.product_id, 'product_id')]);
      if (!p) fail('product_not_found');
      productId = p.id;
    }
    const id = await uniqueId('reward_options', kind === 'discount' ? `discount-${percent}` : `product-${productId}`);
    await db.pool.query('insert into reward_options (id, kind, percent, product_id, cost_points, active, sort) values ($1,$2,$3,$4,$5,true,(select coalesce(max(sort),0)+1 from reward_options))', [
      id,
      kind,
      percent,
      productId,
      int(b.cost_points, 'cost_points', 1, 1000000),
    ]);
    await audit(me, 'create', 'reward_option', id, b);
    return { id };
  }

  @Patch('reward-options/:id')
  @UseGuards(Managers)
  async updateRewardOption(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: any) {
    await patchRow('reward_options', id, {
      cost_points: b.cost_points !== undefined ? int(b.cost_points, 'cost_points', 1, 1000000) : undefined,
      percent: b.percent !== undefined ? int(b.percent, 'percent', 1, 100) : undefined,
      active: typeof b.active === 'boolean' ? b.active : undefined,
    });
    await audit(me, 'update', 'reward_option', id, b);
    return { ok: true };
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
    await db.pool.query('insert into coupons (code, percent, max_discount, starts_at, expires_at, active) values ($1,$2,$3,$4,$5,true)', [
      code,
      int(b.percent, 'percent', 1, 100),
      b.max_discount ? money(b.max_discount, 'max_discount') : null,
      b.starts_at || null,
      b.expires_at || null,
    ]);
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
    if (b.expires_at !== undefined) add('expires_at', b.expires_at || null);
    if (b.starts_at !== undefined) add('starts_at', b.starts_at || null);
    if (typeof b.active === 'boolean') add('active', b.active);
    if (sets.length) {
      const r = await db.pool.query(`update coupons set ${sets.join(', ')} where upper(code) = $1`, vals);
      if (!r.rowCount) throw new NotFoundException({ code: 'not_found' });
    }
    await audit(me, 'update', 'coupon', code, b);
    return { ok: true };
  }
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
