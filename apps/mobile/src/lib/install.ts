import { Platform } from 'react-native';

/*
 * Installing the web app on a phone's Home Screen.
 *
 * Chrome and Edge (Android, and desktop) fire `beforeinstallprompt` once, early,
 * when the app can be installed; we keep it so the Install page can show a
 * one-tap button. iPhone has no such event: people use Share > Add to Home
 * Screen, so the page shows those steps instead.
 */

export type Device = 'ios' | 'android' | 'desktop';
export type InstallInfo = { device: Device; installed: boolean; canPrompt: boolean; inAppBrowser: boolean };

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const web = Platform.OS === 'web' && typeof window !== 'undefined';
let deferred: PromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (web) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    justInstalled = true;
    notify();
  });
}

export function onInstallChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function installInfo(): InstallInfo {
  if (!web) return { device: Platform.OS === 'ios' ? 'ios' : 'android', installed: true, canPrompt: false, inAppBrowser: false };
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const installed = justInstalled || window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  return {
    device: ios ? 'ios' : android ? 'android' : 'desktop',
    installed,
    canPrompt: !!deferred && !installed,
    // Instagram, Facebook, TikTok, Snapchat and similar open links in their own browser, which cannot install apps.
    inAppBrowser: /FBAN|FBAV|Instagram|Line\/|Snapchat|TikTok|musical_ly|BytedanceWebview|GSA\//i.test(ua),
  };
}

/** Shows the browser's own install dialog. Resolves to true when the person accepts. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === 'accepted') justInstalled = true;
  notify();
  return outcome === 'accepted';
}

export function appAddress() {
  return web ? window.location.host : 'app.alrmh.qa';
}
