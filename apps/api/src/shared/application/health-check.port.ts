/** NestJS DI token for the registered health checks (multi-provider). */
export const HEALTH_CHECKS = Symbol('HEALTH_CHECKS');

/**
 * A readiness probe for one dependency. Implementations must fail fast
 * (short internal timeouts); the controller maps a rejection to `down`.
 */
export interface HealthCheck {
  readonly name: string;
  check(): Promise<void>;
}
