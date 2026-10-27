import { DomainEvent } from '../../kernel/domain-event';
import { DomainEventDispatcher } from './domain-event.dispatcher';

class OrderPlaced extends DomainEvent {
  readonly name = 'order.placed';

  constructor(aggregateId: string, id = 'evt-1') {
    super({ id, occurredAt: new Date('2026-01-01T00:00:00Z'), aggregateId });
  }
}

describe('DomainEventDispatcher', () => {
  it('dispatches to handlers registered for the event name only', async () => {
    const dispatcher = new DomainEventDispatcher();
    const placed: DomainEvent[] = [];
    const other: DomainEvent[] = [];
    dispatcher.register('order.placed', (event) => {
      placed.push(event);
    });
    dispatcher.register('order.cancelled', (event) => {
      other.push(event);
    });

    const event = new OrderPlaced('agg-1');
    await dispatcher.dispatchAll([event]);

    expect(placed).toEqual([event]);
    expect(other).toEqual([]);
  });

  it('a failing handler is logged and does not break the rest', async () => {
    const dispatcher = new DomainEventDispatcher();
    const calls: string[] = [];
    dispatcher.register('order.placed', () => {
      calls.push('first');
      throw new Error('handler exploded');
    });
    dispatcher.register('order.placed', () => {
      calls.push('second');
    });

    await expect(dispatcher.dispatchAll([new OrderPlaced('agg-1')])).resolves.toBeUndefined();
    expect(calls).toEqual(['first', 'second']);
  });

  it('dispatching with no handlers is a no-op', async () => {
    const dispatcher = new DomainEventDispatcher();
    await expect(dispatcher.dispatchAll([new OrderPlaced('agg-1')])).resolves.toBeUndefined();
  });
});
