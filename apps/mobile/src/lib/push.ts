import { Platform } from 'react-native';
import { api } from '@/api/client';

/*
 * Push notifications for the web app installed on a phone.
 *
 * Android (Chrome) supports them in the browser and when installed. iPhone
 * supports them only once AlRmh is added to the Home Screen and opened from
 * there (iOS 16.4 and later). Native iOS and Android builds will use their
 * own push service when they exist.
 */

export type PushState = 'on' | 'off' | 'install' | 'denied' | 'unsupported';

const web = Platform.OS === 'web';
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const hasPushApi = () => web && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration() {
  if (!hasPushApi()) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushState(): Promise<PushState> {
  if (!web) return 'unsupported';
  if (!hasPushApi()) return isIOS() && !installed() ? 'install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await registration();
  if (!reg) return 'unsupported';
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function keyBytes(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Asks the customer, subscribes this phone and tells the API. Returns the new state. */
export async function enablePush(key: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
  await api('/push/subscriptions', { body: sub.toJSON() });
  return 'on';
}

/** Stops notifications on this phone. */
export async function disablePush(): Promise<PushState> {
  const sub = await (await registration())?.pushManager.getSubscription();
  if (sub) {
    await api('/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}

/** After signing in: a phone that already allows notifications is linked to this account. */
export async function relinkPush() {
  try {
    if ((await pushState()) !== 'on') return;
    const sub = await (await registration())?.pushManager.getSubscription();
    if (sub) await api('/push/subscriptions', { body: sub.toJSON() });
  } catch {}
}

/** Before signing out: this phone stops receiving the account's notifications. */
export async function unlinkPush() {
  try {
    const sub = await (await registration())?.pushManager.getSubscription();
    if (sub) await api('/push/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } });
  } catch {}
}
