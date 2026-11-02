import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import { CustomerGuard, Me, type Customer } from '../auth.js';
import { fail } from '../lib.js';
import { quote, type QuoteInput } from '../pricing.js';
import { closePayment, createOrder, markPaid, stagesFor } from '../orders.js';

function allowedReturn(url: string | undefined) {
  if (!url) return config.appUrl;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) && !u.protocol.startsWith('alrmh')) return config.appUrl;
    if (config.corsOrigins.includes('*') || config.corsOrigins.includes(u.origin) || url.startsWith(config.appUrl)) return url.replace(/\/$/, '');
  } catch {}
  return config.appUrl;
}

const ORDER_SUMMARY = `
  o.id, o.number, o.stage, o.total, o.created_at, o.expected_delivery, o.points_to_earn, o.points_awarded,
  (select coalesce(sum(qty),0)::int from order_items i where i.order_id = o.id) as item_count,
  (select coalesce(sum(qty),0)::int from order_items i where i.order_id = o.id and i.kind = 'thobe') as thobe_count,
  (select array_agg(distinct i.snapshot->'member'->>'name') from order_items i where i.order_id = o.id and i.kind = 'thobe') as members`;

@Controller('v1')
export class OrdersController {
  @Post('checkout/quote')
  @HttpCode(200)
  @UseGuards(CustomerGuard)
  async quote(@Me() me: Customer, @Body() body: QuoteInput) {
    return quote(me.id, body ?? {});
  }

  @Post('orders')
  @UseGuards(CustomerGuard)
  async create(@Me() me: Customer, @Body() body: QuoteInput & { returnUrl?: string }) {
    if (config.paymentMode !== 'mock') fail('payment_not_configured');
    const r = await createOrder(me.id, body ?? {});
    const ret = encodeURIComponent(allowedReturn(body?.returnUrl));
    return { ...r, paymentUrl: `${config.apiUrl}/v1/pay/mock/${r.paymentId}?return=${ret}` };
  }

  @Get('orders')
  @UseGuards(CustomerGuard)
  async list(@Me() me: Customer) {
    const rows = await db.many(
      `select ${ORDER_SUMMARY} from orders o where o.customer_id = $1 and o.stage not in ('pending_payment','payment_failed') order by o.created_at desc`,
      [me.id],
    );
    const done = (s: string) => s === 'delivered' || s === 'cancelled';
    return { active: rows.filter((r) => !done(r.stage)), past: rows.filter((r) => done(r.stage)) };
  }

  @Get('orders/:id')
  @UseGuards(CustomerGuard)
  async detail(@Me() me: Customer, @Param('id') id: string) {
    const order = await db.one(
      `select o.*, (select status from payments p where p.order_id = o.id order by created_at desc limit 1) as payment_status
         from orders o where o.id = $1 and o.customer_id = $2`,
      [id, me.id],
    );
    if (!order) throw new NotFoundException({ code: 'order_not_found' });
    const [items, events, appointments] = await Promise.all([
      db.many('select id, kind, snapshot, qty, unit_price, line_total from order_items where order_id = $1 order by kind desc', [id]),
      db.many('select stage, at, note from order_events where order_id = $1 order by at', [id]),
      db.many(
        `select a.id, a.kind, a.starts_at, a.status, f.name as member_name, b.name_en as branch_name_en, b.name_ar as branch_name_ar, ad.area
           from appointments a join family_members f on f.id = a.member_id left join branches b on b.id = a.branch_id left join addresses ad on ad.id = a.address_id
          where a.order_id = $1 order by a.starts_at`,
        [id],
      ),
    ]);
    return { ...order, items, events, appointments, stages: stagesFor(items) };
  }

  @Get('pay/mock/:paymentId')
  async mockPage(@Param('paymentId') paymentId: string, @Query('return') ret: string, @Res() res: Response) {
    const p = await db.one('select p.id, p.amount, p.status, o.number from payments p join orders o on o.id = p.order_id where p.id = $1', [paymentId]);
    if (!p) return res.status(404).send('Payment not found');
    const action = `${config.apiUrl}/v1/pay/mock/${paymentId}?return=${encodeURIComponent(ret ?? '')}`;
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SADAD · Test payment</title><style>
body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#f4f4f4;color:#0b0b0b;display:flex;min-height:100vh;align-items:center;justify-content:center}
.card{background:#fff;border-radius:16px;padding:28px;width:min(92vw,380px);box-shadow:0 1px 3px rgba(0,0,0,.08)}
.badge{display:inline-block;background:#fff4d6;color:#7a5a1c;font-size:12px;font-weight:600;padding:4px 10px;border-radius:99px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 4px}p{color:#4a4a4a;font-size:14px;margin:0 0 20px}.amt{font-size:32px;font-weight:700;margin:8px 0 24px}
button{width:100%;height:52px;border-radius:12px;border:0;font-size:16px;font-weight:600;cursor:pointer;margin-bottom:10px}
.pay{background:#0b0b0b;color:#fff}.fail{background:#fff;border:1px solid #e8e2d6;color:#0b0b0b}.cancel{background:none;color:#4a4a4a}
</style></head><body><form class="card" method="post" action="${action}">
<span class="badge">Test mode · no money is taken</span><h1>SADAD</h1><p>Order #${p.number}</p>
<div class="amt">QAR ${Number(p.amount).toFixed(2)}</div>
${p.status === 'pending' ? `<button class="pay" name="result" value="paid">Pay QAR ${Number(p.amount).toFixed(2)}</button>
<button class="fail" name="result" value="failed">Simulate a declined card</button>
<button class="cancel" name="result" value="cancelled">Cancel and go back</button>` : `<p>This payment is already ${p.status}.</p>`}
</form></body></html>`);
  }

  @Post('pay/mock/:paymentId')
  async mockComplete(@Param('paymentId') paymentId: string, @Query('return') ret: string, @Body() body: { result?: string }, @Res() res: Response) {
    const base = allowedReturn(ret);
    const p = await db.one('select order_id from payments where id = $1', [paymentId]);
    if (!p) return res.status(404).send('Payment not found');
    if (body?.result === 'paid') {
      const orderId = await markPaid(paymentId, `MOCK-${Date.now()}`);
      return res.redirect(303, `${base}/order-placed/${orderId}`);
    }
    await closePayment(paymentId, body?.result === 'failed' ? 'failed' : 'cancelled');
    return res.redirect(303, `${base}/checkout?payment=${body?.result === 'failed' ? 'failed' : 'cancelled'}`);
  }
}
