/**
 * Base class for typed failures that cross layer boundaries.
 *
 * Domain and application code return `Result.fail(error)` for expected
 * failures instead of throwing. `code` is a machine-readable literal
 * (one union per module); `httpStatus` is a hint the HTTP layer uses
 * when mapping the error to RFC 7807 problem+json.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options !== undefined ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
  }
}

/**
 * Fallback for unexpected exceptions caught at a use-case boundary.
 * Carries no internals: the HTTP layer maps it to a generic 500.
 */
export class InternalError extends DomainError {
  readonly code = 'INTERNAL_ERROR';
  readonly httpStatus = 500;

  constructor(message = 'An unexpected error occurred', options?: { cause?: unknown }) {
    super(message, options);
  }
}
