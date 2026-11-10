// Statistiques d'une boîte à moustaches (F5) : quartiles par médiane exclue (comme Excel), moustaches à 1,5 écart interquartile.
export interface BoxStats { min: number; q1: number; median: number; q3: number; max: number; whiskerLow: number; whiskerHigh: number; outliers: number[] }

const median = (s: number[]): number => { const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Les cinq nombres, les moustaches et les valeurs aberrantes (croissantes) ; null sans valeur finie. L'entrée n'est pas modifiée. */
export function boxStats(values: number[]): BoxStats | null {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const med = median(s);
  // moitiés sans la médiane quand le nombre est impair ; une moitié vide (1 observation) retombe sur la médiane
  const lo = s.slice(0, s.length >> 1);
  const hi = s.slice((s.length + 1) >> 1);
  const q1 = lo.length ? median(lo) : med;
  const q3 = hi.length ? median(hi) : med;
  const fence = 1.5 * (q3 - q1);
  const inside = s.filter((v) => v >= q1 - fence && v <= q3 + fence);   // jamais vide : q1 et q3 en font partie ou la médiane
  return { min: s[0]!, q1, median: med, q3, max: s[s.length - 1]!, whiskerLow: inside[0]!, whiskerHigh: inside[inside.length - 1]!, outliers: s.filter((v) => v < q1 - fence || v > q3 + fence) };
}
