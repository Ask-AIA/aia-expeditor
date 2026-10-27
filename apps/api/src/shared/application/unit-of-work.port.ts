import type { DomainEvent } from '../kernel/domain-event';

/** NestJS DI token for the `UnitOfWork` port. */
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

/**
 * Unit of Work port (application layer).
 *
 * Use cases run their persistence inside `run`, which executes the work
 * in a single transaction. Events pulled from aggregates are registered
 * with `addEvents`: they are dispatched only after the transaction
 * commits, and dropped when it rolls back.
 */
export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
  addEvents(events: readonly DomainEvent[]): void;
}
