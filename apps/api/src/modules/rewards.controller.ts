import { Body, Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { CustomerGuard, Me, type Customer } from '../auth.js';
import { expirePoints, fail, getSettings, need, notify, pointsBalance, spendPoints, voucherCode } from '../lib.js';

const VOUCHER_COLS = `v.id, v.code, v.kind, v.percent, v.product_id, v.status, v.expires_at, v.cost_points, v.created_at,
  p.name_en as product_name_en, p.name_ar as product_name_ar`;

@Controller('v1/rewards')
@UseGuards(CustomerGuard)
export class RewardsController {
  @Get()
  async summary(@Me() me: Customer) {
    await expirePoints(me.id);
    const s = await getSettings();
    const [balance, year, expiring, vouchers, recent] = await Promise.all([
      pointsBalance(me.id),
      db.one(
        `select coalesce(sum(points) filter (where kind = 'earn'),0)::int as earned, coalesce(-sum(points) filter (where kind = 'redeem'),0)::int as redeemed
           from points_ledger where customer_id = $1 and created_at >= date_trunc('year', now())`,
        [me.id],
      ),
      db.one(
        `select coalesce(sum(remaining),0)::int as points, min(expires_at) as expires_at, min(created_at) as earned_at from points_ledger
          where customer_id = $1 and kind = 'earn' and remaining > 0 and expires_at <= now() + ($2 || ' days')::interval`,
        [me.id, String(s.points.warn_days)],
      ),
      db.many(`select ${VOUCHER_COLS} from vouchers v left join products p on p.id = v.product_id where v.customer_id = $1 and v.status = 'active' order by v.expires_at`, [me.id]),
      db.many('select id, kind, points, expires_at, label, created_at from points_ledger where customer_id = $1 order by created_at desc limit 5', [me.id]),
    ]);
    return {
      balance,
      earnedThisYear: year!.earned,
      redeemedThisYear: year!.redeemed,
      expiring: expiring!.points > 0 ? expiring : null,
      vouchers,
      rules: s.points,
      recent,
    };
  }

  @Get('history')
  async history(@Me() me: Customer, @Query('filter') filter?: string) {
    const kinds = filter === 'earned' ? ['earn'] : filter === 'redeemed' ? ['redeem'] : filter === 'expired' ? ['expire'] : ['earn', 'redeem', 'expire', 'adjust'];
    return db.many(
      `select id, kind, points, remaining, expires_at, label, created_at from points_ledger where customer_id = $1 and kind = any($2) order by created_at desc limit 200`,
      [me.id, kinds],
    );
  }

  @Get('options')
  async options(@Me() me: Customer) {
    await expirePoints(me.id);
    const balance = await pointsBalance(me.id);
    const rows = await db.many(
      `select r.id, r.kind, r.percent, r.product_id, r.cost_points, p.name_en as product_name_en, p.name_ar as product_name_ar, p.price as product_price, p.category
         from reward_options r left join products p on p.id = r.product_id where r.active order by r.kind, r.sort, r.cost_points`,
    );
    const withShort = rows.map((r) => ({ ...r, short: Math.max(0, r.cost_points - balance) }));
    return { balance, discounts: withShort.filter((r) => r.kind === 'discount'), products: withShort.filter((r) => r.kind === 'product') };
  }

  @Post('redeem')
  async redeem(@Me() me: Customer, @Body() body: { optionId: string }) {
    const option = await db.one('select * from reward_options where id = $1 and active', [need(body?.optionId, 'optionId')]);
    if (!option) throw new NotFoundException({ code: 'option_not_found' });
    const s = await getSettings();
    const voucher = await db.tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`points:${me.id}`]);
      await expirePoints(me.id, c);
      if ((await pointsBalance(me.id, c)) < option.cost_points) fail('not_enough_points');
      await spendPoints(me.id, option.cost_points, c);
      const v = await db.one(
        `insert into vouchers (customer_id, code, option_id, kind, percent, product_id, cost_points, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' days')::interval) returning id, code`,
        [me.id, voucherCode(option.percent), option.id, option.kind, option.percent, option.product_id, option.cost_points, String(s.voucher_valid_days)],
        c,
      );
      const label = option.kind === 'discount' ? `${option.percent}% off voucher` : `Reward: ${option.product_id}`;
      await c.query(`insert into points_ledger (customer_id, kind, points, voucher_id, label) values ($1, 'redeem', $2, $3, $4)`, [
        me.id,
        -option.cost_points,
        v!.id,
        label,
      ]);
      await notify(
        me.id,
        'points',
        {
          en: { title: 'Voucher ready', body: `Code ${v!.code}. It's applied automatically at checkout.` },
          ar: { title: 'القسيمة جاهزة', body: `الرمز ${v!.code}. تُطبَّق تلقائيًا عند الدفع.` },
        },
        `/rewards/voucher/${v!.id}`,
        c,
      );
      return v!;
    });
    return this.voucher(me, voucher.id);
  }

  @Get('vouchers/:id')
  async voucher(@Me() me: Customer, @Param('id') id: string) {
    const v = await db.one(`select ${VOUCHER_COLS} from vouchers v left join products p on p.id = v.product_id where v.id = $1 and v.customer_id = $2`, [id, me.id]);
    if (!v) throw new NotFoundException({ code: 'not_found' });
    return v;
  }
}

@Controller('v1/notifications')
@UseGuards(CustomerGuard)
export class NotificationsController {
  @Get()
  async list(@Me() me: Customer) {
    return db.many(
      'select id, kind, title_en, title_ar, body_en, body_ar, link, created_at, read_at from notifications where customer_id = $1 order by created_at desc limit 100',
      [me.id],
    );
  }

  @Post('read-all')
  async readAll(@Me() me: Customer) {
    await db.pool.query('update notifications set read_at = now() where customer_id = $1 and read_at is null', [me.id]);
    return { ok: true };
  }
}
