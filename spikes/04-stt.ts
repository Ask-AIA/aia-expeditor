/**
 * Spike 4 — transcribe `es-10s.wav` with `muse-voice-transcribe-1.0`.
 *
 * Uses the realtime WebSocket (`wss://…/v1/asr/realtime`) with the protocol
 * confirmed by a manual run on 2026-10-26: the first client frame is text
 * JSON carrying the access token, audio starts only after the server replies
 * `{sessionId}`, audio is raw PCM16 mono 24 kHz in 4,800-byte (100 ms)
 * binary frames paced in real time, and the stream ends with the text frame
 * `{"type":"endStream"}` (server then closes `1000 "No more transcript
 * segments"`). Runs twice — with and without `languageBias`/`keywords` —
 * and reports the WER of each against the reference text.
 *
 * The file endpoint (`POST /v1/asr/transcribe`) is kept as one attempt but
 * marked "not needed: realtime works".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import WebSocket from 'ws';
import { z } from 'zod';
import { getEnv, missingEnv, REPO_ROOT } from './lib/env.js';
import { excerpt } from './lib/http.js';
import { appendCall, FIXTURES_DIR, logInfo } from './lib/log.js';
import { isDirectRun, printSkipped } from './lib/run.js';
import type { SpikeResult } from './lib/run.js';
import { wordErrorRate } from './lib/wer.js';
import type { WerResult } from './lib/wer.js';

const SPIKE = '04-stt';
const REFERENCE_TEXT =
  'Listo, ya metí las dos bandejas de pollo y una de arroz. ' +
  'Me faltan los tenedores y cuatro vasos. ¿Cuántas ensaladas lleva este pedido?';

/** Keywords for the biased run: catalog item names from the reference text. */
const KEYWORDS = ['bandejas', 'tenedores', 'vasos', 'ensaladas'];

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
 * Resample PCM16 mono from 16 kHz to 24 kHz with linear interpolation.
 * Good enough for the spike; the server requires 24 kHz input.
 */
function resample16kTo24k(pcm16k: Buffer): Buffer {
  const inSamples = Math.floor(pcm16k.length / 2);
  if (inSamples === 0) return Buffer.alloc(0);
  const view = new DataView(pcm16k.buffer, pcm16k.byteOffset, inSamples * 2);
  const outSamples = Math.round((inSamples * 24000) / 16000);
  const out = Buffer.alloc(outSamples * 2);
  const outView = new DataView(out.buffer, out.byteOffset, out.length);
  for (let i = 0; i < outSamples; i += 1) {
    const pos = (i * 16000) / 24000;
    const j = Math.floor(pos);
    const frac = pos - j;
    const s0 = view.getInt16(Math.min(j, inSamples - 1) * 2, true);
    const s1 = view.getInt16(Math.min(j + 1, inSamples - 1) * 2, true);
    outView.setInt16(i * 2, Math.round(s0 + (s1 - s0) * frac), true);
  }
  return out;
}

/**
 * Rebuild a canonical 44-byte-header WAV (standard PCM tag) from any WAV.
 * Pure-Node so the spike does not need ffmpeg for this input. Used only by
 * the retained (not needed) file-endpoint attempt.
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

/**
 * Proxy agent for sandbox runs: raw DNS is blocked here while `fetch`
 * works, so the `ws` client must go through the proxy when one is set.
 * Outside the sandbox (no proxy env) the connection stays direct.
 */
function buildProxyAgent(): HttpsProxyAgent<string> | undefined {
  const proxy = process.env['HTTPS_PROXY'] ?? process.env['https_proxy'];
  if (proxy === undefined || proxy.trim() === '') return undefined;
  return new HttpsProxyAgent(proxy);
}

