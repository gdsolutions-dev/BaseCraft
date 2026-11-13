// Runs a table's data macros (T2) for the write layer: builds the host of shared/macro/data-macro.ts over the rows being written.
// Everything happens inside the write's transaction and in the main process; the macro reaches nothing but the row and its table.
import type { DatabaseSync } from 'node:sqlite';
import type { CellInput, SqlValue } from '../../shared/coerce';
import type { Value } from '../../shared/expr/ast';
import { fromStored, toStored } from '../../shared/expr/evaluate';
import { fail } from '../../shared/expr/library';
import { sameName, type TableDesign } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { runDataMacro, type DataEvent, type DataMacros } from '../../shared/macro/data-macro';
import { dataDesign, getDataMacros, listTables, pickName } from './schema';
import { insertRow } from './write-layer';   // a cycle used only at call time (CreateRecord)

/** The table's data macros; none for a table that has none (the usual case: one small read per write).
 *  ponytail: read per write, cache by the bc_tables row version if bulk imports into a table with macros get slow. */
export const dataMacrosOf = (db: DatabaseSync, design: TableDesign): DataMacros => getDataMacros(db, design.name);

export type EventOutcome = { ok: true; sets: Record<string, CellInput> } | { ok: false; message: string };
export type Row = Record<string, SqlValue>;

/** Runs the macro of `event`, if any. `old`: the row before (absent for an insert); `next`: the row as it will be stored (absent for
 *  a delete, where `[Field]` reads the deleted row). Before events fail with the RaiseError message; for an After event the
 *  caller ignores a failure (ponytail: Access logs it in USysApplicationLog, BaseCraft has no log yet). */
export async function runEvent(db: DatabaseSync, dm: DataMacros, event: DataEvent, design: TableDesign, rows: { old?: Row; next?: Row }, info: LocaleInfo, now: () => Date, depth = 1): Promise<EventOutcome> {
  const def = dm.events?.[event];
  if (!def) return { ok: true, sets: {} };
  const sets: Record<string, CellInput> = {};
  const overrides = new Map<string, Value>();
  const fieldOf = (name: string) => design.fields.find((f) => sameName(f.name, name)) ?? fail('unknownField');
  const r = await runDataMacro(def, `${design.name}: ${event}`, {
    field: (name, old) => {
      const fd = fieldOf(name);
      const row = old ? rows.old : rows.next ?? rows.old;
      if (!old && overrides.has(fd.name)) return overrides.get(fd.name)!;
      return row ? fromStored(fd, row[fd.name] ?? null) : null;
    },
    setField: (name, v) => { const fd = fieldOf(name); sets[fd.name] = toStored(fd, v, info); overrides.set(fd.name, v); },
    createRecord: async (table, values, at) => {
      const target = dataDesign(db, pickName(listTables(db).map((x) => x.name), table) ?? table);   // bc:notFound / bc:unsupportedTable reject
      const inputs: Record<string, CellInput> = {};
      for (const [name, v] of Object.entries(values)) { const fd = target.fields.find((f) => sameName(f.name, name)) ?? fail('unknownField'); inputs[fd.name] = toStored(fd, v, info); }
      const r = await insertRow(db, target, inputs, info, now, { macroDepth: at + 1 });
      if (!r.ok) { const e = 'errors' in r ? r.errors[0] : undefined; throw new Error(`${target.name}: ${e?.message ?? `${e?.field ?? ''} ${e?.code ?? 'refused'}`.trim()}`); }
    },
    named: (name) => Object.entries(dm.named ?? {}).find(([n]) => sameName(n, name))?.[1],
    now, locale: info.locale,
  }, { event, depth });
  return r.ok ? { ok: true, sets } : { ok: false, message: r.message };
}

