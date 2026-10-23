// Requêtes action (A3) : Création de table, Ajout, Mise à jour et Suppression. Les lignes visées sont lues par un SELECT
// compilé et autorisé (compileAction), puis écrites une à une par la couche d'écriture (règles, Null interdit, relations et
// cascades, comme une saisie en feuille de données ; jamais les masques), dans une seule transaction.
import type { DatabaseSync } from 'node:sqlite';
import type { ActionResult, RowWriteResult, RunActionOptions } from '../../shared/api';
import type { CellInput } from '../../shared/coerce';
import { ExprRuntimeError } from '../../shared/expr/ast';
import { toStored } from '../../shared/expr/evaluate';
import { decodeValue, type SqlOut } from '../../shared/expr/sql';
import { defaultProps, sameName, type FieldDef, type FieldProps, type TableDesign } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import type { BoundColumn } from '../../shared/query/bind';
import { invalidQueryError } from '../../shared/query/definition';
import { createTable, dataDesign, DesignValidationError, dropTable, isQueryName, listTables, NameExistsError, tableDesign } from '../db/schema';
import { inTransactionAsync } from '../db/tx';
import { deleteRows, insertRow, updateRow } from '../db/write-layer';
import { compileAction } from './compile';
import { paramValues, resolve, run, type QueryCtx, type QueryRef } from './source';

type FieldError = Extract<RowWriteResult, { ok: false }>['errors'][number];
type ByCause = Extract<ActionResult, { reason: 'rowErrors' }>['byCause'];
/** Access's causes of a refused row: a key (duplicate, missing parent, related records), else a rule (Validation Rule,
 *  Required, an AutoNumber changed…). `conversion` counts only the FIELDS set to Null (a value the field cannot store, an
 *  error value), as Access counts them. BaseCraft takes no record locks. */
const causeOf = (code: FieldError['code']): 'key' | 'validation' => (['duplicate', 'noParent', 'related'].includes(code) ? 'key' : 'validation');
/** A refusal that rolls the whole run back. */
class Refused extends Error {
  constructor(readonly result: ActionResult) { super('refused'); }
}

/** The bound action query of `ref` and its compiled rows (bc:invalidArgument for a select query; source.ts's errors). */
function prepare(db: DatabaseSync, ref: QueryRef, params: Record<string, CellInput>, info: LocaleInfo) {
  const b = resolve(db, ref, true);
  try {
    return { b, ...compileAction(b, paramValues(b, params, info), { locale: info.locale }) };
  } catch (e) {
    throw invalidQueryError(e, false) ?? e; // tooComplex
  }
}

/** The rows the query would write (distinct target rows for Update, Delete; else the rows read) and the table it writes
 *  (Make-Table: the existing table it would replace, as spelled now, else its INTO name). */
export function actionCount(db: DatabaseSync, ref: QueryRef, params: Record<string, CellInput>, ctx: QueryCtx): { count: number; table: string } {
  const { b, select, target } = prepare(db, ref, params, ctx.info);
  const count = Number(run(db, `SELECT count(${select.hasRowid ? 'DISTINCT "bcx_rowid"' : '*'}) FROM (${select.sql})`, select.params)[0][0]);
  const table = b.query.body.k === 'select' ? listTables(db).find((x) => sameName(x.name, target))?.name ?? target : target;
  return { count, table };
}

/** Each encoded value converted as its field stores it; a value that is an error becomes Null (`nulled`: expressionError),
 *  as Access writes a type conversion failure. */
function inputs(fields: FieldDef[], cells: SqlOut[], info: LocaleInfo): { values: Record<string, CellInput>; nulled: FieldError[] } {
  const values: Record<string, CellInput> = {};
  const nulled: FieldError[] = [];
  for (const [i, fd] of fields.entries()) {
    try {
      values[fd.name] = toStored(fd, decodeValue(cells[i]!), info);
    } catch (e) {
      if (!(e instanceof ExprRuntimeError)) throw e;
      values[fd.name] = null;
      nulled.push({ field: fd.name, code: 'expressionError' });
    }
  }
  return { values, nulled };
}

/** A Make-Table field: the column's type and size only, as Access (no key, no rule, not required); AutoNumber -> Long Integer. */
function madeField(c: BoundColumn): FieldDef {
  if (c.type === 'autoNumber') return { name: c.name, props: { ...defaultProps('number'), numberSize: 'longInteger' } };
  const props: FieldProps = defaultProps(c.type);
  for (const k of ['numberSize', 'precision', 'scale', 'size'] as const) if (c.props[k] !== undefined) Object.assign(props, { [k]: c.props[k] });
  return { name: c.name, props };
}

/**
 * Runs the action query `ref` (Access's protocol): every row through the write layer, in one transaction. A row refused
 * (rules, Required, noParent, duplicate…) or a field set to Null (a value it cannot store: nullOnConversion) rolls everything
 * back (`rowErrors`, counted by cause) unless `skipFailures`: the valid rows are then written, with those Nulls. A delete that related records refuse deletes the rows they do not hold the same way
 * (key violations), or is refused as a whole (`related`) when they hold every row. Make-Table never replaces a query (`nameExists`), replaces an existing table only with `replaceTable`
 * (`tableExists`), after dropTable (`hasRelations`, `related`); a column name no field can take: `badColumnName`.
 */