/** Render a `ws` message payload as UTF-8 text. */
function rawDataToString(data: WebSocket.RawData): string {
  if (typeof data === 'string') return data;
  if (data instanceof Buffer) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

/** The first client frame: handshake JSON carrying the access token. */
function buildHandshake(input: {
  apiKey: string;
  model: string;
  languageBias: readonly string[];
  keywords: readonly string[];
}): string {
  return JSON.stringify({
    mode: 'ENDPOINTING',
    authorization: { accessToken: input.apiKey },
    audioEncoding: 'PCM_24KHZ',
    model: input.model,
    partialMode: 'CUMULATIVE',
    emitAudioProgress: false,
    languageBias: [...input.languageBias],
    keywords: [...input.keywords],
  });
}

/** `{sessionId}` reply that opens the audio gate (before any event). */
const SessionReplySchema = z.object({ sessionId: z.string() }).passthrough();

/** Server events after the handshake (`speechStart`, `transcript`, …). */
const RealtimeEventSchema = z
  .object({
    type: z.string(),
    // `turnId` arrives as a number (observed `0`); accept either shape.
    turnId: z.union([z.string(), z.number()]).optional(),
    transcript: z.string().optional(),
    final: z.boolean().optional(),
    audioProcessedMs: z.number().optional(),
  })
  .passthrough();

interface SeenMessage {
  atMs: number;
  excerpt: string;
}

interface RealtimeOutcome {
  label: string;
  connected: boolean;
  handshakeMs: number | null;
  sessionId: string | null;
  sentChunks: number;
  audioBytes: number;
  seen: SeenMessage[];
  partialCount: number;
  firstPartialMs: number | null;
  speechCompleteMs: number | null;
  closeMs: number | null;
  closeCode: number | null;
  closeReason: string;
  transcript: string | null;
  error: string | null;
}

interface RunConfig {
  label: string;
  languageBias: readonly string[];
  keywords: readonly string[];
}

interface RunReport extends RealtimeOutcome {
  languageBias: string[];
  keywords: string[];
  wer: WerResult;
}

/**
 * One realtime run: handshake, wait for `{sessionId}`, stream 4,800-byte
 * (100 ms) PCM16 24 kHz frames paced in real time, end with
 * `{"type":"endStream"}`, and record everything until the server closes.
 */
function tryRealtime(input: {
  url: string;
  apiKey: string;
  model: string;
  pcm24k: Buffer;
  config: RunConfig;
}): Promise<RealtimeOutcome> {
  const CHUNK = 4800;
  const PACED_MS = 100;
  return new Promise((resolve) => {
    const outcome: RealtimeOutcome = {
      label: input.config.label,
      connected: false,
      handshakeMs: null,
      sessionId: null,
      sentChunks: 0,
      audioBytes: input.pcm24k.length,
      seen: [],
      partialCount: 0,
      firstPartialMs: null,
      speechCompleteMs: null,
      closeMs: null,
      closeCode: null,
      closeReason: '',
      transcript: null,
      error: null,
    };
    const started = Date.now();
    const atMs = (): number => Date.now() - started;
    let agent: HttpsProxyAgent<string> | undefined;
    try {
      agent = buildProxyAgent();
    } catch (error: unknown) {
      outcome.error = error instanceof Error ? error.message : String(error);
      resolve(outcome);
      return;
    }
    let socket: WebSocket;
    try {
      socket = agent === undefined ? new WebSocket(input.url) : new WebSocket(input.url, { agent });
    } catch (error: unknown) {
      outcome.error = error instanceof Error ? error.message : String(error);
      resolve(outcome);
      return;
    }

    let settled = false;
    let audioStartedAt = 0;
    let sessionSeen = false;
    let pacing: NodeJS.Timeout | undefined;
    let closeWait: NodeJS.Timeout | undefined;
    const overall = setTimeout(() => {
      finish();
    }, 90_000);
    if (typeof overall.unref === 'function') overall.unref();

    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (pacing !== undefined) clearInterval(pacing);
      if (closeWait !== undefined) clearTimeout(closeWait);
      clearTimeout(overall);
      try {
        // Terminate (not close): a dead socket can sit in CLOSING forever
        // and keep the spike process alive; on a clean server close this
        // is a no-op.
        socket.terminate();
      } catch {
        // Already closed.
      }
      resolve(outcome);
    };

    /** Start pacing audio frames; called once `{sessionId}` arrives. */
    const startAudio = (sessionId: string): void => {
      if (sessionSeen) return;
      sessionSeen = true;
      outcome.sessionId = sessionId;
      outcome.handshakeMs = atMs();
      logInfo(`${SPIKE}: [${input.config.label}] session in ${String(outcome.handshakeMs)}ms`);
      let offset = 0;
      let first = true;
      pacing = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) {
          if (pacing !== undefined) clearInterval(pacing);
          return;
        }
        if (first) {
          first = false;
          audioStartedAt = Date.now();
        }
        if (offset >= input.pcm24k.length) {
          if (pacing !== undefined) clearInterval(pacing);
          try {
            socket.send(JSON.stringify({ type: 'endStream' }));
          } catch {
            // Send failure surfaces as socket error/close below.
          }
          closeWait = setTimeout(() => {
            finish();
          }, 15_000);
          if (typeof closeWait.unref === 'function') closeWait.unref();
          return;
        }
        const chunk = input.pcm24k.subarray(offset, offset + CHUNK);
        offset += chunk.length;
        outcome.sentChunks += 1;
        socket.send(chunk);
      }, PACED_MS);
    };

    socket.on('open', () => {
      outcome.connected = true;
      try {
        socket.send(
          buildHandshake({
            apiKey: input.apiKey,
            model: input.model,
            languageBias: input.config.languageBias,
            keywords: input.config.keywords,
          }),
        );
      } catch (error: unknown) {
        outcome.error = error instanceof Error ? error.message : String(error);
        finish();
      }
    });

    socket.on('message', (data) => {
      const raw = rawDataToString(data);
      if (outcome.seen.length < 30) outcome.seen.push({ atMs: atMs(), excerpt: excerpt(raw, 300) });
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return;
      }
      if (!sessionSeen) {
        const session = SessionReplySchema.safeParse(parsed);
        if (session.success) {
          startAudio(session.data.sessionId);
          return;
        }
        const maybeError = RealtimeEventSchema.safeParse(parsed);
        if (maybeError.success && maybeError.data.type === 'error') {
          outcome.error = `handshake failed: ${excerpt(raw, 300)}`;
          finish();
        }
        return;
      }
      const event = RealtimeEventSchema.safeParse(parsed);
      if (!event.success) return;
      const text = event.data.transcript ?? '';
      switch (event.data.type) {
        case 'speechStart':
        case 'speechEnd':
        case 'audioProgress':
          break;
        case 'transcript': {
          if (text !== '') {
            outcome.partialCount += 1;
            if (outcome.firstPartialMs === null && audioStartedAt > 0) {
              outcome.firstPartialMs = Date.now() - audioStartedAt;
            }
            // CUMULATIVE partials grow: the latest non-empty one is the
            // best running hypothesis (`final:true` arrives with empty
            // text and is ignored here).
            if (event.data.final !== true) outcome.transcript = text;
          }
          break;
        }
        case 'speechComplete': {
          if (text !== '') outcome.transcript = text;
          if (audioStartedAt > 0) outcome.speechCompleteMs = Date.now() - audioStartedAt;
          break;
        }
        case 'error': {
          outcome.error = excerpt(raw, 300);
          break;
        }
        default:
          break;
      }
    });

    socket.on('error', (error) => {
      if (outcome.error === null) outcome.error = error.message;
      finish();
    });
    socket.on('close', (code, reason) => {
      outcome.closeCode = code;
      outcome.closeReason = reason.toString('utf8').slice(0, 120);
      if (audioStartedAt > 0) outcome.closeMs = Date.now() - audioStartedAt;
      logInfo(
        `${SPIKE}: [${input.config.label}] socket closed code=${String(code)} ` +
          `reason=${outcome.closeReason}`,
      );
      finish();
    });
  });
}

