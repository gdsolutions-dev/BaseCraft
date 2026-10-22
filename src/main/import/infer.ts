// Types de champs déduits d'un échantillon (au plus 1000 enregistrements), et présence d'une ligne d'en-tête.
import { fieldNames, normalizeValue, parseFileNumber, type ImportField, type ImportFieldType, type ImportSpec } from '../../shared/import-text';
import { NO_TOKENS, YES_TOKENS } from '../../shared/coerce';
import { parseDateTime, type LocaleInfo } from '../../shared/locale-format';

export const SAMPLE = 1000;
const LONG = [-2147483648, 2147483647];
const YES_NO = [...YES_TOKENS, ...NO_TOKENS]; // the write layer's own table: what is inferred Oui/Non always imports

/** Type d'une colonne d'après ses valeurs non vides. */
export function inferType(values: readonly string[], spec: ImportSpec, info: LocaleInfo): { type: ImportFieldType; size?: number } {
  const v = values.map((x) => x.trim()).filter((x) => x !== '');
  if (v.length === 0) return { type: 'shortText', size: 255 };
  const dec = v.map((x) => parseFileNumber(x, spec.decimalSep, spec.thousandsSep));
  if (dec.every((d) => d !== null && Number.isFinite(Number(d)))) {
    // 007 reste du texte (codes postaux, références) : un nombre perdrait le zéro de tête
    const leadingZero = v.some((x) => /^[+-]?0\d/.test(x));
    const ints = dec.every((d) => /^-?\d+$/.test(d!) && Number(d) >= LONG[0] && Number(d) <= LONG[1]);
    const precise = dec.every((d) => d!.replace(/[-.]/g, '').replace(/^0+/, '').length <= 15); // a double keeps 15 digits
    if (!leadingZero && precise) return { type: ints ? 'longInteger' : 'double' };
  } else if (v.every((x) => parseDateTime(normalizeValue(x, 'dateTime', spec)!, info) !== null)) return { type: 'dateTime' };
  else if (v.every((x) => YES_NO.includes(x.toLowerCase()))) return { type: 'yesNo' };
  // as Access: 255 whatever the sample (a longer value later in the file still fits), long text beyond
  return Math.max(...v.map((x) => [...x].length)) > 255 ? { type: 'longText' } : { type: 'shortText', size: 255 };
}

const isTyped = (x: string, spec: ImportSpec, info: LocaleInfo) =>
  parseFileNumber(x, spec.decimalSep, spec.thousandsSep) !== null || parseDateTime(normalizeValue(x, 'dateTime', spec)!, info) !== null;

/** En-tête probable : première ligne de textes non vides, distincts, sans nombre ni date. */
export function detectHeader(records: readonly string[][], spec: ImportSpec, info: LocaleInfo): boolean {
  const [first, ...rest] = records;
  if (!first || rest.length === 0) return false;
  const names = first.map((x) => x.trim());
  // empty or duplicate names are fine: fieldNames replaces and deduplicates them
  if (names.every((x) => x === '') || names.some((x) => x !== '' && isTyped(x, spec, info))) return false;
  return true;
}

/** Champs déduits : noms (en-tête ou `<préfixe><n>`), types d'après les enregistrements de l'échantillon. */
export function inferFields(header: readonly string[] | null, rows: readonly string[][], columns: number, spec: ImportSpec, info: LocaleInfo, prefix: string): ImportField[] {
  const names = fieldNames(header, columns, prefix);
  const sample = rows.slice(0, SAMPLE);
  return names.map((name, i) => ({ name, indexed: 'no', skip: false, ...inferType(sample.map((r) => r[i] ?? ''), spec, info) }));
}
