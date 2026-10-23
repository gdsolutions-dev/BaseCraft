// Seuils de performance bloquants (spec 6). STRICT : BASECRAFT_BENCH_STRICT=1 ; FACTOR : tolérance des runners CI partagés (x2).
export const STRICT = process.env.BASECRAFT_BENCH_STRICT === '1';
const factor = Number(process.env.BASECRAFT_BENCH_FACTOR ?? 1);
export const FACTOR = factor > 0 ? factor : 1;

/** Échoue si, en mode strict, la médiane atteint ou dépasse le seuil multiplié par FACTOR. */
export function assertUnder(label: string, medianMs: number, limitMs: number): void {
  if (STRICT && !(medianMs < limitMs * FACTOR)) throw new Error(`${label}: ${medianMs} ms > ${limitMs * FACTOR} ms`);
}
