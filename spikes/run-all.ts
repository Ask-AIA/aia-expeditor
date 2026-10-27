/**
 * Root spike runner: executes all six spikes in order and prints a table.
 *
 * A spike that fails never aborts the run: its row is marked and the next
 * spike continues, so one missing input or key cannot fail the whole run.
 */
import { resetCallsLog } from './lib/log.js';
import { runSam } from './01-sam.js';
import { runIdentify } from './02-identify.js';
import { runDisplay } from './03-display.js';
import { runStt } from './04-stt.js';
import { runBaseten } from './05-baseten.js';
import { runTts } from './06-tts.js';
import type { SpikeResult } from './lib/run.js';

const SPIKES: Array<{ name: string; run: () => Promise<SpikeResult> }> = [
  { name: '01-sam', run: runSam },
  { name: '02-identify', run: runIdentify },
  { name: '03-display', run: runDisplay },
  { name: '04-stt', run: runStt },
  { name: '05-baseten', run: runBaseten },
  { name: '06-tts', run: runTts },
];

function row(result: SpikeResult): string {
  const status = result.status === 'ok' ? 'OK' : result.status === 'skipped' ? 'SKIPPED' : 'ERROR';
  return `| ${result.spike} | ${status} | ${result.detail.slice(0, 100)} |`;
}

async function main(): Promise<void> {
  resetCallsLog();
  const results: SpikeResult[] = [];
  for (const spike of SPIKES) {
    try {
      results.push(await spike.run());
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      results.push({ spike: spike.name, status: 'error', detail: detail.slice(0, 160) });
    }
  }
  console.log('');
  console.log('| spike | status | detail |');
  console.log('| --- | --- | --- |');
  for (const result of results) console.log(row(result));
  const failed = results.filter((r) => r.status === 'error');
  if (failed.length > 0) {
    console.log(
      `\n${String(failed.length)} spike(s) recorded an error (see rows + spikes/RESULTS.md).`,
    );
  }
}

await main();
