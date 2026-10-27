/**
 * Base class for domain events.
 *
 * Each event carries a unique id, the time it was recorded, the aggregate
 * that produced it, and a stable `name` handlers subscribe to.
 */
export abstract class DomainEvent {
  abstract readonly name: string;

  readonly id: string;
  readonly occurredAt: Date;
  readonly aggregateId: string;

  protected constructor(init: { id: string; occurredAt: Date; aggregateId: string }) {
    this.id = init.id;
    this.occurredAt = init.occurredAt;
    this.aggregateId = init.aggregateId;
  }
}
