import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { STAGES, expirePoints, fail, getSettings, need, notify, pointsBalance, spendPoints, type Stage } from '../lib.js';
import { setStage, stagesFor } from '../orders.js';
import { addMonthsSql } from '../sql-helpers.js';
import { AnyStaff, CurrentStaff, Managers, Workshop, audit, type StaffUser } from '../staff.js';

const FIELDS = ['length_cm', 'shoulder_cm', 'chest_cm', 'waist_cm', 'sleeve_cm', 'neck_cm', 'cuff_cm'] as const;

@Controller('v1/admin')
export class AdminOpsController {
  /* ---------- orders ---------- */

  @Get('orders')
  @UseGuards(AnyStaff)
  orders(@Query('stage') stage?: string, @Query('q') q?: string) {
    const needle = q?.trim() ? `%${q.trim().replace(/\s+/g, '')}%` : null;
    return db.many(
      `select o.id, o.number, o.stage, o.total, o.created_at, o.paid_at, o.expected_delivery, c.id as customer_id, c.name as customer_name, c.phone,
              (select coalesce(sum(qty),0)::int from order_items i where i.order_id = o.id and i.kind = 'thobe') as thobe_count,
              (select coalesce(sum(qty),0)::int from order_items i where i.order_id = o.id) as item_count,
              (select min(a.starts_at) from appointments a where a.order_id = o.id and a.status = 'confirmed') as next_appointment
         from orders o join customers c on c.id = o.customer_id
        where o.stage not in ('pending_payment','payment_failed')
          and ($1::text is null or o.stage = $1)
          and ($2::text is null or o.number ilike $2 or replace(c.phone,' ','') ilike $2 or c.name ilike $2)
        order by o.created_at desc limit 300`,
      [stage || null, needle],
    );
  }

  @Get('orders/:id')
  @UseGuards(AnyStaff)
  async order(@Param('id') id: string) {
    const o = await db.one(
      `select o.*, c.name as customer_name, c.phone, c.email,
              (select status from payments p where p.order_id = o.id order by created_at desc limit 1) as payment_status,
              (select provider_ref from payments p where p.order_id = o.id order by created_at desc limit 1) as payment_ref
         from orders o join customers c on c.id = o.customer_id where o.id = $1`,
      [id],
    );
    if (!o) throw new NotFoundException({ code: 'not_found' });
    const [items, events, appointments] = await Promise.all([
      db.many('select id, kind, snapshot, qty, unit_price, line_total from order_items where order_id = $1 order by kind desc', [id]),
      db.many(`select e.stage, e.at, e.note, u.name as staff_name from order_events e left join staff_users u on u.id = e.staff_id where e.order_id = $1 order by e.at, array_position(array['confirmed','measured','cutting','stitching','ready','out_for_delivery','delivered','cancelled'], e.stage)`, [id]),
      db.many(
        `select a.id, a.kind, a.starts_at, a.status, a.member_id, f.name as member_name, b.name_en as branch_name, ad.line1, ad.area
           from appointments a join family_members f on f.id = a.member_id left join branches b on b.id = a.branch_id left join addresses ad on ad.id = a.address_id
          where a.order_id = $1 order by a.starts_at`,
        [id],
      ),
    ]);
    const memberIds = [...new Set(items.filter((i) => i.kind === 'thobe').map((i) => i.snapshot.member?.id).filter(Boolean))];
    const measurements = memberIds.length
      ? await db.many(
          `select distinct on (m.member_id) m.member_id, m.taken_at, m.tailor_name, ${FIELDS.join(', ')}, m.remarks
             from measurements m where m.member_id = any($1::uuid[]) order by m.member_id, m.taken_at desc`,
          [memberIds],
        )
      : [];
    return { ...o, items, events, appointments, measurements, stages: stagesFor(items) };
  }

  @Post('orders/:id/stage')
  @UseGuards(Workshop)
  async stage(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() body: { stage: Stage }) {
    if (!STAGES.includes(body?.stage)) fail('invalid_stage');
    const r = await db.tx(async (c) => {
      const out = await setStage(id, body.stage, c, me.id);
      await audit(me, 'stage', 'order', id, { stage: body.stage }, c);
      return out;
    });
    return r;
  }

