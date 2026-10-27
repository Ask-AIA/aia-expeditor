/**
 * Minimal structured-logging port. The kernel depends only on this
 * interface; adapters (NestJS logger, pino, …) live in infrastructure.
 * The active correlation ID is attached by the adapter, not here.
 */
export interface LoggerPort {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/** No-op logger for unit tests that do not assert on logging. */
export class NoopLogger implements LoggerPort {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
