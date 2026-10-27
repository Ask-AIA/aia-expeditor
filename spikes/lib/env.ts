/**
 * Minimal `.env` loader + typed env access for spikes.
 *
 * Keys are read only through `process.env` after loading. Values are never
 * printed, logged, or written anywhere by this module.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
/** Repository root (spikes/lib -> spikes -> repo). */
export const REPO_ROOT = join(LIB_DIR, '..', '..');
const DOTENV_PATH = join(REPO_ROOT, '.env');

/** Parse `KEY=VALUE` lines (quotes stripped, `#` comments and blanks skipped). */
function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length) : line;
    const eq = withoutExport.indexOf('=');
    if (eq < 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== '') out[key] = value;
  }
  return out;
}

let loaded = false;

/** Load `.env` once. Existing `process.env` values always win. */
export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  try {
    const parsed = parseDotEnv(readFileSync(DOTENV_PATH, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // No .env file: callers treat every needed key as missing (SKIPPED).
  }
}

/** Raw accessor. Returns `undefined` when the variable is unset or empty. */
export function getEnv(name: string): string | undefined {
  loadDotEnv();
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Names (only names) of the variables in `names` that are unset or empty. */
export function missingEnv(names: readonly string[]): string[] {
  return names.filter((name) => getEnv(name) === undefined);
}
