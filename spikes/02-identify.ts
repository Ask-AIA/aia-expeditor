/**
 * Spike 2 — identify one cropped object with `muse-spark-1.3`.
 *
 * Crops one detected box from spike 1 (fallback: center crop of `01.png`),
 * then first tries Responses-API structured output (`text.format` with
 * `json_schema`). On rejection it falls back to prompting for JSON + Zod
 * parsing with one repair retry. Reports which mechanism works.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { getEnv, missingEnv, REPO_ROOT } from './lib/env.js';
import { excerpt, loggedFetch } from './lib/http.js';
import { FIXTURES_DIR, logInfo } from './lib/log.js';
import { isDirectRun, printSkipped } from './lib/run.js';
import type { SpikeResult } from './lib/run.js';

const SPIKE = '02-identify';

const EnvSchema = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

const ParsedEntrySchema = z.object({
  photo: z.string(),
  concept: z.string(),
  encoding: z.string(),
  count: z.number(),
  boxes: z.array(
    z.object({
      objectId: z.string(),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
    }),
  ),
});

const IdentificationSchema = z.object({
  concept: z.string(),
  confidence: z.number().min(0).max(1),
  lidLabelText: z.string().nullable(),
  isLidClosed: z.boolean(),
  reason: z.string().max(200),
});

/** Loose Responses-API envelope: find the first assistant text part. */
function extractAssistantText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const output = (body as Record<string, unknown>)['output'];
  if (!Array.isArray(output)) {
    const direct = (body as Record<string, unknown>)['output_text'];
    return typeof direct === 'string' ? direct : null;
  }
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

/** Pull a JSON object out of free-form model text (fenced or bare). */
function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

