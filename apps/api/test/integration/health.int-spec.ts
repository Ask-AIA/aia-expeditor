import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import type { Response } from 'supertest';
import { ConfigModule } from '../../src/shared/config/config.module';
import { RedisService } from '../../src/shared/infrastructure/persistence/redis.service';
import { setupApiDocs } from '../../src/shared/presentation/docs/api-docs';
import { SharedModule } from '../../src/shared/shared.module';
import { useIsolatedTestEnv } from './test-env';

/**
 * HTTP integration coverage for the Phase 2 foundation: the app boots
 * against the test database (migrated by `integration/global-setup.js`)
 * and a per-run Redis prefix, `/api/v1/health` reports both
 * dependencies, and the correlation ID round-trips through the middleware.
 */

function serverOf(app: INestApplication): Server {
  // getHttpServer() is typed `any`; the double assertion stops it leaking
  // into the typed helpers (`no-unsafe-assignment` forbids the annotated
  // assignment form, so this narrowing assertion is the sanctioned pattern).
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  return app.getHttpServer() as unknown as Server;
}

function responseCorrelationId(response: Response): string | undefined {
  const headers = response.headers as Record<string, string | undefined>;
  return headers['x-correlation-id'];
}

describe('HTTP foundation (integration)', () => {
  let moduleRef: TestingModule | undefined;
  let app: INestApplication | undefined;
  let redis: RedisService | undefined;

  beforeAll(async () => {
    const { redisKeyPrefix } = useIsolatedTestEnv();
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, SharedModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // Mirror main.ts: REST lives under /api/v1, docs stay at /docs.
    app.setGlobalPrefix('api/v1');
    setupApiDocs(app);
    await app.init();
    const redisService: RedisService = moduleRef.get(RedisService);
    redis = redisService;
    expect(redisService.prefix).toBe(redisKeyPrefix);
  }, 30000);

  afterAll(async () => {
    // Delete only keys under this run's prefix — never anything else on
    // the shared Redis.
    await redis?.deleteByPrefix('');
    await app?.close();
  });

  it('GET /api/v1/health returns 200 with both checks up', async () => {
    if (app === undefined) {
      throw new Error('test app not initialized');
    }
    const response = await request(serverOf(app)).get('/api/v1/health').expect(200);

    const body: unknown = response.body;
    expect(body).toMatchObject({
      status: 'ok',
      checks: { database: 'up', redis: 'up' },
    });
    const payload = body as { version: unknown; uptimeSeconds: unknown };
    expect(typeof payload.version).toBe('string');
    expect((payload.version as string).length).toBeGreaterThan(0);
    expect(typeof payload.uptimeSeconds).toBe('number');
  });

  it('echoes a valid X-Correlation-Id response header', async () => {
    if (app === undefined) {
      throw new Error('test app not initialized');
    }
    const correlationId = randomUUID();
    const response = await request(serverOf(app))
      .get('/api/v1/health')
      .set('X-Correlation-Id', correlationId)
      .expect(200);

    expect(responseCorrelationId(response)).toBe(correlationId);
  });

  it('generates a correlation ID when the header is missing or invalid', async () => {
    if (app === undefined) {
      throw new Error('test app not initialized');
    }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

    const missing = await request(serverOf(app)).get('/api/v1/health').expect(200);
    expect(responseCorrelationId(missing)).toMatch(uuidPattern);

    const invalid = await request(serverOf(app))
      .get('/api/v1/health')
      .set('X-Correlation-Id', 'not-a-uuid')
      .expect(200);
    const regenerated = responseCorrelationId(invalid);
    expect(regenerated).toMatch(uuidPattern);
    expect(regenerated).not.toBe('not-a-uuid');
  });

  it('serves the OpenAPI document at /docs-json outside production', async () => {
    if (app === undefined) {
      throw new Error('test app not initialized');
    }
    const response = await request(serverOf(app)).get('/docs-json').expect(200);

    const body: unknown = response.body;
    const document = body as { openapi: unknown; info: unknown };
    expect(typeof document.openapi).toBe('string');
    expect(document).toMatchObject({ info: { title: 'AIA Expeditor API' } });
  });
});