  @Post('orders/:id/cancel')
  @UseGuards(Managers)
  async cancel(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() body: { reason?: string }) {
    return db.tx(async (c) => {
      const o = await db.one('select * from orders where id = $1 for update', [id], c);
      if (!o) throw new NotFoundException({ code: 'not_found' });
      if (['delivered', 'cancelled', 'out_for_delivery'].includes(o.stage)) fail('cannot_cancel', { stage: o.stage });
      await c.query(`update orders set stage = 'cancelled' where id = $1`, [id]);
      await c.query(`insert into order_events (order_id, stage, note, staff_id) values ($1, 'cancelled', $2, $3)`, [id, body?.reason ?? null, me.id]);
      await c.query(`update appointments set status = 'cancelled' where order_id = $1 and status in ('held','confirmed')`, [id]);
      if (o.voucher_id) await c.query(`update vouchers set status = 'active', used_order_id = null where id = $1 and expires_at > now()`, [o.voucher_id]);
      await notify(
        o.customer_id,
        'order',
        {
          en: { title: 'Order cancelled', body: `#${o.number} was cancelled. Any payment will be refunded to your card.` },
          ar: { title: 'تم إلغاء الطلب', body: `تم إلغاء الطلب #${o.number}. سيُعاد أي مبلغ مدفوع إلى بطاقتك.` },
        },
        `/orders/${id}`,
        c,
      );
      await audit(me, 'cancel', 'order', id, { reason: body?.reason ?? null, refund_due: o.paid_at ? o.total : 0 }, c);
      return { ok: true, refundDue: o.paid_at ? o.total : 0 };
    });
  }

  /* ---------- appointments ---------- */

  @Get('appointments')
  @UseGuards(AnyStaff)
  appointments(@Query('from') from?: string, @Query('days') days?: string, @Query('kind') kind?: string) {
    const start = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : null;
    return db.many(
      `select a.id, a.kind, a.starts_at, a.status, a.order_id, o.number as order_number, a.member_id, f.name as member_name, f.relation, f.size,
              c.id as customer_id, c.name as customer_name, c.phone, ad.line1, ad.area, ad.notes as address_notes, b.name_en as branch_name,
              exists (select 1 from measurements m where m.member_id = a.member_id and m.taken_at >= a.created_at) as measured
         from appointments a join family_members f on f.id = a.member_id join customers c on c.id = a.customer_id
         left join orders o on o.id = a.order_id left join addresses ad on ad.id = a.address_id left join branches b on b.id = a.branch_id
        where a.status in ('confirmed','done')
          and (a.starts_at at time zone 'Asia/Qatar')::date >= coalesce($1::date, (now() at time zone 'Asia/Qatar')::date)
          and (a.starts_at at time zone 'Asia/Qatar')::date < coalesce($1::date, (now() at time zone 'Asia/Qatar')::date) + $2::int
          and ($3::text is null or a.kind = $3)
        order by a.starts_at`,
      [start, Math.min(Number(days ?? 7), 31), kind || null],
    );
  }

  @Post('appointments/:id/status')
  @UseGuards(Workshop)
  async apptStatus(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() body: { status: 'done' | 'cancelled' | 'confirmed' }) {
    if (!['done', 'cancelled', 'confirmed'].includes(body?.status)) fail('invalid_status');
    const a = await db.one('update appointments set status = $2 where id = $1 returning id, customer_id, kind, starts_at', [id, body.status]);
    if (!a) throw new NotFoundException({ code: 'not_found' });
    if (body.status === 'cancelled')
      await notify(
        a.customer_id,
        'appointment',
        {
          en: { title: 'Appointment cancelled', body: 'Your measurement visit was cancelled. Book a new time in the app or message us.' },
          ar: { title: 'تم إلغاء الموعد', body: 'تم إلغاء موعد المقاسات. احجز وقتاً جديداً من التطبيق أو راسلنا.' },
        },
        '/orders',
      );
    await audit(me, 'status', 'appointment', id, { status: body.status });
    return { ok: true };
  }

  /* ---------- customers ---------- */

  @Get('customers')
  @UseGuards(AnyStaff)
  customers(@Query('q') q?: string) {
    const needle = q?.trim() ? `%${q.trim().replace(/\s+/g, '')}%` : null;
    return db.many(
      `select c.id, c.name, c.phone, c.email, c.language, c.created_at,
              (select count(*)::int from orders o where o.customer_id = c.id and o.paid_at is not null) as orders,
              (select coalesce(sum(total),0)::float from orders o where o.customer_id = c.id and o.paid_at is not null and o.stage <> 'cancelled') as spent,
              (select coalesce(sum(points),0)::int from points_ledger p where p.customer_id = c.id) as points
         from customers c
        where c.deleted_at is null and ($1::text is null or replace(c.phone,' ','') ilike $1 or c.name ilike $1 or c.email ilike $1)
        order by c.created_at desc limit 200`,
      [needle],
    );
  }

  @Get('customers/:id')
  @UseGuards(AnyStaff)
  async customer(@Param('id') id: string) {
    await expirePoints(id);
    const c = await db.one('select id, name, phone, email, language, created_at from customers where id = $1 and deleted_at is null', [id]);
    if (!c) throw new NotFoundException({ code: 'not_found' });
    const [family, addresses, orders, ledger, vouchers, balance] = await Promise.all([
      db.many(
        `select f.id, f.name, f.relation, f.size,
                (select row_to_json(m) from (select taken_at, tailor_name, method, ${FIELDS.join(', ')}, remarks from measurements where member_id = f.id order by taken_at desc limit 1) m) as latest,
                (select count(*)::int from measurements where member_id = f.id) as measurement_count
           from family_members f where f.customer_id = $1 order by (f.relation = 'self') desc, f.created_at`,
        [id],
      ),
      db.many('select id, label, line1, area, city, notes, is_default from addresses where customer_id = $1 order by is_default desc', [id]),
      db.many(`select id, number, stage, total, created_at from orders where customer_id = $1 and stage not in ('pending_payment','payment_failed') order by created_at desc`, [id]),
      db.many(
        `select p.id, p.kind, p.points, p.remaining, p.expires_at, p.label, p.created_at, u.name as staff_name
           from points_ledger p left join staff_users u on u.id = p.staff_id where p.customer_id = $1 order by p.created_at desc limit 50`,
        [id],
      ),
      db.many(`select id, code, kind, percent, status, expires_at from vouchers where customer_id = $1 order by created_at desc limit 20`, [id]),
      pointsBalance(id),
    ]);
    return { ...c, family, addresses, orders, ledger, vouchers, balance };
  }

