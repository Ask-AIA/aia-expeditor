import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { APP_CONFIG } from '../../config/app-config';
import type { AppConfig } from '../../config/app-config';

/**
 * Prisma client with NestJS lifecycle hooks. Connects on boot and
 * disconnects on shutdown so the process exits cleanly.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ datasourceUrl: config.DATABASE_URL });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
