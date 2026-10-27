/**
 * Spike 3 — read the digital scale display with `muse-spark-1.3`.
 *
 * Asks for `{ value, unit, confidence }` structured output 5 times on
 * `spikes/inputs/display.{png,jpg}` and reports run-to-run consistency plus
 * the error against `spikes/inputs/ground-truth.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { getEnv, missingEnv, REPO_ROOT } from './lib/env.js';
import { excerpt, loggedFetch } from './lib/http.js';
import { FIXTURES_DIR, logInfo, p50max } from './lib/log.js';
import { isDirectRun, printSkipped } from './lib/run.js';
import type { SpikeResult } from './lib/run.js';

const SPIKE = '03-display';
const RUNS = 5;

const EnvSchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

const ScaleReadingSchema = z.object({
  value: z.number().nullable(),
  unit: z.enum(['g', 'kg', 'oz', 'lb']).nullable(),
  confidence: z.number().min(0).max(1),
});

type ScaleReading = z.infer<typeof ScaleReadingSchema>;

const GroundTruthSchema = z
  .object({
    ['display.png']: z.object({ value: z.number(), unit: z.string() }).passthrough(),
  })
  .passthrough();

function extractAssistantText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const output = (body as Record<string, unknown>)['output'];
  if (!Array.isArray(output)) return null;
  const texts: string[] = [];
  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue;
    const content = (item as Record<string, unknown>)['content'];
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (typeof part !== 'object' || part === null) continue;
      const text = (part as Record<string, unknown>)['text'];
      if (typeof text === 'string') texts.push(text);
    }
  }
  return texts.length > 0 ? texts.join('\n') : null;
}

function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export async function runDisplay(): Promise<SpikeResult> {
  const missing = missingEnv(['META_API_KEY']);
  if (missing.length > 0) {
    return printSkipped(SPIKE, `${SPIKE}: missing env key(s): ${missing.join(', ')}`);
  }
  const env = EnvSchema.parse({
    baseUrl: getEnv('META_API_BASE_URL') ?? 'https://api.meta.ai/v1',
    apiKey: getEnv('META_API_KEY'),
    model: getEnv('MUSE_SPARK_MODEL') ?? 'muse-spark-1.3',
  });
  if (env.model.includes('contributor')) {
    return { spike: SPIKE, status: 'error', detail: 'refusing a -contributor model variant' };
  }

  const inputsDir = join(REPO_ROOT, 'spikes', 'inputs');
  const displayPath = existsSync(join(inputsDir, 'display.png'))
    ? join(inputsDir, 'display.png')
    : join(inputsDir, 'display.jpg');
  if (!existsSync(displayPath)) {
    return printSkipped(SPIKE, `${SPIKE}: missing input spikes/inputs/display.{png,jpg}`);
  }

  const raw = sharp(displayPath);
  const meta = await raw.metadata();
  const sourceW = meta.width;
  const sourceH = meta.height;
  const longest = Math.max(sourceW, sourceH);
  const resized = longest > 1500 ? raw.resize({ width: 1500, height: 1500, fit: 'inside' }) : raw;
  const buffer = await resized.jpeg({ quality: 85 }).toBuffer();
  const sentMeta = await sharp(buffer).metadata();
  const dataUrl = `data:image/jpeg;base64,${buffer.toString('base64')}`;
  logInfo(
    `${SPIKE}: display ${String(sourceW)}x${String(sourceH)} -> sent ` +
      `${String(sentMeta.width)}x${String(sentMeta.height)} (${String(buffer.length)} bytes jpeg)`,
  );

  const endpoint = env.baseUrl.endsWith('/v1')
    ? `${env.baseUrl}/responses`
    : `${env.baseUrl}/v1/responses`;
  const headers = { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json' };
  const prompt =
    'Read the number and unit shown on the digital scale display in this photo. ' +
    'Reply with ONLY a JSON object, no code fences: ' +
    '{"value": number|null, "unit": "g"|"kg"|"oz"|"lb"|null, "confidence": number 0..1}. ' +
    'Use null when the display is unreadable.';

  const readings: ScaleReading[] = [];
  const latencies: number[] = [];
  const rawExcerpts: string[] = [];
  for (let run = 1; run <= RUNS; run += 1) {
    const call = await loggedFetch({
      spike: SPIKE,
      model: env.model,
      endpoint,
      headers,
      bodyText: JSON.stringify({
        model: env.model,
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: dataUrl },
            ],
          },
        ],
      }),
      note: `run=${String(run)}/${String(RUNS)}`,
    });
    latencies.push(call.latencyMs);
    try {
      const text = extractAssistantText(JSON.parse(call.bodyText));
      const candidate = text === null ? null : extractJsonObject(text);
      const reading = ScaleReadingSchema.parse(JSON.parse(candidate ?? ''));
      readings.push(reading);
      rawExcerpts.push(excerpt(text ?? '', 200));
      logInfo(`${SPIKE}: run ${String(run)}/${String(RUNS)} -> ${JSON.stringify(reading)}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logInfo(
        `${SPIKE}: run ${String(run)}/${String(RUNS)} parse failed: ${message.slice(0, 160)}`,
      );
    }
  }

  const outDir = join(FIXTURES_DIR, 'display');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'runs.json'),
    JSON.stringify({ readings, latencies, rawExcerpts }, null, 2),
    'utf8',
  );

  if (readings.length === 0) {
    return { spike: SPIKE, status: 'error', detail: 'all 5 runs failed to parse' };
  }
  const values = readings.map((r) =>
    r.value === null ? 'null' : `${String(r.value)}${r.unit ?? '?'}`,
  );
  const consistent = new Set(values).size === 1;
  const { p50, max } = p50max(latencies);

  let truthNote = 'ground truth unavailable';
  try {
    const truth = GroundTruthSchema.parse(
      JSON.parse(readFileSync(join(inputsDir, 'ground-truth.json'), 'utf8')),
    );
    const first = readings[0];
    const displayTruth = truth['display.png'];
    if (first !== undefined) {
      const valueErr =
        first.value === null ? 'unreadable' : String(first.value - displayTruth.value);
      truthNote =
        `truth=${String(displayTruth.value)}${displayTruth.unit} ` +
        `measured=${String(first.value)}${first.unit ?? '?'} valueErr=${valueErr}`;
    }
  } catch {
    logInfo(`${SPIKE}: ${truthNote}`);
  }

  const detail =
    `runs=${String(readings.length)}/${String(RUNS)} consistent=${String(consistent)} ` +
    `values=[${values.join(', ')}] p50=${String(p50)}ms max=${String(max)}ms ${truthNote}`;
  logInfo(`${SPIKE}: ${detail}`);
  return { spike: SPIKE, status: 'ok', detail };
}

if (isDirectRun(import.meta.url)) {
  await runDisplay();
}
