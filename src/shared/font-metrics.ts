// Tables de mesure des polices embarquées (pur). Seul module qui importe font-metrics.json, généré par
// `BC_WRITE_FONT_METRICS=1 npx vitest run src/main/fonts/ttf` ; le processus principal ne l'importe jamais.
import table from './font-metrics.json';

export interface FontMetrics {
  upm: number; ascender: number; descender: number; lineGap: number; // hhea
  underlinePos: number; underlineThickness: number; // post
  runs: [number, number[]][]; // [premier point de code, avances consécutives], BMP seulement
}

const METRICS = table as unknown as Record<string, FontMetrics>;

/** Metrics of an embedded file (a FONT_FILES value); throws on any other name. */
export function metricsOf(file: string): FontMetrics {
  if (!Object.hasOwn(METRICS, file)) throw new Error(`unknown font file ${file}`);
  return METRICS[file]!;
}
