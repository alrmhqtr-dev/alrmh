import { CanActivate, ExecutionContext, HttpException, HttpStatus, mixin, type Type } from '@nestjs/common';
import { config } from './config.js';

type Bucket = { n: number; reset: number };
const buckets = new Map<string, Bucket>();

setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (b.reset <= now) buckets.delete(key);
}, 60_000).unref();

/**
 * Limits how often one address can call a route: `max` requests per window.
 * Counts are kept in this process, which is enough while the API runs as one
 * replica (railway.json). Move them to the database or Redis before scaling out.
 */
export function rateLimit(name: string, max: number, windowSeconds: number): Type<CanActivate> {
  class Guard implements CanActivate {
    canActivate(ctx: ExecutionContext) {
      if (!config.rateLimits) return true;
      const req = ctx.switchToHttp().getRequest();
      const key = `${name}:${req.ip ?? 'unknown'}`;
      const now = Date.now();
      let b = buckets.get(key);
      if (!b || b.reset <= now) {
        b = { n: 0, reset: now + windowSeconds * 1000 };
        buckets.set(key, b);
      }
      b.n += 1;
      if (b.n > max) throw new HttpException({ code: 'too_many_requests', retryIn: Math.ceil((b.reset - now) / 1000) }, HttpStatus.TOO_MANY_REQUESTS);
      return true;
    }
  }
  return mixin(Guard);
}
