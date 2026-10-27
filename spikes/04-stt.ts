/**
 * Spike 4 — transcribe `es-10s.wav` with `muse-voice-transcribe-1.0`.
 *
 * Tries the realtime WebSocket (`wss://…/v1/asr/realtime`, PCM16 mono
 * 16 kHz chunks) and the file endpoint (`POST /v1/asr/transcribe`).
 * Records handshake, auth, message shapes, end-of-utterance behavior,
 * language detection, latencies, and the word error rate against the
 * reference transcript from the task brief.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { z } from 'zod';
import { getEnv, missingEnv, REPO_ROOT } from './lib/env.js';
import { excerpt } from './lib/http.js';
import { appendCall, FIXTURES_DIR, logInfo } from './lib/log.js';
import { isDirectRun, printSkipped } from './lib/run.js';
import type { SpikeResult } from './lib/run.js';
import { wordErrorRate } from './lib/wer.js';

const SPIKE = '04-stt';
const REFERENCE_TEXT =
  'Listo, ya metí las dos bandejas de pollo y una de arroz. ' +
  'Me faltan los tenedores y cuatro vasos. ¿Cuántas ensaladas lleva este pedido?';

const EnvSchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

interface AudioFormat {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  audioFormatTag: number;
  durationSec: number;
}

/** Read the WAV header, walking chunks (handles JUNK + WAVE_FORMAT_EXTENSIBLE). */
function readWavFormat(buffer: Buffer): AudioFormat | null {
  if (buffer.length < 44 || buffer.subarray(0, 4).toString() !== 'RIFF') return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const audioFormatTag = view.getUint16(20, true);
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const tag = buffer.subarray(offset, offset + 4).toString();
    const size = view.getUint32(offset + 4, true);
    if (tag === 'data') {
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  const bytesPerSec = (sampleRate * channels * bitsPerSample) / 8;
  return {
    channels,
    sampleRate,
    bitsPerSample,
    audioFormatTag,
    durationSec: bytesPerSec > 0 ? dataSize / bytesPerSec : 0,
  };
}

/** Locate the `data` chunk payload (PCM bytes) by walking RIFF chunks. */
function findPcmData(buffer: Buffer): { pcm: Buffer; offset: number } | null {
  if (buffer.length < 44 || buffer.subarray(0, 4).toString() !== 'RIFF') return null;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const tag = buffer.subarray(offset, offset + 4).toString();
    const size = view.getUint32(offset + 4, true);
    if (tag === 'data') {
      return { pcm: buffer.subarray(offset + 8, offset + 8 + size), offset: offset + 8 };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

/**
 * Rebuild a canonical 44-byte-header WAV (standard PCM tag) from any WAV.
 * Pure-Node so the spike does not need ffmpeg for this input.
 */
function buildCanonicalWav(buffer: Buffer): Buffer {
  const found = findPcmData(buffer);
  const format = readWavFormat(buffer);
  const pcm = found?.pcm ?? buffer.subarray(44);
  const channels = format?.channels ?? 1;
  const sampleRate = format?.sampleRate ?? 16000;
  const bitsPerSample = format?.bitsPerSample ?? 16;
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(sampleRate, 24);
  head.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28);
  head.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  head.writeUInt16LE(bitsPerSample, 34);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/** True when `ffmpeg` is on PATH (used only for conversion if needed). */
function ffmpegAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], (error) => {
      resolve(error === null);
    });
  });
}

