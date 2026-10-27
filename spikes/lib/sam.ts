/**
 * First parser for the SAM 3.1 streaming grammar (spec §10.2) plus empirical
 * base85-alphabet analysis. Written against real responses in spike 1.
 *
 * Line shape (one line per detection event):
 * `<{frame}f>{objId}<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..[;c=..]|><|mask;x=..;y=..[;c=..];data={H},{W},{enc}{payload}|>,…`
 */
import { z } from 'zod';

export interface SamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
  confidence?: number;
}

export interface SamMask {
  x: number;
  y: number;
  confidence?: number;
  height: number;
  width: number;
  encoding: string;
  payload: string;
}

export interface SamObject {
  objectId: string;
  box: SamBox;
  mask: SamMask | null;
}

export interface SamFrame {
  frameIndex: number;
  objects: SamObject[];
}

/** Parse `k=v;k=v` segments into a record. */
function parseParams(segment: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of segment.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function toNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const BoxInnerSchema = z.string();
const MaskInnerSchema = z.string();

/** Parse one `<box;…>` inner payload into a {@link SamBox}. */
export function parseBoxInner(inner: string): SamBox | null {
  const checked = BoxInnerSchema.parse(inner);
  const params = parseParams(checked);
  const x1 = toNumber(params['x1']);
  const y1 = toNumber(params['y1']);
  const x2 = toNumber(params['x2']);
  const y2 = toNumber(params['y2']);
  const w = toNumber(params['w']);
  const h = toNumber(params['h']);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
  const box: SamBox = { x1, y1, x2, y2, w: w ?? x2 - x1, h: h ?? y2 - y1 };
  const confidence = toNumber(params['c']);
  if (confidence !== undefined) box.confidence = confidence;
  return box;
}

/** Parse one `<mask;…>` inner payload into a {@link SamMask}. */
export function parseMaskInner(inner: string): SamMask | null {
  const checked = MaskInnerSchema.parse(inner);
  const params = parseParams(checked);
  const data = params['data'];
  if (data === undefined) return null;
  const firstComma = data.indexOf(',');
  const secondComma = data.indexOf(',', firstComma + 1);
  if (firstComma < 0 || secondComma < 0) return null;
  const height = toNumber(data.slice(0, firstComma));
  const width = toNumber(data.slice(firstComma + 1, secondComma));
  const rest = data.slice(secondComma + 1);
  if (height === undefined || width === undefined || rest === '') return null;
  const mask: SamMask = {
    x: toNumber(params['x']) ?? 0,
    y: toNumber(params['y']) ?? 0,
    height,
    width,
    encoding: rest.slice(0, 1),
    payload: rest.slice(1),
  };
  const confidence = toNumber(params['c']);
  if (confidence !== undefined) mask.confidence = confidence;
  return mask;
}

const OBJECT_PATTERN = /([^<>,]+?)<\|box;([^|]*)\|>(?:<\|mask;([^|]*)\|>)?/g;

/**
 * Parse one response-output line. Returns `null` when the line carries no
 * frame tag (`<Nf>` prefix missing), e.g. status text.
 */
export function parseSamLine(line: string): SamFrame | null {
  const frameMatch = /^<(\d+)f>/.exec(line.trim());
  if (frameMatch === null || frameMatch[1] === undefined) return null;
  const frameIndex = Number(frameMatch[1]);
  const rest = line.trim().slice(frameMatch[0].length);
  const objects: SamObject[] = [];
  for (const match of rest.matchAll(OBJECT_PATTERN)) {
    const objectId = (match[1] ?? '').trim();
    if (objectId === '') continue;
    const box = parseBoxInner(match[2] ?? '');
    if (box === null) continue;
    const maskText = match[3];
    objects.push({
      objectId,
      box,
      mask: maskText === undefined ? null : parseMaskInner(maskText),
    });
  }
  return { frameIndex, objects };
}

/** Parse every line of a joined output-text buffer into frames. */
export function parseSamOutput(text: string): SamFrame[] {
  const frames: SamFrame[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const frame = parseSamLine(line);
    if (frame !== null) frames.push(frame);
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Base85 evidence
// ---------------------------------------------------------------------------

/** Sorted unique characters used across all mask payloads (UTF-16 units; payloads are ASCII). */
export function payloadAlphabet(payloads: readonly string[]): string {
  const seen = new Set<string>();
  for (const payload of payloads) {
    for (let i = 0; i < payload.length; i += 1) {
      const ch = payload[i];
      if (ch !== undefined) seen.add(ch);
    }
  }
  return Array.from(seen).sort().join('');
}

/** Candidate reference alphabets, for comparison only (never assumed). */
export const REFERENCE_ALPHABETS: Record<string, string> = {
  // RFC 1924 base85.
  rfc1924: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~',
  // Z85 (ZeroMQ).
  z85: '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#',
  // Ascii85 proper: '!' (33) through 'u' (117), 85 characters.
  ascii85: Array.from({ length: 85 }, (_, code) => String.fromCharCode(code + 33)).join(''),
};

/** Which reference alphabet is the closest superset of the observed one. */
export function closestAlphabet(observed: string): { name: string; missing: string } {
  let best = { name: 'none', missing: '' };
  for (const [name, alphabet] of Object.entries(REFERENCE_ALPHABETS)) {
    const missingChars: string[] = [];
    for (let i = 0; i < observed.length; i += 1) {
      const ch = observed[i];
      if (ch !== undefined && !alphabet.includes(ch)) missingChars.push(ch);
    }
    const missing = missingChars.join('');
    if (best.name === 'none' || missing.length < best.missing.length) {
      best = { name, missing };
    }
  }
  return best;
}

/**
 * Generic base85 decode: 5 chars -> 4 bytes (big-endian base-N digits).
 * Returns `null` when a character falls outside `alphabet`.
 */
export function decodeBase85(payload: string, alphabet: string): Uint8Array | null {
  const base = alphabet.length;
  const out: number[] = [];
  const full = Math.floor(payload.length / 5) * 5;
  for (let i = 0; i < full; i += 5) {
    let value = 0;
    for (let j = 0; j < 5; j += 1) {
      const digit = alphabet.indexOf(payload[i + j] ?? '');
      if (digit < 0) return null;
      value = value * base + digit;
    }
    out.push(
      Math.floor(value / 16_777_216) % 256,
      Math.floor(value / 65_536) % 256,
      Math.floor(value / 256) % 256,
      value % 256,
    );
  }
  return Uint8Array.from(out);
}

/** Expected decoded byte length for a W×H mask under each packing hypothesis. */
export function expectedBytes(
  width: number,
  height: number,
): { oneBit: number; bytePerPixel: number } {
  return { oneBit: Math.ceil((width * height) / 8), bytePerPixel: width * height };
}
