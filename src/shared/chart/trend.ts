// Courbes de tendance (F4b) : calcul pur à partir des valeurs d'une série (x = rang 1, 2, 3…). Une courbe impossible
// (trop peu de points, valeur non positive en exponentielle/puissance/logarithmique) donne [] : jamais NaN dans l'option.
export type Trendline = 'none' | 'linear' | 'exponential' | 'logarithmic' | 'polynomial' | 'power' | 'movingAverage';
export const TRENDLINES: readonly Trendline[] = ['none', 'linear', 'exponential', 'logarithmic', 'polynomial', 'power', 'movingAverage'];
/** Noms traduits des types de courbe (t = i18n.t), pour les libellés de readChartFormat. */
export const trendLabels = (t: (key: string) => string): Record<string, string> => Object.fromEntries(TRENDLINES.map((k) => [k, t(`chart.settings.format.trendKinds.${k}`)]));

/** Période par défaut de la moyenne mobile (celle d'Excel). */
export const MOVING_PERIOD = 2;
const DEGREE = 2;

/** Moindres carrés d'un polynôme de degré d sur (xs, ys) : pivot de Gauss sur les équations normales ; null si le système est singulier. */
function polyfit(xs: number[], ys: number[], d: number): number[] | null {
  const n = d + 1;
  const m = Array.from({ length: n }, (_, i) => [...Array.from({ length: n }, (_, j) => xs.reduce((s, x) => s + x ** (i + j), 0)), ys.reduce((s, y, k) => s + y * xs[k]! ** i, 0)]);
  for (let c = 0; c < n; c++) {
    const p = m.reduce((best, _, r) => (r >= c && Math.abs(m[r]![c]!) > Math.abs(m[best]![c]!) ? r : best), c);
    if (Math.abs(m[p]![c]!) < 1e-12) return null;
    [m[c], m[p]] = [m[p]!, m[c]!];
    for (let r = 0; r < n; r++) if (r !== c) { const k = m[r]![c]! / m[c]![c]!; for (let j = c; j <= n; j++) m[r]![j]! -= k * m[c]![j]!; }
  }
  return m.map((row, i) => row[n]! / row[i]!);
}

/** Les ordonnées de la courbe, une par entrée de `ys` (un trou de `ys` reste calculé : la courbe est continue). */
export function trendlineData(kind: Trendline, ys: (number | null)[], period = MOVING_PERIOD): number[] {
  const pts = ys.flatMap((y, i) => (y === null || !Number.isFinite(y) ? [] : [{ x: i + 1, y }]));
  const all = ys.map((_, i) => i + 1);
  if (kind === 'none' || pts.length < 2) return [];
  if (kind === 'movingAverage') {
    const w = Math.max(1, Math.floor(period));
    let last = pts[0]!.y;
    return ys.map((_, i) => { const win = ys.slice(Math.max(0, i - w + 1), i + 1).filter((v): v is number => v !== null && Number.isFinite(v)); if (win.length) last = win.reduce((a, b) => a + b, 0) / win.length; return last; });
  }
  const positive = pts.every((p) => p.y > 0);
  if (kind !== 'linear' && kind !== 'polynomial' && !positive) return [];
  // Transformation des données puis ajustement polynomial, puis transformation inverse.
  const fx = kind === 'logarithmic' || kind === 'power' ? Math.log : (x: number) => x;
  const fy = kind === 'exponential' || kind === 'power' ? Math.log : (y: number) => y;
  const degree = kind === 'polynomial' ? DEGREE : 1;
  if (pts.length <= degree) return [];
  const c = polyfit(pts.map((p) => fx(p.x)), pts.map((p) => fy(p.y)), degree);
  if (!c) return [];
  const out = all.map((x) => { const v = c.reduce((s, k, i) => s + k * fx(x) ** i, 0); return kind === 'exponential' || kind === 'power' ? Math.exp(v) : v; });
  return out.every(Number.isFinite) ? out : [];
}
