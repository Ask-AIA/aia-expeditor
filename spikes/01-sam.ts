/**
 * Spike 1 — SAM 3.1 via `POST /v1/responses`.
 *
 * For each packing-table photo and each concept (`cup`, `plate`, `fork`,
 * `aluminum tray`): stream the response, save it verbatim, parse the
 * `<Nf>id<|box…|><|mask…|>` grammar, and compare counts with
 * `spikes/inputs/ground-truth.json`.
 *
 * `mask_encoding` `one_bit` and `lossless` (plus `include_confidence`) are
 * tried on photo 01; the other photos use `one_bit` + confidence.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { getEnv, missingEnv, REPO_ROOT } from './lib/env.js';
import { excerpt, loggedFetch } from './lib/http.js';
import { appendCall, FIXTURES_DIR, logInfo } from './lib/log.js';
import { isDirectRun, printSkipped } from './lib/run.js';
import type { SpikeResult } from './lib/run.js';
import {
  closestAlphabet,
  decodeBase85,
  expectedBytes,
  parseSamOutput,
  payloadAlphabet,
  REFERENCE_ALPHABETS,
} from './lib/sam.js';

const SPIKE = '01-sam';
const PHOTOS = ['01', '02', '03', '04', '05'];
const CONCEPTS = ['cup', 'plate', 'fork', 'aluminum tray'] as const;
const GROUND_TRUTH_CONCEPTS = ['cup', 'plate', 'fork', 'aluminum tray'] as const;

const EnvSchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

const SseEventSchema = z.object({ type: z.string() }).passthrough();

const GroundTruthSchema = z
  .object({
    tables: z.record(
      z
        .object({
          cup: z.number().optional(),
          plate: z.number().optional(),
          fork: z.number().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

interface SentImage {
  dataUrl: string;
  sentWidth: number;
  sentHeight: number;
  sentBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  downscaled: boolean;
}

/** Read a photo, downscale the long side to 1500px when larger, JPEG it. */
async function prepareImage(photoPath: string): Promise<SentImage> {
  const pipeline = sharp(photoPath);
  const metadata = await pipeline.metadata();
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  const longest = Math.max(sourceWidth, sourceHeight);
  const downscaled = longest > 1500;
  const resized = downscaled
    ? pipeline.resize({ width: 1500, height: 1500, fit: 'inside' })
    : pipeline;
  const buffer = await resized.jpeg({ quality: 85 }).toBuffer();
  const outMeta = await sharp(buffer).metadata();
  return {
    dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
    sentWidth: outMeta.width,
    sentHeight: outMeta.height,
    sentBytes: buffer.length,
    sourceWidth,
    sourceHeight,
    downscaled,
  };
}

/** Collect streamed `output_text` deltas from a `stream: true` SSE body. */
function extractOutputText(sseBody: string): {
  text: string;
  eventTypes: string[];
  excerpts: string[];
} {
  const eventTypes: string[] = [];
  const excerpts: string[] = [];
  const chunks: string[] = [];
  for (const line of sseBody.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    if (payload === '[DONE]') continue;
    try {
      const event = SseEventSchema.parse(JSON.parse(payload));
      if (!eventTypes.includes(event.type)) eventTypes.push(event.type);
      if (excerpts.length < 3) excerpts.push(excerpt(payload, 300));
      if (event.type !== 'response.output_text.delta') continue;
      // NOTE: response.output_text.done repeats the full text in `text`;
      // including it double-counts every object (found empirically).
      const record = JSON.parse(payload) as Record<string, unknown>;
      const delta = record['delta'];
      if (typeof delta === 'string') {
        chunks.push(delta);
      }
    } catch {
      // Non-JSON heartbeat: keep the raw line shape as evidence.
      if (excerpts.length < 3) excerpts.push(excerpt(trimmed, 200));
    }
  }
  return { text: chunks.join(''), eventTypes, excerpts };
}

interface ComboResult {
  photo: string;
  concept: string;
  encoding: string;
  httpStatus: number | null;
  latencyMs: number;
  count: number;
  rawChars: number;
  eventTypes: string[];
}

