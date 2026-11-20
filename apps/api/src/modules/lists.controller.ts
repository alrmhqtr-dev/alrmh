import { Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { fail } from '../lib.js';
import { AnyStaff, CurrentStaff, audit, hasPerm, type Permission, type StaffUser } from '../staff.js';

/**
 * The simple lists behind the POS: brands, units, warranties, tax rates, variations,
 * customer groups, expense categories, agents, service types, suppliers and discounts.
 * Each has the same four actions; who may change it depends on the list.
 */
type Kind = 'text' | 'textOpt' | 'money' | 'moneySigned' | 'percent' | 'int' | 'intOpt' | 'bool' | 'textArray' | 'uuidOpt' | 'enum' | 'dateTimeOpt';
type FieldDef = { col?: string; kind: Kind; max?: number; min?: number; values?: string[]; required?: boolean };
type Resource = {
  table: string;
  perm: Permission[];
  fields: Record<string, FieldDef>;
  list: string;
  validate?: (row: Record<string, any>) => void;
};

const SUPPLIER_BALANCE = `(s.opening_balance
   + coalesce((select sum(total) from purchases p where p.supplier_id = s.id and p.kind = 'purchase' and p.status = 'received'),0)
   - coalesce((select sum(total) from purchases p where p.supplier_id = s.id and p.kind = 'return' and p.status = 'received'),0)
   - coalesce((select sum(amount) from supplier_payments sp where sp.supplier_id = s.id),0))::float`;

export const RESOURCES: Record<string, Resource> = {
  brands: {
    table: 'brands',
    perm: ['products'],
    fields: { name: { kind: 'text', required: true, max: 80 }, description: { kind: 'textOpt', max: 300 }, active: { kind: 'bool' } },
    list: `select b.*, (select count(*)::int from products p where p.brand_id = b.id) as product_count from brands b order by b.active desc, b.name`,
  },
  units: {
    table: 'units',
    perm: ['products'],
    fields: { name_en: { kind: 'text', required: true, max: 40 }, name_ar: { kind: 'text', required: true, max: 40 }, short_name: { kind: 'text', required: true, max: 10 }, allow_decimal: { kind: 'bool' } },
    list: `select u.*, (select count(*)::int from products p where p.unit_id = u.id) as product_count from units u order by u.created_at`,
  },
  warranties: {
    table: 'warranties',
    perm: ['products'],
    fields: { name: { kind: 'text', required: true, max: 80 }, description: { kind: 'textOpt', max: 300 }, months: { kind: 'int', min: 0, max: 120 } },
    list: `select w.*, (select count(*)::int from products p where p.warranty_id = w.id) as product_count from warranties w order by w.months, w.name`,
  },
  'tax-rates': {
    table: 'tax_rates',
    perm: ['manage'],
    fields: { name: { kind: 'text', required: true, max: 60 }, percent: { kind: 'percent', required: true }, active: { kind: 'bool' } },
    list: `select t.*, t.percent::float as percent from tax_rates t order by t.active desc, t.percent`,
  },
  variations: {
    table: 'variation_templates',
    perm: ['products'],
    fields: { name: { kind: 'text', required: true, max: 60 }, options: { kind: 'textArray', required: true } },
    list: `select * from variation_templates order by name`,
  },
  'customer-groups': {
    table: 'customer_groups',
    perm: ['contacts'],
    fields: { name_en: { kind: 'text', required: true, max: 60 }, name_ar: { kind: 'text', required: true, max: 60 }, discount_percent: { kind: 'percent' }, active: { kind: 'bool' } },
    list: `select g.*, g.discount_percent::float as discount_percent, (select count(*)::int from customers c where c.group_id = g.id and c.deleted_at is null) as customer_count from customer_groups g order by g.active desc, g.name_en`,
  },
  'expense-categories': {
    table: 'expense_categories',
    perm: ['expenses', 'manage'],
    fields: { name_en: { kind: 'text', required: true, max: 60 }, name_ar: { kind: 'text', required: true, max: 60 }, active: { kind: 'bool' } },
    list: `select e.*, (select count(*)::int from expenses x where x.category_id = e.id) as expense_count from expense_categories e order by e.active desc, e.name_en`,
  },
  agents: {
    table: 'agents',
    perm: ['staff'],
    fields: { name: { kind: 'text', required: true, max: 80 }, phone: { kind: 'textOpt', max: 30 }, email: { kind: 'textOpt', max: 120 }, commission_percent: { kind: 'percent' }, active: { kind: 'bool' } },
    list: `select a.*, a.commission_percent::float as commission_percent,
             (select count(*)::int from orders o where o.agent_id = a.id and o.stage <> 'cancelled') as sales_count,
             (select coalesce(sum(total),0)::float from orders o where o.agent_id = a.id and o.stage <> 'cancelled') as sales_total
             from agents a order by a.active desc, a.name`,
  },
  'service-types': {
    table: 'service_types',
    perm: ['manage'],
    fields: {
      name_en: { kind: 'text', required: true, max: 60 },
      name_ar: { kind: 'text', required: true, max: 60 },
      charge_kind: { kind: 'enum', values: ['fixed', 'percent'] },
      charge: { kind: 'money' },
      lead_days: { kind: 'intOpt', min: 0, max: 90 },
      active: { kind: 'bool' },
      sort: { kind: 'int', min: 0, max: 1000 },
    },
    list: `select s.*, s.charge::float as charge from service_types s order by s.active desc, s.sort, s.name_en`,
    validate: (r) => {
      if (r.charge_kind === 'percent' && r.charge > 100) fail('invalid_number', { field: 'charge' });
    },
  },
  suppliers: {
    table: 'suppliers',
    perm: ['purchases'],
    fields: {
      name: { kind: 'text', required: true, max: 120 },
      business_name: { kind: 'textOpt', max: 120 },
      phone: { kind: 'textOpt', max: 30 },
      email: { kind: 'textOpt', max: 120 },
      tax_number: { kind: 'textOpt', max: 40 },
      address: { kind: 'textOpt', max: 300 },
      opening_balance: { kind: 'moneySigned' },
      notes: { kind: 'textOpt', max: 500 },
      active: { kind: 'bool' },
    },
    list: `select s.*, s.opening_balance::float as opening_balance, ${SUPPLIER_BALANCE} as balance,
             (select count(*)::int from purchases p where p.supplier_id = s.id and p.kind = 'purchase') as purchase_count
             from suppliers s order by s.active desc, s.name`,
  },
  discounts: {
    table: 'discounts',
    perm: ['manage'],
    fields: {
      name: { kind: 'text', required: true, max: 80 },
      applies_to: { kind: 'enum', values: ['all', 'category', 'product', 'brand', 'fabric'], required: true },
      target_ids: { kind: 'textArray' },
      kind: { kind: 'enum', values: ['percent', 'fixed'], required: true },
      amount: { kind: 'money', required: true },
      starts_at: { kind: 'dateTimeOpt' },
      ends_at: { kind: 'dateTimeOpt' },
      branch_id: { kind: 'uuidOpt' },
      channel: { kind: 'enum', values: ['all', 'pos', 'app'] },
      priority: { kind: 'int', min: 0, max: 100 },
      active: { kind: 'bool' },
    },
    list: `select d.*, d.amount::float as amount, b.name_en as branch_en, b.name_ar as branch_ar from discounts d left join branches b on b.id = d.branch_id order by d.active desc, d.priority desc, d.created_at desc`,
    validate: (r) => {
      if (r.amount !== undefined && !(r.amount > 0)) fail('invalid_number', { field: 'amount' });
      if (r.kind === 'percent' && r.amount > 100) fail('invalid_number', { field: 'amount' });
      if (r.starts_at && r.ends_at && r.starts_at >= r.ends_at) fail('invalid_date', { field: 'ends_at' });
    },
  },
};

function clean(name: string, def: FieldDef, v: unknown): unknown {
  const empty = v === undefined || v === null || v === '';
  const bad = () => fail('invalid_number', { field: name });
  switch (def.kind) {
    case 'text': {
      const s = String(v ?? '').trim();
      if (!s) fail('missing_field', { field: name });
      return s.slice(0, def.max ?? 200);
    }
    case 'textOpt':
      return empty ? null : String(v).trim().slice(0, def.max ?? 200) || null;
    case 'money':
    case 'moneySigned': {
      const n = Number(empty ? 0 : v);
      if (!Number.isFinite(n) || Math.abs(n) > 10_000_000 || (def.kind === 'money' && n < 0)) bad();
      return Math.round(n * 100) / 100;
    }
    case 'percent': {
      const n = Number(empty ? 0 : v);
      if (!Number.isFinite(n) || n < 0 || n > 100) bad();
      return Math.round(n * 100) / 100;
    }
    case 'int':
    case 'intOpt': {
      if (empty) return def.kind === 'intOpt' ? null : 0;
      const n = Number(v);
      if (!Number.isInteger(n) || n < (def.min ?? -1e9) || n > (def.max ?? 1e9)) bad();
      return n;
    }
    case 'bool':
      return v === true || v === 'true';
    case 'textArray': {
      const list = Array.isArray(v) ? v : String(v ?? '').split(',');
      return [...new Set(list.map((x) => String(x).trim()).filter(Boolean))].slice(0, 200);
    }
    case 'uuidOpt':
      if (empty) return null;
      if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) fail('invalid_input', { field: name });
      return v;
    case 'enum':
      if (!def.values!.includes(String(v))) fail('invalid_input', { field: name });
      return String(v);
    case 'dateTimeOpt': {
      if (empty) return null;
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) fail('invalid_date', { field: name });
      return d.toISOString();
    }
  }
}

