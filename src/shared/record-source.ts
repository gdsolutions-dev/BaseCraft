// Source d'enregistrements d'une feuille de requête, d'un formulaire ou d'un état (contrat A3/A4/A5, section 1.2).
// Le socle sert `table` ; le lot A3 sert `query` et `sql` (src/main/query/source.ts) sans changer ces types.
import type { FieldFilter, RowWriteResult } from './api';
import type { CellInput, SqlValue } from './coerce';
import { sameName, type FieldProps, type FieldType } from './field-types';

/** Sort key; several keys sort by the first, then the next… */
export interface SortSpec { field: string; dir: 'asc' | 'desc' }

export type RecordSourceRef = { kind: 'table'; name: string } | { kind: 'query'; name: string } | { kind: 'sql'; sql: string /* canonique */ };
export interface SourceField { name: string; type: FieldType; props: FieldProps; origin?: { table: string; field: string } }
/** A table written through an updatable source (B4 R1, R2). */
export interface SourceTable { table: string; role: 'key' | 'one'; readOnly: string[]; lookupBy: string[] /* output columns whose change looks this table up, chains included (R4) */ }
export interface SourceInfo { fields: SourceField[]; updatable: boolean; keyTable?: string;
  parameters: { name: string; type: FieldType | null; props?: FieldProps }[];
  tables?: SourceTable[] /* updatable query or sql sources; [0] = keyTable */
  /** A crosstab (B4 R11): its headings from its IN list, from the data, or still unknown (the data, with parameters not given:
   *  `fields` are its row columns only). */
  crosstab?: { headings: 'fixed' | 'data' | 'needsParameters' } }
export interface SourcePageRequest { offset: number; limit: number; sort?: SortSpec[]; filter?: FieldFilter[]; params?: Record<string, CellInput>;
  where?: string /* an opening's Where Condition: canonical expression over the source's output columns, no member; ANDed with filter */ }
export interface SourcePage { rows: SqlValue[][]; rowids: (number | null)[]; total: number; columns?: string[] /* a crosstab: this page's column names (R14) */ }
/** A record saved through an updatable query or SQL source (B4 R2, R3). */
export interface SourceSaveRequest { rowid: number | null /* key table rowid; null = new record */; values: Record<string, CellInput> /* by output column */ }
export type SourceSaveResult = { ok: true; rowid: number; values: Record<string, SqlValue> /* re-read columns of the plan's tables, by output column */ }
  | Extract<RowWriteResult, { ok: false }>;   // errors[].field = output column; table set for a 'one' table

/** An output column the user may write (R2): its origin is in one of `tables` and not a read-only join field; without
 *  `tables`, A3's rule (its origin is in `keyTable`). Computed or unknown columns never. */
export function writableColumn(info: SourceInfo, name: string): boolean {
  const origin = info.fields.find((f) => sameName(f.name, name))?.origin;
  if (!info.updatable || !origin) return false;
  if (!info.tables) return info.keyTable !== undefined && sameName(origin.table, info.keyTable);
  const t = info.tables.find((x) => sameName(x.table, origin.table));
  return !!t && !t.readOnly.some((x) => sameName(x, origin.field));
}

/** AutoLookup after `column` changed (R4): the 'one' tables it links (`lookupBy`, chains included), every link column of
 *  those tables (sources.autoLookup looks a table up only when all of its link is sent), and their output columns (the only
 *  ones a lookup may show and replace). A link of a table that is not looked up is left out: in Lignes ⋈ Commandes ⋈ Clients,
 *  a change of Commandes.Client looks Clients up from it, not through the order (whose stored Client is the old one). Null
 *  when `column` links no table. */
export function lookupFor(info: SourceInfo, column: string): { links: string[]; columns: string[] } | null {
  const all = info.tables ?? [];
  const tables = all.filter((x) => x.lookupBy.some((c) => sameName(c, column)));
  if (!tables.length) return null;
  const upstream = all.filter((x) => !tables.includes(x)).flatMap((x) => x.lookupBy);
  const links: string[] = [];
  for (const c of tables.flatMap((x) => x.lookupBy)) if (!links.some((l) => sameName(l, c)) && !upstream.some((u) => sameName(u, c))) links.push(c);
  const columns = info.fields.filter((f) => f.origin && tables.some((x) => sameName(x.table, f.origin!.table))).map((f) => f.name);
  return { links, columns };
}
