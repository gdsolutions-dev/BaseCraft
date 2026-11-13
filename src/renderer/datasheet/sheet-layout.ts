// Largeurs de colonne tirées en Feuille de données d'une table ou d'une requête (px à l'écran, twips une fois enregistrées).
import type { SheetLayout } from '../../shared/sheet-layout';

/** Largeur enregistrée (twips entiers > 0) en px ; autre valeur : ignorée (largeur par défaut). */
export const storedPx = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v / 15 : undefined);

export const toTwips = (widths: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(widths).map(([k, px]) => [k, Math.round(px * 15)]));

/** Hauteur de ligne saisie (points) en px entiers ; illisible ou hors [9, 300] points : null. */
export const rowHeightPx = (pt: number | null): number | null => (pt !== null && pt >= 9 && pt <= 300 ? Math.round(pt * 4 / 3) : null);

/** Largeur de colonne saisie (twips) en px ; illisible ou hors des bornes de la grille (20 à 2112 px) : null. */
export const columnWidthPx = (tw: number | null): number | null => (tw !== null && tw >= 300 && tw <= 31680 ? tw / 15 : null);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** La définition d'une requête avec ses largeurs (twips) ; les autres clés et les largeurs déjà là sont gardées. */
export const withQueryWidths = (def: Record<string, unknown>, widths: Record<string, number>): Record<string, unknown> =>
  ({ ...def, columnWidths: { ...(isObject(def.columnWidths) ? def.columnWidths : {}), ...toTwips(widths) } });

/** La définition d'une requête avec le reste de la mise en forme de sa feuille de données (`sheetLayout`, remplacée ; vide : retirée). */
export const withQuerySheet = (def: Record<string, unknown>, layout: SheetLayout): Record<string, unknown> => {
  const { sheetLayout: _old, ...kept } = def;
  return Object.keys(layout).length ? { ...kept, sheetLayout: layout } : kept;
};

/** Les largeurs peuvent-elles être enregistrées ? Non : lien, exécution du Générateur (sql), requête directe, lecture seule, Runtime. */
export const layoutSavable = (p: { kind: 'table' | 'query'; source?: { kind: string }; link: boolean; passThrough: boolean; readOnly: boolean; runtime: boolean }): boolean =>
  !p.link && p.source?.kind !== 'sql' && !p.passThrough && !p.readOnly && !p.runtime;
