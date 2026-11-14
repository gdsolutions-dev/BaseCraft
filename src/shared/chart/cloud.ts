// Nuage de mots (C3) : disposition déterministe en spirale, sans dépendance (echarts-wordcloud dessine sur un canvas,
// donc ni SVG imprimable ni rendu sans DOM). Les mots les plus lourds d'abord ; un mot qui ne tient pas est écarté.
export interface CloudWord { name: string; value: number }
export interface PlacedWord extends CloudWord { size: number; x: number; y: number }

const MIN_SIZE = 11;
const MAX_SIZE = 44;
// Largeur estimée d'un texte : 0,58 em par caractère latin, 1 em par caractère CJK (pas de mesure : la même disposition partout).
const textWidth = (s: string, size: number): number => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) >= 0x2e80 ? 1 : 0.58) * size, 0);

/** Positions (centre du mot) dans un cadre `w` x `h` ; valeurs <= 0 écartées, ordre : valeur décroissante puis nom (points de code). */
export function cloudLayout(words: CloudWord[], w: number, h: number): PlacedWord[] {
  const list = words.filter((d) => d.value > 0).sort((a, b) => b.value - a.value || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (list.length === 0 || w <= 0 || h <= 0) return [];
  const top = Math.sqrt(list[0]!.value);
  const biggest = Math.min(MAX_SIZE, Math.max(MIN_SIZE, h / 4));
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const placed: PlacedWord[] = [];
  for (const d of list) {
    const size = Math.round(MIN_SIZE + (biggest - MIN_SIZE) * (Math.sqrt(d.value) / top));
    const hw = textWidth(d.name, size) / 2 + 2, hh = size * 0.6 + 1;
    for (let t = 0; t < 4000; t++) {   // Archimède : r = 3,5 t / (2 pi) ... l'ellipse suit le cadre
      const a = t * 0.35, r = 0.9 * a;
      const x = w / 2 + r * Math.cos(a) * (w / h), y = h / 2 + r * Math.sin(a);
      if (x - hw < 0 || x + hw > w || y - hh < 0 || y + hh > h) { if (r > w + h) break; continue; }
      if (boxes.some((b) => x - hw < b.x1 && x + hw > b.x0 && y - hh < b.y1 && y + hh > b.y0)) continue;
      boxes.push({ x0: x - hw, x1: x + hw, y0: y - hh, y1: y + hh });
      placed.push({ ...d, size, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
      break;
    }
  }
  return placed;
}
