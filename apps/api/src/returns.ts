import { config } from './config.js';

/**
 * Where the customer goes after paying. Only the app's own addresses are
 * accepted: the web app's exact origin (or another allowed origin), or the
 * native app's own link scheme. Anything else falls back to the web app.
 */
export function allowedReturn(url: string | undefined) {
  if (!url) return config.appUrl;
  try {
    const u = new URL(url);
    if (u.protocol === `${config.appScheme}:`) return `${config.appScheme}:/`;
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      const origins = new Set([new URL(config.appUrl).origin, ...config.corsOrigins.filter((o) => o !== '*')]);
      const anyOrigin = !config.production && config.corsOrigins.includes('*');
      if (origins.has(u.origin) || anyOrigin) return url.replace(/\/$/, '');
    }
  } catch {}
  return config.appUrl;
}

