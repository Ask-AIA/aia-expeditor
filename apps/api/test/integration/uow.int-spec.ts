import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import { AggregateRoot } from '../../src/shared/kernel/aggregate-root';
import { DomainEvent } from '../../src/shared/kernel/domain-event';
import { ConfigModule } from '../../src/shared/config/config.module';
import { DomainEventDispatcher } from '../../src/shared/infrastructure/events/domain-event.dispatcher';
import { PrismaUnitOfWork } from '../../src/shared/infrastructure/persistence/prisma-unit-of-work';
import { PrismaService } from '../../src/shared/infrastructure/persistence/prisma.service';
import { useIsolatedTestEnv } from './test-env';

/**
 * Integration coverage for the Prisma Unit of Work against the real test
 * database (migrated by `integration/global-setup.js`):
 * commit really persists, rollback really reverts, and aggregate events
 * reach handlers only after the commit.
 *
 * Rows use direct SQL (`$queryRaw`) instead of model delegates on purpose:
 * `Restaurant` is only a stand-in aggregate row until the business modules
 * (Phase 3+) bring their own repositories.
 */

class RowInserted extends DomainEvent {
  readonly name = 'test.row-inserted';

  constructor(aggregateId: string) {
    super({ id: `evt-${aggregateId}`, occurredAt: new Date(), aggregateId });
  }
}

class TestOrder extends AggregateRoot<string> {
  // Explicit ctor only widens the intentionally protected base constructor.
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(id: string) {
    super(id);
  }

  place(): void {
    this.record(new RowInserted(this.id));
  }
}

const rowId = (tag: string): string => `itest-${tag}-${randomUUID()}`;

describe('PrismaUnitOfWork (integration)', () => {
  let moduleRef: TestingModule | undefined;
  let uow: PrismaUnitOfWork | undefined;
  let prisma: PrismaService | undefined;
  let received: DomainEvent[] = [];

  async function insertRestaurant(id: string): Promise<void> {
    if (uow === undefined) {
      throw new Error('test module not initialized');
    }
    const now = new Date();
    await uow.currentClient().$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Restaurant" ("id", "name", "timeZone", "createdAt", "updatedAt")
      VALUES (${id}, ${`Test ${id}`}, ${'America/New_York'}, ${now}, ${now})
      RETURNING "id"`;
  }

  async function countRestaurants(ids: string[]): Promise<number> {
    if (prisma === undefined) {
      throw new Error('test module not initialized');
    }
    if (ids.length === 0) {
      return 0;
    }
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS "count" FROM "Restaurant" WHERE "id" = ANY(${ids})`;
    return rows[0]?.count ?? 0;
  }

  beforeAll(async () => {
    useIsolatedTestEnv();
    received = [];
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule],
      providers: [PrismaService, PrismaUnitOfWork, DomainEventDispatcher],
    }).compile();
    await moduleRef.init();
    uow = moduleRef.get(PrismaUnitOfWork);
    prisma = moduleRef.get(PrismaService);
    moduleRef.get(DomainEventDispatcher).register('test.row-inserted', (event) => {
      received.push(event);
    });
  }, 30000);

  beforeEach(() => {
    received = [];
  });

  afterEach(async () => {
    if (prisma !== undefined) {
      await prisma.$queryRaw<unknown[]>`
        DELETE FROM "Restaurant" WHERE "id" LIKE 'itest-%'`;
    }
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('commits the transaction and dispatches events only after commit', async () => {
    if (uow === undefined) {
      throw new Error('test module not initialized');
    }
    const order = new TestOrder(rowId('commit'));
    order.place();

    await uow.run(async () => {
      await insertRestaurant(order.id);
      uow?.addEvents(order.pullEvents());
      // Still inside the transaction: nothing dispatched yet.
      expect(received).toHaveLength(0);
    });

    expect(await countRestaurants([order.id])).toBe(1);
    expect(received.map((event) => event.aggregateId)).toEqual([order.id]);
  });

  it('rolls the transaction back and drops events on failure', async () => {
    if (uow === undefined) {
      throw new Error('test module not initialized');
    }
    const order = new TestOrder(rowId('rollback'));
    order.place();

    await expect(
      uow.run(async () => {
        await insertRestaurant(order.id);
        uow?.addEvents(order.pullEvents());
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');

    expect(await countRestaurants([order.id])).toBe(0);
    expect(received).toHaveLength(0);
  });

  it('joins nested runs into the outer transaction', async () => {
    if (uow === undefined) {
      throw new Error('test module not initialized');
    }
    const outer = new TestOrder(rowId('outer'));
    const inner = new TestOrder(rowId('inner'));
    outer.place();
    inner.place();

    await uow.run(async () => {
      await insertRestaurant(outer.id);
      uow?.addEvents(outer.pullEvents());
      await uow?.run(async () => {
        await insertRestaurant(inner.id);
        uow?.addEvents(inner.pullEvents());
      });
    });

    expect(await countRestaurants([outer.id, inner.id])).toBe(2);
    expect(received.map((event) => event.aggregateId)).toEqual([outer.id, inner.id]);
  });

  it('rolls back the whole transaction when a nested run fails', async () => {
    if (uow === undefined) {
      throw new Error('test module not initialized');
    }
    const outer = new TestOrder(rowId('outer-fail'));
    const inner = new TestOrder(rowId('inner-fail'));
    outer.place();
    inner.place();

    await expect(
      uow.run(async () => {
        await insertRestaurant(outer.id);
        uow?.addEvents(outer.pullEvents());
        await uow?.run(async () => {
          await insertRestaurant(inner.id);
          uow?.addEvents(inner.pullEvents());
          throw new Error('inner failure');
        });
      }),
    ).rejects.toThrow('inner failure');

    expect(await countRestaurants([outer.id, inner.id])).toBe(0);
    expect(received).toHaveLength(0);
  });
});
