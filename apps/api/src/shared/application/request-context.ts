import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped context, propagated through `AsyncLocalStorage`.
 * Lives in the application layer so both presentation (middleware) and
 * infrastructure (logger, event dispatcher) can use it without breaking
 * the layer rules. Framework-free: no NestJS dependency.
 */
export interface RequestContext {
  readonly correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with the given request context active. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The active request context, or `undefined` outside a request scope. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** The active correlation ID, or `undefined` outside a request scope. */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
