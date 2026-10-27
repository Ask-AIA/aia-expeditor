import { Entity } from './entity';
import type { DomainEvent } from './domain-event';

/**
 * Aggregate root: an entity that records domain events.
 *
 * Events are collected during state changes and pulled exactly once by
 * the Unit of Work, which dispatches them only after the transaction
 * commits (dropped on rollback).
 */
export abstract class AggregateRoot<TId> extends Entity<TId> {
  private domainEvents: DomainEvent[] = [];

  protected constructor(id: TId) {
    super(id);
  }

  protected record(event: DomainEvent): void {
    this.domainEvents.push(event);
  }

  /** Read-only view of the currently recorded events. */
  get recordedEvents(): readonly DomainEvent[] {
    return this.domainEvents;
  }

  /**
   * Return all recorded events and clear the internal list, so each
   * event is dispatched at most once.
   */
  pullEvents(): DomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents = [];
    return events;
  }
}
