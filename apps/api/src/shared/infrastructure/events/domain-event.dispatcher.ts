import { Injectable, Logger } from '@nestjs/common';
import { getCorrelationId } from '../../application/request-context';
import type { DomainEvent } from '../../kernel/domain-event';

/** Handler invoked for one domain event. A throw is logged, never propagated. */
export type DomainEventHandler = (event: DomainEvent) => Promise<void> | void;

/**
 * In-process domain-event dispatcher (Observer).
 *
 * Handlers register per event `name`. The Unit of Work calls
 * `dispatchAll` only after its transaction commits; a rollback drops the
 * events before they reach this dispatcher. A failing handler is logged
 * with the correlation ID and never breaks the (already committed)
 * transaction or the remaining handlers.
 */
@Injectable()
export class DomainEventDispatcher {
  private readonly logger = new Logger(DomainEventDispatcher.name);
  private readonly handlers = new Map<string, DomainEventHandler[]>();

  register(eventName: string, handler: DomainEventHandler): void {
    const current = this.handlers.get(eventName) ?? [];
    current.push(handler);
    this.handlers.set(eventName, current);
  }

  async dispatchAll(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      const handlers = this.handlers.get(event.name) ?? [];
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (error: unknown) {
          this.logger.error(`Domain event handler failed for ${event.name} (${event.id})`, {
            eventName: event.name,
            eventId: event.id,
            aggregateId: event.aggregateId,
            correlationId: getCorrelationId(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }
}
