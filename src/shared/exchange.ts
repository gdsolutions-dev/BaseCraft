// Échanges (A6) : types partagés de l'export. Module pur : utilisé par le processus de données, le principal et le rendu.
import type { FieldFilter } from './api';
import type { CellInput } from './coerce';
import type { LocaleInfo } from './locale-format';
import type { ImportField, ImportSpec } from './import-text';
import type { RecordSourceRef, SortSpec } from './record-source';

export const EXPORT_DELIMITERS = [',', ';', '\t', '|'] as const;
export const EXPORT_QUALIFIERS = ['"', "'", ''] as const;
export const EXPORT_ENCODINGS = ['utf-8-bom', 'utf-8', 'windows-1252'] as const;

/** Limites d'une feuille Excel : lignes de données (l'en-tête prend la 1 048 576e) et caractères d'une cellule. */
export const MAX_EXCEL_ROWS = 1_048_575;
export const MAX_EXCEL_CELL = 32_767;
/** Taille maximale d'un classeur à importer (lu en entier en mémoire). */
export const MAX_EXCEL_BYTES = 100 * 1024 * 1024;

/** Un classeur lu par l'import : cellules en texte canonique (nombre à point décimal, dates ISO), d'où ce profil. */
export const EXCEL_SPEC: ImportSpec = {
  format: 'delimited', delimiter: ',', qualifier: '"', hasHeader: false, encoding: 'utf-8', dateOrder: 'YMD', dateSep: '-', timeSep: ':',
  fourDigitYears: true, leadingZeros: false, decimalSep: '.', thousandsSep: '', breaks: [], fields: [],
};
/** Aperçu d'une feuille (`rows` hors en-tête) ; `fields` : champs déduits, comme pour un fichier texte. */
export interface ExcelPreview {
  sheets: string[]; sheet: string; hasHeader: boolean; header: string[] | null; rows: string[][]; columns: number; fields: ImportField[];
}

/** Réglages d'un export en fichier texte (lignes terminées par CR LF, comme Access). */
export interface ExportTextSpec {
  delimiter: (typeof EXPORT_DELIMITERS)[number]; qualifier: (typeof EXPORT_QUALIFIERS)[number]; hasHeader: boolean;
  encoding: (typeof EXPORT_ENCODINGS)[number];
}
/** Ce qu'on exporte : une source, avec ses paramètres, son tri et son filtre (ceux de la feuille de données) ; `where` : la condition
 *  WHERE d'ouverture d'un état (OpenReport, R8), pour que l'export de l'aperçu ait les mêmes lignes. */
export interface ExportSource { ref: RecordSourceRef; params?: Record<string, CellInput>; sort?: SortSpec[]; filter?: FieldFilter[]; where?: string }
export interface ExportWarnings { unmappable: number; truncated: number; ambiguous: number }
export type ExportResult = { ok: true; rows: number; warnings: ExportWarnings } | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'tooManyRows'; limit: number };

/** ';' quand la région écrit la virgule décimale (le fichier s'ouvre alors correctement dans Excel), sinon ','. */
export function defaultExportSpec(info: LocaleInfo): ExportTextSpec {
  return { delimiter: info.decimalSep === ',' ? ';' : ',', qualifier: '"', hasHeader: true, encoding: 'utf-8-bom' };
}

export function validExportSpec(v: unknown): ExportTextSpec | null {
  if (v === null || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  const has = (list: readonly unknown[], x: unknown) => list.includes(x);
  if (!has(EXPORT_DELIMITERS, s.delimiter) || !has(EXPORT_QUALIFIERS, s.qualifier) || !has(EXPORT_ENCODINGS, s.encoding) || typeof s.hasHeader !== 'boolean') return null;
  return { delimiter: s.delimiter as ExportTextSpec['delimiter'], qualifier: s.qualifier as ExportTextSpec['qualifier'], hasHeader: s.hasHeader, encoding: s.encoding as ExportTextSpec['encoding'] };
}
