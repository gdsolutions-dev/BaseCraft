// Unités du concepteur générique (formulaires A4, états A5) : twips <-> px, cm saisis et affichés, aimantation sur la grille.
import { cmToTwips, TWIPS_PER_CM, twipsToCm, type DesignDoc } from '../../shared/design/model';
import { effectiveProp } from '../../shared/design/properties';
import { MAX_TWIPS } from '../../shared/field-types';
import { parseDecimal, type LocaleInfo } from '../../shared/locale-format';

export { MAX_TWIPS };
export const TWIPS_PER_PX = 15; // 1440 twips par pouce, 96 px par pouce
export const twipsToPx = (tw: number): number => tw / TWIPS_PER_PX;
export const pxToTwips = (px: number): number => Math.round(px * TWIPS_PER_PX);

/** '1,53 cm' : 2 décimales, séparateur décimal de la région. Affichage seulement : il perd de la précision (1 twip = 0,0018 cm),
 *  donc l'appelant ne réécrit pas une valeur dont le texte n'a pas changé. */
export const formatCm = (tw: number, info: LocaleInfo): string =>
  `${new Intl.NumberFormat(info.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(twipsToCm(tw))} cm`;

/** '1,53' ou '1,53 cm' -> twips ; illisible ou hors [0, MAX_TWIPS] -> null. */
export function parseCm(text: string, info: LocaleInfo): number | null {
  const d = parseDecimal(text.trim().replace(/\s*cm$/i, ''), info);
  if (d === null) return null;
  const tw = cmToTwips(Number(d));
  return tw >= 0 && tw <= MAX_TWIPS ? tw + 0 : null; // + 0 : jamais -0
}

/** Twips entre deux points de la grille : 567 / GridX (4 par défaut -> 142). */
export function gridStep(doc: DesignDoc): number {
  const x = Number(effectiveProp(doc.props, 'GridX', 'form'));
  return Math.round(TWIPS_PER_CM / (Number.isFinite(x) ? Math.min(16, Math.max(1, x)) : 4)); // bornes du catalogue, 4 si illisible
}

/** Multiple de `step` le plus proche. */
export const snap = (tw: number, step: number): number => Math.round(tw / step) * step + 0; // + 0 : jamais -0
