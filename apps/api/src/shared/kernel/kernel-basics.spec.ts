import { assertNever } from './assert-never';
import { FixedClock, SystemClock } from './clock';
import { Entity } from './entity';

class TestEntity extends Entity<string> {
  // Explicit ctor only widens the intentionally protected base constructor.
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(id: string) {
    super(id);
  }
}

class OtherEntity extends Entity<string> {
  // Explicit ctor only widens the intentionally protected base constructor.
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(id: string) {
    super(id);
  }
}

describe('Entity', () => {
  it('equals by id within the same class', () => {
    expect(new TestEntity('a').equals(new TestEntity('a'))).toBe(true);
    expect(new TestEntity('a').equals(new TestEntity('b'))).toBe(false);
  });

  it('never equals another class, null, or a primitive', () => {
    const entity = new TestEntity('a');
    expect(entity.equals(new OtherEntity('a'))).toBe(false);
    expect(entity.equals(null)).toBe(false);
    expect(entity.equals('a')).toBe(false);
  });
});

describe('Clock', () => {
  it('SystemClock returns the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('FixedClock only moves when told to', () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    expect(clock.now()).toEqual(new Date('2026-01-01T00:00:00Z'));

    clock.advanceBy(1000);
    expect(clock.now()).toEqual(new Date('2026-01-01T00:00:01Z'));

    clock.setTo(new Date('2026-06-01T00:00:00Z'));
    expect(clock.now()).toEqual(new Date('2026-06-01T00:00:00Z'));
  });

  it('FixedClock returns copies, so callers cannot move it', () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));
    clock.now().setFullYear(2000);
    expect(clock.now()).toEqual(new Date('2026-01-01T00:00:00Z'));
  });
});

describe('assertNever', () => {
  it('throws for an allegedly impossible value', () => {
    expect(() => assertNever('boom' as never)).toThrow('Unhandled variant: boom');
    expect(() => assertNever('boom' as never, 'custom')).toThrow('custom: boom');
  });

  it('narrows discriminated unions at compile time', () => {
    function labelOf(kind: 'a' | 'b'): string {
      switch (kind) {
        case 'a':
          return 'A';
        case 'b':
          return 'B';
        default:
          return assertNever(kind);
      }
    }
    expect(labelOf('a')).toBe('A');
    expect(labelOf('b')).toBe('B');
  });
});
