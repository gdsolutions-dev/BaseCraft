// Analyze Performance (K4): index suggestions read from the table designs, the relations and the saved queries. Pure module.
// ponytail: no row counts or statistics (a small table needs no index): every missing index is suggested; add them when needed.
import type { Relation } from '../../shared/api';
import { sameName, type TableDesign } from '../../shared/field-types';
import { parseSql } from '../../shared/query/sql-parser';
import { indexRows } from '../table-design/indexes-model';

export type Suggestion =
  | { kind: 'noPrimaryKey'; table: string }
  | { kind: 'relationIndex'; table: string; field: string; relation: string }
  | { kind: 'queryIndex'; table: string; field: string; query: string };
export interface PerfWorld { tables: TableDesign[]; relations: Relation[]; queries: { name: string; sql: string }[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Is `field` the first column of an index (or the primary key) of `d`? */
export const isIndexed = (d: TableDesign, field: string): boolean => indexRows(d).some((r) => sameName(r.fields[0]!.name, field));

interface Src { name: string; alias: string }
const fromSources = (n: unknown, out: Src[] = []): Src[] => {
  if (Array.isArray(n)) n.forEach((x) => fromSources(x, out));
  else if (isObj(n)) {
    if (n.k === 'source') out.push({ name: String(n.name), alias: String(n.alias ?? n.name) });
    else if (n.k === 'join') { fromSources(n.l, out); fromSources(n.r, out); }
  }
  return out;
};
const joinOns = (n: unknown, out: unknown[] = []): unknown[] => {
  if (Array.isArray(n)) n.forEach((x) => joinOns(x, out));
  else if (isObj(n) && n.k === 'join') { out.push(n.on); joinOns(n.l, out); joinOns(n.r, out); }
  return out;
};
interface Id { name: string; table?: string }
/** The columns a condition names; a subquery's own are read with its own SELECT. */
const ids = (n: unknown, out: Id[] = []): Id[] => {
  if (Array.isArray(n)) n.forEach((x) => ids(x, out));
  else if (isObj(n)) {
    if (n.k === 'id') out.push({ name: String(n.name), ...(typeof n.table === 'string' ? { table: n.table } : {}) });
    else for (const [k, v] of Object.entries(n)) if (k !== 'q') ids(v, out);
  }
  return out;
};

/** The (table, field) pairs a SQL text filters or joins on. */
export function filteredFields(sql: string, designs: TableDesign[]): { table: string; field: string }[] {
  const found: { table: string; field: string }[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (isObj(n)) {
      if (n.k === 'select' || n.k === 'update' || n.k === 'delete') {
        const srcs = fromSources(n.from).flatMap((s) => { const d = designs.find((x) => sameName(x.name, s.name)); return d ? [{ ...s, d }] : []; });
        for (const id of ids([n.where, joinOns(n.from)])) {
          const hit = id.table !== undefined ? srcs.filter((s) => sameName(s.alias, id.table!) || sameName(s.name, id.table!))
            : srcs.filter((s) => s.d.fields.some((f) => sameName(f.name, id.name)));
          const field = hit.length === 1 ? hit[0]!.d.fields.find((f) => sameName(f.name, id.name)) : undefined;
          if (field && !found.some((x) => sameName(x.table, hit[0]!.d.name) && sameName(x.field, field.name))) found.push({ table: hit[0]!.d.name, field: field.name });
        }
      }
      Object.values(n).forEach(walk);
    }
  };
  try { walk(parseSql(sql)); } catch { /* unparsable (pass-through) SQL suggests nothing */ }
  return found;
}

/** The suggestions of the base, tables without a key first. */
export function analyzePerformance(w: PerfWorld): Suggestion[] {
  const design = (t: string) => w.tables.find((d) => sameName(d.name, t));
  const out: Suggestion[] = w.tables.filter((d) => !d.fields.some((f) => f.props.primaryKey)).map((d) => ({ kind: 'noPrimaryKey', table: d.name }));
  const has = (table: string, field: string) => out.some((s) => s.kind !== 'noPrimaryKey' && sameName(s.table, table) && sameName(s.field, field));
  for (const r of w.relations) {
    const d = design(r.childTable);
    if (d && !isIndexed(d, r.childFields[0]!) && !has(d.name, r.childFields[0]!)) out.push({ kind: 'relationIndex', table: d.name, field: r.childFields[0]!, relation: r.name });
  }
  for (const q of w.queries) {
    for (const f of filteredFields(q.sql, w.tables)) {
      if (!isIndexed(design(f.table)!, f.field) && !has(f.table, f.field)) out.push({ kind: 'queryIndex', table: f.table, field: f.field, query: q.name });
    }
  }
  return out;
}
