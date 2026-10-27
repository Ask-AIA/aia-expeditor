import type { Prisma } from '@prisma/client';
import { DomainEvent } from '../../kernel/domain-event';
import { DomainEventDispatcher } from '../events/domain-event.dispatcher';
import { PrismaUnitOfWork } from './prisma-unit-of-work';
import type { PrismaService } from './prisma.service';

class TestHappened extends DomainEvent {
  readonly name = 'test.happened';

  constructor(aggregateId: string) {
    super({ id: `evt-${aggregateId}`, occurredAt: new Date(), aggregateId });
  }
}

interface StubRunner {
  prisma: PrismaService;
  txClient: Prisma.TransactionClient;
  state: { transactions: number };
}

function stubPrisma(behavior: 'commit' | 'rollback'): StubRunner {
  const txClient = {} as Prisma.TransactionClient;
  const state = { transactions: 0 };
  const prisma = {
    $transaction: async <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
      state.transactions += 1;
      const result = await fn(txClient);
      if (behavior === 'rollback') {
        throw new Error('transaction failed');
      }
      return result;
    },
  } as unknown as PrismaService;
  return { prisma, txClient, state };
}

function setup(behavior: 'commit' | 'rollback'): {
  uow: PrismaUnitOfWork;
  received: DomainEvent[];
  runner: StubRunner;
} {
  const runner = stubPrisma(behavior);
  const dispatcher = new DomainEventDispatcher();
  const received: DomainEvent[] = [];
  dispatcher.register('test.happened', (event) => {
    received.push(event);
  });
  return { uow: new PrismaUnitOfWork(runner.prisma, dispatcher), received, runner };
}

describe('PrismaUnitOfWork', () => {
  it('dispatches collected events only after commit', async () => {
    const { uow, received, runner } = setup('commit');

    const result = await uow.run(() => {
      expect(uow.currentClient()).toBe(runner.txClient);
      uow.addEvents([new TestHappened('agg-1')]);
      // Not dispatched while the transaction is still open.
      expect(received).toHaveLength(0);
      return Promise.resolve('done');
    });

    expect(result).toBe('done');
    expect(received.map((event) => event.aggregateId)).toEqual(['agg-1']);
  });

  it('drops events when the transaction rolls back', async () => {
    const { uow, received } = setup('rollback');

    await expect(
      uow.run(() => {
        uow.addEvents([new TestHappened('agg-1')]);
        return Promise.reject(new Error('business failure'));
      }),
    ).rejects.toThrow('business failure');
    expect(received).toHaveLength(0);
  });

  it('nested run() joins the outer transaction', async () => {
    const { uow, received, runner } = setup('commit');
    let innerTx: unknown;

    await uow.run(() => {
      const inner = uow.run(() => {
        innerTx = uow.currentClient();
        uow.addEvents([new TestHappened('inner')]);
        return Promise.resolve();
      });
      uow.addEvents([new TestHappened('outer')]);
      return inner;
    });

    expect(innerTx).toBe(runner.txClient);
    expect(runner.state.transactions).toBe(1);
    expect(received.map((event) => event.aggregateId)).toEqual(['inner', 'outer']);
  });

  it('uses the root client outside a transaction', () => {
    const { uow, runner } = setup('commit');
    expect(uow.currentClient()).toBe(runner.prisma);
  });
});
