// Couleurs et police d'un graphique (F4) : accents du thème du document, texte et grille du thème, fond transparent.
import { resolveColor, type ColorValue } from '../design/colors';
import { cssFamily, resolveFont } from '../fonts';
import type { Mode, Theme } from '../design/theme';

export interface ChartPalette { series: string[]; text: string; grid: string; fontFamily: string; /** Famille CSS embarquée d'un nom de police du document (une non portable : Liberation Sans). */ font(name: string): string; /** Couleur propre à une série (ColorValue du document), résolue avec le thème et le mode. */ custom(c: ColorValue): string }

/** La série i prend l'accent 1 + i % 6 ; une police non portable est dessinée en Liberation Sans, comme le texte d'un état ; la famille est le nom CSS embarqué (cssFamily). */
export function chartPalette(theme: Theme, mode: Mode): ChartPalette {
  const family = (name: string): string => { const f = resolveFont(name, theme); return cssFamily(f.portable ? f.family : 'Liberation Sans'); };
  return {
    series: [1, 2, 3, 4, 5, 6].map((n) => resolveColor(`theme:accent${n}`, mode, 'transparent', theme)),
    text: resolveColor('theme:text', mode, 'transparent', theme),
    grid: resolveColor('theme:border', mode, 'transparent', theme),
    fontFamily: family('(Body)'), font: family,
    custom: (c) => resolveColor(c, mode, 'transparent', theme),
  };
}
