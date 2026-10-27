import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG } from '../../config/app-config';
import type { AppConfig } from '../../config/app-config';

/**
 * Redis client with a mandatory key prefix.
 *
 * The local Redis is shared with other projects: every key this app
 * writes starts with `REDIS_KEY_PREFIX` (default `exp:`). There is
 * intentionally no `flushall`/`flushdb` method.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  readonly prefix: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (config.REDIS_KEY_PREFIX.length === 0) {
      throw new Error('REDIS_KEY_PREFIX must not be empty');
    }
    this.prefix = config.REDIS_KEY_PREFIX;
    this.client = new Redis(config.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    this.client.on('error', (error: unknown) => {
      this.logger.warn(
        `Redis client error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.ping();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status === 'ready' || this.client.status === 'connect') {
      await this.client.quit().catch((error: unknown) => {
        this.logger.warn(
          `Redis quit failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    } else {
      this.client.disconnect();
    }
  }

  /** The namespaced key actually stored in Redis. */
  namespaced(key: string): string {
    return `${this.prefix}${key}`;
  }

  async ping(): Promise<'PONG'> {
    return this.client.ping();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(this.namespaced(key));
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds === undefined) {
      await this.client.set(this.namespaced(key), value);
      return;
    }
    await this.client.set(this.namespaced(key), value, 'EX', ttlSeconds);
  }

  async del(...keys: string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return this.client.del(keys.map((key) => this.namespaced(key)));
  }

  /**
   * Delete every key under `prefix` (relative to this service's own
   * prefix) using SCAN — never `KEYS`, never `FLUSHDB`. Used by tests
   * to clean a per-run prefix such as `exp:test:<uuid>:`.
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    const pattern = this.namespaced(`${prefix}*`);
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        deleted += await this.client.del(...keys);
      }
    } while (cursor !== '0');
    return deleted;
  }
}
