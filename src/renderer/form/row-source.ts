// Contenu d'une zone de liste déroulante ou d'une zone de liste (module pur) : liste de valeurs ou table/requête lue par
// sources.describe/page, en LookupData d'A2 (colonnes visibles seulement, la première est le texte montré).
import type { LookupData } from '../../shared/api';
import { listItemText, listItemValue, type CellInput, type SqlValue } from '../../shared/coerce';
import type { ControlDef } from '../../shared/design/model';
import { DEFAULT_COLUMN_WIDTH, shownColumns, splitValueList, valueListRows } from '../../shared/field-types';
import { localeInfo } from '../../shared/locale-format';
import type { SourceField, SourceInfo } from '../../shared/record-source';
import { texts } from '../datasheet/datasheet-cells';
import { toSourceRef } from '../designer/property-sheet-model';
import { fold } from '../shell/combobox-model';
export { listOptions, prefixMatch } from '../shell/combobox-model';   // shared with the datasheet's lookupEditor
import type { FormDataApi } from './record-controller';
import { prop } from './run-model';

export const LIST_MAX = 5000;   // as rows.lookup's LOOKUP_MAX
/** ponytail: another row of Continuous Forms draws this many list box rows from its value, not all (a list box taller than that
 *  shows blank below them there); virtualise the list box if that matters. */
export const LIST_PEEK = 40;
/** The rows [start, end[ a list box draws: all on the current record; on another row, at most LIST_PEEK, from its value. */
export function listWindow(count: number, row: number, other: boolean): [number, number] {
  if (!other) return [0, count];
  const start = Math.max(0, Math.min(row, count - LIST_PEEK));
  return [start, Math.min(count, start + LIST_PEEK)];
}

/** props.ColumnWidths '0;1417' -> [0, 1417] (integer twips, contract 1.4); absent or unreadable -> undefined. */
export function columnWidthsOf(c: ControlDef): number[] | undefined {
  const v = c.props.ColumnWidths;
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? [v] : undefined;
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const parts = v.trim().replace(/;$/, '').split(';').map((x) => x.trim());
  return parts.every((x) => /^\d+$/.test(x)) ? parts.map(Number) : undefined;
}

const int = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : fallback);

/** The control's list: a value list as typed (its bound items converted as the bound field stores them), or the first Column
 *  Count fields of a table or query (at most LIST_MAX rows: truncated beyond). An unknown source or one that cannot be read
 *  gives no rows and its error; never throws. `askParams`: the values of a parameterized source (null: declined, no rows). */
export async function loadRowSource(c: ControlDef, bound: SourceField | null, api: Pick<FormDataApi, 'describe' | 'page'>,
  ctx: { locale: string; lang: 'fr' | 'en'; tables: string[]; queries: string[] },
  askParams?: (p: SourceInfo['parameters']) => Promise<Record<string, CellInput> | null>): Promise<{ data: LookupData; truncated: boolean; error?: unknown }> {
  const count = int(prop(c, 'ColumnCount'), 1);
  const b = int(prop(c, 'BoundColumn'), 1) - 1;
  const cw = columnWidthsOf(c);
  const shown = shownColumns(cw, count);
  const widths = shown.map((i) => cw?.[i] ?? DEFAULT_COLUMN_WIDTH);
  const source = String(prop(c, 'RowSource') ?? '');
  const withHeads = prop(c, 'ColumnHeads') === true;
  const empty = (error?: unknown) => ({ data: { rows: [], widths }, truncated: false, ...(error === undefined ? {} : { error }) });
  if (prop(c, 'RowSourceType') === 'valueList') {
    const info = localeInfo(ctx.locale);
    const list = valueListRows({ values: splitValueList(source), columnCount: count, columnHeads: withHeads });
    const rows = list.rows.map((r) => ({
      value: r[b] === undefined ? null : bound ? listItemValue(bound, r[b]) : r[b],
      display: shown.map((i) => (i === b && bound ? listItemText(bound.type, r[i] ?? '', info) : r[i] ?? '')),
    }));
    return { data: { rows, widths, ...(list.heads ? { heads: shown.map((i) => list.heads![i] ?? '') } : {}) }, truncated: false };
  }
  if (source.trim() === '') return empty();
  const ref = toSourceRef(source, ctx.tables, ctx.queries);
  if (!ref) return empty(new Error(`bc:notFound ${source}`));
  try {
    const info = await api.describe(ref);
    const params = info.parameters.length && askParams ? await askParams(info.parameters) : undefined;
    if (params === null) return empty();
    const page = await api.page(ref, { offset: 0, limit: LIST_MAX, ...(params && { params }) });
    const cols = info.fields.slice(0, count);
    const rows = page.rows.map((r) => ({
      value: r[b] ?? null,
      display: shown.map((i) => (cols[i] ? texts(cols[i], r[i] ?? null, ctx)[0] : '')),
    }));
    const heads = withHeads ? { heads: shown.map((i) => (cols[i] ? cols[i].props.caption || cols[i].name : '')) } : {};   // as rows.lookup
    return { data: { rows, widths, ...heads }, truncated: page.total > LIST_MAX };
  } catch (e) {
    return empty(e);
  }
}

/** The first row whose shown text is `text`, case and accents ignored (Access); -1. */
export function rowOfText(data: LookupData, text: string): number {
  return data.rows.findIndex((r) => fold(r.display[0] ?? '') === fold(text));
}

const indexes = new WeakMap<LookupData, Map<CellInput, number>>();
/** Each bound value's first row, built once per list read. */
function indexOf(data: LookupData): Map<CellInput, number> {
  let m = indexes.get(data);
  if (!m) {
    m = new Map();
    data.rows.forEach((r, i) => { if (r.value !== null && !m!.has(r.value)) m!.set(r.value, i); });
    indexes.set(data, m);
  }
  return m;
}

/** The row an entry stands for: its bound value as stored (looked up at once), else as its edit text (`editOf`); -1 (blank included). */
export function rowOfValue(data: LookupData, input: CellInput, editOf: (v: SqlValue) => string): number {
  if (input === null || input === '') return -1;
  return indexOf(data).get(input) ?? data.rows.findIndex((r) => r.value !== null && editOf(r.value) === String(input));
}

/** Limit To List: whether an entry is in no row. A text typed (`typed`, still the entry) is compared with the shown texts, as
 *  Access does (typing a hidden bound N° is not in the list); a value written by a row pick, or stored, with the bound values.
 *  Blank is always allowed. */
export function outOfList(data: LookupData, input: CellInput, typed: string | undefined, editOf: (v: SqlValue) => string): boolean {
  if (input === null || input === '') return false;
  return typed !== undefined && typed === input ? rowOfText(data, typed) < 0 : rowOfValue(data, input, editOf) < 0;
}
