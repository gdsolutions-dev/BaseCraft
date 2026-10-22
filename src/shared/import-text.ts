// Import de fichiers texte : types partagés (API), validation d'une spécification, noms de champs et de tables.
// Module pur : utilisé par le processus principal (analyse, import) et par le rendu (assistant).
import { defaultProps, isReservedName, isValidObjectName, sameName, type DesignError, type FieldProps } from './field-types';
import { parseDecimal, type LocaleInfo } from './locale-format';

export const IMPORT_TYPES = ['shortText', 'longText', 'longInteger', 'double', 'currency', 'dateTime', 'yesNo'] as const;
export type ImportFieldType = (typeof IMPORT_TYPES)[number];
export const ENCODINGS = ['auto', 'utf-8', 'windows-1252', 'utf-16le'] as const;
export type ImportEncoding = (typeof ENCODINGS)[number];
export type ResolvedEncoding = Exclude<ImportEncoding, 'auto'>;
const INDEXED = ['no', 'yesDuplicates', 'yesNoDuplicates'] as const;
const ORDERS = ['DMY', 'MDY', 'YMD'] as const;

export interface ImportField { name: string; type: ImportFieldType; indexed: FieldProps['indexed']; skip: boolean; size?: number }

/** Spécification d'import (« Avancé… » d'Access) ; `breaks` : débuts de colonnes (largeur fixe), sans le 0 initial. */
export interface ImportSpec {
  format: 'delimited' | 'fixed';
  delimiter: string;
  qualifier: '' | '"' | "'";
  hasHeader: boolean;
  encoding: ImportEncoding;
  dateOrder: LocaleInfo['dateOrder'];
  dateSep: string;
  timeSep: string;
  fourDigitYears: boolean;
  leadingZeros: boolean;
  decimalSep: string; // celui du fichier, jamais celui de la région
  thousandsSep: string; // du fichier ; '' = aucun (une espace entre groupes de trois chiffres est toujours admise)
  breaks: number[];
  fields: ImportField[];
}

export type PrimaryKeyChoice = { kind: 'auto' } | { kind: 'field'; field: string } | { kind: 'none' };
/** append.mapping : pour chaque colonne du fichier, le champ cible, ou null pour la sauter. */
export type ImportTarget =
  | { kind: 'new'; table: string; primaryKey: PrimaryKeyChoice }
  | { kind: 'append'; table: string; mapping: (string | null)[] };
export interface ImportPlan { spec: ImportSpec; target: ImportTarget }

export interface TextPreview {
  encoding: ResolvedEncoding; // encodage réellement utilisé (détection automatique résolue)
  spec: ImportSpec; // spécification reçue, ou détectée (format, séparateur, en-tête, coupures, champs)
  inferred: ImportField[]; // champs déduits de l'échantillon pour cette analyse
  lines: string[]; // premières lignes brutes
  header: string[] | null;
  rows: string[][]; // premiers enregistrements (hors en-tête)
  columns: number;
  assumedDecimal: boolean; // every sampled number was ambiguous (« 1,250 ») : the region's decimal symbol was assumed
}
export interface ImportProgress { done: number; total: number }
export type ImportResult =
  | { ok: true; table: string; imported: number; errors: number; errorTable?: string }
  | { ok: false; reason: 'nameExists' }
  | { ok: false; reason: 'danglingKey'; table: string } // `table` has a FOREIGN KEY to a dropped table of that name
  | { ok: false; reason: 'design'; errors: DesignError[] };

const MAX_FIELDS = 255;
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const oneChar = (v: unknown): v is string => typeof v === 'string' && [...v].length === 1 && !/[\r\n]/.test(v);

