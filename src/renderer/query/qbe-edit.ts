// Grille de création des requêtes (QBE) : réducteur pur des actions de l'utilisateur sur le modèle de la tâche 7, jointures par
// défaut tirées des relations, contrôles faits avant l'enregistrement. Les cellules gardent la forme canonique.
import type { Relation } from '../../shared/api';
import { bracket } from '../../shared/expr/lexer';
import { sameName } from '../../shared/field-types';
import type { JoinKind, ParamDecl } from '../../shared/query/ast';
import type { Expr } from '../../shared/expr/ast';
import { parseCanonical } from '../../shared/expr/parser';
import { named, splitAlias, type QbeColumn, type QbeDesign, type QbeJoin, type QbeKind, type QbeTotal } from '../../shared/query/qbe';
import { QUERY_PARSE } from '../../shared/query/sql-parser';

export type QbeAction =
  | { type: 'addTable'; name: string; relations: Relation[] }          // automatic alias « Clients_1 » when already present; default joins
  | { type: 'removeTable'; alias: string } | { type: 'addJoin'; join: QbeDesign['joins'][number] } | { type: 'setJoinKind'; index: number; kind: JoinKind }
  | { type: 'removeJoin'; index: number } | { type: 'addField'; table: string; field: string; at?: number }
  | { type: 'setCell'; col: number; row: QbeRow; value: string | boolean } | { type: 'insertColumn'; at: number } | { type: 'deleteColumn'; at: number }
  | { type: 'moveColumn'; from: number; to: number } | { type: 'setTotals'; on: boolean } | { type: 'setKind'; kind: QbeKind; target?: string }
  // Task 9: Insert / Delete Rows (a criteria row, in every column); the query's properties (null: Top Values All)
  | { type: 'insertRow'; at: number } | { type: 'deleteRow'; at: number }
  | { type: 'setProps'; top?: QbeDesign['top'] | null; distinct?: boolean; outputAll?: boolean; params?: ParamDecl[] };
export type QbeRow = 'field' | 'table' | 'total' | 'sort' | 'show' | `criteria${number}` | 'appendTo' | 'updateTo' | 'deleteRole';

/** A grid column; `uid` (given by the reducer) keeps a column's identity when columns move (React keys, cell errors). */
export type GridColumn = QbeColumn & { uid?: number };
/** Criteria and at least two « Or » rows, as in Access; typing in the last one adds another. */
export const ROWS_MIN = 3;

export const emptyQbe = (): QbeDesign => ({ kind: 'select', tables: [], joins: [], totals: false, distinct: false, params: [], columns: [] });
const aliasOf = (t: { name: string; alias?: string }): string => t.alias ?? t.name;

/** One join per field pair of each relation between the added table (`alias`, `added` by default) and a box already there:
 *  the parent is `l`; joinType 1 inner, 2 left (every parent row), 3 right (every child row). No AutoJoin on equal names. */
export function defaultJoins(tables: QbeDesign['tables'], added: string, relations: Relation[], alias = added): QbeDesign['joins'] {
  const kind = (r: Relation): JoinKind => (r.joinType === 2 ? 'left' : r.joinType === 3 ? 'right' : 'inner');
  const out: QbeJoin[] = [];
  for (const r of relations) {
    for (const b of tables) {
      const other = aliasOf(b);
      if (sameName(other, alias)) continue;
      const pairs = r.parentFields.map((p, i) => [p, r.childFields[i]] as const);
      if (sameName(r.parentTable, added) && sameName(r.childTable, b.name)) {
        for (const [p, c] of pairs) out.push({ l: alias, lField: p, r: other, rField: c, kind: kind(r) });
      } else if (sameName(r.childTable, added) && sameName(r.parentTable, b.name)) {
        for (const [p, c] of pairs) out.push({ l: other, lField: p, r: alias, rField: c, kind: kind(r) });
      }
    }
  }
  return out;
}

const rowsOf = (cols: QbeColumn[]): number =>
  Math.max(ROWS_MIN, ...cols.map((c) => c.criteria.findLastIndex((s) => s !== '') + 2));
