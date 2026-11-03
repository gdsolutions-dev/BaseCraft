// Filtre de la feuille de données (module pur) : critères canoniques par champ, filtre par sélection.
import { MAX_CRITERIA_CHARS, MAX_FILTERS, type FieldFilter } from '../../shared/api';
import type { SqlValue } from '../../shared/coerce';
import type { Expr } from '../../shared/expr/ast';
import { serializeCriteria } from '../../shared/expr/parser';
import { sameName, type FieldDef } from '../../shared/field-types';
import { MAX_LOADED_ROWS } from './page-cache';

export type SelectionFilter = 'equals' | 'notEquals' | 'contains' | 'notContains';
/** items: one criterion per field, combined with And; applied: a form's ApplyFilter Where Condition (B2 R14), ANDed with them;
 *  active: applied (Toggle Filter keeps the items and the Where Condition). */
export interface FilterState { items: FieldFilter[]; applied: string | null; active: boolean }
export const NO_FILTER: FilterState = { items: [], applied: null, active: false };

const DATE = /^\d{4}-\d\d-\d\d( \d\d:\d\d:\d\d)?$/;
/** A non-negative number as a canonical decimal, without exponent (the shortest text that reads back as it). */
const decimal = (n: number): string => (/e/i.test(String(n)) ? n.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 100 }) : String(n));

/** A stored value as a literal, as the field's type reads it; a value another tool stored in another class, as it is. */
function literal(field: FieldDef, v: string | number): Expr {
  const p = field.props;
  if (p.type === 'yesNo' && typeof v === 'number') return { k: 'bool', v: v !== 0 };
  if (p.type === 'dateTime' && typeof v === 'string' && DATE.test(v)) return { k: 'date', v: v.length === 10 ? `${v} 00:00:00` : v };
  const exact = typeof v === 'string' && p.type === 'number' && p.numberSize === 'decimal' && /^-?\d+(\.\d+)?$/.test(v); // Decimal: exact text
  if (typeof v === 'string' && !exact) return { k: 'str', v };
  const neg = typeof v === 'number' ? v < 0 : v.startsWith('-');
  const num: Expr = { k: 'num', v: typeof v === 'number' ? decimal(Math.abs(v)) : v.replace('-', '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') };
  return neg ? { k: 'un', op: '-', e: num } : num;
}

/** Access's Filter By Selection on the selected cell's stored value (a Lookup field: its bound value, not the text shown).
 *  Contains: a Like on the value's text, its wildcards (* ? # [) escaped. Null: Is [Not] Null. A BLOB: bc:unsupportedValue. */
export function selectionCriteria(kind: SelectionFilter, field: FieldDef, value: SqlValue): string {
  const not = kind === 'notEquals' || kind === 'notContains';
  const subject: Expr = { k: 'subject' };
  // A BLOB another tool stored (readRows gives it as is): no literal can stand for it.
  if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new Error('bc:unsupportedValue');
  if (value === null) return serializeCriteria({ k: 'isnull', e: subject, not });
  if (kind === 'contains' || kind === 'notContains') {
    const pattern = `*${String(value).replace(/[[*?#]/g, '[$&]')}*`;
    return serializeCriteria({ k: 'like', e: subject, pattern: { k: 'str', v: pattern }, not });
  }
  return serializeCriteria({ k: 'bin', op: not ? '<>' : '=', l: subject, r: literal(field, value) });
}

/** The field's criterion set ('' removes it); the filter is then on (off without criteria). At most MAX_FILTERS fields:
 *  one more throws bc:tooManyFilters. */
export function withCriteria(s: FilterState, field: string, criteria: string): FilterState {
  const others = s.items.filter((x) => !sameName(x.field, field));
  if (!criteria) return { ...s, items: others, active: (others.length > 0 || !!s.applied) && s.active };
  if (others.length >= MAX_FILTERS) throw new Error('bc:tooManyFilters');
  const at = s.items.findIndex((x) => sameName(x.field, field));
  const items = at < 0 ? [...s.items, { field, criteria }] : s.items.map((x, i) => (i === at ? { field, criteria } : x));
  return { ...s, items, active: true };
}

/** The filter sent with the page requests and the count: undefined when off or empty. */
export const activeFilter = (s: FilterState): FieldFilter[] | undefined => (s.active && s.items.length ? s.items : undefined);

