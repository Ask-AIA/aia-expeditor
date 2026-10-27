import type { DomainError } from './domain-error';

type OkState<T> = { readonly kind: 'ok'; readonly value: T };
type ErrState<E> = { readonly kind: 'err'; readonly error: E };

/**
 * Explicit success/failure container. Domain and application code return
 * `Result` for expected failures and throw only for unexpected bugs.
 */
export class Result<T, E extends DomainError> {
  private constructor(private readonly state: OkState<T> | ErrState<E>) {}

  static ok<T, E extends DomainError>(value: T): Result<T, E> {
    return new Result<T, E>({ kind: 'ok', value });
  }

  static err<T, E extends DomainError>(error: E): Result<T, E> {
    return new Result<T, E>({ kind: 'err', error });
  }

  isOk(): this is Result<T, E> & { readonly value: T } {
    return this.state.kind === 'ok';
  }

  isErr(): this is Result<T, E> & { readonly error: E } {
    return this.state.kind === 'err';
  }

  /** Read the success value. Throws if this is an error. */
  unwrap(): T {
    if (this.state.kind === 'err') {
      throw this.state.error;
    }
    return this.state.value;
  }

  /** Read the error. Throws if this is a success. */
  unwrapErr(): E {
    if (this.state.kind === 'ok') {
      throw new Error('Result.unwrapErr() called on an ok result');
    }
    return this.state.error;
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    if (this.state.kind === 'err') {
      return Result.err<U, E>(this.state.error);
    }
    return Result.ok<U, E>(fn(this.state.value));
  }

  flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
    if (this.state.kind === 'err') {
      return Result.err<U, E>(this.state.error);
    }
    return fn(this.state.value);
  }

  match<U>(handlers: { ok: (value: T) => U; err: (error: E) => U }): U {
    if (this.state.kind === 'ok') {
      return handlers.ok(this.state.value);
    }
    return handlers.err(this.state.error);
  }

  /**
   * Combine many results: the first error wins, otherwise all values
   * in input order.
   */
  static combine<T, E extends DomainError>(
    results: readonly Result<T, E>[],
  ): Result<readonly T[], E> {
    const values: T[] = [];
    for (const result of results) {
      if (result.isErr()) {
        return Result.err<readonly T[], E>(result.unwrapErr());
      }
      values.push(result.unwrap());
    }
    return Result.ok<readonly T[], E>(values);
  }
}
