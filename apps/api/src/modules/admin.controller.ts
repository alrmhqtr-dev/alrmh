import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { AdminGuard } from '../auth.js';
import { STAGES, fail, need, normaliseQatarPhone, notify, type Stage } from '../lib.js';
import { setStage } from '../orders.js';

const FIELDS = ['length_cm', 'shoulder_cm', 'chest_cm', 'waist_cm', 'sleeve_cm', 'neck_cm', 'cuff_cm'] as const;

@Controller('v1/admin')
@UseGuards(AdminGuard)
export class AdminController {
  @Get('orders')
  orders(@Query('stage') stage?: string) {
    return db.many(
      `select o.id, o.number, o.stage, o.total, o.created_at, o.expected_delivery, c.name as customer_name, c.phone
         from orders o join customers c on c.id = o.customer_id
        where ($1::text is null or o.stage = $1) and o.stage not in ('pending_payment','payment_failed')
        order by o.created_at desc limit 200`,
      [stage ?? null],
    );
  }

  @Post('orders/:id/stage')
  stage(@Param('id') id: string, @Body() body: { stage: Stage }) {
    if (!STAGES.includes(body?.stage)) fail('invalid_stage');
    return setStage(id, body.stage);
  }

  @Get('customers')
  async customer(@Query('phone') phone: string) {
    const c = await db.one('select id, phone, name, email, language, created_at from customers where phone = $1', [normaliseQatarPhone(phone)]);
    if (!c) throw new NotFoundException({ code: 'not_found' });
    const family = await db.many('select id, name, relation, size from family_members where customer_id = $1 order by created_at', [c.id]);
    return { ...c, family };
  }

  @Post('members/:id/measurements')
  async measure(@Param('id') memberId: string, @Body() body: Record<string, any>) {
    const member = await db.one('select f.id, f.customer_id, f.name from family_members f where f.id = $1', [memberId]);
    if (!member) throw new NotFoundException({ code: 'member_not_found' });
    const values = FIELDS.map((f) => {
      const v = Number(need(body[f], f));
      if (!(v > 0 && v < 300)) fail('invalid_measurement', { field: f });
      return v;
    });
    const m = await db.one(
      `insert into measurements (member_id, method, branch_id, tailor_name, ${FIELDS.join(', ')}, remarks)
       values ($1,$2,$3,$4,${FIELDS.map((_, i) => `$${i + 5}`).join(',')},$12) returning id, taken_at`,
      [memberId, body.method === 'home' ? 'home' : 'branch', body.branchId ?? null, need(body.tailorName, 'tailorName'), ...values, body.remarks ?? null],
    );
    const orders = await db.many(
      `select distinct o.id from orders o join appointments a on a.order_id = o.id where a.member_id = $1 and o.stage = 'confirmed'`,
      [memberId],
    );
    for (const o of orders) {
      const pending = await db.one(
        `select count(*)::int as n from appointments a where a.order_id = $1 and a.status = 'confirmed'
           and not exists (select 1 from measurements m where m.member_id = a.member_id and m.taken_at >= a.created_at)`,
        [o.id],
      );
      if (pending!.n === 0) await setStage(o.id, 'measured');
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
    return m;
  }
}
