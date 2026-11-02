import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { config } from '../config.js';
import { CustomerGuard, Me, type Customer } from '../auth.js';
import { expirePoints, fail, need, newToken, normaliseQatarPhone, pointsBalance, sha256, sixDigits } from '../lib.js';

const RESEND_SECONDS = 45;

async function sendSms(phone: string, text: string) {
  console.log(`[sms] to ${phone}: ${text}`);
}

@Controller('v1')
export class AuthController {
  @Post('auth/otp')
  @HttpCode(200)
  async requestOtp(@Body() body: { phone: string }) {
    const phone = normaliseQatarPhone(need(body?.phone, 'phone'));
    const existing = await db.one<{ age: number }>('select extract(epoch from now() - sent_at)::int as age from otp_codes where phone = $1', [phone]);
    if (existing && existing.age < RESEND_SECONDS) fail('too_soon', { retryIn: RESEND_SECONDS - existing.age });
    const code = config.otpMode === 'preview' ? config.otpPreviewCode : sixDigits();
    await db.pool.query(
      `insert into otp_codes (phone, code_hash, expires_at, attempts, sent_at) values ($1, $2, now() + interval '5 minutes', 0, now())
       on conflict (phone) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = now()`,
      [phone, sha256(`${phone}:${code}`)],
    );
    if (config.otpMode === 'sms') await sendSms(phone, `Your AlRmh code is ${code}`);
    return { phone, retryIn: RESEND_SECONDS, preview: config.otpMode === 'preview' ? { code } : null };
  }

  @Post('auth/verify')
  @HttpCode(200)
  async verify(@Body() body: { phone: string; code: string }) {
    const phone = normaliseQatarPhone(need(body?.phone, 'phone'));
    const code = String(need(body?.code, 'code')).trim();
    const row = await db.one<{ code_hash: string; expired: boolean; attempts: number }>(
      'select code_hash, expires_at < now() as expired, attempts from otp_codes where phone = $1',
      [phone],
    );
    if (!row) fail('code_expired');
    if (row.attempts >= 5) fail('too_many_attempts');
    if (row.expired) fail('code_expired');
    if (row.code_hash !== sha256(`${phone}:${code}`)) {
      await db.pool.query('update otp_codes set attempts = attempts + 1 where phone = $1', [phone]);
      fail('wrong_code');
    }
    await db.pool.query('delete from otp_codes where phone = $1', [phone]);
    const customer = await db.one<Customer>(
      `insert into customers (phone) values ($1) on conflict (phone) do update set phone = excluded.phone
       returning id, phone, name, email, language`,
      [phone],
    );
    const token = newToken();
    await db.pool.query(`insert into sessions (token_hash, customer_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)`, [
      sha256(token),
      customer!.id,
      String(config.sessionDays),
    ]);
    return { token, customer, isNew: !customer!.name };
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Req() req: any) {
    const header: string = req.headers['authorization'] ?? '';
    if (header.startsWith('Bearer ')) await db.pool.query('delete from sessions where token_hash = $1', [sha256(header.slice(7))]);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(CustomerGuard)
  async me(@Me() me: Customer) {
    await expirePoints(me.id);
    const counts = await db.one(
      `select
        (select count(*)::int from family_members where customer_id = $1) as family,
        (select count(*)::int from addresses where customer_id = $1) as addresses,
        (select count(*)::int from orders where customer_id = $1 and stage not in ('pending_payment','delivered','cancelled','payment_failed')) as active_orders,
        (select count(*)::int from notifications where customer_id = $1 and read_at is null) as unread,
        (select coalesce(sum(qty),0)::int from basket_items where customer_id = $1) as basket`,
      [me.id],
    );
    return { ...me, counts, points: await pointsBalance(me.id) };
  }

  @Patch('me')
  @UseGuards(CustomerGuard)
  async update(@Me() me: Customer, @Body() body: { name?: string; email?: string | null; language?: string }) {
    const name = body.name !== undefined ? String(body.name).trim().slice(0, 80) : me.name;
    if (body.name !== undefined && !name) fail('missing_field', { field: 'name' });
    const email = body.email === undefined ? me.email : body.email ? String(body.email).trim().slice(0, 120) : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('invalid_email');
    const language = body.language === 'ar' || body.language === 'en' ? body.language : me.language;
    const updated = await db.one<Customer>(
      'update customers set name = $2, email = $3, language = $4 where id = $1 returning id, phone, name, email, language',
      [me.id, name, email, language],
    );
    if (name) {
      const self = await db.one('select id from family_members where customer_id = $1 and relation = $2', [me.id, 'self']);
      if (!self) await db.pool.query(`insert into family_members (customer_id, name, relation, size) values ($1, $2, 'self', 'adult')`, [me.id, name]);
      else await db.pool.query(`update family_members set name = $2 where id = $1`, [self.id, name]);
    }
    return updated;
  }

  @Delete('me')
  @UseGuards(CustomerGuard)
  async remove(@Me() me: Customer) {
    await db.tx(async (c) => {
      await c.query('delete from sessions where customer_id = $1', [me.id]);
      await c.query('delete from basket_items where customer_id = $1', [me.id]);
      await c.query('delete from addresses where customer_id = $1', [me.id]);
      await c.query(`update customers set phone = 'deleted:' || id, name = null, email = null, deleted_at = now() where id = $1`, [me.id]);
    });
    return { ok: true };
  }
}
