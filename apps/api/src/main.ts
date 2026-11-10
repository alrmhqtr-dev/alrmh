import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { expirePoints } from './lib.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { AuthController } from './modules/auth.controller.js';
import { CatalogueController } from './modules/catalogue.controller.js';
import { FamilyController } from './modules/family.controller.js';
import { BookingController } from './modules/booking.controller.js';
import { BasketController } from './modules/basket.controller.js';
import { OrdersController } from './modules/orders.controller.js';
import { NotificationsController, RewardsController } from './modules/rewards.controller.js';
import { AdminCoreController } from './modules/admin-core.controller.js';
import { AdminOpsController } from './modules/admin-ops.controller.js';
import { AdminSetupController } from './modules/admin-setup.controller.js';
import { MEDIA_LIMIT, MEDIA_TYPES, MediaController } from './modules/media.controller.js';
import { ensureOwner } from './staff.js';
import { ErrorFilter } from './errors.js';

@Controller()
class HealthController {
  @Get('health/live')
  live() {
    return { ok: true };
  }

  @Get('health')
  async health() {
    await db.pool.query('select 1');
    return { ok: true };
  }
}

@Module({
  controllers: [
    HealthController,
    AuthController,
    CatalogueController,
    FamilyController,
    BookingController,
    BasketController,
    OrdersController,
    RewardsController,
    NotificationsController,
    AdminCoreController,
    AdminOpsController,
    AdminSetupController,
    MediaController,
  ],
})
class AppModule {}

async function bootstrap() {
  if (process.env.MIGRATE_ON_START !== 'false') await migrate();
  if (process.env.SEED_ON_START === 'true') await seed({ demo: process.env.SEED_DEMO === 'true' });
  await ensureOwner();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (config.production) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });
  app.useGlobalFilters(new ErrorFilter());
  // Photo uploads arrive as the image itself.
  app.useBodyParser('raw', { type: MEDIA_TYPES, limit: MEDIA_LIMIT });
  app.enableCors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  console.log(`AlRmh API on :${config.port} (login: ${config.otpMode}, payment: ${config.paymentMode})`);
  if (config.production && config.otpMode === 'preview') console.warn('OTP_MODE=preview: every number signs in with the preview code. Not for real customers.');
  if (config.production && config.paymentMode === 'mock') console.warn('PAYMENT_MODE=mock: orders are marked paid on the test page. Not for real customers.');
  setInterval(() => expirePoints(null).catch((e) => console.error('expiry job', e)), 60 * 60_000);
}

bootstrap();
