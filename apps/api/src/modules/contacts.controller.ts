import { Body, Controller, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { fail, need, normaliseQatarPhone } from '../lib.js';
import { parseCsv } from '../csv.js';
import { AnyStaff, ContactsGuard, CurrentStaff, PurchasesGuard, audit, hasPerm, staffGuard, type StaffUser } from '../staff.js';
import { FIELDS, measurementValues } from './admin-ops.controller.js';
import { uuidOrNull } from './pos.controller.js';

const RELATIONS = ['self', 'father', 'son', 'brother', 'friend', 'other'];
const optText = (v: unknown, max: number) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));

async function groupOrNull(v: unknown) {
  const id = uuidOrNull(v);
  if (!v) return null;
  if (!id || !(await db.one('select 1 from customer_groups where id = $1', [id]))) fail('invalid_group');
  return id;
}

/**
 * Customers added at the counter. They are the same accounts the app uses: when the
 * customer later signs in to the app with this mobile number, they see these orders,
 * measurements and points.
 */
@Controller('v1/admin')
export class ContactsController {
  @Post('customers')
  @UseGuards(staffGuard('contacts', 'pos', 'workshop'))
  async create(@CurrentStaff() me: StaffUser, @Body() b: { name?: string; phone?: string; email?: string; groupId?: string; notes?: string; measurements?: Record<string, any> | null }) {
    const phone = normaliseQatarPhone(String(need(b?.phone, 'phone')));
    const name = String(need(b?.name, 'name')).trim().slice(0, 80);
    const existing = await db.one('select id, name, phone, deleted_at from customers where phone = $1', [phone]);
    if (existing && !existing.deleted_at) return { id: existing.id, name: existing.name, phone, existing: true };
    // A new customer at the counter comes with their measurements.
    const measured = b.measurements ? measurementValues(b.measurements) : null;
    if (measured && !hasPerm(me, 'workshop', 'pos')) fail('forbidden');
    const group = await groupOrNull(b.groupId);
    return db.tx(async (c) => {
      const row = existing
        ? await db.one(`update customers set deleted_at = null, name = $2, email = $3, group_id = $4, notes = $5, source = 'pos' where id = $1 returning id`, [existing.id, name, optText(b.email, 120), group, optText(b.notes, 500)], c)
        : await db.one(`insert into customers (phone, name, email, group_id, notes, source, language) values ($1,$2,$3,$4,$5,'pos','ar') returning id`, [phone, name, optText(b.email, 120), group, optText(b.notes, 500)], c);
      // The account holder, so thobes and measurements can be recorded straight away.
      let self = await db.one(`select id from family_members where customer_id = $1 and relation = 'self'`, [row!.id], c);
      if (!self) self = await db.one(`insert into family_members (customer_id, name, relation, size) values ($1,$2,'self','adult') returning id`, [row!.id, name], c);
      if (measured)
        await c.query(
          `insert into measurements (member_id, method, branch_id, tailor_name, ${FIELDS.join(', ')}, remarks, staff_id)
           values ($1,'branch',$2,$3,${FIELDS.map((_, i) => `$${i + 4}`).join(',')},$11,$12)`,
          [self!.id, me.branch_id ?? null, me.name, ...measured, b.measurements?.remarks ? String(b.measurements.remarks).slice(0, 300) : null, me.id],
          );
      await audit(me, 'create', 'customer', row!.id, { phone, name }, c);
      return { id: row!.id, name, phone, existing: false };
    });
  }

  @Patch('customers/:id')
  @UseGuards(staffGuard('contacts', 'pos'))
  async update(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: { name?: string; email?: string | null; groupId?: string | null; notes?: string | null }) {
    const cur = await db.one('select id from customers where id = $1 and deleted_at is null', [id]);
    if (!cur) throw new NotFoundException({ code: 'not_found' });
    if (b.name !== undefined) {
      const name = String(b.name).trim().slice(0, 80);
      if (!name) fail('missing_field', { field: 'name' });
      await db.pool.query('update customers set name = $2 where id = $1', [id, name]);
      await db.pool.query(`update family_members set name = $2 where customer_id = $1 and relation = 'self'`, [id, name]);
    }
    if (b.email !== undefined) await db.pool.query('update customers set email = $2 where id = $1', [id, optText(b.email, 120)]);
    if (b.notes !== undefined) await db.pool.query('update customers set notes = $2 where id = $1', [id, optText(b.notes, 500)]);
    if (b.groupId !== undefined) await db.pool.query('update customers set group_id = $2 where id = $1', [id, await groupOrNull(b.groupId)]);
    await audit(me, 'update', 'customer', id, b);
    return { ok: true };
  }

