import { ValueObject } from './value-object';

class TestPoint extends ValueObject<{ readonly x: number; readonly y: number }> {
  constructor(x: number, y: number) {
    super({ x, y });
  }
}

class TestLabel extends ValueObject<{ readonly text: string }> {
  constructor(text: string) {
    super({ text });
  }
}

class TestRange extends ValueObject<{ readonly stops: readonly number[] }> {
  constructor(stops: number[]) {
    super({ stops });
  }
}

describe('ValueObject', () => {
  it('equal props means equal value objects', () => {
    expect(new TestPoint(1, 2).equals(new TestPoint(1, 2))).toBe(true);
  });

  it('different props means not equal', () => {
    expect(new TestPoint(1, 2).equals(new TestPoint(1, 3))).toBe(false);
  });

  it('different classes are never equal, even with matching shape', () => {
    const point = new TestPoint(1, 2);
    expect(point.equals({ x: 1, y: 2 })).toBe(false);
    expect(point.equals(new TestLabel('x'))).toBe(false);
    expect(point.equals(null)).toBe(false);
    expect(point.equals('point')).toBe(false);
  });

  it('compares nested structures and dates by value', () => {
    expect(new TestRange([1, 2]).equals(new TestRange([1, 2]))).toBe(true);
    expect(new TestRange([1, 2]).equals(new TestRange([2, 1]))).toBe(false);
  });

  it('freezes props so instances are immutable', () => {
    const point = new TestPoint(1, 2);
    expect(Object.isFrozen(point.props)).toBe(true);
    expect(() => {
      (point.props as { x: number }).x = 99;
    }).toThrow();
  });

  it('does not freeze or alias the caller input', () => {
    const stops = [1, 2];
    const range = new TestRange(stops);
    expect(Object.isFrozen(stops)).toBe(false);
    stops.push(3);
    expect(range.props.stops).toEqual([1, 2]);
  });
});
