import { AggregateRoot } from './aggregate-root';
import { DomainEvent } from './domain-event';

class TestHappened extends DomainEvent {
  readonly name = 'test.happened';

  constructor(aggregateId: string) {
    super({ id: 'evt-1', occurredAt: new Date('2026-01-01T00:00:00Z'), aggregateId });
  }
}

class TestAggregate extends AggregateRoot<string> {
  // The base constructor is protected on purpose (creation goes through
  // factories); the explicit forwarding constructor only widens visibility.
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(id: string) {
    super(id);
  }

  doSomething(): void {
    this.record(new TestHappened(this.id));
  }
}

describe('AggregateRoot', () => {
  it('collects recorded events and exposes them read-only', () => {
    const aggregate = new TestAggregate('agg-1');
    aggregate.doSomething();
    aggregate.doSomething();

    expect(aggregate.recordedEvents).toHaveLength(2);
    expect(aggregate.recordedEvents[0]).toBeInstanceOf(TestHappened);
    expect(aggregate.recordedEvents.map((event) => event.aggregateId)).toEqual(['agg-1', 'agg-1']);
  });

  it('pullEvents() returns the events and clears the list exactly once', () => {
    const aggregate = new TestAggregate('agg-1');
    aggregate.doSomething();

    const pulled = aggregate.pullEvents();
    expect(pulled).toHaveLength(1);
    expect(aggregate.recordedEvents).toHaveLength(0);
    expect(aggregate.pullEvents()).toHaveLength(0);
  });

  it('events carry id, timestamp and aggregate id', () => {
    const aggregate = new TestAggregate('agg-9');
    aggregate.doSomething();

    const [event] = aggregate.pullEvents();
    expect(event?.id).toBe('evt-1');
    expect(event?.name).toBe('test.happened');
    expect(event?.aggregateId).toBe('agg-9');
    expect(event?.occurredAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});
