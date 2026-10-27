import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';
import { UNIT_OF_WORK } from '../../application/unit-of-work.port';
import type { UnitOfWork } from '../../application/unit-of-work.port';
import type { DomainEvent } from '../../kernel/domain-event';
import { DomainEventDispatcher } from '../events/domain-event.dispatcher';
import { PrismaService } from './prisma.service';

interface TransactionScope {
  readonly client: Prisma.TransactionClient;
  readonly events: DomainEvent[];
}

/**
 * `UnitOfWork` backed by Prisma interactive transactions.
 *
 * `run` opens one transaction per outermost call; nested `run` calls join
 * the ambient scope. Repositories resolve the active client through
 * `currentClient()`, so they transparently use the transaction when one
 * is open and the root client otherwise. Events registered with
 * `addEvents` are dispatched only after the outermost transaction
 * commits; a rollback drops them.
 */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  private readonly scopes = new AsyncLocalStorage<TransactionScope>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: DomainEventDispatcher,
  ) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.scopes.getStore() !== undefined) {
      return work();
    }
    const collected: DomainEvent[] = [];
    return this.prisma
      .$transaction(async (tx) => {
        const live: TransactionScope = { client: tx, events: collected };
        return this.scopes.run(live, work);
      })
      .then(async (result) => {
        await this.dispatcher.dispatchAll(collected);
        return result;
      });
  }

  addEvents(events: readonly DomainEvent[]): void {
    const scope = this.scopes.getStore();
    if (scope === undefined) {
      // No transaction scope: dispatch directly instead of dropping.
      void this.dispatcher.dispatchAll(events);
      return;
    }
    scope.events.push(...events);
  }

  /**
   * The client repositories must use: the active transaction client
   * inside `run`, the root `PrismaService` otherwise.
   */
  currentClient(): Prisma.TransactionClient | PrismaService {
    return this.scopes.getStore()?.client ?? this.prisma;
  }
}

export { UNIT_OF_WORK };