/** Render a `ws` message payload as UTF-8 text. */
function rawDataToString(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data;
  if (data instanceof Buffer) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

interface SeenMessage {
  atMs: number;
  excerpt: string;
}

interface RealtimeOutcome {
  connected: boolean;
  handshakeMs: number | null;
  sentChunks: number;
  eosSignal: string;
  seen: SeenMessage[];
  firstPartialMs: number | null;
  finalMs: number | null;
  transcript: string | null;
  detectedLanguage: string | null;
  error: string | null;
}

/** Pull a transcript-ish string and a language hint out of any JSON message. */
function getStringField(record: Record<string, unknown>, key: string): string | null {
  const value: unknown = record[key];
  return typeof value === 'string' ? value : null;
}

function extractTranscript(message: unknown): {
  text: string | null;
  language: string | null;
  isFinal: boolean;
} {
  if (typeof message === 'string') return { text: message, language: null, isFinal: false };
  if (typeof message !== 'object' || message === null) {
    return { text: null, language: null, isFinal: false };
  }
  const record: Record<string, unknown> = { ...message };
  let text: string | null = null;
  for (const key of ['transcript', 'text', 'hypothesis']) {
    const candidate = getStringField(record, key);
    if (candidate !== null) {
      text = candidate;
      break;
    }
  }
  const language =
    getStringField(record, 'language') ?? getStringField(record, 'detected_language');
  const type = getStringField(record, 'type') ?? '';
  const isFinal = type.includes('final') || record['is_final'] === true || record['final'] === true;
  return { text, language, isFinal };
}

/** Stream PCM chunks over the realtime socket and record everything. */
function tryRealtime(url: string, apiKey: string, pcm: Buffer): Promise<RealtimeOutcome> {
  return new Promise((resolve) => {
    const outcome: RealtimeOutcome = {
      connected: false,
      handshakeMs: null,
      sentChunks: 0,
      eosSignal: 'json {type:end_of_stream} + socket close (write end)',
      seen: [],
      firstPartialMs: null,
      finalMs: null,
      transcript: null,
      detectedLanguage: null,
      error: null,
    };
    const started = Date.now();
    const atMs = (): number => Date.now() - started;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    } catch (error: unknown) {
      outcome.error = error instanceof Error ? error.message : String(error);
      resolve(outcome);
      return;
    }

    const finals: string[] = [];
    const finish = (): void => {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      const lastFinal = finals[finals.length - 1];
      resolve({ ...outcome, transcript: lastFinal ?? outcome.transcript });
    };

    const overall = setTimeout(finish, 45_000);
    let firstChunkAt = 0;

    socket.on('open', () => {
      outcome.connected = true;
      outcome.handshakeMs = atMs();
      logInfo(`${SPIKE}: realtime socket open in ${String(outcome.handshakeMs)}ms`);
      // 20 ms PCM16 mono 16 kHz frames (640 bytes), paced in real time.
      const CHUNK = 640;
      let offset = 0;
      firstChunkAt = Date.now();
      const timer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          clearInterval(timer);
          return;
        }
        if (offset >= pcm.length) {
          clearInterval(timer);
          try {
            socket.send(JSON.stringify({ type: 'end_of_stream' }));
          } catch {
            // Server may not accept text frames; the close below still ends it.
          }
          setTimeout(finish, 8_000);
          return;
        }
        const chunk = pcm.subarray(offset, offset + CHUNK);
        offset += chunk.length;
        outcome.sentChunks += 1;
        socket.send(chunk);
      }, 20);
    });

    socket.on('message', (data) => {
      const raw = rawDataToString(data);
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Binary or plain-text frame: keep as-is.
      }
      const { text, language, isFinal } = extractTranscript(parsed);
      if (outcome.seen.length < 20) outcome.seen.push({ atMs: atMs(), excerpt: excerpt(raw, 300) });
      if (text !== null && text !== '') {
        if (outcome.firstPartialMs === null) outcome.firstPartialMs = Date.now() - firstChunkAt;
        if (isFinal) {
          outcome.finalMs = Date.now() - firstChunkAt;
          finals.push(text);
          outcome.transcript = text;
        } else if (outcome.transcript === null) {
          outcome.transcript = text;
        }
        if (language !== null) outcome.detectedLanguage = language;
      } else if (language !== null && outcome.detectedLanguage === null) {
        outcome.detectedLanguage = language;
      }
    });

    socket.on('error', (error) => {
      outcome.error = error.message;
      clearTimeout(overall);
      finish();
    });
    socket.on('close', (code, reason) => {
      logInfo(
        `${SPIKE}: realtime socket closed code=${String(code)} reason=${reason.toString('utf8').slice(0, 120)}`,
      );
      clearTimeout(overall);
      finish();
    });
  });
}

interface FileOutcome {
  httpStatus: number | null;
  latencyMs: number;
  transcript: string | null;
  detectedLanguage: string | null;
  excerpt: string;
}

