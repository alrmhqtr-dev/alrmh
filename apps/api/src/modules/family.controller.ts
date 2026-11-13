import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { CustomerGuard, Me, type Customer } from '../auth.js';
import { fail, getSettings, need } from '../lib.js';

const RELATIONS = ['father', 'son', 'brother', 'friend', 'other'];

const MEASURE_COLS = `m.id, m.taken_at, m.method, m.tailor_name, m.length_cm, m.shoulder_cm, m.chest_cm, m.waist_cm, m.sleeve_cm, m.neck_cm, m.cuff_cm, m.remarks,
  b.name_en as branch_name_en, b.name_ar as branch_name_ar`;

export async function memberFor(customerId: string, memberId: string) {
  const m = await db.one('select * from family_members where id = $1 and customer_id = $2', [memberId, customerId]);
  if (!m) throw new NotFoundException({ code: 'member_not_found' });
  return m;
}

export async function latestMeasurement(memberId: string) {
  return db.one(
    `select ${MEASURE_COLS} from measurements m left join branches b on b.id = m.branch_id where m.member_id = $1 order by m.taken_at desc limit 1`,
    [memberId],
  );
}

@Controller('v1')
@UseGuards(CustomerGuard)
export class FamilyController {
  @Get('family')
  async list(@Me() me: Customer) {
    const settings = await getSettings();
    const rows = await db.many(
      `select f.id, f.name, f.relation, f.size,
              lm.taken_at as measured_at, lm.method as measured_method, b.name_en as branch_name_en, b.name_ar as branch_name_ar,
              lm.taken_at < now() - ($2 || ' months')::interval as measurement_stale,
              (select a.starts_at from appointments a where a.member_id = f.id and a.status in ('held','confirmed') and a.starts_at > now() order by a.starts_at limit 1) as next_appointment
         from family_members f
         left join lateral (select * from measurements m where m.member_id = f.id order by m.taken_at desc limit 1) lm on true
         left join branches b on b.id = lm.branch_id
        where f.customer_id = $1
        order by (f.relation = 'self') desc, f.created_at`,
      [me.id, String(settings.measurements_valid_months)],
    );
    return rows;
  }

  @Post('family')
  async add(@Me() me: Customer, @Body() body: { name: string; relation: string; size: string }) {
    const name = String(need(body?.name, 'name')).trim().slice(0, 60);
    if (!RELATIONS.includes(body.relation)) fail('invalid_relation');
    const size = body.size === 'child' ? 'child' : 'adult';
    return db.one(
      'insert into family_members (customer_id, name, relation, size) values ($1, $2, $3, $4) returning id, name, relation, size',
      [me.id, name, body.relation, size],
    );
  }

  @Get('family/:id')
  async detail(@Me() me: Customer, @Param('id') id: string) {
    const member = await memberFor(me.id, id);
    const history = await db.many(
      `select ${MEASURE_COLS} from measurements m left join branches b on b.id = m.branch_id where m.member_id = $1 order by m.taken_at desc`,
      [id],
    );
    return { id: member.id, name: member.name, relation: member.relation, size: member.size, latest: history[0] ?? null, history };
  }

  @Patch('family/:id')
  async editMember(@Me() me: Customer, @Param('id') id: string, @Body() body: { name?: string; relation?: string; size?: string }) {
    const member = await memberFor(me.id, id);
    // The account holder's own entry follows the profile name.
    if (member.relation === 'self') fail('cannot_edit_self');
    const name = body?.name !== undefined ? String(body.name).trim().slice(0, 60) : member.name;
    if (!name) fail('missing_field', { field: 'name' });
    if (body?.relation !== undefined && !RELATIONS.includes(body.relation)) fail('invalid_relation');
    const size = body?.size === undefined ? member.size : body.size === 'child' ? 'child' : 'adult';
    return db.one('update family_members set name = $2, relation = $3, size = $4 where id = $1 returning id, name, relation, size', [id, name, body?.relation ?? member.relation, size]);
  }

