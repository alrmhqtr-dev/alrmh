const env = process.env;
const production = env.NODE_ENV === 'production';
const appUrl = (env.APP_URL ?? 'http://localhost:8081').replace(/\/$/, '');

// Preview login and test payments must be asked for by name in production.
// Left unset there, the API falls back to the real modes, which refuse to work
// until a provider is connected, rather than silently accepting a fixed code.
const mode = <T extends string>(value: string | undefined, allowed: readonly T[], whenUnset: T): T => (allowed.includes(value as T) ? (value as T) : whenUnset);

export const config = {
  production,
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://alrmh:alrmh@localhost:5432/alrmh',
  databaseSsl: env.DATABASE_SSL === 'true',
  appUrl,
  appScheme: env.APP_SCHEME ?? 'alrmh',
  apiUrl: (env.API_URL ?? (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : undefined) ?? `http://localhost:${env.PORT ?? 4000}`).replace(/\/$/, ''),
  corsOrigins: (env.CORS_ORIGINS ?? (production ? appUrl : '*')).split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
  otpMode: mode(env.OTP_MODE, ['preview', 'sms'] as const, production ? 'sms' : 'preview'),
  otpPreviewCode: env.OTP_PREVIEW_CODE ?? '123456',
  paymentMode: mode(env.PAYMENT_MODE, ['mock', 'sadad'] as const, production ? 'sadad' : 'mock'),
  sessionDays: Number(env.SESSION_DAYS ?? 90),
  rateLimits: env.RATE_LIMITS !== 'off',
  // How many proxies sit in front of the API (Railway: one). Needed to see the caller's real address.
  trustProxy: Number(env.TRUST_PROXY ?? (production ? 1 : 0)),
  // Push notifications. Generate the pair once with `npx web-push generate-vapid-keys`; unset means push is off.
  vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
  vapidPrivateKey: env.VAPID_PRIVATE_KEY || null,
  vapidSubject: env.VAPID_SUBJECT ?? 'mailto:support@alrmh.qa',
  // Push services the API may send to. A leading dot covers subdomains.
  pushHosts: (env.PUSH_HOSTS ?? 'fcm.googleapis.com,.push.apple.com,updates.push.services.mozilla.com,.notify.windows.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
};

export const QATAR_OFFSET_MINUTES = 180;
