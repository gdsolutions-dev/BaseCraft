// Galeries Couleurs et Polices, boîtes Personnaliser : sections, échange de jeu de couleurs, édition (fonctions pures).
import { isEmbeddedFont } from '../../shared/fonts';
import { deriveDark, isTheme, THEME_SLOTS, type Palette, type Theme, type ThemeSlot } from '../../shared/design/theme';

export type ColorScheme = Theme['colors'];
export interface SchemeEntry { section: 'current' | 'custom' | 'builtin'; scheme: ColorScheme }

const same = (a: ColorScheme, b: ColorScheme): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Le jeu actuel d'abord, puis ceux des thèmes personnalisés, puis ceux des thèmes fournis ; un jeu de même nom et de même contenu n'apparaît qu'une fois. */
export function colorSchemes(current: Theme, custom: Theme[], builtin: readonly Theme[]): SchemeEntry[] {
  const out: SchemeEntry[] = [{ section: 'current', scheme: current.colors }];
  for (const [section, list] of [['custom', custom], ['builtin', builtin]] as const) {
    for (const t of list) if (!out.some((e) => same(e.scheme, t.colors))) out.push({ section, scheme: t.colors });
  }
  return out;
}

/** Les couleurs changent ; le nom du thème et ses polices restent. */
export const swapColors = (t: Theme, s: ColorScheme): Theme => ({ ...t, colors: s });

export const isValidScheme = (s: ColorScheme): boolean => isTheme({ name: '', colors: s, fonts: { name: '', major: '', minor: '' } }) && s.name.trim() !== '';

/** Applique des modifications Clair / Sombre emplacement par emplacement. Un Sombre jamais modifié suit `deriveDark` de son Clair modifié ;
 *  un emplacement sans modification garde les valeurs de `base`. */
export function customizeColors(base: ColorScheme, edits: Partial<Record<ThemeSlot, { light?: string; dark?: string }>>, name: string): ColorScheme {
  const light = { ...base.light } as Palette, dark = { ...base.dark } as Palette;
  for (const s of THEME_SLOTS) if (edits[s]?.light !== undefined) light[s] = edits[s]!.light!;
  const derived = deriveDark(light);
  for (const s of THEME_SLOTS) {
    const e = edits[s];
    if (e?.dark !== undefined) dark[s] = e.dark;
    else if (e?.light !== undefined) dark[s] = derived[s];
  }
  return { name, light, dark };
}

// --- Polices ---

export type FontScheme = Theme['fonts'];
export interface FontEntry { section: 'current' | 'custom' | 'builtin'; scheme: FontScheme }

/** Le jeu de polices actuel d'abord, puis ceux des thèmes personnalisés, puis ceux des thèmes fournis ; un jeu identique n'apparaît qu'une fois. */
export function fontSchemes(current: Theme, custom: Theme[], builtin: readonly Theme[]): FontEntry[] {
  const out: FontEntry[] = [{ section: 'current', scheme: current.fonts }];
  for (const [section, list] of [['custom', custom], ['builtin', builtin]] as const) {
    for (const t of list) if (!out.some((e) => JSON.stringify(e.scheme) === JSON.stringify(t.fonts))) out.push({ section, scheme: t.fonts });
  }
  return out;
}

/** Les polices changent ; le nom du thème et ses couleurs restent. */
export const swapFonts = (t: Theme, f: FontScheme): Theme => ({ ...t, fonts: f });

/** Nom non vide et deux polices embarquées (un PDF ne dépend jamais de la machine). */
export const isValidFontScheme = (f: FontScheme): boolean => f.name.trim() !== '' && isEmbeddedFont(f.major) && isEmbeddedFont(f.minor);
