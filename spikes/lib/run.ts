/**
 * Shared spike-runner types: every spike exposes `run<Name>()` returning a
 * {@link SpikeResult}, and executes it directly when run with `tsx`.
 */
import { pathToFileURL } from 'node:url';

export type SpikeStatus = 'ok' | 'skipped' | 'error';

export interface SpikeResult {
  spike: string;
  status: SpikeStatus;
  detail: string;
}

/** True when this module is the tsx entrypoint (not imported by run-all). */
export function isDirectRun(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  return pathToFileURL(entry).href === metaUrl;
}

/** Standard `SKIPPED: <reason>` line. Callers still return the result. */
export function printSkipped(spike: string, reason: string): SpikeResult {
  console.log(`SKIPPED: ${reason}`);
  return { spike, status: 'skipped', detail: reason };
}
