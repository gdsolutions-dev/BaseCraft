// Name AutoCorrect (O4): a plan's writes (src/shared/autocorrect/plan.ts) inside the rename's transaction, and the log table (R9).
import type { DatabaseSync } from 'node:sqlite';
import type { AutoCorrectReport, LogLabels, PropertyItem } from '../../shared/api';
import { flattenControls, type DesignDoc } from '../../shared/design/model';
import type { AutoCorrectPlan } from '../../shared/autocorrect/plan';
import { defaultProps, sameName, type FieldType } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { getObject } from './objects';
import { inTransaction } from './tx';
import { createTable, dataDesign, listTables, NameExistsError, setFieldLookup } from './schema';
import { saveStartupOptions, startupOptions } from './startup';
import { insertRow } from './write-layer';

const LOG_TYPES: FieldType[] = ['shortText', 'shortText', 'shortText', 'shortText', 'longText', 'longText', 'dateTime'];

/** The plan's writes, in the caller's transaction (a throw rolls the rename back too): each definition under its exact stored
 *  name, the lookups, the startup form; then, with `log`, one row per entry (R9). */
export async function applyAutoCorrect(db: DatabaseSync, plan: AutoCorrectPlan, log: LogLabels | null, info: LocaleInfo): Promise<Pick<AutoCorrectReport, 'logTable' | 'logSkipped'>> {
  const now = new Date().toISOString();
  const upd = db.prepare('UPDATE bc_objects SET definition = ?, modified = ? WHERE kind = ? AND name = ?');
  for (const o of plan.objects) {
    if (Number(upd.run(JSON.stringify(o.definition), now, o.kind, o.name).changes) !== 1) throw new Error(`unknown object: ${o.kind} ${o.name}`);
  }
  for (const l of plan.lookups) setFieldLookup(db, l.table, l.field, l.lookup);
  if (plan.startupForm !== undefined) saveStartupOptions(db, { ...startupOptions(db), startupForm: plan.startupForm });
  return log && plan.entries.length ? writeLog(db, plan, log, info) : {};
}

/** R9: the table found by name (sameName), else created; used only when it has the seven fields. A refused row throws. */
async function writeLog(db: DatabaseSync, plan: AutoCorrectPlan, log: LogLabels, info: LocaleInfo): Promise<Pick<AutoCorrectReport, 'logTable' | 'logSkipped'>> {
  let table = listTables(db).find((x) => sameName(x.name, log.table))?.name;
  if (table === undefined) {
    const fields = log.fields.map((name, i) => ({ name, props: i === 6 ? { ...defaultProps('dateTime'), defaultValue: 'Now()' } : defaultProps(LOG_TYPES[i]!) }));
    try { createTable(db, { name: log.table, fields }); } catch (e) {
      if (e instanceof NameExistsError) return { logSkipped: true, logTable: log.table }; // a query or a link of that name
      throw e;
    }
    table = log.table.normalize('NFC');
  }
  const design = dataDesign(db, table);
  const names = log.fields.map((n) => design.fields.find((x) => sameName(x.name, n))?.name);
  if (names.some((n) => n === undefined)) return { logSkipped: true, logTable: table };
  for (const e of plan.entries) {
    const kind = (log.kinds as Record<string, string>)[e.kind] ?? e.kind;
    const values = [kind, e.name, e.control, e.property, e.old, e.new ?? log.failed[e.reason ?? 'unreadable']];
    const r = await insertRow(db, design, Object.fromEntries(values.map((v, i) => [names[i]!, v])), info);
    if (!r.ok) throw new Error(`bc:autoCorrectLog|${design.name}|${r.errors[0]?.field ?? ''}`);
  }
  return { logTable: design.name };
}

/** R12: each item's value written to its control (an empty value removes the property: the control inherits the field's), in one
 *  transaction; a missing, unreadable or malformed object or a missing control is skipped. The number of controls written. */
export function applyPropertyUpdates(db: DatabaseSync, items: PropertyItem[]): number {
  return inTransaction(db, () => {
    const now = new Date().toISOString();
    const docs = new Map<string, { kind: PropertyItem['kind']; name: string; doc: DesignDoc }>();
    let count = 0;
    for (const it of items) {
      let obj: ReturnType<typeof getObject>;
      try { obj = getObject(db, it.kind, it.name); } catch { continue; }
      const doc = obj && (obj.definition as DesignDoc);
      if (!obj || !doc || !Array.isArray(doc.sections)) continue;
      const key = `${it.kind}|${obj.name}`;
      const entry = docs.get(key) ?? { kind: it.kind, name: obj.name, doc };
      const c = entry.doc.sections.flatMap((s) => flattenControls(s.controls ?? [])).find((x) => sameName(x.name, it.control));
      if (!c) continue;
      if (it.value === '') delete c.props[it.prop]; else c.props[it.prop] = it.value;
      docs.set(key, entry);
      count++;
    }
    const upd = db.prepare('UPDATE bc_objects SET definition = ?, modified = ? WHERE kind = ? AND name = ?');
    for (const e of docs.values()) upd.run(JSON.stringify(e.doc), now, e.kind, e.name);
    return count;
  });
}
