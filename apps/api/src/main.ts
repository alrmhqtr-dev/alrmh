import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
import { AdminController } from './modules/admin.controller.js';

@Controller()
class HealthController {
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
    AdminController,
  ],
})
class AppModule {}

async function bootstrap() {
  if (process.env.MIGRATE_ON_START !== 'false') await migrate();
  if (process.env.SEED_ON_START === 'true') await seed({ demo: process.env.SEED_DEMO !== 'false' });
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.enableCors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  console.log(`AlRmh API on :${config.port}`);
  setInterval(() => expirePoints(null).catch((e) => console.error('expiry job', e)), 60 * 60_000);
}

bootstrap();