/** Spécification valide (venue du rendu ou relue de la base), recopiée sans clé inconnue ; null sinon. */
export function validSpec(v: unknown): ImportSpec | null {
  if (!isObj(v)) return null;
  const { format, delimiter, qualifier, hasHeader, encoding, dateOrder, dateSep, timeSep, fourDigitYears, leadingZeros, decimalSep, breaks, fields } = v;
  const thousandsSep = v.thousandsSep ?? ''; // spécifications enregistrées avant ce réglage
  if (!(thousandsSep === '' || oneChar(thousandsSep)) || thousandsSep === decimalSep || /\d/.test(`${decimalSep}${thousandsSep}`)) return null;
  if ((format !== 'delimited' && format !== 'fixed') || !oneChar(delimiter) || (qualifier !== '' && qualifier !== '"' && qualifier !== "'")
    || typeof hasHeader !== 'boolean' || !ENCODINGS.includes(encoding as ImportEncoding) || !ORDERS.includes(dateOrder as LocaleInfo['dateOrder'])
    || !oneChar(dateSep) || !oneChar(timeSep) || !oneChar(decimalSep) || typeof fourDigitYears !== 'boolean' || typeof leadingZeros !== 'boolean'
    || delimiter === qualifier) return null;
  if (!Array.isArray(breaks) || breaks.length >= MAX_FIELDS
    || !breaks.every((b, i) => Number.isSafeInteger(b) && b > 0 && b <= 100000 && (i === 0 || b > breaks[i - 1]))) return null;
  if (!Array.isArray(fields) || fields.length > MAX_FIELDS) return null;
  const out: ImportField[] = [];
  for (const f of fields) {
    if (!isObj(f) || typeof f.name !== 'string' || [...f.name].length > 64 || !IMPORT_TYPES.includes(f.type as ImportFieldType)
      || !INDEXED.includes(f.indexed as FieldProps['indexed']) || typeof f.skip !== 'boolean'
      || !(f.size === undefined || (Number.isSafeInteger(f.size) && (f.size as number) >= 1 && (f.size as number) <= 255))) return null;
    out.push({ name: f.name, type: f.type as ImportFieldType, indexed: f.indexed as FieldProps['indexed'], skip: f.skip, ...(f.size === undefined ? {} : { size: f.size as number }) });
  }
  return {
    format, delimiter, qualifier, hasHeader, encoding: encoding as ImportEncoding, dateOrder: dateOrder as LocaleInfo['dateOrder'],
    dateSep, timeSep, fourDigitYears, leadingZeros, decimalSep, thousandsSep: thousandsSep as string, breaks: [...breaks] as number[], fields: out,
  };
}

/** Spécification par défaut : ordre des dates de la région ; les nombres sont ceux du fichier (détectés à l'aperçu). */
export function defaultSpec(info: LocaleInfo): ImportSpec {
  return {
    format: 'delimited', delimiter: ',', qualifier: '"', hasHeader: false, encoding: 'auto', dateOrder: info.dateOrder,
    dateSep: info.dateSep, timeSep: ':', fourDigitYears: true, leadingZeros: false, decimalSep: '.', thousandsSep: ',', breaks: [], fields: [],
  };
}

/** Lecture des valeurs par la couche d'écriture : dates selon la spécification ; les nombres lui arrivent déjà sous forme
 *  canonique (parseFileNumber), d'où le '.' décimal sans séparateur de milliers. */
export function specLocale(spec: ImportSpec, region: LocaleInfo): LocaleInfo {
  return { locale: region.locale, decimalSep: '.', groupSep: '', dateOrder: spec.dateOrder, dateSep: spec.dateSep };
}

const CANON: LocaleInfo = { locale: 'en', decimalSep: '.', groupSep: '', dateOrder: 'YMD', dateSep: '-' };
const SPACE_LIKE = /[   ]/g;

/**
 * Nombre tel qu'écrit dans le fichier → chaîne décimale canonique, ou null. Les milliers (le séparateur de la spécification,
 * ou une espace) ne sont admis qu'entre groupes de trois chiffres : avec milliers « . », « 1.234 » vaut 1234 mais
 * « 249.90 » est refusé (jamais ×100 en silence).
 */
