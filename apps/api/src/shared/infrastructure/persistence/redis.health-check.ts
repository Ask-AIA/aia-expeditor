import { Injectable } from '@nestjs/common';
import type { HealthCheck } from '../../application/health-check.port';
import { RedisService } from './redis.service';

const REDIS_TIMEOUT_MS = 1000;

function withTimeout<T>(promise: Promise<T>, ms: number, owner: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${owner} health check timed out`));
    }, ms);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

/** Readiness probe for Redis: `PING` with a short timeout. */
@Injectable()
export class RedisHealthCheck implements HealthCheck {
  readonly name = 'redis';

  constructor(private readonly redis: RedisService) {}

  async check(): Promise<void> {
    await withTimeout(this.redis.ping(), REDIS_TIMEOUT_MS, 'redis');
  }
}