export async function runStt(): Promise<SpikeResult> {
  const inputsDir = join(REPO_ROOT, 'spikes', 'inputs');
  const wavPath = join(inputsDir, 'es-10s.wav');
  if (!existsSync(wavPath)) {
    return printSkipped(SPIKE, `${SPIKE}: missing input spikes/inputs/es-10s.wav`);
  }
  const missing = missingEnv(['META_API_KEY']);
  if (missing.length > 0) {
    return printSkipped(SPIKE, `${SPIKE}: missing env key(s): ${missing.join(', ')}`);
  }
  const env = EnvSchema.parse({
    baseUrl: getEnv('META_API_BASE_URL') ?? 'https://api.meta.ai/v1',
    apiKey: getEnv('META_API_KEY'),
    model: getEnv('STT_MODEL') ?? 'muse-voice-transcribe-1.0',
  });

  const wav = readFileSync(wavPath);
  const format = readWavFormat(wav);
  const hasFfmpeg = await ffmpegAvailable();
  const formatNote =
    format === null
      ? 'unknown'
      : `${String(format.channels)}ch ${String(format.sampleRate)}Hz ${String(format.bitsPerSample)}bit tag=${String(format.audioFormatTag)} ~${format.durationSec.toFixed(1)}s`;
  logInfo(
    `${SPIKE}: wav ${String(wav.length)} bytes format=${formatNote} ffmpeg=${String(hasFfmpeg)}`,
  );
  const needsConversion =
    format === null ||
    format.channels !== 1 ||
    format.sampleRate !== 16000 ||
    format.bitsPerSample !== 16;
  if (needsConversion && !hasFfmpeg) {
    logInfo(
      `${SPIKE}: audio needs conversion but ffmpeg is unavailable; sending as-is and recording the result`,
    );
  }
  // The socket gets raw PCM16 frames (header located by chunk walk).
  const pcm = findPcmData(wav)?.pcm ?? wav.subarray(44);
  logInfo(`${SPIKE}: pcm bytes=${String(pcm.length)} (socket streams these)`);

  // --- Realtime -------------------------------------------------------------
  const wsBase = env.baseUrl.replace(/^http/, 'ws').replace(/\/$/, '');
  const realtimeUrl = wsBase.endsWith('/asr/realtime') ? wsBase : `${wsBase}/asr/realtime`;
  const realtimeStarted = Date.now();
  const realtime = await tryRealtime(realtimeUrl, env.apiKey, pcm);
  appendCall({
    ts: new Date().toISOString(),
    spike: SPIKE,
    model: env.model,
    endpoint: realtimeUrl,
    method: 'WS',
    httpStatus: realtime.connected ? 101 : null,
    latencyMs: Date.now() - realtimeStarted,
    note: `connected=${String(realtime.connected)} chunks=${String(realtime.sentChunks)}`,
  });
  logInfo(
    `${SPIKE}: realtime connected=${String(realtime.connected)} ` +
      `firstPartialMs=${String(realtime.firstPartialMs)} finalMs=${String(realtime.finalMs)} ` +
      `lang=${realtime.detectedLanguage ?? 'n/a'} error=${realtime.error ?? 'none'}`,
  );

  // --- File endpoint ----------------------------------------------------------
  // The server's own 400-errors guided the shape: parts must be named
  // `request` (JSON) + `audio` (binary), and `request` must carry
  // camelCase `audioEncoding`. Every attempt is logged separately.
  const fileUrl = env.baseUrl.endsWith('/v1')
    ? `${env.baseUrl}/asr/transcribe`
    : `${env.baseUrl}/v1/asr/transcribe`;
  const canonicalWav = buildCanonicalWav(wav);
  const fileAttempts: Array<{
    name: string;
    requestJson: Record<string, unknown>;
    audio: Buffer;
    audioMime: string;
    audioName: string;
  }> = [
    {
      name: 'naive file+model+language',
      requestJson: {},
      audio: wav,
      audioMime: 'audio/wav',
      audioName: 'es-10s.wav',
    },
    {
      name: 'request+audio original-wav',
      requestJson: {
        model: env.model,
        language: 'es',
        audioEncoding: 'LINEAR16',
        sampleRateHertz: 16000,
      },
      audio: wav,
      audioMime: 'audio/wav',
      audioName: 'es-10s.wav',
    },
    {
      name: 'request+audio canonical-wav',
      requestJson: { language: 'es', audioEncoding: 'LINEAR16', sampleRateHertz: 16000 },
      audio: canonicalWav,
      audioMime: 'audio/wav',
      audioName: 'es-10s.wav',
    },
  ];
  const fileOutcome: FileOutcome = {
    httpStatus: null,
    latencyMs: 0,
    transcript: null,
    detectedLanguage: null,
    excerpt: '',
  };
  for (const attempt of fileAttempts) {
    const fileStarted = Date.now();
    let bodyText = '';
    let status: number | null = null;
    try {
      const form = new FormData();
      if (attempt.name === 'naive file+model+language') {
        form.append(
          'file',
          new Blob([attempt.audio], { type: attempt.audioMime }),
          attempt.audioName,
        );
        form.append('model', env.model);
        form.append('language', 'es');
      } else {
        form.append(
          'request',
          new Blob([JSON.stringify(attempt.requestJson)], { type: 'application/json' }),
          'request.json',
        );
        form.append(
          'audio',
          new Blob([attempt.audio], { type: attempt.audioMime }),
          attempt.audioName,
        );
      }
      const response = await fetch(fileUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.apiKey}` },
        body: form,
      });
      bodyText = await response.text();
      status = response.status;
    } catch (error: unknown) {
      bodyText = error instanceof Error ? `fetch-error: ${error.message}` : 'fetch-error';
    }
    const attemptLatency = Date.now() - fileStarted;
    appendCall({
      ts: new Date().toISOString(),
      spike: SPIKE,
      model: env.model,
      endpoint: fileUrl,
      method: 'POST',
      httpStatus: status,
      latencyMs: attemptLatency,
      note: `multipart ${attempt.name}`,
    });
    logInfo(
      `${SPIKE}: file ${attempt.name} HTTP ${String(status)} in ${String(attemptLatency)}ms: ${excerpt(bodyText, 220)}`,
    );
    if (status !== null && status >= 200 && status < 300) {
      fileOutcome.httpStatus = status;
      fileOutcome.latencyMs = attemptLatency;
      fileOutcome.excerpt = excerpt(bodyText, 600);
      try {
        const { text, language } = extractTranscript(JSON.parse(bodyText));
        fileOutcome.transcript = text;
        fileOutcome.detectedLanguage = language;
      } catch {
        fileOutcome.transcript = null;
      }
      break;
    }
    fileOutcome.httpStatus = status;
    fileOutcome.latencyMs = attemptLatency;
    fileOutcome.excerpt = excerpt(bodyText, 600);
  }

  // --- WER ----------------------------------------------------------------------
  const best = fileOutcome.transcript ?? realtime.transcript ?? '';
  const wer = wordErrorRate(REFERENCE_TEXT, best);
  logInfo(
    `${SPIKE}: transcript=${JSON.stringify(best.slice(0, 200))} ` +
      `WER=${wer.wer.toFixed(3)} (${String(wer.errors)}/${String(wer.referenceWords)} words)`,
  );

  const outDir = join(FIXTURES_DIR, 'stt');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'result.json'),
    JSON.stringify(
      {
        model: env.model,
        realtimeUrl,
        fileUrl,
        audioFormat: format,
        ffmpegAvailable: hasFfmpeg,
        realtime: { ...realtime, seen: realtime.seen },
        file: fileOutcome,
        referenceText: REFERENCE_TEXT,
        wer,
      },
      null,
      2,
    ),
    'utf8',
  );

  if (best === '') {
    return {
      spike: SPIKE,
      status: 'error',
      detail: 'no transcript from realtime or file endpoint',
    };
  }
  return {
    spike: SPIKE,
    status: 'ok',
    detail: `WER=${wer.wer.toFixed(3)} transcript=${JSON.stringify(best.slice(0, 120))}`,
  };
}

if (isDirectRun(import.meta.url)) {
  await runStt();
}
