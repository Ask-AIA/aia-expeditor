import type { Response } from 'express';
import type { HealthCheck } from '../../application/health-check.port';
import { HealthController } from './health.controller';

function mockResponse(): { response: Response; statusCode: { value: number } } {
  const statusCode = { value: 200 };
  const response = {
    status: (code: number): unknown => {
      statusCode.value = code;
      return response;
    },
  } as unknown as Response;
  return { response, statusCode };
}

function check(name: string, behavior: 'up' | 'down'): HealthCheck {
  return {
    name,
    check: (): Promise<void> => {
      if (behavior === 'down') {
        return Promise.reject(new Error(`${name} is down`));
      }
      return Promise.resolve();
    },
  };
}

describe('HealthController', () => {
  it('returns 200 with both checks up', async () => {
    const controller = new HealthController([check('database', 'up'), check('redis', 'up')]);
    const { response, statusCode } = mockResponse();

    const body = await controller.check(response);

    expect(statusCode.value).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.checks).toEqual({ database: 'up', redis: 'up' });
    expect(typeof body.version).toBe('string');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('returns 503 when any check fails', async () => {
    const controller = new HealthController([check('database', 'up'), check('redis', 'down')]);
    const { response, statusCode } = mockResponse();

    const body = await controller.check(response);

    expect(statusCode.value).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.checks).toEqual({ database: 'up', redis: 'down' });
  });
});
