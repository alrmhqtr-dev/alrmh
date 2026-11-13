import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { db } from '../db.js';
import { fail, getSettings, need, newToken, sha256 } from '../lib.js';
import { AnyStaff, CurrentStaff, Managers, OwnerOnly, ROLES, audit, hashPassword, verifyPassword, type Role, type StaffUser } from '../staff.js';

import { rateLimit } from '../ratelimit.js';

const SESSION_HOURS = 12;
const MAX_FAILED_LOGINS = 10;
const LOCK_MINUTES = 15;
// Checked when the email is unknown, so a wrong email takes as long as a wrong password.
const dummyHash = hashPassword('not-a-real-password');

@Controller('v1/admin')
export class AdminCoreController {
  @Post('auth/login')
  @HttpCode(200)
  @UseGuards(rateLimit('staff-login', 20, 600))
  async login(@Body() body: { email: string; password: string }) {
    const email = String(need(body?.email, 'email')).trim().toLowerCase();
    const user = await db.one(`select *, greatest(0, ceil(extract(epoch from locked_until - now())))::int as locked_for from staff_users where email = $1 and active`, [email]);
    if (user?.locked_for > 0) throw new HttpException({ code: 'account_locked', retryIn: user.locked_for }, HttpStatus.TOO_MANY_REQUESTS);
    const ok = await verifyPassword(String(body.password ?? ''), user ? user.password_hash : await dummyHash);
    if (!user || !ok) {
      if (user)
        await db.pool.query(
          `update staff_users set
             failed_logins = case when locked_until is not null then 1 else failed_logins + 1 end,
             locked_until = case when locked_until is null and failed_logins + 1 >= $2 then now() + ($3 || ' minutes')::interval else null end
           where id = $1`,
          [user.id, MAX_FAILED_LOGINS, String(LOCK_MINUTES)],
        );
      fail('invalid_login');
    }
    const token = newToken();
    await db.pool.query(`insert into staff_sessions (token_hash, staff_id, expires_at) values ($1, $2, now() + ($3 || ' hours')::interval)`, [sha256(token), user.id, String(SESSION_HOURS)]);
    await db.pool.query('update staff_users set last_login_at = now(), failed_logins = 0, locked_until = null where id = $1', [user.id]);
    return { token, staff: { id: user.id, email: user.email, name: user.name, role: user.role, branch_id: user.branch_id } };
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(@Req() req: any) {
    const header: string = req.headers['authorization'] ?? '';
    if (header.startsWith('Bearer ')) await db.pool.query('delete from staff_sessions where token_hash = $1', [sha256(header.slice(7))]);
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AnyStaff)
  me(@CurrentStaff() staff: StaffUser) {
    return staff;
  }

  @Post('me/password')
  @HttpCode(200)
  @UseGuards(AnyStaff)
  async changeOwnPassword(@CurrentStaff() me: StaffUser, @Req() req: any, @Body() body: { current?: string; next?: string }) {
    const row = await db.one('select password_hash from staff_users where id = $1', [me.id]);
    if (!(await verifyPassword(String(body?.current ?? ''), row.password_hash))) fail('wrong_password');
    const next = String(body?.next ?? '');
    if (next.length < 10) fail('password_too_short');
    if (next === body?.current) fail('same_password');
    await db.pool.query('update staff_users set password_hash = $2, failed_logins = 0, locked_until = null where id = $1', [me.id, await hashPassword(next)]);
    // Signed out everywhere else; this browser stays signed in.
    const header: string = req.headers['authorization'] ?? '';
    await db.pool.query('delete from staff_sessions where staff_id = $1 and token_hash <> $2', [me.id, sha256(header.slice(7))]);
    await audit(me, 'password', 'staff', me.id);
    return { ok: true };
  }

  @Get('overview')
  @UseGuards(AnyStaff)
  async overview() {
    const settings = await getSettings();
    const [stages, today, sales, customers, points, expiring, attention, refunds] = await Promise.all([
      db.many(`select stage, count(*)::int as n from orders where stage not in ('pending_payment','payment_failed') group by stage`),
      db.many(
        `select a.id, a.kind, a.starts_at, a.status, f.name as member_name, c.name as customer_name, c.phone, ad.area, b.name_en as branch_name, o.number as order_number
           from appointments a join family_members f on f.id = a.member_id join customers c on c.id = a.customer_id
           left join addresses ad on ad.id = a.address_id left join branches b on b.id = a.branch_id left join orders o on o.id = a.order_id
          where a.status in ('confirmed','done') and (a.starts_at at time zone 'Asia/Qatar')::date = (now() at time zone 'Asia/Qatar')::date
          order by a.starts_at`,
      ),
      db.one(
        `select coalesce(sum(total) filter (where paid_at > now() - interval '7 days'),0)::float as week,
                coalesce(sum(total) filter (where paid_at > now() - interval '30 days'),0)::float as month,
                count(*) filter (where paid_at > now() - interval '7 days')::int as week_orders,
                count(*) filter (where paid_at > now() - interval '30 days')::int as month_orders
           from orders where paid_at is not null and stage <> 'cancelled'`,
      ),
      db.one(`select count(*)::int as total, count(*) filter (where created_at > now() - interval '7 days')::int as week from customers where deleted_at is null`),
      db.one(`select coalesce(sum(points),0)::int as outstanding from points_ledger`),
      db.one(
        `select coalesce(sum(remaining),0)::int as points, count(distinct customer_id)::int as customers from points_ledger
          where kind = 'earn' and remaining > 0 and expires_at > now() and expires_at <= now() + ($1 || ' days')::interval`,
        [String(settings.points.warn_days)],
      ),
      db.many(
        `select o.id, o.number, o.stage, o.expected_delivery, c.name as customer_name from orders o join customers c on c.id = o.customer_id
          where o.stage not in ('pending_payment','payment_failed','delivered','cancelled','out_for_delivery','ready')
            and o.expected_delivery is not null and o.expected_delivery <= (now() at time zone 'Asia/Qatar')::date + 1
          order by o.expected_delivery limit 20`,
      ),
      db.many(
        `select o.id, o.number, o.total::float as total, c.name as customer_name,
                (o.total - coalesce((select sum(amount) from refunds r where r.order_id = o.id), 0))::float as due
           from orders o join customers c on c.id = o.customer_id
          where o.stage = 'cancelled' and o.paid_at is not null
            and o.total > coalesce((select sum(amount) from refunds r where r.order_id = o.id), 0)
          order by o.created_at limit 20`,
      ),
    ]);
    return { stages, today, sales, customers, points: { outstanding: points!.outstanding, expiring }, attention, refunds };
  }

  @Get('staff')
  @UseGuards(OwnerOnly)
  staff() {
    return db.many(
      `select u.id, u.email, u.name, u.role, u.active, u.branch_id, b.name_en as branch_name, u.created_at, u.last_login_at
         from staff_users u left join branches b on b.id = u.branch_id order by u.active desc, u.role, u.name`,
    );
  }

  @Post('staff')
  @UseGuards(OwnerOnly)
  async addStaff(@CurrentStaff() me: StaffUser, @Body() body: { email: string; name: string; role: Role; password: string; branchId?: string | null }) {
    const email = String(need(body?.email, 'email')).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('invalid_email');
    if (!ROLES.includes(body.role)) fail('invalid_role');
    const password = String(need(body.password, 'password'));
    if (password.length < 10) fail('password_too_short');
    const exists = await db.one('select 1 from staff_users where email = $1', [email]);
    if (exists) fail('email_taken');
    const u = await db.one(
      'insert into staff_users (email, name, role, branch_id, password_hash) values ($1,$2,$3,$4,$5) returning id, email, name, role',
      [email, String(need(body.name, 'name')).trim(), body.role, body.branchId || null, await hashPassword(password)],
    );
    await audit(me, 'create', 'staff', u!.id, { email, role: body.role });
    return u;
  }

  @Patch('staff/:id')
  @UseGuards(OwnerOnly)
  async updateStaff(@CurrentStaff() me: StaffUser, @Param('id') id: string, @Body() body: { name?: string; role?: Role; active?: boolean; password?: string; branchId?: string | null }) {
    const u = await db.one('select * from staff_users where id = $1', [id]);
    if (!u) throw new NotFoundException({ code: 'not_found' });
    if (id === me.id && (body.active === false || (body.role && body.role !== 'owner'))) fail('cannot_demote_self');
    if (body.role && !ROLES.includes(body.role)) fail('invalid_role');
    if (body.password !== undefined && String(body.password).length < 10) fail('password_too_short');
    await db.pool.query(
      `update staff_users set name = coalesce($2, name), role = coalesce($3, role), active = coalesce($4, active),
              branch_id = case when $5::boolean then $6::uuid else branch_id end,
              password_hash = coalesce($7, password_hash) where id = $1`,
      [id, body.name ?? null, body.role ?? null, body.active ?? null, body.branchId !== undefined, body.branchId || null, body.password ? await hashPassword(body.password) : null],
    );
    if (body.active === false || body.password) await db.pool.query('delete from staff_sessions where staff_id = $1', [id]);
    if (body.password) await db.pool.query('update staff_users set failed_logins = 0, locked_until = null where id = $1', [id]);
    await audit(me, 'update', 'staff', id, { ...body, password: body.password ? '(changed)' : undefined });
    return { ok: true };
  }

  @Get('audit')
  @UseGuards(Managers)
  auditLog(@Query('entity') entity?: string, @Query('limit') limit?: string) {
    return db.many(
      `select id, staff_name, action, entity, entity_id, data, at from audit_log where ($1::text is null or entity = $1) order by at desc limit $2`,
      [entity ?? null, Math.min(Number(limit ?? 200), 500)],
    );
  }
}
