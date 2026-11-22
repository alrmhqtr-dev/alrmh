import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException, createParamDecorator, mixin, type Type } from '@nestjs/common';
import { db, type Queryable } from './db.js';
import { sha256 } from './lib.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** Built-in roles. Owners can add more on the Permissions page. */
export const ROLES = ['owner', 'manager', 'tailor', 'support', 'cashier'] as const;
export type Role = string;
/**
 * What a role can do. Viewing needs only a sign-in; each permission unlocks changes.
 * '*' (owner) is everything.
 */
export const PERMISSIONS = [
  'workshop', // move orders through the workshop, measurements, orders at a visit, appointments, thobe photos
  'pos', // sell at the counter, drafts, quotations, own cash register, take balance payments
  'pos.discount', // change prices and give discounts at the counter
  'returns', // sales returns, cancellations and refunds
  'manage', // catalogue, fees and rules, branches, rewards, coupons, discounts, service types, company settings
  'products', // products, brands, units, warranties, variations, stock adjustments and transfers, labels, imports
  'purchases', // suppliers, purchases, purchase returns, supplier payments
  'contacts', // add and edit customers, customer groups, contact imports
  'expenses', // record expenses
  'reports', // reports and exports
  'audit', // activity log
  'staff', // users and roles
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export type StaffUser = { id: string; email: string; name: string; role: Role; branch_id: string | null; permissions: string[]; language: 'ar' | 'en'; role_en?: string; role_ar?: string };

export const hasPerm = (staff: Pick<StaffUser, 'permissions'>, ...perms: string[]) => !perms.length || staff.permissions.includes('*') || perms.some((p) => staff.permissions.includes(p));

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

/** Signed-in staff; with permissions given, the staff member needs at least one of them. */
export function staffGuard(...perms: Permission[]): Type<CanActivate> {
  class Guard implements CanActivate {
    async canActivate(ctx: ExecutionContext) {
      const req = ctx.switchToHttp().getRequest();
      const header: string = req.headers['authorization'] ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) throw new UnauthorizedException({ code: 'unauthorized' });
      const staff = await db.one<StaffUser>(
        `select u.id, u.email, u.name, u.role, u.branch_id, u.language, r.permissions, r.name_en as role_en, r.name_ar as role_ar
           from staff_sessions s join staff_users u on u.id = s.staff_id join roles r on r.id = u.role
          where s.token_hash = $1 and s.expires_at > now() and u.active`,
        [sha256(token)],
      );
      if (!staff) throw new UnauthorizedException({ code: 'unauthorized' });
      if (!hasPerm(staff, ...perms)) throw new ForbiddenException({ code: 'forbidden' });
      req.staff = staff;
      return true;
    }
  }
  return mixin(Guard);
}

export const AnyStaff = staffGuard();
export const Managers = staffGuard('manage');
export const Workshop = staffGuard('workshop');
export const Measurers = staffGuard('workshop', 'pos');
export const OwnerOnly = staffGuard('staff');
export const Sellers = staffGuard('pos');
export const ProductsGuard = staffGuard('products');
export const PurchasesGuard = staffGuard('purchases');
export const ContactsGuard = staffGuard('contacts');
export const ExpensesGuard = staffGuard('expenses');
export const ReportsGuard = staffGuard('reports');
export const ReturnsGuard = staffGuard('returns');
export const AuditGuard = staffGuard('audit');

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
  const name = process.env.ADMIN_NAME?.trim() || 'Owner';
  await db.pool.query(`insert into staff_users (email, name, role, password_hash) values ($1, $2, 'owner', $3)`, [email, name, await hashPassword(password)]);
  console.log(`created owner account ${email}`);
}
