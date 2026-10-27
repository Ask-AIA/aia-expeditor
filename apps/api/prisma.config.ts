// Prisma CLI configuration (Prisma 6).
//
// The workspace `.env` lives at the repository root, but
// `pnpm --filter api prisma …` runs with `apps/api` as the working
// directory, where no `.env` exists — so `env("DATABASE_URL")` in
// `prisma/schema.prisma` fails with P1012. This file is auto-loaded by
// the Prisma CLI from the working directory and points dotenv at the
// root `.env` explicitly. Real environment variables always win over
// file values (dotenv default), so `test/global-setup.js` can still
// override `DATABASE_URL` with the test database.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

const workspaceEnv = path.resolve(process.cwd(), '..', '..', '.env');
if (fs.existsSync(workspaceEnv)) {
  config({ path: workspaceEnv });
} else {
  // Invoked from the workspace root (or anywhere with a local `.env`):
  // keep dotenv's default resolution relative to the working directory.
  config();
}

export default defineConfig({});
