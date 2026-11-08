import type { DatabaseSync } from 'node:sqlite';
import type { CellInput } from '../shared/coerce';
import type { LocaleInfo } from '../shared/locale-format';
import { dataDesign, listTables, pickName } from '../main/db/schema';
import { isLinkName } from '../main/links/store';
import { insertRow } from '../main/db/write-layer';
import type { OpOutcome } from './ops';

const refuse = (message: string): OpOutcome => ({ ok: false, message });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCell = (v: unknown): v is CellInput => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Inserts rows through the application's write layer (conversion, defaults, rules, keys), as programmatic writes do:
 *  input masks and Limit To List do not apply. Text values are read in the canonical locale (1234.5, 2026-01-31). */
export async function rowsInsert(db: DatabaseSync, args: Record<string, unknown>, info: LocaleInfo): Promise<OpOutcome> {
  const { table: rawTable, rows } = args;
  if (typeof rawTable !== 'string') return refuse('"table" must be a string');
  if (!Array.isArray(rows)) return refuse('"rows" must be an array of objects');
  if (isLinkName(db, rawTable)) return refuse(`table is external (linked): ${rawTable}`);
  const table = pickName(listTables(db).map((t) => t.name), rawTable);
  if (table === undefined) return refuse(`table not found: ${rawTable}`);
  let design;
  try { design = dataDesign(db, table); } catch { return refuse(`rows cannot be written to this table: ${table}`); }
  const names = design.fields.map((f) => f.name);
  for (const [i, row] of rows.entries()) {
    if (!isObject(row)) return refuse(`row #${i}: must be an object of field values`);
    const values: Record<string, CellInput> = {};
    for (const [k, v] of Object.entries(row)) {
      const field = pickName(names, k);
      if (field === undefined) return refuse(`row #${i}: field not found: ${k}`);
      if (!isCell(v)) return refuse(`row #${i}, field "${field}": value must be a string, number, boolean or null`);
      values[field] = v;
    }
    let r;
    try { r = await insertRow(db, design, values, info); } catch (e) { return refuse(`row #${i}: ${e instanceof Error ? e.message : String(e)}`); }
    if (!r.ok) {
      const e = r.errors[0]!;
      return refuse(`row #${i}${e.field ? `, field "${e.field}"` : ''}: ${e.code}${e.message ? `: ${e.message}` : ''}${e.table ? ` (${e.table})` : ''}`);
    }
  }
  return { ok: true };
}
