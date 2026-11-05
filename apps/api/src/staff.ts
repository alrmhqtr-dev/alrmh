import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException, createParamDecorator, mixin, type Type } from '@nestjs/common';
import { db, type Queryable } from './db.js';
import { sha256 } from './lib.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const ROLES = ['owner', 'manager', 'tailor', 'support'] as const;
export type Role = (typeof ROLES)[number];
export type StaffUser = { id: string; email: string; name: string; role: Role; branch_id: string | null };

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt:${salt.toString('base64')}:${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string) {
  const [alg, saltB64, keyB64] = stored.split(':');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const key = Buffer.from(keyB64, 'base64');
  const test = await scrypt(pw, Buffer.from(saltB64, 'base64'), key.length);
  return timingSafeEqual(key, test);
}

export function staffGuard(...roles: Role[]): Type<CanActivate> {
  class Guard implements CanActivate {
    async canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      const header: string = req.headers['authorization'] ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new UnauthorizedException({ code: 'unauthorized' });
      const staff = await db.one<StaffUser>(
        `select u.id, u.email, u.name, u.role, u.branch_id from staff_sessions s join staff_users u on u.id = s.staff_id
          where s.token_hash = $1 and s.expires_at > now() and u.active`,
        [sha256(token)],
      );
      if (!staff) throw new UnauthorizedException({ code: 'unauthorized' });
      if (roles.length && !roles.includes(staff.role)) throw new ForbiddenException({ code: 'forbidden' });
      req.staff = staff;
      return true;
    }
  }
  return mixin(Guard);
}

export const AnyStaff = staffGuard();
export const Managers = staffGuard('owner', 'manager');
export const Workshop = staffGuard('owner', 'manager', 'tailor');
export const OwnerOnly = staffGuard('owner');

export const CurrentStaff = createParamDecorator((_: unknown, ctx: ExecutionContext): StaffUser => ctx.switchToHttp().getRequest().staff);

export async function audit(staff: StaffUser, action: string, entity: string, entityId: string | null, data: unknown = null, client: Queryable = db.pool) {
  await client.query('insert into audit_log (staff_id, staff_name, action, entity, entity_id, data) values ($1,$2,$3,$4,$5,$6)', [
    staff.id,
    staff.name,
    action,
    entity,
    entityId,
    data === null ? null : JSON.stringify(data),
  ]);
}

export async function ensureOwner() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const exists = await db.one('select 1 from staff_users limit 1');
  if (exists) return;
  await db.pool.query(`insert into staff_users (email, name, role, password_hash) values ($1, 'Owner', 'owner', $2)`, [email, await hashPassword(password)]);
  console.log(`created owner account ${email}`);
}
