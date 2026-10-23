// Source d'enregistrements d'une feuille de requête, d'un formulaire ou d'un état (contrat A3/A4/A5, section 1.2).
// Le socle sert `table` ; le lot A3 sert `query` et `sql` (src/main/query/source.ts) sans changer ces types.
import type { FieldFilter } from './api';
import type { CellInput, SqlValue } from './coerce';
import { sameName, type FieldProps, type FieldType } from './field-types';

/** Sort key; several keys sort by the first, then the next… */
export interface SortSpec { field: string; dir: 'asc' | 'desc' }

export type RecordSourceRef = { kind: 'table'; name: string } | { kind: 'query'; name: string } | { kind: 'sql'; sql: string /* canonique */ };
export interface SourceField { name: string; type: FieldType; props: FieldProps; origin?: { table: string; field: string } }
export interface SourceInfo { fields: SourceField[]; updatable: boolean; keyTable?: string;
  parameters: { name: string; type: FieldType | null; props?: FieldProps }[] }
export interface SourcePageRequest { offset: number; limit: number; sort?: SortSpec[]; filter?: FieldFilter[]; params?: Record<string, CellInput> }
export interface SourcePage { rows: SqlValue[][]; rowids: (number | null)[]; total: number }

/**
 * Values keyed by the source's output columns -> the same values keyed by the key table's own field names, for
 * rows.insert/update on `table` (an alias such as `Nom AS Client` writes `Nom`). Null when the source is not updatable, or
 * a written column is unknown, computed (no `origin`) or comes from another table than `keyTable`.
 */
export function toOrigin(info: SourceInfo, values: Record<string, CellInput>): { table: string; values: Record<string, CellInput> } | null {
  if (!info.updatable || info.keyTable === undefined) return null;
  const out: [string, CellInput][] = [];
  for (const [name, v] of Object.entries(values)) {
    const origin = info.fields.find((f) => sameName(f.name, name))?.origin;
    if (!origin || !sameName(origin.table, info.keyTable)) return null;
    out.push([origin.field, v]);
  }
  return { table: info.keyTable, values: Object.fromEntries(out) }; // fromEntries: a field named __proto__ stays a key
}
