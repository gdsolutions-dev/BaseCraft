// Valeur stockée ↔ cellule de Glide. Affichage selon la région ; texte modifiable que la couche d'écriture relit.
import { GridCellKind, type EditableGridCell, type GridCell } from '@glideapps/glide-data-grid';
import { coerce, numberToText, type CellInput, type SqlValue } from '../../shared/coerce';
import type { FieldDef, FieldType, TableDesign } from '../../shared/field-types';
import { defaultInput } from '../../shared/expr/evaluate';
import type { Value } from '../../shared/expr/ast';
import { formatValue } from '../../shared/expr/format';
import { checkMasked, parseMask } from '../../shared/expr/input-mask';
import { date, num, str, toSerial } from '../../shared/expr/library';
import { formatCurrency, formatDateTime, formatNumber, localeInfo, type LocaleInfo } from '../../shared/locale-format';

const infos = new Map<string, LocaleInfo>();
const info = (locale: string): LocaleInfo => {
  let i = infos.get(locale);
  if (!i) infos.set(locale, (i = localeInfo(locale)));
  return i;
};

const STORED_DATE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

/** [display, edit text]. Numbers: grouped display, edit text in the regional form without grouping and with every digit;
 *  dates: the time is left out at midnight, and the edit text keeps a 24 h time that parseDateTime reads back. */
function texts(field: FieldDef, v: SqlValue, ctx: { locale: string; lang?: 'fr' | 'en' }): [string, string] {
  const [shown, edit] = plainTexts(field, v, ctx.locale);
  const p = field.props;
  if (!p.format) return [p.type === 'shortText' && p.inputMask && typeof v === 'string' ? throughMask(p.inputMask, v) : shown, edit];
  const value = formatable(v, p.type);
  if (value === undefined) return [shown, edit]; // stored by another tool as something else: shown as stored
  const lang = ctx.lang ?? (ctx.locale.toLowerCase().startsWith('fr') ? 'fr' : 'en');
  return [formatValue(value, p.format, { locale: ctx.locale, lang, decimalPlaces: p.decimalPlaces }), edit];
}

/** A text stored without its literals is shown with them, as Access does; one that does not match (or a bad mask): as stored. */
function throughMask(mask: string, v: string): string {
  try {
    const r = checkMasked({ ...parseMask(mask), storeLiterals: true }, v);
    return r.ok ? r.stored : v;
  } catch {
    return v;
  }
}

/** The stored value as an expression Value (an exact Decimal text goes through a double: formats show at most 15 digits). */
function formatable(v: SqlValue, type: FieldType): Value | undefined {
  if (v === null) return null;
  if (type === 'shortText' || type === 'longText' || type === 'hyperlink') return str(String(v));
  if (typeof v === 'number') return num(v);
  if (typeof v !== 'string') return undefined;
  if (STORED_DATE.test(v)) return date(toSerial(v));
  return /^-?\d+(\.\d+)?$/.test(v) ? num(Number(v)) : str(v);
}

function plainTexts(field: FieldDef, v: SqlValue, locale: string): [string, string] {
  if (v === null) return ['', ''];
  const p = field.props;
  switch (p.type) {
    case 'number':
    case 'currency': {
      if (p.type === 'number' && p.numberSize === 'decimal' && typeof v === 'string') {
        const places = typeof p.decimalPlaces === 'number' ? p.decimalPlaces : p.scale ?? 0;
        return [formatNumber(v, locale, places), v.replace('.', info(locale).decimalSep)];
      }
      if (typeof v !== 'number') return [String(v), String(v)]; // written by another tool: shown as stored
      const display = p.type === 'currency' ? formatCurrency(v, locale)
        : formatNumber(v, locale, typeof p.decimalPlaces === 'number' ? p.decimalPlaces : undefined);
      return [display, numberToText(v, info(locale))];
    }
    case 'dateTime': {
      const m = typeof v === 'string' ? STORED_DATE.exec(v) : null;
      if (!m) return [String(v), String(v)];
      const date = formatDateTime(`${m[1]} 00:00:00`, locale);
      return [formatDateTime(v as string, locale), m[2] === '00:00:00' ? date : `${date} ${m[2]}`];
    }
    default:
      return [String(v), String(v)];
  }
}

export function toCell(field: FieldDef, value: SqlValue, ctx: { locale: string; lang?: 'fr' | 'en'; readOnly: boolean }): GridCell {
  const readonly = ctx.readOnly || field.props.type === 'autoNumber';
  if (field.props.type === 'yesNo') {
    return { kind: GridCellKind.Boolean, data: value !== null && Number(value) !== 0, allowOverlay: false, readonly };
  }
  const [displayData, data] = texts(field, value, ctx);
  const numeric = ['autoNumber', 'number', 'currency'].includes(field.props.type);
  return { kind: GridCellKind.Text, data, displayData, allowOverlay: true, readonly, ...(numeric ? { contentAlign: 'right' as const } : {}) };
}

/** Stored value of each field's default (null without one, or when it cannot be computed: the save reports it),
 *  with the write layer's own evaluation and conversion. */
export async function defaultValues(design: TableDesign, locale: string, now: () => Date = () => new Date()): Promise<SqlValue[]> {
  const out: SqlValue[] = [];
  for (const fd of design.fields) {
    let v: SqlValue = null;
    if (fd.props.defaultValue && fd.props.type !== 'autoNumber') {
      try { const r = coerce(fd, await defaultInput(fd, info(locale), now), info(locale)); if (r.ok) v = r.value; } catch { /* shown empty */ }
    }
    out.push(v);
  }
  return out;
}

/** A cell of the pending row: what was typed, as typed (the write layer converts it when the row is saved). */
export function inputCell(field: FieldDef, input: CellInput, ctx: { readOnly: boolean }): GridCell {
  const readonly = ctx.readOnly || field.props.type === 'autoNumber';
  if (field.props.type === 'yesNo') return { kind: GridCellKind.Boolean, data: input === true, allowOverlay: false, readonly };
  const text = input === null ? '' : String(input);
  return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: true, readonly };
}

export function fromEdit(_field: FieldDef, cell: EditableGridCell): CellInput {
  switch (cell.kind) {
    case GridCellKind.Boolean: return cell.data === true;
    case GridCellKind.Text: return cell.data;
    default: return null; // the datasheet only makes Text and Boolean cells
  }
}

/** A1: a paste fills one row at most (a row is saved as a whole; several rows would need several commits). */
export function pasteAllowed(target: { rows: number }): boolean {
  return target.rows <= 1;
}
