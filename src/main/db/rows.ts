// Comptage et lecture paginée triée (utilisée par la feuille de données).
import type { DatabaseSync } from 'node:sqlite';
import type { SqlValue } from '../../shared/coerce';
import { sameName, type TableDesign } from '../../shared/field-types';
import { quoteIdent } from './schema';

import type { PageRequest, RowPage } from '../../shared/api';
export type { PageRequest, RowPage };

export function countRows(db: DatabaseSync, table: string): number {
  return Number((db.prepare(`SELECT count(*) AS n FROM ${quoteIdent(table)}`).get() as { n: number | bigint }).n);
}

function orderBy(design: TableDesign, sort: PageRequest['sort']): string {
  if (!sort) return 'rowid ASC';
  const fd = design.fields.find((x) => sameName(x.name, sort.field));
  if (!fd) throw new Error(`unknown sort field: ${sort.field}`);
  const dir = sort.dir === 'desc' ? 'DESC' : 'ASC';
  const nulls = dir === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST';
  const c = quoteIdent(fd.name);
  const p = fd.props;
  const keys = p.type === 'shortText' || p.type === 'longText' || p.type === 'hyperlink'
    ? `bc_fold(${c}) ${dir} ${nulls}, ${c} ${dir}`
    // ponytail: CAST AS REAL perd la précision au-delà de ~15-17 chiffres significatifs ; ces valeurs sont à égalité et retombent sur l'ordre rowid.
    : p.type === 'number' && p.numberSize === 'decimal' ? `CAST(${c} AS REAL) ${dir} ${nulls}`
    : `${c} ${dir} ${nulls}`;
  return `${keys}, rowid ${dir}`;
}

// ponytail: pagination par OFFSET, qui suffit jusqu'à environ 1 million de lignes ; au-delà, passer à une pagination par clé.
export function readRows(db: DatabaseSync, design: TableDesign, req: PageRequest): RowPage {
  const names = design.fields.map((fd) => quoteIdent(fd.name));
  const sql = `SELECT rowid, ${names.join(', ')} FROM ${quoteIdent(design.name)} ORDER BY ${orderBy(design, req.sort)} LIMIT ? OFFSET ?`;
  const stmt = db.prepare(sql);
  stmt.setReturnArrays(true); // positionnel : un champ peut porter n'importe quel nom
  const rows = stmt.all(req.limit, req.offset) as unknown as SqlValue[][];
  return { rows: rows.map(([rowid, ...values]) => ({ rowid: Number(rowid), values })) };
}
