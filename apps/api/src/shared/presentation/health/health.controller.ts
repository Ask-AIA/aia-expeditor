import { Inject } from '@nestjs/common';
import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HEALTH_CHECKS } from '../../application/health-check.port';
import type { HealthCheck } from '../../application/health-check.port';

const CHECK_TIMEOUT_MS = 2000;

async function runCheck(check: HealthCheck): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<'down'>((resolve) => {
      timer = setTimeout(() => {
        resolve('down');
      }, CHECK_TIMEOUT_MS);
      timer.unref();
    });
    return await Promise.race([check.check().then((): 'up' => 'up'), timeout]);
  } catch {
    return 'down';
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
  };
  version: string;
  uptimeSeconds: number;
}

/**
 * Public readiness endpoint. Returns 503 when any dependency check
 * fails. Each check is bounded by a short timeout.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(HEALTH_CHECKS) private readonly checks: HealthCheck[]) {}

  @Get()
  @HttpCode(200)
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    const results = new Map<string, 'up' | 'down'>();
    await Promise.all(
      this.checks.map(async (check) => {
        results.set(check.name, await runCheck(check));
      }),
    );
    const database = results.get('database') ?? 'down';
    const redis = results.get('redis') ?? 'down';
    const healthy = database === 'up' && redis === 'up';
    if (!healthy) {
      response.status(503);
    }
    return {
      status: healthy ? 'ok' : 'degraded',
      checks: { database, redis },
      version: HealthController.VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  private static readonly VERSION = '0.0.0';
}
