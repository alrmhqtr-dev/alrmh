import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { config } from '../config.js';
import { CustomerGuard, Me, type Customer } from '../auth.js';
import { expirePoints, fail, need, newToken, normaliseQatarPhone, pointsBalance, sameHash, sha256, sixDigits } from '../lib.js';
import { rateLimit } from '../ratelimit.js';

const RESEND_SECONDS = 45;
const CODES_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

/**
 * The SMS provider plugs in here. Until it does, SMS mode refuses to issue
 * codes: a code that is never delivered only locks customers out, and it must
 * never be written to the log.
 */
async function sendSms(_phone: string, _text: string): Promise<void> {
  throw new HttpException({ code: 'sms_not_configured' }, HttpStatus.SERVICE_UNAVAILABLE);
}

@Controller('v1')
export class AuthController {
  @Post('auth/otp')
  @HttpCode(200)
  @UseGuards(rateLimit('otp', 10, 600))
  async requestOtp(@Body() body: { phone: string }) {
    const phone = normaliseQatarPhone(need(body?.phone, 'phone'));
    const existing = await db.one<{ age: number; sends: number; in_window: boolean }>(
      `select extract(epoch from now() - sent_at)::int as age, sends, window_start > now() - interval '1 hour' as in_window from otp_codes where phone = $1`,
      [phone],
    );
    if (existing && existing.age < RESEND_SECONDS) fail('too_soon', { retryIn: RESEND_SECONDS - existing.age });
    if (existing && existing.in_window && existing.sends >= CODES_PER_HOUR) throw new HttpException({ code: 'too_many_codes' }, HttpStatus.TOO_MANY_REQUESTS);
    const code = config.otpMode === 'preview' ? config.otpPreviewCode : sixDigits();
    if (config.otpMode === 'sms') await sendSms(phone, `Your AlRmh code is ${code}`);
    await db.pool.query(
      `insert into otp_codes (phone, code_hash, expires_at, attempts, sent_at, sends, window_start) values ($1, $2, now() + interval '5 minutes', 0, now(), 1, now())
       on conflict (phone) do update set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, sent_at = now(),
         sends = case when otp_codes.window_start > now() - interval '1 hour' then otp_codes.sends + 1 else 1 end,
         window_start = case when otp_codes.window_start > now() - interval '1 hour' then otp_codes.window_start else now() end`,
      [phone, sha256(`${phone}:${code}`)],
    );
    return { phone, retryIn: RESEND_SECONDS, preview: config.otpMode === 'preview' ? { code } : null };
  }

  @Post('auth/verify')
  @HttpCode(200)
  @UseGuards(rateLimit('otp-verify', 40, 600))
  async verify(@Body() body: { phone: string; code: string }) {
    const phone = normaliseQatarPhone(need(body?.phone, 'phone'));
    const code = String(need(body?.code, 'code')).trim();
    // Every try is counted before it is checked, in one statement, so parallel
    // guesses cannot slip past the limit.
    const row = await db.one<{ code_hash: string; expired: boolean }>(
      'update otp_codes set attempts = attempts + 1 where phone = $1 and attempts < $2 returning code_hash, expires_at < now() as expired',
      [phone, MAX_ATTEMPTS],
    );
    if (!row) fail((await db.one('select 1 from otp_codes where phone = $1', [phone])) ? 'too_many_attempts' : 'code_expired');
    if (row.expired) fail('code_expired');
    if (!sameHash(row.code_hash, sha256(`${phone}:${code}`))) fail('wrong_code');
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
      // An order still being made needs the measurements and the visit, so it has to finish or be cancelled first.
      const open = await db.one(
        `select 1 from orders where customer_id = $1 and stage not in ('pending_payment','payment_failed','delivered','cancelled') limit 1`,
        [me.id],
        c,
      );
      if (open) fail('active_orders');
      await c.query('delete from sessions where customer_id = $1', [me.id]);
      await c.query('delete from basket_items where customer_id = $1', [me.id]);
      await c.query('delete from notifications where customer_id = $1', [me.id]);
      await c.query('delete from points_ledger where customer_id = $1', [me.id]);
      await c.query('delete from vouchers where customer_id = $1', [me.id]);
      // Removes measurements and appointments with them.
      await c.query('delete from family_members where customer_id = $1', [me.id]);
      await c.query('delete from addresses where customer_id = $1', [me.id]);
      // Past orders stay as sales records, without the profile they belonged to.
      await c.query(`update customers set phone = 'deleted:' || id, name = null, email = null, deleted_at = now() where id = $1`, [me.id]);
    });
    return { ok: true };
  }
}