/** R14: whether a field lists its values. indexed: an indexed or key field; local: not a server link nor a pass-through. */
export interface ListRule { indexed: boolean; local: boolean; listIndexed: boolean; listNonIndexed: boolean; max: number }
/** How a list compares its values, as the filter does (compareText): a text without case, accents kept, width/ligature forms
 *  (NFKC), katakana as hiragana and a final sigma as sigma folded; a number apart from a text. ponytail: bc_gkey (sql.ts) keeps
 *  the plain fold, so BaseCraft's own DISTINCT / GROUP BY still split kana and width variants. */
export const valueKey = (v: SqlValue): string => (v === null ? 'z' : typeof v === 'number' ? `n${v}`
  : `s${String(v).normalize('NFKC').toLowerCase().replace(/ς/g, 'σ').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))}`);
const TEXT_TYPES = ['shortText', 'longText', 'hyperlink'];
/** Contains / Does Not Contain are offered on text, as in Access; its blanks are Null and the zero-length string. */
export const isTextField = (f: FieldDef): boolean => TEXT_TYPES.includes(f.props.type);
const PAGE = 1000;

/** R14: the distinct values (blank included as null, text without case, sorted as read), or null for no list. `read` pages the
 *  source under the other fields' criteria, sorted by this field (`total`: its count, read(0, 0) asks for nothing else).
 *  A non-indexed field reads nothing past the count when its records are more than `max`; an indexed one stops at max + 1
 *  values. A BLOB another tool stored is left out (no criterion stands for it). ponytail: at most MAX_LOADED_ROWS records
 *  scanned, no list beyond (an index would give the values without reading the rows). */
export async function filterValues(read: (offset: number, limit: number) => Promise<{ rows: SqlValue[][]; total: number }>,
  col: number, rule: ListRule): Promise<SqlValue[] | null> {
  if (!rule.local || !(rule.indexed ? rule.listIndexed : rule.listNonIndexed)) return null;
  const { total } = await read(0, 0);
  if ((!rule.indexed && total > rule.max) || total > MAX_LOADED_ROWS) return null;
  const seen = new Set<string>();
  const out: SqlValue[] = [];
  for (let at = 0; at < total;) {
    const { rows } = await read(at, Math.min(PAGE, total - at));
    if (!rows.length) break; // fewer records than counted (deleted meanwhile)
    at += rows.length;
    for (const r of rows) {
      const v = r[col] ?? null;
      if (v !== null && typeof v !== 'string' && typeof v !== 'number') continue;
      const k = valueKey(v === '' ? null : v); // a zero-length string is listed within the blanks, as Access does
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v === '' ? null : v);
      if (out.length > rule.max) return null;
    }
  }
  return out;
}

/** The criteria of the ticked values: each as selectionCriteria('equals', …), joined by ' Or ', 'Is Null' for blanks. */
export function valuesCriteria(field: FieldDef, values: SqlValue[], blanks: boolean): string {
  return [...values.filter((v) => v !== null).map((v) => selectionCriteria('equals', field, v)), ...(blanks ? ['Is Null', ...(isTextField(field) ? ['= ""'] : [])] : [])].join(' Or ');
}

/** What a list's OK sets on its field: null when every value is ticked (no criterion); else the ticked values' criteria, or,
 *  when that is longer than a criterion may be, the values left out (`not`: <> each, And; blanks by Is [Not] Null). ponytail:
 *  both too long, the ticked one: the caller says so (MAX_CRITERIA_CHARS). */
export function listCriteria(field: FieldDef, list: SqlValue[], ticked: SqlValue[]): { criteria: string; values: SqlValue[]; not: boolean } | null {
  if (list.every((v) => ticked.includes(v))) return null;
  const blanks = ticked.includes(null);
  const criteria = valuesCriteria(field, ticked, blanks);
  const out = list.filter((v) => !ticked.includes(v));
  const nots = out.filter((v) => v !== null).map((v) => selectionCriteria('notEquals', field, v));
  if (out.includes(null) && isTextField(field)) nots.push('<> ""'); // blanks left out: the zero-length string too
  const not = [nots.join(' And ') || 'Is Not Null', ...(blanks ? ['Is Null'] : [])].join(' Or ');
  return criteria.length > MAX_CRITERIA_CHARS && not.length <= MAX_CRITERIA_CHARS ? { criteria: not, values: out, not: true } : { criteria, values: ticked, not: false };
}