function resource(name: string) {
  const r = RESOURCES[name];
  if (!r) throw new NotFoundException({ code: 'not_found' });
  return r;
}

@Controller('v1/admin/lists')
@UseGuards(AnyStaff)
export class ListsController {
  @Get(':res')
  list(@Param('res') res: string) {
    return db.many(resource(res).list);
  }

  @Post(':res')
  async create(@CurrentStaff() me: StaffUser, @Param('res') res: string, @Body() b: Record<string, unknown>) {
    const r = resource(res);
    if (!hasPerm(me, ...r.perm)) fail('forbidden');
    const row: Record<string, any> = {};
    for (const [name, def] of Object.entries(r.fields)) {
      if (b?.[name] === undefined && !def.required) {
        if (def.kind === 'bool') row[name] = true;
        continue;
      }
      row[name] = clean(name, def, b?.[name]);
    }
    r.validate?.(row);
    const cols = Object.keys(row);
    const created = await db.one(
      `insert into ${r.table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      cols.map((c) => row[c]),
    );
    await audit(me, 'create', res, created!.id, row);
    return created;
  }

  @Patch(':res/:id')
  async update(@CurrentStaff() me: StaffUser, @Param('res') res: string, @Param('id') id: string, @Body() b: Record<string, unknown>) {
    const r = resource(res);
    if (!hasPerm(me, ...r.perm)) fail('forbidden');
    const current = await db.one(`select * from ${r.table} where id = $1`, [id]);
    if (!current) throw new NotFoundException({ code: 'not_found' });
    const row: Record<string, any> = {};
    for (const [name, def] of Object.entries(r.fields)) if (b?.[name] !== undefined) row[name] = clean(name, def, b[name]);
    r.validate?.({ ...current, amount: current.amount != null ? Number(current.amount) : undefined, charge: current.charge != null ? Number(current.charge) : undefined, ...row });
    const cols = Object.keys(row);
    if (cols.length) await db.pool.query(`update ${r.table} set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`, [id, ...cols.map((c) => row[c])]);
    await audit(me, 'update', res, id, row);
    return { ok: true };
  }

  @Post(':res/:id/delete')
  @HttpCode(200)
  async remove(@CurrentStaff() me: StaffUser, @Param('res') res: string, @Param('id') id: string) {
    const r = resource(res);
    if (!hasPerm(me, ...r.perm)) fail('forbidden');
    try {
      const out = await db.pool.query(`delete from ${r.table} where id = $1`, [id]);
      if (!out.rowCount) throw new NotFoundException({ code: 'not_found' });
    } catch (e: any) {
      // Still used somewhere (a product, a purchase, a sale): hide it instead.
      if (e?.code === '23503') fail('in_use');
      throw e;
    }
    await audit(me, 'delete', res, id);
    return { ok: true };
  }
}
