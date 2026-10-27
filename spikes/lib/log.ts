/**
 * Redacting logger, `timed()` wrapper, and per-call JSONL accounting.
 *
 * Every provider call appends exactly one JSON line to
 * `spikes/fixtures/calls.jsonl` with model, endpoint, HTTP status, latency,
 * and usage when returned. Keys, tokens, and image bytes are never written.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './env.js';

export const FIXTURES_DIR = join(REPO_ROOT, 'spikes', 'fixtures');
export const CALLS_PATH = join(FIXTURES_DIR, 'calls.jsonl');

export interface CallRecord {
  ts: string;
  spike: string;
  model: string;
  endpoint: string;
  method: string;
  httpStatus: number | null;
  latencyMs: number;
  usage?: Record<string, number | string>;
  note?: string;
}

function ensureFixturesDir(): void {
  if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
}

/** Append one call record. Never pass keys or image data in `record`. */
export function appendCall(record: CallRecord): void {
  ensureFixturesDir();
  appendFileSync(CALLS_PATH, JSON.stringify(record) + '\n', 'utf8');
}

/** Truncate the calls log at the start of a fresh full run. */
export function resetCallsLog(): void {
  ensureFixturesDir();
  writeFileSync(CALLS_PATH, '', 'utf8');
}

const SECRET_KEY_PATTERNS = [/sk-[A-Za-z0-9-_]+/g, /Bearer\s+[A-Za-z0-9\-._~+/=]+/g, /xi-api-key/i];

/**
 * Redact secrets from text meant for stdout, RESULTS.md, or fixtures.
 * Data URLs are truncated to their media-type prefix (no image bytes).
 */
export function redact(text: string): string {
  let out = text;
  for (const pattern of SECRET_KEY_PATTERNS) {
    out = out.replace(pattern, '[REDACTED]');
  }
  out = out.replace(/(data:image\/[a-zA-Z0-9.+-]+;base64,)[A-Za-z0-9+/=]{24,}/g, '$1<TRUNCATED>');
  out = out.replace(/(["']base64["']\s*:\s*["'])[A-Za-z0-9+/=]{24,}/g, '$1<TRUNCATED>');
  return out;
}

/** Log an informational line (redacted). */
export function logInfo(message: string): void {
  console.log(redact(message));
}

/** Time an async call, log `${label}: ${ms}ms`, and return value + latency. */
export async function timed<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<{ value: T; latencyMs: number }> {
  const start = Date.now();
  const value = await fn();
  const latencyMs = Date.now() - start;
  logInfo(`${label}: ${String(latencyMs)}ms`);
  return { value, latencyMs };
}

/** Median and max of a non-empty latency sample. */
export function p50max(samples: readonly number[]): { p50: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const last = sorted[sorted.length - 1];
  return { p50: mid ?? 0, max: last ?? 0 };
}
