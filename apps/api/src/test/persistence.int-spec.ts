import { UNIT_OF_WORK } from '../shared/application/unit-of-work.port';
import type { UnitOfWork } from '../shared/application/unit-of-work.port';
import { DomainEventDispatcher } from '../shared/infrastructure/events/domain-event.dispatcher';
import type { PrismaUnitOfWork } from '../shared/infrastructure/persistence/prisma-unit-of-work';
import { DomainEvent } from '../shared/kernel/domain-event';
import type { IntegrationContext } from './integration-setup';
import { setupIntegration, teardownIntegration } from './integration-setup';

class RestaurantCreated extends DomainEvent {
  readonly name = 'restaurant.created';

  constructor(aggregateId: string) {
    super({ id: `evt-${aggregateId}`, occurredAt: new Date(), aggregateId });
  }
}

describe('persistence (integration)', () => {
  let ctx: IntegrationContext;
  let uow: UnitOfWork;

  beforeAll(async () => {
    ctx = await setupIntegration();
    uow = ctx.app.get<UnitOfWork>(UNIT_OF_WORK);
  });

  afterAll(async () => {
    await teardownIntegration(ctx);
  });

  afterEach(async () => {
    await ctx.prisma.restaurant.deleteMany();
  });

  it('migrations applied: the Restaurant table exists and is writable', async () => {
    const created = await ctx.prisma.restaurant.create({
      data: { name: 'Smoke Kitchen', timeZone: 'America/New_York' },
    });
    expect(created.id).toBeDefined();
    await ctx.prisma.restaurant.delete({ where: { id: created.id } });
  });

  it('UoW commit really persists', async () => {
    await uow.run(async () => {
      const client = (uow as PrismaUnitOfWork).currentClient();
      await client.restaurant.create({
        data: { name: 'Committed Kitchen', timeZone: 'America/New_York' },
      });
    });

    const found = await ctx.prisma.restaurant.findFirst({
      where: { name: 'Committed Kitchen' },
    });
    expect(found).not.toBeNull();
  });

  it('UoW rollback really reverts', async () => {
    await expect(
      uow.run(async () => {
        const client = (uow as PrismaUnitOfWork).currentClient();
        await client.restaurant.create({
          data: { name: 'Rolled Back Kitchen', timeZone: 'America/New_York' },
        });
        throw new Error('packer cancelled');
      }),
    ).rejects.toThrow('packer cancelled');

    const found = await ctx.prisma.restaurant.findFirst({
      where: { name: 'Rolled Back Kitchen' },
    });
    expect(found).toBeNull();
  });

  it('events dispatch after commit only', async () => {
    const dispatcher = ctx.app.get(DomainEventDispatcher);
    const received: DomainEvent[] = [];
    dispatcher.register('restaurant.created', (event) => {
      received.push(event);
    });

    await uow.run(() => {
      uow.addEvents([new RestaurantCreated('agg-commit')]);
      return Promise.resolve();
    });
    expect(received.map((event) => event.aggregateId)).toEqual(['agg-commit']);

    received.length = 0;
    await expect(
      uow.run(() => {
        uow.addEvents([new RestaurantCreated('agg-rollback')]);
        return Promise.reject(new Error('packer cancelled'));
      }),
    ).rejects.toThrow('packer cancelled');
    expect(received).toHaveLength(0);
  });

  it('Redis writes stay under the per-run prefix', async () => {
    await ctx.redis.set('probe', '1', 60);
    expect(await ctx.redis.get('probe')).toBe('1');
    expect(ctx.redis.namespaced('probe').startsWith(ctx.config.REDIS_KEY_PREFIX)).toBe(true);
  });
});
