import * as dotenv from 'dotenv';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ValidatedEnv } from './env.schema';
import { envSchema, formatEnvIssues } from './env.schema';

/** Typed application configuration, validated once at boot. */
export type AppConfig = ValidatedEnv;

/** NestJS DI token for the validated `AppConfig`. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Thrown when the environment fails validation. The message lists
 * variable names and reasons only — never secret values.
 */
export class ConfigValidationError extends Error {
  constructor(details: string) {
    super(details);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Find the workspace root (the directory containing `pnpm-workspace.yaml`)
 * so `.env` files load whether the process starts at the root or in
 * `apps/api` (`pnpm --filter api …` runs with `apps/api` as CWD).
 */
function findEnvDir(): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 4; depth += 1) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return process.cwd();
}

function loadDotFiles(): void {
  const envDir = findEnvDir();
  dotenv.config({ path: path.join(envDir, '.env') });
  if (process.env['NODE_ENV'] === 'test') {
    // `.env.test` supplies test-local values (test database, per-run Redis
    // prefix). `override: false` keeps real environment variables winning.
    dotenv.config({ path: path.join(envDir, '.env.test'), override: false });
  }
}

/**
 * Validate the environment and return the typed config. Call once at
 * boot (or once per test process with an explicit `source`).
 *
 * Phase 4: the setup wizard makes live provider keys mandatory. Enforce
 * that here by requiring `META_API_KEY`, `BASETEN_API_KEY` (when
 * `IDENTIFIER_PROVIDER=baseten`) and `ELEVENLABS_API_KEY` outside the
 * `test` environment.
 */
export function loadAppConfig(source?: Record<string, string | undefined>): AppConfig {
  if (source === undefined) {
    loadDotFiles();
    source = process.env;
  }
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigValidationError(formatEnvIssues(parsed.error));
  }
  return parsed.data;
}