export function parseFileNumber(text: string, decimalSep: string, thousandsSep: string): string | null {
  const m = /^([+-]?)(.*)$/s.exec(text.trim().replace(SPACE_LIKE, ' '))!;
  const parts = m[2].split(decimalSep);
  if (parts.length > 2) return null;
  let int = parts[0];
  const frac = parts[1];
  if (frac !== undefined && !/^\d*$/.test(frac)) return null;
  const seps = new Set([' ', ...(thousandsSep && thousandsSep !== decimalSep ? [thousandsSep] : [])]);
  if ([...int].some((c) => seps.has(c))) {
    const groups = [...int].reduce<string[]>((g, c) => { if (seps.has(c)) g.push(''); else g[g.length - 1] += c; return g; }, ['']);
    const sepsUsed = new Set([...int].filter((c) => seps.has(c)));
    if (sepsUsed.size > 1 || !/^\d{1,3}$/.test(groups[0]) || !groups.slice(1).every((x) => /^\d{3}$/.test(x))) return null;
    int = groups.join('');
  }
  if (!/^\d*$/.test(int) || !(int || frac)) return null;
  return parseDecimal(`${m[1]}${int}${frac === undefined ? '' : '.' + frac}`, CANON);
}

/**
 * Symbole décimal et séparateur des milliers d'après les nombres de l'échantillon (toutes colonnes : un seul symbole par
 * fichier, comme une spécification d'Access). Chaque valeur peut prouver le symbole décimal :
 * - les deux signes présents (« 1.234,5 ») : le dernier est décimal ;
 * - un signe répété (« 1,250,500 ») : c'est le séparateur des milliers, l'autre est décimal ;
 * - des groupes séparés par une espace (« 1 250,500 ») : le signe restant est décimal ;
 * - un seul signe suivi de 1, 2 ou 4 chiffres et plus, ou précédé d'un 0 seul (« 0,750 ») ou de 4 chiffres et plus
 *   (« 1250,500 ») : décimal.
 * Un seul signe suivi de trois chiffres (« 1,250 ») ne prouve rien. La majorité des preuves l'emporte ; sans preuve, ou à
 * égalité, le symbole décimal de la région (`regionDecimal`) est retenu. `assumed` signale toute décision qui n'est pas
 * unanime (preuves contradictoires, ou valeurs ambiguës sans preuve) : l'assistant l'affiche.
 */
export function detectNumberFormat(values: Iterable<string>, regionDecimal = '.'): { decimalSep: string; thousandsSep: string; assumed: boolean } {
  const dec: Record<string, number> = { '.': 0, ',': 0 };
  const group: Record<string, number> = { '.': 0, ',': 0, ' ': 0 };
  const other = (c: string) => (c === '.' ? ',' : '.');
  let ambiguous = 0;
  for (const raw of values) {
    const v = raw.trim().replace(SPACE_LIKE, ' ');
    if (!/^[+-]?\d(?:[\d., ]*\d)?$/.test(v)) continue;
    const spaced = /\d \d{3}(?!\d)/.test(v);
    if (spaced) group[' ']++;
    const d = v.lastIndexOf('.'), c = v.lastIndexOf(',');
    if (d >= 0 && c >= 0) { const x = d > c ? '.' : ','; dec[x]++; group[other(x)]++; continue; }
    if (d < 0 && c < 0) continue;
    const x = d >= 0 ? '.' : ',';
    if (v.split(x).length > 2) { group[x]++; dec[other(x)]++; } // repeated: thousands, so the other symbol is decimal
    else if (spaced || v.length - v.lastIndexOf(x) - 1 !== 3 || /^[+-]?(?:0|\d{4,})[.,]/.test(v)) dec[x]++;
    else ambiguous++;
  }
  const region = regionDecimal === ',' ? ',' : '.';
  const assumed = (dec['.'] > 0 && dec[','] > 0) || (dec['.'] === 0 && dec[','] === 0 && ambiguous > 0);
  const decimalSep = dec[','] > dec['.'] ? ',' : dec['.'] > dec[','] ? '.' : region;
  const best = ['.', ',', ' '].filter((g) => g !== decimalSep && group[g] > 0).sort((a, b) => group[b] - group[a])[0];
  return { decimalSep, thousandsSep: best ?? other(decimalSep), assumed };
}