  @Post('customers/:id/points')
  @UseGuards(Managers)
  async adjustPoints(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() body: { points: number; reason: string }) {
    const points = Math.trunc(Number(body?.points));
    if (!points || Math.abs(points) > 100000) fail('invalid_points');
    const reason = String(need(body.reason, 'reason')).trim().slice(0, 120);
    const s = await getSettings();
    await db.tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`points:${id}`]);
      if (points > 0) {
        await c.query(
          `insert into points_ledger (customer_id, kind, points, remaining, expires_at, label, staff_id)
           values ($1, 'earn', $2, $2, ${addMonthsSql('now()', '$3')}, $4, $5)`,
          [id, points, s.points.expiry_months, `Adjustment: ${reason}`, me.id],
        );
      } else {
        await expirePoints(id, c);
        if ((await pointsBalance(id, c)) < -points) fail('not_enough_points');
        await spendPoints(id, -points, c);
        await c.query(`insert into points_ledger (customer_id, kind, points, label, staff_id) values ($1, 'adjust', $2, $3, $4)`, [id, points, `Adjustment: ${reason}`, me.id]);
      }
      await audit(me, 'adjust_points', 'customer', id, { points, reason }, c);
    });
    return { balance: await pointsBalance(id) };
  }

  /* ---------- measurements ---------- */

  @Get('members/:id/measurements')
  @UseGuards(AnyStaff)
  memberMeasurements(@Param('id') id: string) {
    return db.many(
      `select m.id, m.taken_at, m.method, m.tailor_name, ${FIELDS.map((f) => 'm.' + f).join(', ')}, m.remarks, b.name_en as branch_name
         from measurements m left join branches b on b.id = m.branch_id where m.member_id = $1 order by m.taken_at desc`,
      [id],
    );
  }

  @Post('members/:id/measurements')
  @UseGuards(Workshop)
  async measure(@CurrentStaff() me: StaffUser, @Param('id') memberId: string, @Body() body: Record<string, any>) {
    const member = await db.one('select id, customer_id, name from family_members where id = $1', [memberId]);
    if (!member) throw new NotFoundException({ code: 'member_not_found' });
    const values = FIELDS.map((f) => {
      const v = Number(need(body[f], f));
      if (!(v > 5 && v < 260)) fail('invalid_measurement', { field: f });
      return v;
    });
    const tailor = String(body.tailorName ?? me.name).trim() || me.name;
    const m = await db.one(
      `insert into measurements (member_id, method, branch_id, tailor_name, ${FIELDS.join(', ')}, remarks, staff_id)
       values ($1,$2,$3,$4,${FIELDS.map((_, i) => `$${i + 5}`).join(',')},$12,$13) returning id, taken_at`,
      [memberId, body.method === 'home' ? 'home' : 'branch', body.branchId || me.branch_id || null, tailor, ...values, body.remarks ? String(body.remarks).slice(0, 300) : null, me.id],
    );
    await db.pool.query(
      `update appointments set status = 'done' where member_id = $1 and status = 'confirmed' and (starts_at at time zone 'Asia/Qatar')::date <= (now() at time zone 'Asia/Qatar')::date`,
      [memberId],
    );
    const waiting = await db.many(`select distinct o.id from orders o join appointments a on a.order_id = o.id where a.member_id = $1 and o.stage = 'confirmed'`, [memberId]);
    for (const o of waiting) {
      const pending = await db.one(
        `select count(*)::int as n from appointments a where a.order_id = $1 and a.status in ('confirmed','done')
           and not exists (select 1 from measurements m where m.member_id = a.member_id and m.taken_at >= a.created_at)`,
        [o.id],
      );
      if (pending!.n === 0) await setStage(o.id, 'measured', undefined, me.id);
    }
    await notify(
      member.customer_id,
      'measurement',
      {
        en: { title: 'Measurements saved', body: `${member.name}'s new measurements are in your account.` },
        ar: { title: 'تم حفظ المقاسات', body: `مقاسات ${member.name} الجديدة متاحة في حسابك.` },
      },
      `/account/member/${memberId}`,
    );
    await audit(me, 'create', 'measurement', m!.id, { member: memberId });
    return m;
  }
}