export async function runSam(): Promise<SpikeResult> {
  const missing = missingEnv(['META_API_KEY']);
  if (missing.length > 0) {
    return printSkipped(SPIKE, `${SPIKE}: missing env key(s): ${missing.join(', ')}`);
  }
  const env = EnvSchema.parse({
    baseUrl: getEnv('META_API_BASE_URL') ?? 'https://api.meta.ai/v1',
    apiKey: getEnv('META_API_KEY'),
    model: getEnv('SAM_MODEL') ?? 'sam-3.1',
  });

  const inputsDir = join(REPO_ROOT, 'spikes', 'inputs', 'tables');
  if (!existsSync(inputsDir)) {
    return printSkipped(SPIKE, `${SPIKE}: no input dir spikes/inputs/tables`);
  }
  const samDir = join(FIXTURES_DIR, 'sam');
  mkdirSync(samDir, { recursive: true });

  const endpoint = env.baseUrl.endsWith('/v1')
    ? `${env.baseUrl}/responses`
    : `${env.baseUrl}/v1/responses`;

  const results: ComboResult[] = [];
  const parsedIndex: Array<{
    photo: string;
    concept: string;
    encoding: string;
    count: number;
    boxes: Array<{
      objectId: string;
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      confidence?: number;
    }>;
    maskPayloadLens: number[];
    maskDims: Array<{ h: number; w: number; enc: string }>;
    decodeChecks: Array<{
      decodedBytes: number | null;
      payloadChars: number;
      expectedOneBit: number;
      expectedBytePerPixel: number;
      alphabet: string;
    }>;
  }> = [];
  const allPayloads: string[] = [];

  for (const photo of PHOTOS) {
    const photoPath = join(inputsDir, `${photo}.png`);
    if (!existsSync(photoPath)) {
      logInfo(`${SPIKE}: missing input ${photo}.png, continuing with the rest`);
      continue;
    }
    const image = await prepareImage(photoPath);
    logInfo(
      `${SPIKE}: ${photo}.png ${String(image.sourceWidth)}x${String(image.sourceHeight)}` +
        ` -> sent ${String(image.sentWidth)}x${String(image.sentHeight)} (${String(image.sentBytes)} bytes jpeg, downscaled=${String(image.downscaled)})`,
    );
    const encodings = photo === '01' ? ['one_bit', 'lossless'] : ['one_bit'];
    for (const concept of CONCEPTS) {
      for (const encoding of encodings) {
        const body = JSON.stringify({
          model: env.model,
          input: [
            {
              type: 'message',
              role: 'user',
              content: [
                { type: 'input_text', text: concept },
                { type: 'input_image', image_url: image.dataUrl },
              ],
            },
          ],
          stream: true,
          metadata: { include_confidence: 'true', mask_encoding: encoding },
        });
        // The key travels only in the request header. loggedFetch records
        // endpoint/status/latency but never headers or bodies, so the key
        // never reaches stdout, RESULTS.md, or fixtures.
        const call = await loggedFetch({
          spike: SPIKE,
          model: env.model,
          endpoint,
          headers: { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json' },
          bodyText: body,
          note: `photo=${photo} concept=${concept} encoding=${encoding}`,
        });
        const fixtureName = `${photo}__${concept}__${encoding}.txt`;
        writeFileSync(join(samDir, fixtureName), call.bodyText, 'utf8');

        if (call.status === null || call.status < 200 || call.status >= 300) {
          logInfo(
            `${SPIKE}: ${fixtureName} HTTP ${String(call.status)}: ${excerpt(call.bodyText)}`,
          );
          results.push({
            photo,
            concept,
            encoding,
            httpStatus: call.status,
            latencyMs: call.latencyMs,
            count: 0,
            rawChars: call.bodyText.length,
            eventTypes: [],
          });
          continue;
        }
        const { text, eventTypes } = extractOutputText(call.bodyText);
        const frames = parseSamOutput(text);
        const count = frames.reduce((sum, frame) => sum + frame.objects.length, 0);
        const decodeChecks: Array<{
          decodedBytes: number | null;
          payloadChars: number;
          expectedOneBit: number;
          expectedBytePerPixel: number;
          alphabet: string;
        }> = [];
        for (const frame of frames) {
          for (const object of frame.objects) {
            if (object.mask === null) continue;
            allPayloads.push(object.mask.payload);
            if (decodeChecks.length >= 2) continue;
            const expected = expectedBytes(object.mask.width, object.mask.height);
            let decodedBytes: number | null = null;
            let alphabetName = 'none';
            for (const [name, alphabet] of Object.entries(REFERENCE_ALPHABETS)) {
              const decoded = decodeBase85(object.mask.payload, alphabet);
              if (decoded !== null) {
                decodedBytes = decoded.length;
                alphabetName = name;
                break;
              }
            }
            decodeChecks.push({
              decodedBytes,
              payloadChars: object.mask.payload.length,
              expectedOneBit: expected.oneBit,
              expectedBytePerPixel: expected.bytePerPixel,
              alphabet: alphabetName,
            });
          }
        }
        parsedIndex.push({
          photo,
          concept,
          encoding,
          count,
          boxes: frames.flatMap((frame) =>
            frame.objects.map((object) => ({
              objectId: object.objectId,
              x1: object.box.x1,
              y1: object.box.y1,
              x2: object.box.x2,
              y2: object.box.y2,
              ...(object.box.confidence !== undefined ? { confidence: object.box.confidence } : {}),
            })),
          ),
          maskPayloadLens: frames.flatMap((frame) =>
            frame.objects.flatMap((object) =>
              object.mask === null ? [] : [object.mask.payload.length],
            ),
          ),
          maskDims: frames.flatMap((frame) =>
            frame.objects.flatMap((object) =>
              object.mask === null
                ? []
                : [{ h: object.mask.height, w: object.mask.width, enc: object.mask.encoding }],
            ),
          ),
          decodeChecks,
        });
        logInfo(`${SPIKE}: ${fixtureName} HTTP ${String(call.status)} count=${String(count)}`);
        results.push({
          photo,
          concept,
          encoding,
          httpStatus: call.status,
          latencyMs: call.latencyMs,
          count,
          rawChars: call.bodyText.length,
          eventTypes,
        });
      }
    }
  }

  writeFileSync(join(samDir, 'parsed.json'), JSON.stringify(parsedIndex, null, 2), 'utf8');

  // --- Base85 evidence ------------------------------------------------------
  const alphabet = payloadAlphabet(allPayloads);
  const closest = closestAlphabet(alphabet);
  logInfo(`${SPIKE}: payload alphabet (${String(alphabet.length)} chars): ${alphabet}`);
  logInfo(`${SPIKE}: closest reference alphabet: ${closest.name} (missing: ${closest.missing})`);
  for (const entry of parsedIndex.slice(0, 8)) {
    for (const check of entry.decodeChecks) {
      logInfo(
        `${SPIKE}: decode ${entry.photo}/${entry.concept}: payload=${String(check.payloadChars)} chars ` +
          `decoded=${check.decodedBytes === null ? 'null' : String(check.decodedBytes)} bytes ` +
          `(${check.alphabet}) vs oneBit=${String(check.expectedOneBit)} bytePerPixel=${String(check.expectedBytePerPixel)}`,
      );
    }
  }

  // --- Ground-truth comparison -----------------------------------------------
  let truthNote = 'ground-truth.json unavailable';
  try {
    const truth = GroundTruthSchema.parse(
      JSON.parse(readFileSync(join(REPO_ROOT, 'spikes', 'inputs', 'ground-truth.json'), 'utf8')),
    );
    const lines: string[] = [];
    for (const photo of PHOTOS) {
      const row = truth.tables[`${photo}.png`];
      if (row === undefined) continue;
      for (const concept of GROUND_TRUTH_CONCEPTS) {
        const expectedCount: unknown = row[concept];
        const measured = results.find(
          (r) => r.photo === photo && r.concept === concept && r.encoding === 'one_bit',
        );
        if (typeof expectedCount === 'number' && measured !== undefined) {
          const error = measured.count - expectedCount;
          lines.push(
            `${photo}/${concept}: truth=${String(expectedCount)} sam=${String(measured.count)} err=${String(error)}`,
          );
        }
      }
    }
    truthNote = lines.join(' | ');
    logInfo(`${SPIKE}: ${truthNote}`);
  } catch {
    logInfo(`${SPIKE}: ${truthNote}`);
  }

  appendCall({
    ts: new Date().toISOString(),
    spike: SPIKE,
    model: env.model,
    endpoint: 'spike-summary',
    method: 'SUMMARY',
    httpStatus: null,
    latencyMs: 0,
    note: `combos=${String(results.length)} alphabet=${String(alphabet.length)}chars closest=${closest.name}`,
  });

  const failures = results.filter(
    (r) => r.httpStatus === null || r.httpStatus < 200 || r.httpStatus >= 300,
  );
  if (results.length > 0 && failures.length === results.length) {
    return { spike: SPIKE, status: 'error', detail: `all ${String(results.length)} calls failed` };
  }
  return { spike: SPIKE, status: 'ok', detail: `${String(results.length)} combos, ${truthNote}` };
}

if (isDirectRun(import.meta.url)) {
  await runSam();
}