  @Post('customers/:id/members')
  @UseGuards(staffGuard('contacts', 'pos', 'workshop'))
  async addMember(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() b: { name?: string; relation?: string; size?: string }) {
    const cur = await db.one('select id from customers where id = $1 and deleted_at is null', [id]);
    if (!cur) throw new NotFoundException({ code: 'not_found' });
    const relation = RELATIONS.includes(String(b?.relation)) && b.relation !== 'self' ? b.relation : 'other';
    const m = await db.one(`insert into family_members (customer_id, name, relation, size) values ($1,$2,$3,$4) returning id, name, relation, size`, [
      id,
      String(need(b?.name, 'name')).trim().slice(0, 60),
      relation,
      b.size === 'child' ? 'child' : 'adult',
    ]);
    await audit(me, 'create', 'member', m.id, { customer: id });
    return m;
  }

  /** The latest measurements of everyone measured (مقاسات الزبائن). */
  @Get('measurements')
  @UseGuards(AnyStaff)
  measurements(@Query('q') q?: string) {
    const needle = q?.trim() ? `%${q.trim().replace(/\s+/g, '')}%` : null;
    const words = q?.trim() ? `%${q.trim()}%` : null;
    return db.many(
      `select distinct on (m.member_id) m.id, m.member_id, m.taken_at, m.tailor_name, m.method, m.length_cm, m.shoulder_cm, m.chest_cm, m.waist_cm, m.sleeve_cm, m.neck_cm, m.cuff_cm, m.remarks,
              f.name as member_name, f.relation, f.size, c.id as customer_id, c.name as customer_name, c.phone,
              (select count(*)::int from measurements x where x.member_id = m.member_id) as records
         from measurements m join family_members f on f.id = m.member_id join customers c on c.id = f.customer_id
        where c.deleted_at is null and ($1::text is null or replace(c.phone,' ','') ilike $1 or c.name ilike $2 or f.name ilike $2)
        order by m.member_id, m.taken_at desc limit 300`,
      [needle, words],
    ).then((rows) => rows.sort((a, b) => +new Date(b.taken_at) - +new Date(a.taken_at)));
  }

  @Get('members/:id')
  @UseGuards(AnyStaff)
  async member(@Param('id') id: string) {
    const m = await db.one(
      `select f.id, f.name, f.relation, f.size, c.id as customer_id, c.name as customer_name, c.phone from family_members f join customers c on c.id = f.customer_id where f.id = $1`,
      [id],
    );
    if (!m) throw new NotFoundException({ code: 'not_found' });
    const latest = await db.one(
      `select taken_at, tailor_name, method, length_cm, shoulder_cm, chest_cm, waist_cm, sleeve_cm, neck_cm, cuff_cm, remarks from measurements where member_id = $1 order by taken_at desc limit 1`,
      [id],
    );
    // The styles of the person's last thobe, for the measurement sheet.
    const last = await db.one(
      `select oi.snapshot->'thobe' as thobe from order_items oi join orders o on o.id = oi.order_id
        where oi.kind = 'thobe' and oi.snapshot->'member'->>'id' = $1 and o.stage <> 'cancelled' order by o.created_at desc limit 1`,
      [id],
    );
    return { ...m, latest: latest ?? null, last_thobe: last?.thobe ?? null };
  }

