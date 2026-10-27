import type { Server } from 'node:http';
import request from 'supertest';
import type { IntegrationContext } from './integration-setup';
import { setupIntegration, teardownIntegration } from './integration-setup';

interface HealthBody {
  status: string;
  checks: { database: string; redis: string };
  version: string;
  uptimeSeconds: number;
}

describe('GET /health (integration)', () => {
  let ctx: IntegrationContext;

  beforeAll(async () => {
    ctx = await setupIntegration();
  });

  afterAll(async () => {
    await teardownIntegration(ctx);
  });

  it('returns 200 with both checks up', async () => {
    const server = ctx.app.getHttpServer() as unknown as Server;
    const response = await request(server).get('/api/v1/health').expect(200);
    const body = response.body as HealthBody;

    expect(body.status).toBe('ok');
    expect(body.checks).toEqual({ database: 'up', redis: 'up' });
    expect(typeof body.version).toBe('string');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(response.headers['x-correlation-id']).toBeDefined();
  });
});
