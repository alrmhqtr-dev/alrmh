import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { db } from './db.js';
import { sha256 } from './lib.js';

export type Customer = { id: string; phone: string; name: string | null; email: string | null; language: string };

@Injectable()
export class CustomerGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new UnauthorizedException({ code: 'unauthorized' });
    const customer = await db.one<Customer>(
      `select c.id, c.phone, c.name, c.email, c.language from sessions s join customers c on c.id = s.customer_id
        where s.token_hash = $1 and s.expires_at > now() and c.deleted_at is null`,
      [sha256(token)],
    );
    if (!customer) throw new UnauthorizedException({ code: 'unauthorized' });
    req.customer = customer;
    return true;
  }
}

export const Me = createParamDecorator((_: unknown, ctx: ExecutionContext): Customer => ctx.switchToHttp().getRequest().customer);
