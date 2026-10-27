import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { APP_CONFIG } from '../shared/config/app-config';
import type { AppConfig } from '../shared/config/app-config';
import { loadAppConfig } from '../shared/config/app-config';
import { PrismaService } from '../shared/infrastructure/persistence/prisma.service';
import { RedisService } from '../shared/infrastructure/persistence/redis.service';
import { AppModule } from '../app.module';

export interface IntegrationContext {
  app: INestApplication;
  prisma: PrismaService;
  redis: RedisService;
  config: AppConfig;
}

/**
 * Boot the real application against the test database with a per-run
 * Redis prefix (`exp:test:<uuid>:`), so parallel runs and other projects
 * sharing the local Redis never collide. Call `teardown` in
 * `afterAll`: it wipes only keys under the per-run prefix — never
 * `FLUSHDB`.
 */
export async function setupIntegration(): Promise<IntegrationContext> {
  const base = loadAppConfig();
  const testDatabaseUrl = base.DATABASE_URL_TEST;
  if (!testDatabaseUrl) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Copy .env.test.example to .env.test and fill it in.',
    );
  }
  const config: AppConfig = {
    ...base,
    DATABASE_URL: testDatabaseUrl,
    REDIS_KEY_PREFIX: `exp:test:${randomUUID()}:`,
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();

  const app = moduleRef.createNestApplication();
  // Mirror main.ts: every REST endpoint lives under /api/v1 (spec §15).
  app.setGlobalPrefix('api/v1');
  await app.init();

  const prisma = app.get(PrismaService);
  const redis = app.get(RedisService);
  return { app, prisma, redis, config };
}

export async function teardownIntegration(ctx: IntegrationContext): Promise<void> {
  try {
    await ctx.redis.deleteByPrefix('');
  } finally {
    await ctx.app.close();
  }
}
