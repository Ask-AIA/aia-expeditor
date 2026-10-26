import { PrismaClient } from '@prisma/client';

/**
 * Intentionally violating fixture: `domain` code must never import
 * infrastructure packages such as `@prisma/client`.
 * `pnpm lint:boundaries-test` asserts that this file fails lint.
 */
export function createForbiddenClient(): PrismaClient {
  return new PrismaClient();
}