  @Get('suppliers/:id')
  @UseGuards(AnyStaff)
  async supplier(@Param('id') id: string) {
    const s = await db.one('select *, opening_balance::float as opening_balance from suppliers where id = $1', [id]);
    if (!s) throw new NotFoundException({ code: 'not_found' });
    const [purchases, payments] = await Promise.all([
      db.many(
        `select p.id, p.number, p.kind, p.status, p.purchase_date, p.total::float as total, p.reference, b.name_en as branch_en, b.name_ar as branch_ar,
                coalesce((select sum(amount) from supplier_payments sp where sp.purchase_id = p.id),0)::float as paid
           from purchases p join branches b on b.id = p.branch_id where p.supplier_id = $1 order by p.purchase_date desc, p.created_at desc`,
        [id],
      ),
      db.many(`select sp.*, sp.amount::float as amount, p.number as purchase_number, u.name as staff_name from supplier_payments sp left join purchases p on p.id = sp.purchase_id left join staff_users u on u.id = sp.staff_id where sp.supplier_id = $1 order by sp.paid_on desc, sp.created_at desc`, [id]),
    ]);
    const bought = purchases.filter((p) => p.kind === 'purchase' && p.status === 'received').reduce((a, p) => a + p.total, 0);
    const returned = purchases.filter((p) => p.kind === 'return' && p.status === 'received').reduce((a, p) => a + p.total, 0);
    const paid = payments.reduce((a, p) => a + p.amount, 0);
    return { ...s, purchases, payments, totals: { bought, returned, paid, balance: Math.round((s.opening_balance + bought - returned - paid) * 100) / 100 } };
  }

  /* ---------- imports (CSV from Mada or a spreadsheet) ---------- */

  @Post('import/customers')
  @HttpCode(200)
  @UseGuards(ContactsGuard)
  async importCustomers(@CurrentStaff() me: StaffUser, @Body() b: { csv?: string }) {
    const rows = parseCsv(String(need(b?.csv, 'csv')));
    if (rows.length > 20000) fail('too_many_rows');
    const groups = await db.many<{ id: string; name_en: string; name_ar: string }>('select id, name_en, name_ar from customer_groups');
    let added = 0;
    let skipped = 0;
    const errors: { row: number; error: string }[] = [];
    await db.tx(async (c) => {
      for (const [i, r] of rows.entries()) {
        const rawPhone = r.mobile || r.phone || r.mobile_number || r['رقم_الجوال'] || r['الجوال'] || '';
        const name = (r.name || r.customer_name || r['الاسم'] || '').slice(0, 80);
        let phone: string;
        try {
          phone = normaliseQatarPhone(rawPhone);
        } catch {
          errors.push({ row: i + 2, error: 'invalid_phone' });
          continue;
        }
        if (!name) {
          errors.push({ row: i + 2, error: 'missing_name' });
          continue;
        }
        const g = r.group ? groups.find((x) => x.name_en.toLowerCase() === r.group.toLowerCase() || x.name_ar === r.group) : null;
        const ins = await db.one(
          `insert into customers (phone, name, email, group_id, notes, source, language) values ($1,$2,$3,$4,$5,'import','ar') on conflict (phone) do nothing returning id`,
          [phone, name, optText(r.email, 120), g?.id ?? null, optText(r.notes, 500)],
          c,
        );
        if (!ins) {
          skipped++;
          continue;
        }
        await c.query(`insert into family_members (customer_id, name, relation, size) values ($1,$2,'self','adult')`, [ins.id, name]);
        added++;
      }
      await audit(me, 'import', 'customers', null, { added, skipped, errors: errors.length }, c);
    });
    return { added, skipped, errors: errors.slice(0, 50), errorCount: errors.length };
  }

  @Post('import/suppliers')
  @HttpCode(200)
  @UseGuards(PurchasesGuard)
  async importSuppliers(@CurrentStaff() me: StaffUser, @Body() b: { csv?: string }) {
    const rows = parseCsv(String(need(b?.csv, 'csv')));
    if (rows.length > 5000) fail('too_many_rows');
    let added = 0;
    const errors: { row: number; error: string }[] = [];
    await db.tx(async (c) => {
      for (const [i, r] of rows.entries()) {
        const name = (r.name || r.supplier_name || r['الاسم'] || '').slice(0, 120);
        if (!name) {
          errors.push({ row: i + 2, error: 'missing_name' });
          continue;
        }
        const opening = Number(r.opening_balance || 0);
        await c.query('insert into suppliers (name, business_name, phone, email, tax_number, address, opening_balance) values ($1,$2,$3,$4,$5,$6,$7)', [
          name,
          optText(r.business_name, 120),
          optText(r.mobile || r.phone, 30),
          optText(r.email, 120),
          optText(r.tax_number, 40),
          optText(r.address, 300),
          Number.isFinite(opening) ? opening : 0,
        ]);
        added++;
      }
      await audit(me, 'import', 'suppliers', null, { added, errors: errors.length }, c);
    });
    return { added, skipped: 0, errors: errors.slice(0, 50), errorCount: errors.length };
  }
}