export async function runIdentify(): Promise<SpikeResult> {
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

  const tablesDir = join(REPO_ROOT, 'spikes', 'inputs', 'tables');
  const photo01 = join(tablesDir, '01.png');
  if (!existsSync(photo01)) {
    return printSkipped(SPIKE, `${SPIKE}: missing input spikes/inputs/tables/01.png`);
  }

  // --- Crop ---------------------------------------------------------------
  let cropBox = { x1: 0, y1: 0, x2: 0, y2: 0 };
  let cropSource = 'center-fallback';
  try {
    const parsed = z
      .array(ParsedEntrySchema)
      .parse(JSON.parse(readFileSync(join(FIXTURES_DIR, 'sam', 'parsed.json'), 'utf8')));
    const withBox = parsed.find((entry) => entry.boxes.length > 0);
    const box = withBox?.boxes[0];
    if (withBox !== undefined && box !== undefined) {
      cropBox = { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 };
      cropSource = `spike1:${withBox.photo}/${withBox.concept}#${box.objectId}`;
    }
  } catch {
    logInfo(`${SPIKE}: no usable spike-1 boxes, using center fallback`);
  }

  const full = sharp(photo01);
  const meta = await full.metadata();
  const fullW = meta.width;
  const fullH = meta.height;
  if (cropSource === 'center-fallback' && fullW > 0 && fullH > 0) {
    const w = Math.floor(fullW / 3);
    const h = Math.floor(fullH / 3);
    cropBox = { x1: Math.floor((fullW - w) / 2), y1: Math.floor((fullH - h) / 2), x2: 0, y2: 0 };
    cropBox.x2 = cropBox.x1 + w;
    cropBox.y2 = cropBox.y1 + h;
  }
  const pad = 0.08;
  const padX = Math.floor((cropBox.x2 - cropBox.x1) * pad);
  const padY = Math.floor((cropBox.y2 - cropBox.y1) * pad);
  const left = Math.max(0, cropBox.x1 - padX);
  const top = Math.max(0, cropBox.y1 - padY);
  const width = Math.min(fullW - left, cropBox.x2 - cropBox.x1 + padX * 2);
  const height = Math.min(fullH - top, cropBox.y2 - cropBox.y1 + padY * 2);
  const cropBuffer = await sharp(photo01)
    .extract({ left, top, width, height })
    .jpeg({ quality: 85 })
    .toBuffer();
  const cropMeta = await sharp(cropBuffer).metadata();
  const dataUrl = `data:image/jpeg;base64,${cropBuffer.toString('base64')}`;
  logInfo(
    `${SPIKE}: crop from ${cropSource} ${String(width)}x${String(height)} -> sent ` +
      `${String(cropMeta.width)}x${String(cropMeta.height)} (${String(cropBuffer.length)} bytes jpeg)`,
  );

  const outDir = join(FIXTURES_DIR, 'identify');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'crop.png'), cropBuffer);
  writeFileSync(
    join(outDir, 'crop-meta.json'),
    JSON.stringify({ source: cropSource, box: cropBox, sentBytes: cropBuffer.length }, null, 2),
    'utf8',
  );

  const endpoint = env.baseUrl.endsWith('/v1')
    ? `${env.baseUrl}/responses`
    : `${env.baseUrl}/v1/responses`;
  const headers = { Authorization: `Bearer ${env.apiKey}`, 'Content-Type': 'application/json' };
  const resultRecord: Record<string, unknown> = { model: env.model, cropSource };

  // --- Mechanism A: text.format json_schema ---------------------------------
  const jsonSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      concept: { type: 'string', description: 'one of: cup, plate, fork, aluminum tray, other' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      lidLabelText: { type: ['string', 'null'] },
      isLidClosed: { type: 'boolean' },
      reason: { type: 'string', maxLength: 200 },
    },
    required: ['concept', 'confidence', 'lidLabelText', 'isLidClosed', 'reason'],
  };
  const promptText =
    'Identify the single object in this crop. Candidates: cup, plate, fork, aluminum tray, other. ' +
    'Also read any lid label text verbatim when visible.';
  const attemptA = await loggedFetch({
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
            { type: 'input_text', text: promptText },
            { type: 'input_image', image_url: dataUrl },
          ],
        },
      ],
      text: {
        format: { type: 'json_schema', name: 'identification', strict: true, schema: jsonSchema },
      },
    }),
    note: 'mechanism=text.format/json_schema',
  });
  resultRecord['attemptA'] = { httpStatus: attemptA.status, excerpt: excerpt(attemptA.bodyText) };
  logInfo(`${SPIKE}: mechanism A (text.format/json_schema) HTTP ${String(attemptA.status)}`);

  let verdict = 'A';
  let parsed: z.infer<typeof IdentificationSchema> | null = null;
  if (attemptA.status !== null && attemptA.status >= 200 && attemptA.status < 300) {
    try {
      const assistantText = extractAssistantText(JSON.parse(attemptA.bodyText));
      parsed = IdentificationSchema.parse(JSON.parse(assistantText ?? ''));
      resultRecord['parsed'] = parsed;
    } catch (error: unknown) {
      resultRecord['attemptAParseError'] = excerpt(
        error instanceof Error ? error.message : String(error),
      );
    }
  } else {
    resultRecord['attemptARejected'] = excerpt(attemptA.bodyText);
  }

  // --- Mechanism B: prompt for JSON + Zod + one repair retry -----------------
  if (parsed === null) {
    try {
      verdict = 'B';
      const jsonPrompt =
        `${promptText} Reply with ONLY a JSON object, no code fences, matching this schema: ` +
        `{"concept": string, "confidence": number 0..1, "lidLabelText": string|null, "isLidClosed": boolean, "reason": string (max 200 chars)}.`;
      const attemptB = await loggedFetch({
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
                { type: 'input_text', text: jsonPrompt },
                { type: 'input_image', image_url: dataUrl },
              ],
            },
          ],
        }),
        note: 'mechanism=prompt-json',
      });
      resultRecord['attemptB'] = {
        httpStatus: attemptB.status,
        excerpt: excerpt(attemptB.bodyText, 600),
      };
      const assistantText = extractAssistantText(JSON.parse(attemptB.bodyText));
      const candidate = assistantText === null ? null : extractJsonObject(assistantText);
      try {
        parsed = IdentificationSchema.parse(JSON.parse(candidate ?? ''));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const repair = await loggedFetch({
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
                  {
                    type: 'input_text',
                    text: `The previous reply failed validation: ${message}. Reply with ONLY the corrected JSON object, no code fences.`,
                  },
                  { type: 'input_image', image_url: dataUrl },
                ],
              },
            ],
          }),
          note: 'mechanism=prompt-json-repair',
        });
        resultRecord['repair'] = {
          httpStatus: repair.status,
          excerpt: excerpt(repair.bodyText, 600),
        };
        const repairText = extractAssistantText(JSON.parse(repair.bodyText));
        const repairCandidate = repairText === null ? null : extractJsonObject(repairText);
        parsed = IdentificationSchema.parse(JSON.parse(repairCandidate ?? ''));
        resultRecord['parsed'] = parsed;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      resultRecord['verdict'] = 'B-failed';
      writeFileSync(join(outDir, 'result.json'), JSON.stringify(resultRecord, null, 2), 'utf8');
      return {
        spike: SPIKE,
        status: 'error',
        detail: `mechanism B failed: ${message.slice(0, 200)}`,
      };
    }
  }

  resultRecord['verdict'] = verdict;
  writeFileSync(join(outDir, 'result.json'), JSON.stringify(resultRecord, null, 2), 'utf8');
  logInfo(`${SPIKE}: verdict=mechanism ${verdict} parsed=${JSON.stringify(parsed)}`);

  return {
    spike: SPIKE,
    status: 'ok',
    detail: `mechanism ${verdict} works: ${JSON.stringify(parsed)}`,
  };
}

if (isDirectRun(import.meta.url)) {
  await runIdentify();
}
