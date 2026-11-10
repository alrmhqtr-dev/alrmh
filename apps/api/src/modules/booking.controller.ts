import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { db, type Queryable } from '../db.js';
import { CustomerGuard, Me, type Customer } from '../auth.js';
import { addDays, fail, getSettings, need, notify, qatarDateString, qatarInstant } from '../lib.js';
import { memberFor } from './family.controller.js';

type Window = { open: number; close: number; step: number; capacity: number; closed: number[] };

async function windowFor(kind: string, branchId: string | undefined, client: Queryable = db.pool): Promise<Window> {
  if (kind === 'home') {
    const s = (await getSettings(client)).home_visit;
    return { open: s.open_minute, close: s.close_minute, step: s.slot_minutes, capacity: s.capacity, closed: s.closed_weekdays };
  }
  const b = await db.one('select * from branches where id = $1 and active', [need(branchId, 'branchId')], client);
  if (!b) throw new NotFoundException({ code: 'branch_not_found' });
  return { open: b.open_minute, close: b.close_minute, step: b.slot_minutes, capacity: b.slot_capacity, closed: b.closed_weekdays };
}

async function takenCounts(kind: string, branchId: string | null, from: Date, to: Date, client: Queryable = db.pool, excludeId?: string) {
  const rows = await db.many<{ starts_at: Date; n: number }>(
    `select starts_at, count(*)::int as n from appointments
      where kind = $1 and ($2::uuid is null or branch_id = $2) and starts_at >= $3 and starts_at < $4
        and (status in ('confirmed','done') or (status = 'held' and created_at > now() - interval '30 minutes'))
        and ($5::uuid is null or id <> $5)
      group by starts_at`,
    [kind, kind === 'branch' ? branchId : null, from, to, excludeId ?? null],
    client,
  );
  return new Map(rows.map((r) => [new Date(r.starts_at).toISOString(), r.n]));
}

const MAX_OPEN_BOOKINGS = 10;

/** Everyone booking the same slot queues on this lock, so capacity is checked one at a time. */
export const slotLockKey = (kind: string, branchId: string | null | undefined, startsAt: Date) => `${kind}:${kind === 'branch' ? branchId : 'home'}:${startsAt.toISOString()}`;

export async function assertSlotFree(kind: string, branchId: string | null, startsAt: Date, client: Queryable, excludeId?: string) {
  const w = await windowFor(kind, branchId ?? undefined, client);
  const date = qatarDateString(startsAt);
  const minute = Math.round((startsAt.getTime() - qatarInstant(date, 0).getTime()) / 60000);
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const onGrid = minute >= w.open && minute + w.step <= w.close && (minute - w.open) % w.step === 0;
  if (!onGrid || w.closed.includes(weekday)) fail('slot_invalid');
  if (startsAt.getTime() < Date.now() + 60 * 60_000) fail('slot_in_past');
  const taken = await takenCounts(kind, branchId, startsAt, new Date(startsAt.getTime() + 1), client, excludeId);
  if ((taken.get(startsAt.toISOString()) ?? 0) >= w.capacity) fail('slot_taken');
}

@Controller('v1')
@UseGuards(CustomerGuard)
export class BookingController {
  @Get('slots')
  async slots(@Query('kind') kind: string, @Query('branchId') branchId?: string, @Query('days') daysParam?: string) {
    if (kind !== 'branch' && kind !== 'home') fail('invalid_kind');
    const w = await windowFor(kind, branchId);
    const asked = Number(daysParam ?? 7);
    const wanted = Number.isFinite(asked) ? Math.max(1, Math.min(Math.trunc(asked), 21)) : 7;
    const today = qatarDateString(new Date());
    const days: { date: string; weekday: number }[] = [];
    for (let i = 0; days.length < wanted && i < 30; i++) {
      const date = addDays(today, i);
      const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
      if (!w.closed.includes(weekday)) days.push({ date, weekday });
    }
    if (!days.length) return { closedWeekdays: w.closed, days: [] };
    const from = qatarInstant(days[0].date, 0);
    const to = qatarInstant(addDays(days[days.length - 1].date, 1), 0);
    const taken = await takenCounts(kind, branchId ?? null, from, to);
    const earliest = Date.now() + 60 * 60_000;
    return {
      closedWeekdays: w.closed,
      days: days.map((d) => {
        const times = [];
        for (let m = w.open; m + w.step <= w.close; m += w.step) {
          const at = qatarInstant(d.date, m);
          const free = at.getTime() >= earliest && (taken.get(at.toISOString()) ?? 0) < w.capacity;
          times.push({ startsAt: at.toISOString(), minute: m, available: free });
        }
        return { ...d, times, available: times.some((t) => t.available) };
      }),
    };
  }