/** Every column with as many criteria rows as the grid shows. */
function padded(d: QbeDesign): QbeDesign {
  const n = rowsOf(d.columns);
  return { ...d, columns: d.columns.map((c) => (c.criteria.length === n ? c : { ...c, criteria: Array.from({ length: n }, (_, i) => c.criteria[i] ?? '') })) };
}
/** A grid read from SQL (toQbe), ready to edit: each column numbered, the criteria rows the grid shows. */
export const editable = (d: QbeDesign): QbeDesign => padded({ ...d, columns: d.columns.map((c, i) => ({ ...c, uid: i + 1 })) });
const nextUid = (cols: GridColumn[]): number => Math.max(0, ...cols.map((c) => c.uid ?? 0)) + 1;
function blank(d: QbeDesign, uid: number): GridColumn {
  return { uid, field: '', show: true, criteria: [], ...(d.totals && { total: 'groupBy' as const }), ...(d.kind === 'delete' && { deleteRole: 'where' as const }) };
}
const without = <T,>(o: T, ...keys: (keyof T)[]): T => { const c = { ...o }; for (const k of keys) delete c[k]; return c; };

/** What the kind keeps: Update and Delete have no totals, sort or hidden column; only Append has Append To, only Update its
 *  Update To, only Delete its roles. */
function forKind(d: QbeDesign, kind: QbeKind, target?: string): QbeDesign {
  const action = kind === 'update' || kind === 'delete';
  const columns = d.columns.map((c) => {
    let x: QbeColumn = c;
    if (action) x = { ...without(x, 'sort', 'total'), show: true };
    if (kind !== 'append') x = without(x, 'appendTo');
    if (kind !== 'update') x = without(x, 'updateTo');
    x = kind === 'delete' ? { ...x, deleteRole: x.deleteRole ?? (x.field.trim() === '*' ? 'from' : 'where') } : without(x, 'deleteRole');
    return x;
  });
  const { target: _old, ...rest } = d;
  return { ...rest, kind, totals: action ? false : d.totals, columns, ...((kind === 'makeTable' || kind === 'append') && target !== undefined && { target }) };
}

