import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { HEALTH_CHECKS } from './application/health-check.port';
import type { HealthCheck } from './application/health-check.port';
import { UNIT_OF_WORK } from './application/unit-of-work.port';
import { DomainEventDispatcher } from './infrastructure/events/domain-event.dispatcher';
import { LOGGER_PORT, NestLoggerAdapter } from './infrastructure/logging/nest-logger.adapter';
import { PrismaHealthCheck } from './infrastructure/persistence/prisma.health-check';
import { PrismaUnitOfWork } from './infrastructure/persistence/prisma-unit-of-work';
import { PrismaService } from './infrastructure/persistence/prisma.service';
import { RedisHealthCheck } from './infrastructure/persistence/redis.health-check';
import { RedisService } from './infrastructure/persistence/redis.service';
import { DomainErrorFilter } from './presentation/filters/domain-error.filter';
import { HealthController } from './presentation/health/health.controller';
import { CorrelationMiddleware } from './presentation/middleware/correlation.middleware';

/**
 * Wires the Phase 2 foundation: config (global), persistence, the unit
 * of work with after-commit event dispatch, logging, health probes, the
 * problem+json filter, the global validation pipe, and correlation IDs.
 */
@Module({
  controllers: [HealthController],
  providers: [
    PrismaService,
    PrismaUnitOfWork,
    { provide: UNIT_OF_WORK, useExisting: PrismaUnitOfWork },
    DomainEventDispatcher,
    RedisService,
    { provide: LOGGER_PORT, useClass: NestLoggerAdapter },
    PrismaHealthCheck,
    RedisHealthCheck,
    {
      // NestJS has no Angular-style `multi` providers: the array of checks
      // is composed explicitly so the controller depends only on the port.
      provide: HEALTH_CHECKS,
      useFactory: (database: PrismaHealthCheck, redis: RedisHealthCheck): HealthCheck[] => [
        database,
        redis,
      ],
      inject: [PrismaHealthCheck, RedisHealthCheck],
    },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
    {
      provide: APP_PIPE,
      useFactory: (): ValidationPipe =>
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    },
    CorrelationMiddleware,
  ],
  exports: [PrismaService, PrismaUnitOfWork, UNIT_OF_WORK, DomainEventDispatcher, RedisService],
})
export class SharedModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
