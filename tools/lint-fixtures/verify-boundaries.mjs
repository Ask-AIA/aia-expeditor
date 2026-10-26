import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const fixture = join('tools', 'lint-fixtures', 'domain', 'violation.fixture.ts');

try {
  await execFileAsync('pnpm', ['exec', 'eslint', fixture], { cwd: repoRoot });
  console.error('FAIL: fixture passed lint, but a boundaries violation was expected.');
  process.exit(1);
} catch (error) {
  const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
  if (output.includes('boundaries/element-types')) {
    console.log('OK: domain importing @prisma/client fails lint (boundaries/element-types).');
  } else {
    console.error('FAIL: eslint failed, but not because of boundaries/element-types:');
    console.error(output);
    process.exit(1);
  }
}
