// A record written through an updatable query (B4 R2, R3) and AutoLookup (R4). A save writes the key table, then each "one"
// table on the row the query's own join locates from the key row (FROM … ON, Access comparison, no WHERE), all in one
// transaction through the write layer; a lookup only reads.
import type { DatabaseSync } from 'node:sqlite';
import { coerce, type CellInput, type SqlValue } from '../../shared/coerce';
import type { Expr } from '../../shared/expr/ast';
import { compileSql, type SqlRef } from '../../shared/expr/sql';
import { quoteIdent, sameName, type FieldDef, type TableDesign } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { toSourceInfo, type BoundQuery } from '../../shared/query/bind';
import type { WriteTable } from '../../shared/query/write-plan';
import { writableColumn, type SourceSaveRequest, type SourceSaveResult } from '../../shared/record-source';
import { inTransactionAsync } from '../db/tx';
import { insertRow, updateRow, type RowWriteResult } from '../db/write-layer';
import { compileLocator } from './compile';
import { run } from './source';

type FieldError = Extract<RowWriteResult, { ok: false }>['errors'][number];

/** A refusal inside the save's transaction: rolls every table back and carries its errors out. */
class Refused extends Error { constructor(readonly errors: FieldError[]) { super('refused'); } }

const designOf = (level: BoundQuery, w: WriteTable): TableDesign => level.sources.find((s) => s.alias === w.alias)!.design!;
const fieldOf = (d: TableDesign, name: string): FieldDef => d.fields.find((x) => sameName(x.name, name))!;
const sameOrigin = (o: { table: string; field: string } | undefined, table: string, field?: string): boolean =>
  !!o && sameName(o.table, table) && (field === undefined || sameName(o.field, field));

/** The rowid of each table of `level.writePlan` (plan order) on the join's row of key row `keyRowid`; null for a table the
 *  row has none of (an outer join, or no parent at all); 'ambiguous' when the join finds several rows (R3: never a guess). */
export function locateRow(db: DatabaseSync, level: BoundQuery, keyRowid: number, info: LocaleInfo): (number | null)[] | 'ambiguous' {
  const c = compileLocator(level, { locale: info.locale });
  const rows = run(db, c.sql, [...c.params, keyRowid]);
  if (rows.length > 1) return 'ambiguous';
  return rows.length ? rows[0].map((x) => (x === null ? null : Number(x))) : level.writePlan!.map(() => null);
}

/**
 * Saves one record of an updatable query (R2, R3): every value's output column must be writable (writableColumn), else
 * readOnly on it and nothing written; a source that is not updatable: readOnly on its first column. Then, in one
 * transaction: the key table (insert when `req.rowid` is null, update when it has values), then each "one" table with
 * values on the parent located after the writes before it (no parent: noParent; found twice: readOnly; `table` set). Any
 * refusal rolls every table back; errors name output columns.
 */
export async function saveSourceRow(db: DatabaseSync, b: BoundQuery, req: SourceSaveRequest, info: LocaleInfo): Promise<SourceSaveResult> {
  if (!b.updatable || !b.writePlan || !b.writeLevel) return { ok: false, errors: [{ field: b.columns[0]?.name ?? '', code: 'readOnly' }] };
  const plan = b.writePlan, level = b.writeLevel, src = toSourceInfo(b);
  const names = Object.keys(req.values);
  const refused = names.filter((n) => !writableColumn(src, n));
  if (refused.length) return { ok: false, errors: refused.map((field) => ({ field, code: 'readOnly' as const })) };
  // the request's columns in output order, with the plan table and field each writes
  const cols = b.columns.flatMap((c) => {
    const n = names.find((x) => sameName(x, c.name));
    return n === undefined ? [] : [{ name: n, at: plan.findIndex((w) => sameOrigin(c.origin, w.table)), field: c.origin!.field }];
  }).filter((c, i, all) => all.findIndex((x) => x.name === c.name) === i);
  const valuesOf = (i: number): Record<string, CellInput> =>
    Object.fromEntries(cols.filter((c) => c.at === i).map((c) => [c.field, req.values[c.name]])); // fromEntries: a field named __proto__ stays a key
  /** A write layer error under the output column of its field (the request's first, else the query's, else the field). */
  const mapped = (i: number, errors: FieldError[]): FieldError[] => errors.map((e) => {
    const field = cols.find((c) => c.at === i && sameName(c.field, e.field))?.name
      ?? b.columns.find((c) => sameOrigin(c.origin, plan[i].table, e.field))?.name ?? e.field;
    return { ...e, field, ...(plan[i].role === 'one' && e.table === undefined && { table: plan[i].table }) };
  });
  const opts = { enforceMask: true }; // datasheet and form entry

  try {
    return await inTransactionAsync(db, async () => {
      let rowid = req.rowid;
      const keyValues = valuesOf(0);
      if (rowid === null || Object.keys(keyValues).length) {
        const kd = designOf(level, plan[0]);
        const r = rowid === null ? await insertRow(db, kd, keyValues, info, undefined, opts) : await updateRow(db, kd, rowid, keyValues, info, undefined, opts);
        if (!r.ok) throw new Refused(mapped(0, r.errors));
        rowid = r.rowid;
      }
      for (let i = 1; i < plan.length; i++) {
        const values = valuesOf(i);
        if (!Object.keys(values).length) continue;
        const first = cols.find((c) => c.at === i)!.name;
        const at = locateRow(db, level, rowid, info); // again for each table: a chain's link may have just changed
        if (at === 'ambiguous') throw new Refused([{ field: first, code: 'readOnly', table: plan[i].table }]);
        if (at[i] === null) throw new Refused([{ field: first, code: 'noParent', table: plan[i].table }]);
        const r = await updateRow(db, designOf(level, plan[i]), at[i]!, values, info, undefined, opts);
        if (!r.ok) throw new Refused(mapped(i, r.errors));
      }
      // read back: each plan table's row, for its output columns
      const at = locateRow(db, level, rowid, info);
      const out: [string, SqlValue][] = [];
      for (const c of b.columns) {
        const i = plan.findIndex((w) => sameOrigin(c.origin, w.table));
        const id = i === 0 ? rowid : i < 0 || at === 'ambiguous' ? undefined : at[i];
        if (id === undefined) continue;
        const s = db.prepare(`SELECT ${quoteIdent(c.origin!.field)} FROM ${quoteIdent(plan[i].table)} WHERE rowid = ?`);
        s.setReturnArrays(true);
        out.push([c.name, id === null ? null : ((s.get(id) as unknown as SqlValue[] | undefined)?.[0] ?? null)]);
      }
      return { ok: true as const, rowid, values: Object.fromEntries(out) };
    });
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors };
    throw e;
  }
}

