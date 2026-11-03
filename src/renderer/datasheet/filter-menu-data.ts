// Le menu de colonne (Filtrer) : ce que lit la liste de valeurs (R14) avant d'ouvrir FilterMenu ; partagé par la feuille de
// données et les formulaires.
import type { SqlValue } from '../../shared/coerce';
import { sameName, type FieldDef } from '../../shared/field-types';
import { passThroughOf } from '../../shared/query/definition';
import type { RecordSourceRef, SourceInfo } from '../../shared/record-source';
import { compareText } from '../../shared/expr/library';
import { api } from '../bridge';
import { currentBaseOptions } from '../shell/startup';
import type { BuiltList, FilterMenuState } from './FilterMenu';
import { filterValues, valueKey, type ListRule } from './filter-model';

/** Link kinds of a file (R14: local); any other (a server's) is not. */
const LOCAL_LINKS = ['basecraft', 'sqlite', 'access'];
/** R14 for `field` of `ref` (`info`: a query's or SQL source's columns), read when the menu opens: local unless its table (a
 *  query column's origin table) is a server link or the source a pass-through; a computed column is not indexed, and local
 *  unless the source reads a server link. */
async function listRule(ref: RecordSourceRef, field: string, info?: SourceInfo): Promise<ListRule> {
  const o = currentBaseOptions();
  const tables = await api.tables.list();
  const server = (table: string) => { const k = tables.find((x) => sameName(x.name, table))?.link?.kind; return k !== undefined && !LOCAL_LINKS.includes(k); };
  const origin = ref.kind === 'table' ? { table: ref.name, field } : info?.fields.find((x) => sameName(x.name, field))?.origin;
  const pass = ref.kind === 'query' && !!passThroughOf((await api.objects.get('query', ref.name)).definition);
  const local = !pass && (origin ? !server(origin.table) : !info?.fields.some((x) => x.origin && server(x.origin.table)));
  const fd = origin && local ? (await api.tables.design(origin.table)).fields.find((x) => sameName(x.name, origin.field)) : undefined;
  return { indexed: !!fd && (fd.props.indexed !== 'no' || fd.props.primaryKey), local, listIndexed: o.filterListIndexed, listNonIndexed: o.filterListNonIndexed, max: o.filterListMax };
}

/** Home › Filter's menu on `field` (column `col` of the rows `read` gives, sorted by it under the other fields' criteria):
 *  its list (`byShown`: in the order of the text shown, a Lookup field's), `shown` giving each value's text; ticked as `built` when the field's criterion is still the one it set. */
export async function fieldMenu(field: FieldDef, at: { x: number; y: number }, o: { ref: RecordSourceRef; info?: SourceInfo; col: number; byShown?: boolean;
  read: Parameters<typeof filterValues>[0]; shown(v: SqlValue): string; criteria: string | undefined; built: BuiltList | undefined }): Promise<FilterMenuState> {
  let values: SqlValue[] | null = null;
  try { values = await filterValues(o.read, o.col, await listRule(o.ref, field.name, o.info)); } catch { /* no list: the menu still opens */ }
  const b = o.built && o.criteria === o.built.criteria ? o.built : undefined;
  const kept = new Set(b?.values.map(valueKey));
  const list = values?.filter((v) => v !== null).map((value) => ({ value, shown: o.shown(value) })) ?? null;
  if (o.byShown) list?.sort((a, b) => compareText(a.shown, b.shown) || a.shown.localeCompare(b.shown));
  return {
    kind: 'field', field, ...at, list, blanks: !!values?.includes(null),
    ticked: values && b ? values.filter((v) => kept.has(valueKey(v)) !== b.not) : 'all',
  };
}

