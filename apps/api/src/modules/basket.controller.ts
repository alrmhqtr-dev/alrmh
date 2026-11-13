import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { CustomerGuard, Me, type Customer } from '../auth.js';
import { fail, need } from '../lib.js';
import { quote } from '../pricing.js';
import { latestMeasurement, memberFor } from './family.controller.js';

type AddBody =
  | { kind: 'product'; productId: string; size?: string; qty?: number }
  | {
      kind: 'thobe';
      collarId: string;
      fabricId: string;
      colourId: string;
      memberId: string;
      measureMethod: 'saved' | 'branch' | 'home';
      appointmentId?: string;
      remarks?: string;
      qty?: number;
    };

@Controller('v1/basket')
@UseGuards(CustomerGuard)
export class BasketController {
  @Get()
  async get(@Me() me: Customer) {
    const q = await quote(me.id, {});
    return { items: q.items, count: q.count, subtotal: q.subtotal, pointsToEarn: q.pointsToEarn };
  }

  @Post('items')
  async add(@Me() me: Customer, @Body() body: AddBody) {
    const qty = Number(body?.qty ?? 1);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) fail('invalid_qty');
    if (body?.kind === 'product') {
      const p = await db.one('select id, sizes from products where id = $1 and active', [need(body.productId, 'productId')]);
      if (!p) throw new NotFoundException({ code: 'product_not_found' });
      if (p.sizes.length && !p.sizes.includes(body.size)) fail('size_required');
      const existing = await db.one(
        `select id from basket_items where customer_id = $1 and kind = 'product' and product_id = $2 and coalesce(size,'') = coalesce($3,'')`,
        [me.id, p.id, body.size ?? null],
      );
      if (existing) await db.pool.query('update basket_items set qty = least(qty + $2, 20) where id = $1', [existing.id, qty]);
      else await db.pool.query(`insert into basket_items (customer_id, kind, product_id, size, qty) values ($1,'product',$2,$3,$4)`, [me.id, p.id, body.size ?? null, qty]);
      return this.get(me);
    }
    if (body?.kind !== 'thobe') fail('invalid_kind');
    const collar = await db.one('select id from collars where id = $1 and active', [need(body.collarId, 'collarId')]);
    const fabric = await db.one('select id from fabrics where id = $1 and active', [need(body.fabricId, 'fabricId')]);
    const colour = await db.one('select 1 from fabric_colours where fabric_id = $1 and colour_id = $2', [body.fabricId, need(body.colourId, 'colourId')]);
    if (!collar || !fabric || !colour) fail('invalid_thobe_options');
    await memberFor(me.id, need(body.memberId, 'memberId'));
    const method = body.measureMethod;
    if (method === 'saved') {
      if (!(await latestMeasurement(body.memberId))) fail('no_saved_measurements');
    } else if (method === 'branch' || method === 'home') {
      const appt = await db.one(
        `select id from appointments where id = $1 and customer_id = $2 and member_id = $3 and kind = $4 and status in ('held','confirmed')`,
        [need(body.appointmentId, 'appointmentId'), me.id, body.memberId, method],
      );
      if (!appt) fail('appointment_not_found');
    } else fail('invalid_measure_method');
    const remarks = body.remarks ? String(body.remarks).slice(0, 200) : null;
    await db.pool.query(
      `insert into basket_items (customer_id, kind, qty, thobe, member_id, measure_method, appointment_id, remarks)
       values ($1,'thobe',$2,$3,$4,$5,$6,$7)`,
      [me.id, qty, { collarId: body.collarId, fabricId: body.fabricId, colourId: body.colourId }, body.memberId, method, method === 'saved' ? null : body.appointmentId, remarks],
    );
    return this.get(me);
  }

  @Patch('items/:id')
  async setQty(@Me() me: Customer, @Param('id') id: string, @Body() body: { qty: number }) {
    const qty = Number(body?.qty);
    if (!Number.isInteger(qty) || qty < 0 || qty > 20) fail('invalid_qty');
    if (qty === 0) await db.pool.query('delete from basket_items where id = $1 and customer_id = $2', [id, me.id]);
    else await db.pool.query('update basket_items set qty = $3 where id = $1 and customer_id = $2', [id, me.id, qty]);
    return this.get(me);
  }

  @Delete('items/:id')
  async remove(@Me() me: Customer, @Param('id') id: string) {
    await db.pool.query('delete from basket_items where id = $1 and customer_id = $2', [id, me.id]);
    return this.get(me);
  }
}
