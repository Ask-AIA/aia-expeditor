import { randomUUID } from 'node:crypto';

/**
 * Point the test process at the isolated test dependencies.
 *
 * - `DATABASE_URL` is redirected to `DATABASE_URL_TEST`: the development
 *   database is never touched (`test/global-setup.js` applies migrations
 *   to the test database the same way).
 * - `REDIS_KEY_PREFIX` gets a per-run value (`exp:test:<uuid>:`), so keys
 *   written by one run can never collide with another project, another run,
 *   or a developer's local data on the shared Redis.
 *
 * Must run before the Nest testing module is compiled, because providers
 * read the validated config at construction time.
 */
export function useIsolatedTestEnv(): { redisKeyPrefix: string } {
  const testUrl = process.env['DATABASE_URL_TEST'];
  if (testUrl === undefined || testUrl === '') {
    throw new Error(
      'DATABASE_URL_TEST is not set. Copy .env.test.example to .env.test (or set DATABASE_URL_TEST in .env).',
    );
  }
  process.env['DATABASE_URL'] = testUrl;

  const redisKeyPrefix = `exp:test:${randomUUID()}:`;
  process.env['REDIS_KEY_PREFIX'] = redisKeyPrefix;
  return { redisKeyPrefix };
}
