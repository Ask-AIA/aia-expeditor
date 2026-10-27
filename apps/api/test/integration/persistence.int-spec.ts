import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { UNIT_OF_WORK } from '../../src/shared/application/unit-of-work.port';
import type { UnitOfWork } from '../../src/shared/application/unit-of-work.port';
import { DomainEventDispatcher } from '../../src/shared/infrastructure/events/domain-event.dispatcher';
import type { PrismaUnitOfWork } from '../../src/shared/infrastructure/persistence/prisma-unit-of-work';
import { PrismaService } from '../../src/shared/infrastructure/persistence/prisma.service';
import { RedisService } from '../../src/shared/infrastructure/persistence/redis.service';
import { DomainEvent } from '../../src/shared/kernel/domain-event';
import { useIsolatedTestEnv } from './test-env';

/**
 * Persistence integration coverage against the real test database
 * (migrated by `integration/global-setup.js`): the `Restaurant` table is
 * writable, Unit of Work commit/rollback holds through the Prisma model
 * delegates, queued events dispatch after commit only, and Redis writes
 * stay under the per-run prefix.
 */

class RestaurantCreated extends DomainEvent {
  readonly name = 'restaurant.created';

  constructor(aggregateId: string) {
    super({ id: `evt-${aggregateId}`, occurredAt: new Date(), aggregateId });
  }
}

describe('persistence (integration)', () => {
  let moduleRef: TestingModule | undefined;
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  let redis: RedisService | undefined;
  let uow: UnitOfWork | undefined;
  let redisKeyPrefix = '';

  beforeAll(async () => {
    ({ redisKeyPrefix } = useIsolatedTestEnv());
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Mirror main.ts: every REST endpoint lives under /api/v1 (spec §15).
    app.setGlobalPrefix('api/v1');
    await app.init();
    const prismaService: PrismaService = moduleRef.get(PrismaService);
    const redisService: RedisService = moduleRef.get(RedisService);
    prisma = prismaService;
    redis = redisService;
    uow = moduleRef.get<UnitOfWork>(UNIT_OF_WORK);
    expect(redisService.prefix).toBe(redisKeyPrefix);
  }, 30000);

  afterAll(async () => {
    // Delete only keys under this run's prefix — never anything else on
    // the shared Redis.
    await redis?.deleteByPrefix('');
    await app?.close();
  });

  afterEach(async () => {
    await prisma?.restaurant.deleteMany();
  });

  it('migrations applied: the Restaurant table exists and is writable', async () => {
    if (prisma === undefined) {
      throw new Error('test app not initialized');
    }
    const created = await prisma.restaurant.create({
      data: { name: 'Smoke Kitchen', timeZone: 'America/New_York' },
    });
    expect(created.id).toBeDefined();
    await prisma.restaurant.delete({ where: { id: created.id } });
  });

  it('UoW commit really persists', async () => {
    if (uow === undefined || prisma === undefined) {
      throw new Error('test app not initialized');
    }
    const unitOfWork: UnitOfWork = uow;
    await unitOfWork.run(async () => {
      const client = (unitOfWork as PrismaUnitOfWork).currentClient();
      await client.restaurant.create({
        data: { name: 'Committed Kitchen', timeZone: 'America/New_York' },
      });
    });

    const found = await prisma.restaurant.findFirst({
      where: { name: 'Committed Kitchen' },
    });
    expect(found).not.toBeNull();
  });

  it('UoW rollback really reverts', async () => {
    if (uow === undefined || prisma === undefined) {
      throw new Error('test app not initialized');
    }
    const unitOfWork: UnitOfWork = uow;
    await expect(
      unitOfWork.run(async () => {
        const client = (unitOfWork as PrismaUnitOfWork).currentClient();
        await client.restaurant.create({
          data: { name: 'Rolled Back Kitchen', timeZone: 'America/New_York' },
        });
        throw new Error('packer cancelled');
      }),
    ).rejects.toThrow('packer cancelled');

    const found = await prisma.restaurant.findFirst({
      where: { name: 'Rolled Back Kitchen' },
    });
    expect(found).toBeNull();
  });

  it('events dispatch after commit only', async () => {
    if (uow === undefined || app === undefined) {
      throw new Error('test app not initialized');
    }
    const unitOfWork: UnitOfWork = uow;
    const dispatcher = app.get(DomainEventDispatcher);
    const received: DomainEvent[] = [];
    dispatcher.register('restaurant.created', (event) => {
      received.push(event);
    });

    await unitOfWork.run(() => {
      unitOfWork.addEvents([new RestaurantCreated('agg-commit')]);
      return Promise.resolve();
    });
    expect(received.map((event) => event.aggregateId)).toEqual(['agg-commit']);

    received.length = 0;
    await expect(
      unitOfWork.run(() => {
        unitOfWork.addEvents([new RestaurantCreated('agg-rollback')]);
        return Promise.reject(new Error('packer cancelled'));
      }),
    ).rejects.toThrow('packer cancelled');
    expect(received).toHaveLength(0);
  });

  it('Redis writes stay under the per-run prefix', async () => {
    if (redis === undefined) {
      throw new Error('test app not initialized');
    }
    await redis.set('probe', '1', 60);
    expect(await redis.get('probe')).toBe('1');
    expect(redis.namespaced('probe')).toBe(`${redisKeyPrefix}probe`);
  });
});
