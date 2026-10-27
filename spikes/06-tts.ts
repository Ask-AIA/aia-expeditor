/**
 * Spike 6 — stream a Spanish sentence from ElevenLabs TTS.
 *
 * Streams `/v1/text-to-speech/{voice_id}/stream`, saves the MP3 to
 * `spikes/fixtures/tts/sample-es.mp3`, and reports time-to-first-byte
 * plus total time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getEnv, missingEnv } from './lib/env.js';
import { appendCall, FIXTURES_DIR, logInfo } from './lib/log.js';
import { isDirectRun, printSkipped } from './lib/run.js';
import type { SpikeResult } from './lib/run.js';

const SPIKE = '06-tts';
const TEXT_ES = 'Listo, el pedido está completo. Todo verificado y empacado.';

const EnvSchema = z.object({
  apiKey: z.string().min(1),
  modelId: z.string().min(1),
  voiceId: z.string().min(1),
});

export async function runTts(): Promise<SpikeResult> {
  const missing = missingEnv([
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_MODEL_ID',
    'ELEVENLABS_VOICE_ID_ES',
  ]);
  if (missing.length > 0) {
    return printSkipped(SPIKE, `${SPIKE}: missing env key(s): ${missing.join(', ')}`);
  }
  const env = EnvSchema.parse({
    apiKey: getEnv('ELEVENLABS_API_KEY'),
    modelId: getEnv('ELEVENLABS_MODEL_ID'),
    voiceId: getEnv('ELEVENLABS_VOICE_ID_ES'),
  });

  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${env.voiceId}/stream`;
  const started = Date.now();
  let status: number | null = null;
  let timeToFirstByte: number | null = null;
  const chunks: Buffer[] = [];
  let errorNote = '';
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': env.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({ text: TEXT_ES, model_id: env.modelId }),
    });
    status = response.status;
    if (response.body === null || status < 200 || status >= 300) {
      errorNote = await response.text();
    } else {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (timeToFirstByte === null) timeToFirstByte = Date.now() - started;
        chunks.push(Buffer.from(value));
      }
    }
  } catch (error: unknown) {
    errorNote = error instanceof Error ? `fetch-error: ${error.message}` : 'fetch-error';
  }
  const totalMs = Date.now() - started;
  const audio = Buffer.concat(chunks);
  appendCall({
    ts: new Date().toISOString(),
    spike: SPIKE,
    model: env.modelId,
    endpoint,
    method: 'POST',
    httpStatus: status,
    latencyMs: totalMs,
    ...(timeToFirstByte !== null ? { usage: { timeToFirstByteMs: timeToFirstByte } } : {}),
    note: `bytes=${String(audio.length)} chars=${String(TEXT_ES.length)}`,
  });

  if (audio.length === 0) {
    logInfo(`${SPIKE}: HTTP ${String(status)} failed: ${errorNote.slice(0, 200)}`);
    return { spike: SPIKE, status: 'error', detail: `no audio: HTTP ${String(status)}` };
  }
  const outDir = join(FIXTURES_DIR, 'tts');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'sample-es.mp3');
  writeFileSync(outPath, audio);
  const detail = `ttfb=${String(timeToFirstByte)}ms total=${String(totalMs)}ms bytes=${String(audio.length)}`;
  logInfo(`${SPIKE}: ${detail} -> spikes/fixtures/tts/sample-es.mp3`);
  return { spike: SPIKE, status: 'ok', detail };
}

if (isDirectRun(import.meta.url)) {
  await runTts();
}
