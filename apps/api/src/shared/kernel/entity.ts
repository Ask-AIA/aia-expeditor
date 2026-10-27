/**
 * Base class for entities: an identity plus mutable state.
 * Equality is by ID only.
 */
export abstract class Entity<TId> {
  readonly id: TId;

  protected constructor(id: TId) {
    this.id = id;
  }

  equals(other: unknown): boolean {
    if (other === null || typeof other !== 'object') {
      return false;
    }
    if (other.constructor !== this.constructor) {
      return false;
    }
    return (other as Entity<TId>).id === this.id;
  }
}
