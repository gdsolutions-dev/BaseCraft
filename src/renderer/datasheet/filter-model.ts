// Filtre de la feuille de données (module pur) : critères canoniques par champ, filtre par sélection.
import { MAX_FILTERS, type FieldFilter } from '../../shared/api';
import type { SqlValue } from '../../shared/coerce';
import type { Expr } from '../../shared/expr/ast';
import { serializeCriteria } from '../../shared/expr/parser';
import { sameName, type FieldDef } from '../../shared/field-types';

export type SelectionFilter = 'equals' | 'notEquals' | 'contains' | 'notContains';
/** items: one criterion per field, combined with And; active: applied (Toggle Filter keeps the items). */
export interface FilterState { items: FieldFilter[]; active: boolean }
export const NO_FILTER: FilterState = { items: [], active: false };

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
  if (!criteria) return { items: others, active: others.length > 0 && s.active };
  if (others.length >= MAX_FILTERS) throw new Error('bc:tooManyFilters');
  const at = s.items.findIndex((x) => sameName(x.field, field));
  const items = at < 0 ? [...s.items, { field, criteria }] : s.items.map((x, i) => (i === at ? { field, criteria } : x));
  return { items, active: true };
}

/** The filter sent with the page requests and the count: undefined when off or empty. */
export const activeFilter = (s: FilterState): FieldFilter[] | undefined => (s.active && s.items.length ? s.items : undefined);
