// Largeurs de colonne tirées en Feuille de données d'une table ou d'une requête (px à l'écran, twips une fois enregistrées).

/** Largeur enregistrée (twips entiers > 0) en px ; autre valeur : ignorée (largeur par défaut). */
export const storedPx = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v / 15 : undefined);

export const toTwips = (widths: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(widths).map(([k, px]) => [k, Math.round(px * 15)]));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** La définition d'une requête avec ses largeurs (twips) ; les autres clés et les largeurs déjà là sont gardées. */
export const withQueryWidths = (def: Record<string, unknown>, widths: Record<string, number>): Record<string, unknown> =>
  ({ ...def, columnWidths: { ...(isObject(def.columnWidths) ? def.columnWidths : {}), ...toTwips(widths) } });

/** Les largeurs peuvent-elles être enregistrées ? Non : lien, exécution du Générateur (sql), requête directe, lecture seule, Runtime. */
export const layoutSavable = (p: { kind: 'table' | 'query'; source?: { kind: string }; link: boolean; passThrough: boolean; readOnly: boolean; runtime: boolean }): boolean =>
  !p.link && p.source?.kind !== 'sql' && !p.passThrough && !p.readOnly && !p.runtime;
