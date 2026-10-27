/**
 * Port for generating unique IDs. Implementations produce UUID v7
 * (time-ordered) when randomness is available, else UUID v4.
 */
export interface IdGeneratorPort {
  generate(): string;
}

function randomBytes16(): Uint8Array | null {
  try {
    return globalThis.crypto.getRandomValues(new Uint8Array(16));
  } catch {
    return null;
  }
}

function toHex(value: number | bigint, length: number): string {
  return value.toString(16).padStart(length, '0');
}

/**
 * Build a UUID v7 string: 48-bit unix-ms timestamp + 4-bit version +
 * 12 random bits + 2 variant bits + 62 random bits. v7 IDs sort by
 * creation time, which keeps DB indexes append-friendly.
 */
function uuidV7(nowMs: number, bytes: Uint8Array): string {
  const timeHex = (BigInt(nowMs) & 0xffffffffffffn).toString(16).padStart(12, '0');

  let rand = 0n;
  for (let i = 0; i < 10; i += 1) {
    rand = (rand << 8n) | BigInt(bytes[i] ?? 0);
  }
  const randA = (rand >> 62n) & 0xfffn;
  // Variant field is the top two bits of the 64-bit rand_b half: `10`.
  const randB = (rand & ((1n << 62n) - 1n)) | (0b10n << 62n);
  const randBHigh = (randB >> 48n) & 0xffffn;
  const randBLow = randB & 0xffffffffffffn;

  return (
    `${timeHex.slice(0, 8)}-${timeHex.slice(8)}-7${toHex(randA, 3)}-` +
    `${toHex(randBHigh, 4)}-${toHex(randBLow, 12)}`
  );
}

/** Last resort when no cryptographic randomness exists. */
function mathRandomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Default ID generator: UUID v7 when randomness is available, else v4.
 */
export class UuidGenerator implements IdGeneratorPort {
  generate(): string {
    const bytes = randomBytes16();
    if (bytes !== null) {
      return uuidV7(Date.now(), bytes);
    }
    try {
      return globalThis.crypto.randomUUID();
    } catch {
      return mathRandomUuid();
    }
  }
}