export function qbeReducer(d: QbeDesign, a: QbeAction): QbeDesign {
  const cols = d.columns as GridColumn[];
  const setCol = (i: number, f: (c: QbeColumn) => QbeColumn): QbeDesign => {
    const list = [...cols];
    let uid = nextUid(list);
    while (list.length <= i) list.push(blank(d, uid++));
    list[i] = f(list[i]);
    return padded({ ...d, columns: list });
  };
  switch (a.type) {
    case 'addTable': {
      let alias = a.name, n = 0;
      while (d.tables.some((t) => sameName(aliasOf(t), alias))) alias = `${a.name}_${++n}`;
      const table = alias === a.name ? { name: a.name } : { name: a.name, alias };
      return { ...d, tables: [...d.tables, table], joins: [...d.joins, ...defaultJoins(d.tables, a.name, a.relations, alias)] };
    }
    case 'removeTable':
      return {
        ...d, tables: d.tables.filter((t) => !sameName(aliasOf(t), a.alias)),
        joins: d.joins.filter((j) => !sameName(j.l, a.alias) && !sameName(j.r, a.alias)),
        columns: cols.filter((c) => c.table === undefined || !sameName(c.table, a.alias)),
      };
    case 'addJoin': {
      const j = a.join;
      const same = (x: QbeJoin) => (sameName(x.l, j.l) && sameName(x.r, j.r) && sameName(x.lField, j.lField) && sameName(x.rField, j.rField))
        || (sameName(x.l, j.r) && sameName(x.r, j.l) && sameName(x.lField, j.rField) && sameName(x.rField, j.lField));
      return d.joins.some(same) ? d : { ...d, joins: [...d.joins, j] };
    }
    case 'setJoinKind': {
      const k = d.joins[a.index];
      if (!k) return d;
      const flip = (x: JoinKind): JoinKind => (x === 'left' ? 'right' : x === 'right' ? 'left' : x);
      return {
        ...d, joins: d.joins.map((j) => (sameName(j.l, k.l) && sameName(j.r, k.r) ? { ...j, kind: a.kind }
          : sameName(j.l, k.r) && sameName(j.r, k.l) ? { ...j, kind: flip(a.kind) } : j)),
      };
    }
    case 'removeJoin': return { ...d, joins: d.joins.filter((_, i) => i !== a.index) };
    case 'addField': {
      const at = a.at ?? (cols.findIndex((c) => c.field.trim() === '') + 1 || cols.length + 1) - 1;
      const star = a.field === '*';
      const col: GridColumn = {
        ...blank(d, nextUid(cols)), field: star ? '*' : bracket(a.field), table: a.table,
        ...(d.kind === 'delete' && { deleteRole: star ? 'from' as const : 'where' as const }),
      };
      const list = [...cols];
      if (list[at]?.field.trim() === '') list[at] = { ...col, uid: list[at].uid ?? col.uid };
      else list.splice(at, 0, col);
      return padded({ ...d, columns: list });
    }
    case 'setCell': {
      const { row, value: v } = a;
      const text = typeof v === 'string' ? v : '';
      const crit = /^criteria(\d+)$/.exec(row);
      if (crit) {
        return setCol(a.col, (c) => {
          const criteria = [...c.criteria];
          criteria[Number(crit[1])] = text;
          return { ...c, criteria: Array.from(criteria, (s) => s ?? '') };
        });
      }
      return setCol(a.col, (c) => {
        switch (row) {
          case 'field': return { ...c, field: text };
          case 'show': return { ...c, show: v === true };
          case 'table': case 'appendTo': case 'updateTo': return text ? { ...c, [row]: text } : without(c, row);
          case 'sort': return text ? { ...c, sort: text as 'asc' | 'desc' } : without(c, 'sort');
          case 'total': return { ...c, total: text as QbeTotal };
          case 'deleteRole': return { ...c, deleteRole: text as 'from' | 'where' };
          default: return c;
        }
      });
    }
    case 'insertColumn': {
      const list = [...cols];
      list.splice(a.at, 0, blank(d, nextUid(cols)));
      return padded({ ...d, columns: list });
    }
    case 'deleteColumn': return { ...d, columns: cols.filter((_, i) => i !== a.at) };
    case 'moveColumn': {
      const list = [...cols];
      const [c] = list.splice(a.from, 1);
      if (c) list.splice(a.to, 0, c);
      return { ...d, columns: list };
    }
    case 'setTotals':
      return { ...d, totals: a.on, columns: cols.map((c) => (a.on ? { ...c, total: c.total ?? 'groupBy' } : without(c, 'total'))) };
    case 'setKind': return forKind(d, a.kind, a.target);
    case 'insertRow': case 'deleteRow':
      return padded({ ...d, columns: cols.map((c) => {
        const criteria = [...c.criteria];
        if (a.type === 'insertRow') criteria.splice(a.at, 0, ''); else criteria.splice(a.at, 1);
        return { ...c, criteria };
      }) });
    case 'setProps': {
      const { top: _t, ...rest } = d;
      let out: QbeDesign = a.top === undefined ? d : a.top === null ? rest : { ...d, top: a.top };
      if (a.distinct !== undefined) out = { ...out, distinct: a.distinct };
      if (a.params) out = { ...out, params: a.params };
      if (a.outputAll !== undefined && a.outputAll !== outputAll(out)) {
        out = a.outputAll ? padded({ ...out, columns: [{ ...blank(out, nextUid(cols)), field: '*' }, ...cols] })
          : { ...out, columns: cols.filter((c) => !isOutputAll(c)) };
      }
      return out;
    }
  }
}

/** Output All Fields (Yes): a shown `*` of no table, which SQL writes `SELECT *, …`. */
const isOutputAll = (c: QbeColumn): boolean => c.field.trim() === '*' && c.table === undefined && c.show;
export const outputAll = (d: QbeDesign): boolean => d.columns.some(isOutputAll);

/** Top Values as typed in Access's box: empty or All (`all`, the interface's word) → null; `25` → TOP 25; `5%` → TOP 5
 *  PERCENT (up to 100); anything else undefined (refused). */
export function parseTop(text: string, all: string): QbeDesign['top'] | null | undefined {
  const s = text.trim();
  if (s === '' || s.toLowerCase() === all.toLowerCase()) return null;
  const m = /^(\d+)\s*(%?)$/.exec(s);
  const n = m ? Number(m[1]) : 0;
  if (!m || n < 1 || !Number.isSafeInteger(n) || (m[2] && n > 100)) return undefined;
  return { n, percent: !!m[2] };
}
export const topText = (top: QbeDesign['top'], all: string): string => (top ? `${top.n}${top.percent ? '%' : ''}` : all);

