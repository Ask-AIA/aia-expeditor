/**
 * Spike 5 — "hello world" chat completion on Baseten.
 *
 * Sends a minimal OpenAI-compatible `chat/completions` request for
 * `BASETEN_MODEL` (`meta-models/muse-spark-open-1026`) to
 * `BASETEN_BASE_URL` and reports the endpoint shape + latency.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getEnv, missingEnv } from './lib/env.js';
import { excerpt, loggedFetch } from './lib/http.js';
import { FIXTURES_DIR, logInfo } from './lib/log.js';
import { isDirectRun, printSkipped } from './lib/run.js';
import type { SpikeResult } from './lib/run.js';

const SPIKE = '05-baseten';

const EnvSchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

const ChatCompletionSchema = z
  .object({
    choices: z.array(
      z.object({ message: z.object({ content: z.string() }).passthrough() }).passthrough(),
    ),
  })
  .passthrough();

function candidateEndpoints(baseUrl: string): string[] {
  const base = baseUrl.replace(/\/$/, '');
  if (base.endsWith('/chat/completions')) return [base];
  if (base.endsWith('/v1')) return [`${base}/chat/completions`];
  return [`${base}/chat/completions`, `${base}/v1/chat/completions`];
}

export async function runBaseten(): Promise<SpikeResult> {
  const missing = missingEnv(['BASETEN_BASE_URL', 'BASETEN_API_KEY']);
  if (missing.length > 0) {
    return printSkipped(SPIKE, `${SPIKE}: missing env key(s): ${missing.join(', ')}`);
  }
  const env = EnvSchema.parse({
    baseUrl: getEnv('BASETEN_BASE_URL'),
    apiKey: getEnv('BASETEN_API_KEY'),
    model: getEnv('BASETEN_MODEL') ?? 'meta-models/muse-spark-open-1026',
  });

  const body = JSON.stringify({
    model: env.model,
    messages: [{ role: 'user', content: 'Reply with exactly: hello world' }],
    max_tokens: 32,
  });
  const attempts: Array<{ endpoint: string; status: number | null; latencyMs: number }> = [];
  let reply: string | null = null;
  let lastExcerpt = '';
  for (const endpoint of candidateEndpoints(env.baseUrl)) {
    const call = await loggedFetch({
      spike: SPIKE,
      model: env.model,
      endpoint,
      headers: { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json' },
      bodyText: body,
      note: 'openai-compatible chat/completions',
    });
    attempts.push({ endpoint, status: call.status, latencyMs: call.latencyMs });
    lastExcerpt = excerpt(call.bodyText, 500);
    if (call.status !== null && call.status >= 200 && call.status < 300) {
      try {
        const parsed = ChatCompletionSchema.parse(JSON.parse(call.bodyText));
        const firstChoice = parsed.choices[0];
        reply = firstChoice === undefined ? lastExcerpt : firstChoice.message.content;
      } catch {
        reply = lastExcerpt;
      }
      logInfo(
        `${SPIKE}: ${endpoint} HTTP ${String(call.status)} reply=${JSON.stringify(reply.slice(0, 120))}`,
      );
      break;
    }
    logInfo(`${SPIKE}: ${endpoint} HTTP ${String(call.status)}: ${lastExcerpt}`);
    if (call.status !== 404) break;
  }

  mkdirSync(join(FIXTURES_DIR, 'baseten'), { recursive: true });
  writeFileSync(
    join(FIXTURES_DIR, 'baseten', 'result.json'),
    JSON.stringify({ model: env.model, attempts, reply, lastExcerpt }, null, 2),
    'utf8',
  );

  if (reply === null) {
    return {
      spike: SPIKE,
      status: 'error',
      detail: `all endpoints failed: ${lastExcerpt.slice(0, 160)}`,
    };
  }
  const first = attempts[0];
  return {
    spike: SPIKE,
    status: 'ok',
    detail: `${first?.endpoint ?? '?'} HTTP ${String(first?.status)} in ${String(first?.latencyMs)}ms reply=${JSON.stringify(reply.slice(0, 80))}`,
  };
}

if (isDirectRun(import.meta.url)) {
  await runBaseten();
}