/**
 * Valeur prête pour la couche d'écriture : un nombre est ramené à sa forme canonique (null s'il ne respecte pas la
 * spécification) ; une date avec un séparateur d'heure propre au fichier voit son heure ramenée à « : ».
 */
export function normalizeValue(raw: string, kind: 'number' | 'dateTime' | 'text', spec: ImportSpec): string | null {
  if (kind === 'number') return raw.trim() === '' ? '' : parseFileNumber(raw, spec.decimalSep, spec.thousandsSep);
  if (kind !== 'dateTime' || spec.timeSep === ':') return raw;
  const s = raw.trim();
  const sp = s.search(/\s/);
  const fix = (x: string) => x.split(spec.timeSep).join(':');
  if (sp < 0) return /^\d{1,2}\D\d{2}(\D\d{2})?$/.test(s) && !s.includes(spec.dateSep) ? fix(s) : s; // heure seule
  return s.slice(0, sp) + ' ' + fix(s.slice(sp).trim());
}

export function importFieldProps(f: ImportField): FieldProps {
  const base = (t: Parameters<typeof defaultProps>[0]) => ({ ...defaultProps(t), indexed: f.indexed });
  switch (f.type) {
    case 'shortText': return { ...base('shortText'), size: f.size ?? 255 };
    case 'longText': return base('longText');
    case 'longInteger': return base('number');
    case 'double': return { ...base('number'), numberSize: 'double' };
    case 'currency': return base('currency');
    case 'dateTime': return base('dateTime');
    case 'yesNo': return base('yesNo');
  }
}

const RESERVED_FIELDS = ['rowid', 'oid', '_rowid_'];
const cut = (s: string, n: number) => [...s].slice(0, n).join('');

/** Nom d'objet acceptable tiré d'un texte quelconque (en-tête, nom de fichier) ; `fallback` s'il ne reste rien. */
export function sanitizeName(raw: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex
  let s = cut(raw.replace(/[.!`[\]]/g, '_').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim(), 64).trim();
  if (RESERVED_FIELDS.includes(s.toLowerCase())) s += '_';
  return isValidObjectName(s) ? s : fallback;
}

/** Table : en plus, pas de préfixe réservé (bc_, bcx_, sqlite_). */
export function sanitizeTableName(raw: string, fallback: string): string {
  const s = sanitizeName(raw, fallback);
  return isReservedName(s) ? cut('_' + s, 64) : s;
}

/** `base`, ou base1, base2… : premier nom absent de `taken` (casse Unicode ignorée, comme Access). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const free = (n: string) => !taken.some((x) => sameName(x, n));
  if (free(base)) return base;
  for (let k = 1; ; k++) {
    const sfx = String(k);
    const n = cut(base, 64 - sfx.length) + sfx;
    if (free(n)) return n;
  }
}

/** `<base><suffix>` en 64 caractères au plus (la base est coupée), puis `<base><suffix>1`, 2… s'il est pris. */
export function suffixedName(base: string, suffix: string, taken: readonly string[]): string {
  const len = [...suffix].length;
  for (let k = 0; ; k++) {
    const n = k === 0 ? '' : String(k);
    const name = cut(base, 64 - len - n.length) + suffix + n;
    if (!taken.some((x) => sameName(x, name))) return name;
  }
}

/** Noms de champs : en-tête nettoyé, sinon `Champ<n>` ; doublons renumérotés. */
export function fieldNames(header: readonly string[] | null, columns: number, prefix: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < columns; i++) {
    const fallback = prefix + (i + 1);
    out.push(uniqueName(header ? sanitizeName(header[i] ?? '', fallback) : fallback, out));
  }
  return out;
}