interface FileOutcome {
  httpStatus: number | null;
  latencyMs: number;
  transcript: string | null;
  excerpt: string;
  note: string;
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
  const formatNote =
    format === null
      ? 'unknown'
      : `${String(format.channels)}ch ${String(format.sampleRate)}Hz ${String(format.bitsPerSample)}bit tag=${String(format.audioFormatTag)} ~${format.durationSec.toFixed(1)}s`;
  logInfo(`${SPIKE}: wav ${String(wav.length)} bytes format=${formatNote}`);
  // The socket needs raw PCM16 mono 24 kHz: strip the WAV header (chunk
  // walk) and resample the 16 kHz input in Node (linear interpolation).
  const pcm16k = findPcmData(wav)?.pcm ?? wav.subarray(44);
  const pcm24k = resample16kTo24k(pcm16k);
  logInfo(
    `${SPIKE}: pcm16k bytes=${String(pcm16k.length)} -> pcm24k bytes=${String(pcm24k.length)} ` +
      `(${(pcm24k.length / 4800).toFixed(1)} x 100ms frames)`,
  );

  // --- Realtime (confirmed protocol): twice ---------------------------------
  const realtimeUrl = 'wss://api.meta.ai/v1/asr/realtime';
  const configs: readonly RunConfig[] = [
    { label: 'no-bias', languageBias: [], keywords: [] },
    { label: 'es-bias', languageBias: ['es'], keywords: KEYWORDS },
  ];
  const runs: RunReport[] = [];
  for (const config of configs) {
    const runStarted = Date.now();
    const realtime = await tryRealtime({
      url: realtimeUrl,
      apiKey: env.apiKey,
      model: env.model,
      pcm24k,
      config,
    });
    const wer = wordErrorRate(REFERENCE_TEXT, realtime.transcript ?? '');
    runs.push({
      ...realtime,
      languageBias: [...config.languageBias],
      keywords: [...config.keywords],
      wer,
    });
    appendCall({
      ts: new Date().toISOString(),
      spike: SPIKE,
      model: env.model,
      endpoint: realtimeUrl,
      method: 'WS',
      httpStatus: realtime.connected ? 101 : null,
      latencyMs: Date.now() - runStarted,
      note:
        `realtime ${config.label} connected=${String(realtime.connected)} ` +
        `chunks=${String(realtime.sentChunks)} partials=${String(realtime.partialCount)} ` +
        `firstPartialMs=${String(realtime.firstPartialMs)} ` +
        `speechCompleteMs=${String(realtime.speechCompleteMs)} closeMs=${String(realtime.closeMs)} ` +
        `close=${String(realtime.closeCode)}`,
    });
    logInfo(
      `${SPIKE}: [${config.label}] connected=${String(realtime.connected)} ` +
        `firstPartialMs=${String(realtime.firstPartialMs)} ` +
        `speechCompleteMs=${String(realtime.speechCompleteMs)} closeMs=${String(realtime.closeMs)} ` +
        `WER=${wer.wer.toFixed(3)} (${String(wer.errors)}/${String(wer.referenceWords)} words) ` +
        `transcript=${JSON.stringify((realtime.transcript ?? '').slice(0, 160))} ` +
        `error=${realtime.error ?? 'none'}`,
    );
  }