/**
 * AutoLookup (R4): each "one" table, in plan order, looked up from its link's child values: the field of the table looked
 * up before it (a chain: the new parent wins over the request's stale value), else a value of `values` (by output column,
 * converted as the child field stores it). A table whose
 * link values are not all there is not looked up. The lookup compares as the join (bc_* `=`); no parent, or several, gives
 * Nulls. Returns every output column of each looked-up table. Reads only.
 */
export function autoLookup(db: DatabaseSync, b: BoundQuery, values: Record<string, CellInput>, info: LocaleInfo): Record<string, SqlValue> {
  if (!b.updatable || !b.writePlan || !b.writeLevel) return {};
  const plan = b.writePlan, level = b.writeLevel;
  const found = new Map<string, Record<string, SqlValue> | null>(); // by alias: the parent's fields, null when none
  const out: [string, SqlValue][] = [];
  for (const w of plan.slice(1)) {
    const via = plan.find((x) => x.alias === w.parent!.via)!;
    const vd = designOf(level, via), od = designOf(level, w);
    const child = w.parent!.pairs.map((p): SqlValue | undefined => {
      // a parent just looked up wins: the request's value of its field is the old parent's (R4 drops it)
      if (found.has(via.alias)) return found.get(via.alias)?.[fieldOf(vd, p.child).name] ?? null;
      const col = b.columns.find((c) => sameOrigin(c.origin, via.table, p.child) && Object.keys(values).some((k) => sameName(k, c.name)));
      if (col) {
        const input = values[Object.keys(values).find((k) => sameName(k, col.name))!];
        const fd = fieldOf(vd, p.child);
        const r = coerce(fd.props.type === 'autoNumber' ? { name: fd.name, props: { ...fd.props, type: 'number', numberSize: 'longInteger' } } : fd, input, info);
        return r.ok ? r.value : null;
      }
      return undefined;
    });
    if (child.some((v) => v === undefined)) continue;
    // the ON's equalities, the child side bound
    const refs = new Map<object, SqlRef>();
    const eq = w.parent!.pairs.map((p, k): Expr => {
      const l: Expr = { k: 'id', name: p.field }, r: Expr = { k: 'id', name: p.child };
      refs.set(l, { sql: quoteIdent(fieldOf(od, p.field).name), params: [], type: fieldOf(od, p.field).props.type });
      refs.set(r, { sql: '?', params: [child[k]!], type: fieldOf(vd, p.child).props.type });
      return { k: 'bin', op: '=', l, r };
    });
    const cond = compileSql(eq.reduce((l, r): Expr => ({ k: 'bin', op: 'And', l, r })), { fields: [], locale: info.locale, ref: (n) => refs.get(n) ?? null });
    const rows = run(db, `SELECT ${od.fields.map((x) => quoteIdent(x.name)).join(', ')} FROM ${quoteIdent(od.name)} WHERE ${cond.sql} LIMIT 2`, cond.params);
    const row = rows.length === 1 ? Object.fromEntries(od.fields.map((x, i) => [x.name, rows[0][i]])) : null;
    found.set(w.alias, row);
    for (const c of b.columns) if (sameOrigin(c.origin, w.table)) out.push([c.name, row?.[c.origin!.field] ?? null]);
  }
  return Object.fromEntries(out);
}