/** A Field cell's entry (canonical), as Access fills the Table row: a field qualified by a box, or `T.*`, goes to that box; a
 *  bare field to the column's box when it has it, else to the first box that has it; anything else (an expression, a
 *  parameter, an unknown box) stays as typed, without a table. */
export function fieldEntry(canonical: string, boxes: { alias: string; fields: string[] }[], table?: string): { field: string; table?: string } {
  const { alias, expr } = splitAlias(canonical);
  const star = /^\s*(?:\[((?:[^\]]|\]\])*)\]\.)?\*\s*$/.exec(expr);
  if (star) {
    const box = star[1] === undefined ? undefined : boxes.find((b) => sameName(b.alias, star[1].replace(/]]/g, ']')));
    return box ? { field: named(alias, '*'), table: box.alias } : star[1] === undefined ? { field: canonical, ...(table !== undefined && { table }) } : { field: canonical };
  }
  let e: Expr;
  try { e = parseCanonical(expr, QUERY_PARSE); } catch { return { field: canonical }; } // the cell's own check reports it
  if (e.k !== 'id') return { field: canonical };
  const has = (b: { alias: string; fields: string[] }) => b.fields.some((f) => sameName(f, e.name));
  const box = e.table !== undefined ? boxes.find((b) => sameName(b.alias, e.table!))
    : boxes.find((b) => table !== undefined && sameName(b.alias, table) && has(b)) ?? boxes.find(has);
  return box ? { field: named(alias, bracket(e.name)), table: box.alias } : { field: canonical };
}

/** The grid's rows for a kind, as Access shows them: Field, Table, Total (Totals), then Sort and Show (Select, Make-Table),
 *  Sort and Append To, Update To, or Delete, then Criteria and the « Or » rows. */
export function gridRows(d: QbeDesign): QbeRow[] {
  const n = Math.max(ROWS_MIN, ...d.columns.map((c) => c.criteria.length));
  const criteria = Array.from({ length: n }, (_, i) => `criteria${i}` as const);
  const head: QbeRow[] = ['field', 'table', ...(d.totals ? ['total' as const] : [])];
  switch (d.kind) {
    case 'update': return [...head, 'updateTo', ...criteria];
    case 'delete': return [...head, 'deleteRole', ...criteria];
    case 'append': return [...head, 'sort', 'appendTo', ...criteria];
    default: return [...head, 'sort', 'show', ...criteria];
  }
}

/** Cell errors (`<uid>:<row>`, or `new<i>:<row>` for a column not created yet) of cells the grid still shows: a column that
 *  is gone, a row the kind hides, or a cell of a column without a field (only Field and the criteria show) loses its error. */
export function pruneInvalid(invalid: Record<string, string>, d: QbeDesign): Record<string, string> {
  const rows = new Set<string>(gridRows(d));
  const cols = d.columns as GridColumn[];
  const keep = (k: string) => {
    const [id, row] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
    if (!rows.has(row)) return false;
    const always = row === 'field' || row.startsWith('criteria');
    if (id.startsWith('new')) return always && Number(id.slice(3)) >= cols.length;
    const c = cols.find((x) => String(x.uid) === id);
    return !!c && (always || c.field.trim() !== '');
  };
  return Object.fromEntries(Object.entries(invalid).filter(([k]) => keep(k)));
}

/** Why the grid cannot be saved (Task 7's obligations the grid itself must check), as a `bc:invalidQuery|<sub>|` message for
 *  useErrorDialog, or null: no shown field (a SELECT with no items, an Append with no Append To, an Update with no Update
 *  To), or a Delete over several tables with no From column (Access refuses it). fromQbe reports the others. */
export function designProblem(d: QbeDesign): string | null {
  const used = d.columns.filter((c) => c.field.trim() !== '');
  const noField = d.kind === 'append' ? !used.some((c) => c.appendTo?.trim() && c.total !== 'where')
    : d.kind === 'update' ? !used.some((c) => c.updateTo?.trim())
    : d.kind === 'delete' ? false
    : !used.some((c) => c.show && c.total !== 'where');
  if (noField) return 'bc:invalidQuery|noField|';
  if (d.kind === 'delete' && d.tables.length > 1 && !used.some((c) => c.deleteRole === 'from')) return 'bc:invalidQuery|deleteFrom|';
  return null;
}
