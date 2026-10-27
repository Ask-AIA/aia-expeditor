/** Word error rate for the STT spike (spike 4). */

/** Lowercase, strip punctuation, split on whitespace. */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[¿?¡!.,;:()"«»]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '');
}

/** Levenshtein distance over word sequences. */
function wordDistance(reference: string[], hypothesis: string[]): number {
  const prev = Array.from({ length: hypothesis.length + 1 }, (_, i) => i);
  for (let i = 1; i <= reference.length; i += 1) {
    const curr: number[] = [i];
    for (let j = 1; j <= hypothesis.length; j += 1) {
      const substitution = (prev[j - 1] ?? 0) + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1);
      const deletion = (prev[j] ?? 0) + 1;
      const insertion = (curr[j - 1] ?? 0) + 1;
      curr[j] = Math.min(deletion, insertion, substitution);
    }
    for (let j = 0; j <= hypothesis.length; j += 1) prev[j] = curr[j] ?? 0;
  }
  return prev[hypothesis.length] ?? 0;
}

export interface WerResult {
  wer: number;
  errors: number;
  referenceWords: number;
  hypothesisWords: number;
}

/** Word error rate of `hypothesis` against `reference`. */
export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  if (ref.length === 0) {
    return {
      wer: hyp.length === 0 ? 0 : 1,
      errors: hyp.length,
      referenceWords: 0,
      hypothesisWords: hyp.length,
    };
  }
  const errors = wordDistance(ref, hyp);
  return {
    wer: errors / ref.length,
    errors,
    referenceWords: ref.length,
    hypothesisWords: hyp.length,
  };
}
