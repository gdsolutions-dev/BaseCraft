// Modèle pur du sélecteur de couleurs à l'Access : colonnes du thème (couleur de base + 5 nuances), couleurs standard, récentes, libellés.
import type { TFunction } from 'i18next';
import { isColorValue, type ColorValue } from '../../shared/design/colors';
import { formatSlotRef, parseSlotRef, shade, tint, variantsFor, type Mode, type Theme, type ThemeSlot } from '../../shared/design/theme';

export interface PickerColumn { slot: ThemeSlot; base: string; variants: { value: ColorValue; hex: string; mode: 'tint' | 'shade'; pct: number }[] }

/** Ordre des colonnes d'Access : arrière-plan 1, texte 1, arrière-plan 2, texte 2, puis les six accents. */
const COLUMNS: ThemeSlot[] = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

export const pickerModel = (theme: Theme, mode: Mode): PickerColumn[] => COLUMNS.map((slot) => {
  const base = theme.colors[mode][slot];
  return { slot, base, variants: variantsFor(base).map((v) => ({ ...v, value: formatSlotRef(slot, v) as ColorValue, hex: (v.mode === 'tint' ? tint : shade)(base, v.pct / 100) })) };
});

export const STANDARD_COLORS: ColorValue[] = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];

/** Le plus récent d'abord, sans doublon, 10 au plus. */
export const pushRecent = (recent: ColorValue[], c: ColorValue): ColorValue[] => [c, ...recent.filter((x) => x !== c)].slice(0, 10);

/** « Accent 2, Plus clair 80% » ; jeton de l'interface : son nom ; `#rrggbb` tel quel ; toute autre valeur : son texte. */
export function colorLabel(v: unknown, t: TFunction): string {
  if (!isColorValue(v)) return String(v ?? '');
  const ref = parseSlotRef(v);
  if (ref) return ref.mode ? `${t(`color.${ref.slot}`)}, ${t(ref.mode === 'tint' ? 'color.lighter' : 'color.darker', { pct: ref.pct })}` : t(`color.${ref.slot}`);
  return v.startsWith('theme:') ? t(`color.${v.slice(6)}`) : v;
}