  @Delete('family/:id')
  async removeMember(@Me() me: Customer, @Param('id') id: string) {
    const member = await memberFor(me.id, id);
    if (member.relation === 'self') fail('cannot_edit_self');
    // Removing a person removes their measurements, which the workshop still needs while an order is open.
    const busy = await db.one(
      `select
         exists (select 1 from appointments where member_id = $1 and status in ('held','confirmed') and starts_at > now()) as booked,
         exists (select 1 from basket_items where member_id = $1) as in_basket,
         exists (select 1 from order_items i join orders o on o.id = i.order_id
                  where i.snapshot->'member'->>'id' = $1::text and o.stage not in ('delivered','cancelled','pending_payment','payment_failed')) as on_order`,
      [id],
    );
    if (busy.on_order) fail('member_has_order');
    if (busy.booked) fail('member_has_booking');
    if (busy.in_basket) fail('member_in_basket');
    await db.pool.query('delete from family_members where id = $1 and customer_id = $2', [id, me.id]);
    return { ok: true };
  }

  @Get('addresses')
  addresses(@Me() me: Customer) {
    return db.many('select id, label, line1, area, city, notes, is_default from addresses where customer_id = $1 order by is_default desc, created_at', [me.id]);
  }

  @Post('addresses')
  async addAddress(@Me() me: Customer, @Body() body: { label: string; line1: string; area: string; notes?: string; isDefault?: boolean }) {
    const label = String(need(body?.label, 'label')).trim().slice(0, 30);
    const line1 = String(need(body?.line1, 'line1')).trim().slice(0, 160);
    const area = String(need(body?.area, 'area')).trim().slice(0, 60);
    const count = await db.one<{ n: number }>('select count(*)::int as n from addresses where customer_id = $1', [me.id]);
    const isDefault = Boolean(body.isDefault) || count!.n === 0;
    return db.tx(async (c) => {
      if (isDefault) await c.query('update addresses set is_default = false where customer_id = $1', [me.id]);
      return db.one(
        'insert into addresses (customer_id, label, line1, area, notes, is_default) values ($1,$2,$3,$4,$5,$6) returning id, label, line1, area, city, notes, is_default',
        [me.id, label, line1, area, body.notes ?? null, isDefault],
        c,
      );
    });
  }

  @Patch('addresses/:id')
  async updateAddress(@Me() me: Customer, @Param('id') id: string, @Body() body: { label?: string; line1?: string; area?: string; notes?: string | null; isDefault?: boolean }) {
    const a = await db.one('select * from addresses where id = $1 and customer_id = $2', [id, me.id]);
    if (!a) throw new NotFoundException({ code: 'not_found' });
    const pick = (v: unknown, cur: string, field: string, max: number) => {
      if (v === undefined) return cur;
      const s = String(v).trim().slice(0, max);
      if (!s) fail('missing_field', { field });
      return s;
    };
    if (body?.label !== undefined || body?.line1 !== undefined || body?.area !== undefined || body?.notes !== undefined) {
      await db.pool.query('update addresses set label = $2, line1 = $3, area = $4, notes = $5 where id = $1', [
        id,
        pick(body.label, a.label, 'label', 30),
        pick(body.line1, a.line1, 'line1', 160),
        pick(body.area, a.area, 'area', 60),
        body.notes === undefined ? a.notes : body.notes ? String(body.notes).trim().slice(0, 200) : null,
      ]);
    }
    if (body?.isDefault) {
      await db.tx(async (c) => {
        await c.query('update addresses set is_default = false where customer_id = $1', [me.id]);
        await c.query('update addresses set is_default = true where id = $1', [id]);
      });
    }
    return { ok: true };
  }

  @Delete('addresses/:id')
  async deleteAddress(@Me() me: Customer, @Param('id') id: string) {
    const booked = await db.one(`select 1 from appointments where address_id = $1 and status in ('held','confirmed') and starts_at > now() limit 1`, [id]);
    if (booked) fail('address_has_booking');
    // Past visits keep their record without the address.
    await db.tx(async (c) => {
      const mine = await db.one('select 1 from addresses where id = $1 and customer_id = $2', [id, me.id], c);
      if (!mine) return;
      await c.query('update appointments set address_id = null where address_id = $1', [id]);
      await c.query('delete from addresses where id = $1 and customer_id = $2', [id, me.id]);
      await c.query(
        `update addresses set is_default = true where id = (select id from addresses where customer_id = $1 order by created_at limit 1)
           and not exists (select 1 from addresses where customer_id = $1 and is_default)`,
        [me.id],
      );
    });
    return { ok: true };
  }
}
