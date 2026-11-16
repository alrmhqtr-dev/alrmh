import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { CustomerGuard, Me, type Customer } from '../auth.js';
import { expirePoints, getSettings, pointsBalance, tierStatus } from '../lib.js';

@Controller('v1/rewards')
@UseGuards(CustomerGuard)
export class RewardsController {
  /** The customer's tier card: tier, points (worth QAR 1 each at checkout) and the way to the next tier. */
  @Get()
  async summary(@Me() me: Customer) {
    await expirePoints(me.id);
    const [balance, status, s] = await Promise.all([pointsBalance(me.id), tierStatus(me.id), getSettings()]);
    return { balance, tier: status.tier, next: status.next, lifetime: status.lifetime, toNext: status.toNext, expiryMonths: s.points.expiry_months };
  }

  @Get('history')
  async history(@Me() me: Customer, @Query('filter') filter?: string) {
    const kinds = filter === 'earned' ? ['earn'] : filter === 'redeemed' ? ['redeem'] : filter === 'expired' ? ['expire'] : ['earn', 'redeem', 'expire', 'adjust', 'refund'];
    return db.many(
      `select id, kind, points, remaining, expires_at, label, created_at from points_ledger where customer_id = $1 and kind = any($2) order by created_at desc limit 200`,
      [me.id, kinds],
    );
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
