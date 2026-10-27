import { Injectable } from '@nestjs/common';
import type { HealthCheck } from '../../application/health-check.port';
import { PrismaService } from './prisma.service';

const DATABASE_TIMEOUT_MS = 1500;

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

/** Readiness probe for PostgreSQL: `SELECT 1` with a short timeout. */
@Injectable()
export class PrismaHealthCheck implements HealthCheck {
  readonly name = 'database';

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<void> {
    await withTimeout(this.prisma.$queryRaw`SELECT 1`, DATABASE_TIMEOUT_MS, 'database');
  }
}
