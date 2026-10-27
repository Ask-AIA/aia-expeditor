/**
 * Small `fetch` wrapper for spikes: measures latency, appends one JSONL
 * record per call, and never logs request bodies (they may hold images).
 */
import { appendCall, logInfo, redact } from './log.js';

export interface FetchCallOptions {
  spike: string;
  model: string;
  endpoint: string;
  method?: string;
  headers?: Record<string, string>;
  bodyText?: string;
  timeoutMs?: number;
  note?: string;
}

export interface FetchCallResult {
  status: number | null;
  latencyMs: number;
  bodyText: string;
  usage?: Record<string, number | string>;
}

/** POST/GET with timing + accounting. Bodies are withheld from logs. */
export async function loggedFetch(options: FetchCallOptions): Promise<FetchCallResult> {
  const method = options.method ?? 'POST';
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs ?? 120_000);
  const start = Date.now();
  let status: number | null = null;
  let bodyText = '';
  try {
    const response = await fetch(options.endpoint, {
      method,
      ...(options.headers !== undefined ? { headers: options.headers } : {}),
      ...(options.bodyText !== undefined ? { body: options.bodyText } : {}),
      signal: controller.signal,
    });
    status = response.status;
    bodyText = await response.text();
  } catch (error: unknown) {
    bodyText = error instanceof Error ? `fetch-error: ${error.message}` : 'fetch-error';
  } finally {
    clearTimeout(timeout);
  }
  const latencyMs = Date.now() - start;
  const record = {
    ts: new Date().toISOString(),
    spike: options.spike,
    model: options.model,
    endpoint: options.endpoint,
    method,
    httpStatus: status,
    latencyMs,
    ...(options.note !== undefined ? { note: options.note } : {}),
  };
  appendCall(record);
  logInfo(
    `${options.spike} ${method} ${options.endpoint} -> ${String(status)} in ${String(latencyMs)}ms`,
  );
  return { status, latencyMs, bodyText };
}

/** Short redacted excerpt for RESULTS.md (no image bytes, no keys). */
export function excerpt(text: string, maxChars = 400): string {
  const clean = redact(text).replace(/\s+/g, ' ').trim();
  return clean.length > maxChars ? clean.slice(0, maxChars) + '…' : clean;
}
