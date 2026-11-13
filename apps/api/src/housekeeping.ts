import { db } from './db.js';
import { expirePoints } from './lib.js';
import { sendReminders } from './reminders.js';

/** How long a checkout stays payable. Matches how long a measurement time is held. */
export const CHECKOUT_MINUTES = 30;

/**
 * Regular tidying, every 10 minutes:
 * - unpaid checkouts close after 30 minutes, so a late payment cannot confirm a
 *   visit whose time has since gone to someone else;
 * - held times that never reached an order are released after a day;
 * - expired sign-in sessions and codes are removed;
 * - points past their date are expired;
 * - visit and points-expiry reminders are sent.
 */
export async function housekeeping() {
  await db.pool.query(
    `with closed as (
       update payments set status = 'cancelled', completed_at = now()
        where status = 'pending' and created_at < now() - ($1 || ' minutes')::interval returning order_id
     )
     update orders set stage = 'payment_failed' where id in (select order_id from closed) and stage = 'pending_payment'`,
    [String(CHECKOUT_MINUTES)],
  );
  await db.pool.query(
    `update appointments a set status = 'cancelled'
      where a.status = 'held' and a.order_id is null and a.created_at < now() - interval '1 day'
        and not exists (select 1 from basket_items b where b.appointment_id = a.id)`,
  );
  await db.pool.query('delete from sessions where expires_at < now()');
  await db.pool.query('delete from staff_sessions where expires_at < now()');
  await db.pool.query(`delete from otp_codes where expires_at < now() - interval '1 day'`);
  await expirePoints(null);
  await sendReminders();
}
