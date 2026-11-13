import * as webpush from 'web-push';
import { config } from './config.js';
import { db } from './db.js';

/*
 * Push notifications for the installed web app (Web Push with VAPID keys).
 *
 * Nothing calls this from inside a transaction. `notify()` only saves the
 * notification; this loop picks up saved ones and sends them, so a push is
 * never sent for something that was rolled back.
 */

export const pushEnabled = Boolean(config.vapidPublicKey && config.vapidPrivateKey);
if (pushEnabled) webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey!, config.vapidPrivateKey!);

/** Push services the API will send to. Anything else would let a customer make the server call an address of their choosing. */
export function allowedEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && config.pushHosts.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
  } catch {
    return false;
  }
}

type Pending = { id: string; customer_id: string; language: string; title_en: string; title_ar: string; body_en: string; body_ar: string; link: string | null };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string };

let running = false;

export async function sendPendingPushes() {
  if (!pushEnabled || running) return;
  running = true;
  try {
    // Claim a batch. Notifications older than an hour are not worth a buzz any more.
    const batch = await db.many<Pending>(
      `update notifications n set pushed_at = now() from customers c
        where c.id = n.customer_id and n.id in (
          select id from notifications where pushed_at is null and created_at > now() - interval '1 hour'
           order by created_at limit 50 for update skip locked)
        returning n.id, n.customer_id, c.language, n.title_en, n.title_ar, n.body_en, n.body_ar, n.link`,
    );
    if (!batch.length) return;
    const subs = await db.many<Sub & { customer_id: string }>('select id, customer_id, endpoint, p256dh, auth from push_subscriptions where customer_id = any($1::uuid[])', [
      [...new Set(batch.map((n) => n.customer_id))],
    ]);
    await Promise.all(
      batch.flatMap((n) => {
        const ar = n.language === 'ar';
        const payload = JSON.stringify({ title: ar ? n.title_ar : n.title_en, body: ar ? n.body_ar : n.body_en, link: n.link ?? '/', tag: n.id, lang: ar ? 'ar' : 'en', dir: ar ? 'rtl' : 'ltr' });
        return subs.filter((s) => s.customer_id === n.customer_id).map((s) => deliver(s, payload));
      }),
    );
  } catch (e) {
    console.error('push sender', e);
  } finally {
    running = false;
  }
}

async function deliver(s: Sub, payload: string) {
  try {
    await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high', timeout: 10_000 });
    await db.pool.query('update push_subscriptions set failures = 0, last_sent_at = now() where id = $1', [s.id]);
  } catch (e: any) {
    // 404 and 410 mean the phone unsubscribed or the app was removed. Other errors are retried on later notifications, five times at most.
    const gone = e?.statusCode === 404 || e?.statusCode === 410;
    await db.pool.query(`delete from push_subscriptions where id = $1 and ($2 or failures >= 4)`, [s.id, gone]);
    await db.pool.query('update push_subscriptions set failures = failures + 1 where id = $1', [s.id]);
    if (!gone) console.warn('push failed', e?.statusCode ?? e?.message);
  }
}
