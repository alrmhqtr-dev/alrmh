import { Body, Controller, Delete, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { config } from '../config.js';
import { CustomerGuard, Me, type Customer } from '../auth.js';
import { fail } from '../lib.js';
import { allowedEndpoint, pushEnabled } from '../push.js';

const MAX_DEVICES = 10;

@Controller('v1/push')
export class PushController {
  /** The public key a browser needs to subscribe; null while push is not set up. */
  @Get('key')
  key() {
    return { key: pushEnabled ? config.vapidPublicKey : null };
  }

  @Post('subscriptions')
  @HttpCode(200)
  @UseGuards(CustomerGuard)
  async subscribe(@Me() me: Customer, @Body() body: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }) {
    if (!pushEnabled) fail('push_not_configured');
    const endpoint = String(body?.endpoint ?? '');
    const p256dh = String(body?.keys?.p256dh ?? '');
    const auth = String(body?.keys?.auth ?? '');
    if (endpoint.length > 1000 || !allowedEndpoint(endpoint)) fail('invalid_subscription');
    if (!/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) fail('invalid_subscription');
    await db.tx(async (c) => {
      // A phone belongs to whoever signed in on it last.
      await c.query(
        `insert into push_subscriptions (customer_id, endpoint, p256dh, auth) values ($1,$2,$3,$4)
         on conflict (endpoint) do update set customer_id = excluded.customer_id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0`,
        [me.id, endpoint, p256dh, auth],
      );
      await c.query(
        `delete from push_subscriptions where customer_id = $1 and id not in (select id from push_subscriptions where customer_id = $1 order by created_at desc limit $2)`,
        [me.id, MAX_DEVICES],
      );
    });
    return { ok: true };
  }

  /** Called on sign-out and when the customer turns notifications off. */
  @Delete('subscriptions')
  @UseGuards(CustomerGuard)
  async unsubscribe(@Me() me: Customer, @Body() body: { endpoint?: string }) {
    await db.pool.query('delete from push_subscriptions where customer_id = $1 and endpoint = $2', [me.id, String(body?.endpoint ?? '')]);
    return { ok: true };
  }
}
