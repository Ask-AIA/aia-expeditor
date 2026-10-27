/* eslint-disable @typescript-eslint/no-require-imports -- plain Node setup script
   loaded directly by Jest (not compiled); require() is the only option. */
// Applies pending migrations to the test database before integration tests.
// Never touches the development database: DATABASE_URL is overridden with
// DATABASE_URL_TEST for the `migrate deploy` call only.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const dotenv = require('dotenv');

const apiDir = path.resolve(__dirname, '..', '..');
const workspaceRoot = path.resolve(__dirname, '..', '..', '..', '..');

module.exports = async () => {
  dotenv.config({ path: path.join(workspaceRoot, '.env') });
  if (process.env.NODE_ENV === 'test') {
    dotenv.config({ path: path.join(workspaceRoot, '.env.test'), override: false });
  }
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    throw new Error(
      'DATABASE_URL_TEST is not set. Copy .env.test.example to .env.test and fill it in.',
    );
  }
  execFileSync(
    path.join(apiDir, 'node_modules', '.bin', 'prisma'),
    ['migrate', 'deploy', '--schema', path.join(apiDir, 'prisma', 'schema.prisma')],
    {
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: 'inherit',
      cwd: apiDir,
    },
  );
};
