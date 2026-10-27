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

/**
 * Deep-clone `value` and freeze the clone, so the value object owns
 * immutable props without freezing (or aliasing) the caller's input.
 */
function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    for (const item of value) {
      copy.push(deepClone(item));
    }
    return Object.freeze(copy) as T;
  }
  if (value instanceof Date) {
    return Object.freeze(new Date(value.getTime())) as T;
  }
  if (isRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      copy[key] = deepClone(value[key]);
    }
    return Object.freeze(copy) as T;
  }
  return value;
}

/**
 * Base class for value objects: immutable values with structural equality.
 * Props are deep-cloned and frozen at construction; equality compares by value.
 */
export abstract class ValueObject<TProps> {
  readonly props: TProps;

  protected constructor(props: TProps) {
    this.props = deepClone(props);
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
