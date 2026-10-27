function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => deepEqual(item, b[index]));
  }
  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    return aKeys.length === bKeys.length && aKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    Object.freeze(value);
    return value;
  }
  if (isRecord(value) || value instanceof Date) {
    if (isRecord(value)) {
      for (const key of Object.keys(value)) {
        deepFreeze(value[key]);
      }
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * Base class for value objects: immutable values with structural equality.
 * Props are deep-frozen at construction; equality compares by value.
 */
export abstract class ValueObject<TProps> {
  readonly props: TProps;

  protected constructor(props: TProps) {
    this.props = deepFreeze({ ...(props as Record<string, unknown>) }) as TProps;
  }

  equals(other: unknown): boolean {
    if (other === null || typeof other !== 'object') {
      return false;
    }
    if (other.constructor !== this.constructor) {
      return false;
    }
    return deepEqual(this.props, (other as ValueObject<TProps>).props);
  }
}
