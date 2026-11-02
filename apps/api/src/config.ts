const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://alrmh:alrmh@localhost:5432/alrmh',
  databaseSsl: env.DATABASE_SSL === 'true',
  appUrl: (env.APP_URL ?? 'http://localhost:8081').replace(/\/$/, ''),
  apiUrl: (env.API_URL ?? env.RENDER_EXTERNAL_URL ?? `http://localhost:${env.PORT ?? 4000}`).replace(/\/$/, ''),
  corsOrigins: (env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  otpMode: (env.OTP_MODE ?? 'preview') as 'preview' | 'sms',
  otpPreviewCode: env.OTP_PREVIEW_CODE ?? '123456',
  paymentMode: (env.PAYMENT_MODE ?? 'mock') as 'mock' | 'sadad',
  adminToken: env.ADMIN_TOKEN ?? 'dev-admin-token',
  sessionDays: Number(env.SESSION_DAYS ?? 90),
};

export const QATAR_OFFSET_MINUTES = 180;