  // --- File endpoint: not needed (realtime works) ----------------------------
  // Kept as one attempt for the record only.
  const fileUrl = env.baseUrl.endsWith('/v1')
    ? `${env.baseUrl}/asr/transcribe`
    : `${env.baseUrl}/v1/asr/transcribe`;
  const fileOutcome: FileOutcome = {
    httpStatus: null,
    latencyMs: 0,
    transcript: null,
    excerpt: '',
    note: 'not needed: realtime works',
  };
  {
    const fileStarted = Date.now();
    let bodyText = '';
    let status: number | null = null;
    try {
      const form = new FormData();
      form.append(
        'request',
        new Blob(
          [
            JSON.stringify({
              model: env.model,
              language: 'es',
              audioEncoding: 'LINEAR16',
              sampleRateHertz: 16000,
            }),
          ],
          { type: 'application/json' },
        ),
        'request.json',
      );
      form.append('audio', new Blob([buildCanonicalWav(wav)], { type: 'audio/wav' }), 'es-10s.wav');
      const response = await fetch(fileUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
      bodyText = await response.text();
      status = response.status;
    } catch (error: unknown) {
      bodyText = error instanceof Error ? `fetch-error: ${error.message}` : 'fetch-error';
    }
    fileOutcome.httpStatus = status;
    fileOutcome.latencyMs = Date.now() - fileStarted;
    fileOutcome.excerpt = excerpt(bodyText, 600);
    appendCall({
      ts: new Date().toISOString(),
      spike: SPIKE,
      model: env.model,
      endpoint: fileUrl,
      method: 'POST',
      httpStatus: status,
      latencyMs: fileOutcome.latencyMs,
      note: 'file request+audio canonical-wav (not needed: realtime works)',
    });
    logInfo(
      `${SPIKE}: file HTTP ${String(status)} in ${String(fileOutcome.latencyMs)}ms: ${excerpt(bodyText, 220)}`,
    );
  }

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
        resampledToHz: 24000,
        frameBytes: 4800,
        referenceText: REFERENCE_TEXT,
        runs,
        file: fileOutcome,
      },
      null,
      2,
    ),
    'utf8',
  );

  const okRuns = runs.filter((run) => (run.transcript ?? '') !== '');
  if (okRuns.length === 0) {
    return {
      spike: SPIKE,
      status: 'error',
      detail: 'no transcript from realtime runs or file endpoint',
    };
  }
  const summary = runs
    .map(
      (run) =>
        `${run.label} WER=${run.wer.wer.toFixed(3)} ` +
        `(${String(run.wer.errors)}/${String(run.wer.referenceWords)})`,
    )
    .join(' | ');
  return { spike: SPIKE, status: 'ok', detail: summary };
}

if (isDirectRun(import.meta.url)) {
  await runStt();
}
