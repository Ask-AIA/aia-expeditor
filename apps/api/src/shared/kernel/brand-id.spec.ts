import { brandValue, isUuid, toEntityId, toUuid } from './brand';
import type { EntityId } from './brand';
import { UuidGenerator } from './id-generator';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('brand', () => {
  it('brands a value without changing it at runtime', () => {
    type OrderId = EntityId<'Order'>;
    const id = brandValue<string, 'Order'>('order-1');
    const asOrderId: OrderId = id;
    expect(asOrderId).toBe('order-1');
  });

  it('toEntityId accepts non-empty strings and rejects the rest', () => {
    expect(toEntityId('Order', 'order-1')).toBe('order-1');
    expect(toEntityId('Order', '')).toBeNull();
    expect(toEntityId('Order', 42)).toBeNull();
    expect(toEntityId('Order', null)).toBeNull();
  });

  it('toUuid only accepts UUID-shaped strings', () => {
    const valid = '0193e5e0-7a2b-7c1d-9e2f-3a4b5c6d7e8f';
    expect(toUuid(valid)).toBe(valid);
    expect(isUuid(valid)).toBe(true);
    expect(toUuid('not-a-uuid')).toBeNull();
    expect(toUuid('')).toBeNull();
    expect(isUuid(undefined)).toBe(false);
  });
});

describe('UuidGenerator', () => {
  it('generates unique version-7 UUIDs with a valid RFC variant', () => {
    const generator = new UuidGenerator();
    const ids = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const id = generator.generate();
      expect(id).toMatch(UUID_V7_PATTERN);
      expect(isUuid(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(200);
  });

  it('embeds the current time in the leading bits', () => {
    const generator = new UuidGenerator();
    const before = Date.now().toString(16).padStart(12, '0').slice(0, 8);
    const id = generator.generate();
    // The first group is the high 32 bits of the unix-ms timestamp.
    expect(id.slice(0, 8) >= before).toBe(true);
  });
});