  @Post('appointments')
  async hold(@Me() me: Customer, @Body() body: { kind: string; branchId?: string; addressId?: string; memberId: string; startsAt: string; standalone?: boolean }) {
    const kind = body?.kind;
    if (kind !== 'branch' && kind !== 'home') fail('invalid_kind');
    await memberFor(me.id, need(body.memberId, 'memberId'));
    const startsAt = new Date(need(body.startsAt, 'startsAt'));
    if (Number.isNaN(startsAt.getTime())) fail('slot_invalid');
    if (kind === 'home') {
      const a = await db.one('select id from addresses where id = $1 and customer_id = $2', [need(body.addressId, 'addressId'), me.id]);
      if (!a) fail('address_not_found');
    }
    const standalone = body.standalone === true;
    const branchId = kind === 'branch' ? need(body.branchId, 'branchId') : null;
    return db.tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`bookings:${me.id}`]);
      if (standalone) {
        // A visit booked on its own is confirmed without payment, so it is one per person at a time.
        const existing = await db.one(
          `select id from appointments where customer_id = $1 and member_id = $2 and status = 'confirmed' and order_id is null and starts_at > now() limit 1`,
          [me.id, body.memberId],
          c,
        );
        if (existing) fail('already_booked', { appointmentId: existing.id });
      } else {
        // Choosing a new time while designing a thobe lets go of the earlier hold for that person.
        await c.query(
          `update appointments a set status = 'cancelled'
            where a.customer_id = $1 and a.member_id = $2 and a.status = 'held' and a.order_id is null
              and not exists (select 1 from basket_items b where b.appointment_id = a.id)`,
          [me.id, body.memberId],
        );
      }
      const open = await db.one<{ n: number }>(
        `select count(*)::int as n from appointments where customer_id = $1 and order_id is null and starts_at > now()
           and (status = 'confirmed' or (status = 'held' and created_at > now() - interval '30 minutes'))`,
        [me.id],
        c,
      );
      if (open!.n >= MAX_OPEN_BOOKINGS) fail('too_many_bookings');
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [slotLockKey(kind, branchId, startsAt)]);
      await assertSlotFree(kind, branchId, startsAt, c);
      const appt = await db.one(
        `insert into appointments (customer_id, member_id, kind, branch_id, address_id, starts_at, status) values ($1,$2,$3,$4,$5,$6,$7)
         returning id, kind, branch_id, address_id, member_id, starts_at, status`,
        [me.id, body.memberId, kind, branchId, kind === 'home' ? body.addressId : null, startsAt, standalone ? 'confirmed' : 'held'],
        c,
      );
      if (standalone) {
        await notify(
          me.id,
          'appointment',
          {
            en: { title: kind === 'home' ? 'Home visit confirmed' : 'Branch visit confirmed', body: 'A tailor will take your measurements. See you then.' },
            ar: { title: kind === 'home' ? 'تم تأكيد الزيارة المنزلية' : 'تم تأكيد زيارة الفرع', body: 'سيأخذ الخيّاط مقاساتك. نراك قريباً.' },
          },
          '/orders',
          c,
        );
      }
      return appt;
    });
  }

  @Get('appointments')
  upcoming(@Me() me: Customer) {
    return db.many(
      `select a.id, a.kind, a.starts_at, a.status, a.order_id, f.name as member_name, ad.area, ad.label as address_label,
              b.name_en as branch_name_en, b.name_ar as branch_name_ar, a.branch_id
         from appointments a join family_members f on f.id = a.member_id
         left join addresses ad on ad.id = a.address_id left join branches b on b.id = a.branch_id
        where a.customer_id = $1 and a.status = 'confirmed' and a.starts_at > now() order by a.starts_at`,
      [me.id],
    );
  }

  @Patch('appointments/:id')
  async reschedule(@Me() me: Customer, @Param('id') id: string, @Body() body: { startsAt: string }) {
    const appt = await db.one('select * from appointments where id = $1 and customer_id = $2', [id, me.id]);
    if (!appt || appt.status === 'cancelled' || appt.status === 'done') throw new NotFoundException({ code: 'not_found' });
    const startsAt = new Date(need(body?.startsAt, 'startsAt'));
    if (Number.isNaN(startsAt.getTime())) fail('slot_invalid');
    return db.tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [slotLockKey(appt.kind, appt.branch_id, startsAt)]);
      await assertSlotFree(appt.kind, appt.branch_id, startsAt, c, id);
      return db.one('update appointments set starts_at = $2 where id = $1 returning id, starts_at, status', [id, startsAt], c);
    });
  }

  /** A customer can cancel a visit that is not part of an order. Visits on an order are rescheduled, or cancelled with the order by staff. */
  @Delete('appointments/:id')
  async cancel(@Me() me: Customer, @Param('id') id: string) {
    const appt = await db.one('select id, status, order_id from appointments where id = $1 and customer_id = $2', [id, me.id]);
    if (!appt || appt.status === 'cancelled' || appt.status === 'done') throw new NotFoundException({ code: 'not_found' });
    if (appt.order_id) fail('appointment_has_order');
    await db.pool.query(`update appointments set status = 'cancelled' where id = $1`, [id]);
    return { ok: true };
  }
}
