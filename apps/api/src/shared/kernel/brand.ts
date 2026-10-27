/**
 * Branded (nominal) types.
 *
 * A brand attaches a compile-time tag to a primitive so IDs from different
 * aggregates cannot be mixed up. Brands are erased at runtime.
 *
 * @example
 * ```ts
 * type OrderId = Brand<string, 'OrderId'>;
 * ```
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * A string ID branded with the aggregate name.
 *
 * @example
 * ```ts
 * type OrderId = EntityId<'Order'>;
 * ```
 */
export type EntityId<B extends string> = Brand<string, B>;

/**
 * Attach a brand to a runtime value. Prefer narrowing constructors
 * (e.g. `toOrderId`) at layer boundaries over calling this directly.
 */
export function brandValue<T, B extends string>(value: T): Brand<T, B> {
  return value as Brand<T, B>;
}

/**
 * Narrow an unknown value to a branded string ID, validating only that it
 * is a non-empty string. Format checks (UUID, cuid, …) belong to the
 * aggregate that owns the ID.
 */
export function toEntityId<B extends string>(brand: B, value: unknown): EntityId<B> | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return brandValue<string, B>(value);
}

/** UUID string (v4 or v7), branded so raw strings cannot leak across layers. */
export type Uuid = Brand<string, 'Uuid'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function toUuid(value: unknown): Uuid | null {
  if (!isUuid(value)) {
    return null;
  }
  return value;
}