export async function runAction(db: DatabaseSync, ref: QueryRef, params: Record<string, CellInput>, opts: RunActionOptions, ctx: QueryCtx & { now: () => Date }): Promise<ActionResult> {
  const { b, select, target } = prepare(db, ref, params, ctx.info);
  const body = b.query.body;
  const rows = run(db, select.sql, select.params) as unknown as SqlOut[][]; // read first: a query may read its own target
  const existing = body.k === 'select' ? listTables(db).find((x) => sameName(x.name, target))?.name : undefined; // Make-Table's
  if (body.k === 'select') {
    if (isQueryName(db, target)) return { ok: false, reason: 'nameExists', table: target };
    if (existing && !opts.replaceTable) return { ok: false, reason: 'tableExists', table: existing };
  }
  const info = ctx.info;
  let written = 0;
  let failed = 0;
  let nulledFields = 0;
  const errors: FieldError[] = [];
  const byCause: ByCause = { conversion: 0, key: 0, lock: 0, validation: 0 };
  /** A row: its values converted, then written by `write`. */
  const row = async (v: ReturnType<typeof inputs>, write: (values: Record<string, CellInput>) => Promise<RowWriteResult>) => {
    const r = await write(v.values);
    if (r.ok) {
      written++;
      const nulled = [...v.nulled, ...(r.nulled ?? [])];
      nulledFields += nulled.length;
      byCause.conversion += nulled.length;
      for (const e of nulled) if (errors.length < 5) errors.push(e);
      return;
    }
    failed++;
    byCause[causeOf(r.errors[0]!.code)]++;
    if (errors.length < 5) errors.push(r.errors[0]!);
  };

  try {
    return await inTransactionAsync(db, async (): Promise<ActionResult> => {
      let total = rows.length;
      if (body.k === 'delete') {
        const table = dataDesign(db, target).name;
        const ids = [...new Set(rows.map((r) => Number(r[0])))];
        const all = deleteRows(db, table, ids);
        if (all.ok) return { ok: true, count: all.count };
        // refused: row by row, the rows related records hold are key violations (Access)
        for (const id of ids) {
          await row({ values: {}, nulled: [] }, async () => {
            const one = deleteRows(db, table, [id]);
            return one.ok ? { ok: true, rowid: id, values: [] } : { ok: false, errors: [{ field: '', code: 'related', ...(one.table !== undefined && { table: one.table }) }] };
          });
        }
        if (!written) throw new Refused({ ok: false, reason: 'related', table: all.table ?? '' }); // nothing to run anyway
        total = ids.length;
      } else if (body.k === 'update') {
        const design = dataDesign(db, target);
        const fields = body.set.map((s) => {
          const r = b.refs.get(s.target);
          return design.fields.find((x) => r?.kind === 'column' && sameName(x.name, r.field))!;
        });
        const seen = new Set<number>();
        for (const r of rows) {
          const rowid = Number(r[0]);
          if (seen.has(rowid)) continue; // a join gives a row more than once: its first values win
          seen.add(rowid);
          await row(inputs(fields, r.slice(1), info), (v) => updateRow(db, design, rowid, v, info, ctx.now, { enforceMask: false, nullOnConversion: true }));
        }
        total = seen.size;
      } else {
        let design: TableDesign;
        if (body.k === 'select') { // Make-Table
          if (existing) {
            const d = dropTable(db, existing);
            if (!d.ok) throw new Refused(d.reason === 'referenced' ? { ok: false, reason: 'related', table: d.table } : { ok: false, reason: 'hasRelations' });
          }
          try {
            createTable(db, { name: target, fields: b.columns.map(madeField) });
          } catch (e) { // a column name no field can take (T.F, the name of two sources' fields): the old table stays
            if (e instanceof DesignValidationError) throw new Refused({ ok: false, reason: 'badColumnName', column: e.errors.find((x) => x.field)?.field ?? '' });
            if (e instanceof NameExistsError) throw new Refused({ ok: false, reason: 'nameExists', table: target });
            throw e;
          }
          design = tableDesign(db, target);
        } else design = dataDesign(db, target);
        // a field list, else (Append from a SELECT) each output column's field of the same name, else every field in order
        const names = body.k !== 'insert' ? null : body.columns.length ? body.columns
          : 'values' in body.source ? null : b.selects.get(body.source)!.columns.map((c) => c.name);
        const fields = names ? names.map((n) => design.fields.find((x) => sameName(x.name, n))!) : design.fields;
        for (const r of rows) await row(inputs(fields, r, info), (v) => insertRow(db, design, v, info, ctx.now, { enforceMask: false, allowAutoNumber: true, nullOnConversion: true }));
      }
      if ((failed || nulledFields) && !opts.skipFailures) throw new Refused({ ok: false, reason: 'rowErrors', failed, total, errors, byCause });
      return { ok: true, count: written };
    });
  } catch (e) {
    if (e instanceof Refused) return e.result;
    throw e;
  }
}
