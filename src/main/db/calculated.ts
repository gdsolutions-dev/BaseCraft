// Calculated fields: the write layer stores each one's value (its expression over the row's other stored fields) in its column.
// An evaluation error leaves Null (Access shows #Error). validateDesign keeps an expression off other calculated fields, so the
// order of computing is free. A column another tool writes is stale until the next write of its row (or a table save).
import type { DatabaseSync } from 'node:sqlite';
import { coerce, type SqlValue } from '../../shared/coerce';
import { evaluate, fromStored, toStored } from '../../shared/expr/evaluate';
import { fail } from '../../shared/expr/library';
import { parseCanonical } from '../../shared/expr/parser';
import { isCalculated, sameName, type FieldDef, type TableDesign } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { quoteIdent } from './schema';

export const calculatedFields = (design: TableDesign): FieldDef[] => design.fields.filter((fd) => isCalculated(fd.props));

/** The stored value of each calculated field of `design` for the record `row` (by field name; absent: Null). */
export async function calculatedValues(design: TableDesign, row: Record<string, SqlValue>, info: LocaleInfo, now: () => Date): Promise<{ fd: FieldDef; value: SqlValue }[]> {
  const field = (n: string) => {
    const fd = design.fields.find((x) => sameName(x.name, n));
    return fd ? fromStored(fd, Object.hasOwn(row, fd.name) ? row[fd.name]! : null) : fail('unknownField');
  };
  const out: { fd: FieldDef; value: SqlValue }[] = [];
  for (const fd of calculatedFields(design)) {
    let value: SqlValue = null;
    try {
      const r = coerce(fd, toStored(fd, await evaluate(parseCanonical(fd.props.calculated!), { field, now, locale: info.locale }), info), info);
      if (r.ok) value = r.value;
    } catch { /* #Error: Null */ }
    out.push({ fd, value: value === null && fd.props.type === 'yesNo' ? 0 : value }); // a Yes/No column is NOT NULL
  }
  return out;
}

/** Every row's calculated fields again (a table save may change an expression, a source field or a type). In the caller's transaction. */
export async function recomputeCalculated(db: DatabaseSync, design: TableDesign, info: LocaleInfo, now: () => Date = () => new Date()): Promise<void> {
  const calc = calculatedFields(design);
  if (calc.length === 0) return;
  const sources = design.fields.filter((fd) => !isCalculated(fd.props));
  const select = db.prepare(`SELECT rowid AS r${sources.map((fd, i) => `, ${quoteIdent(fd.name)} AS c${i}`).join('')} FROM ${quoteIdent(design.name)}`);
  const update = db.prepare(`UPDATE ${quoteIdent(design.name)} SET ${calc.map((fd) => `${quoteIdent(fd.name)} = ?`).join(', ')} WHERE rowid = ?`);
  for (const row of select.all() as Record<string, SqlValue>[]) {
    const values = await calculatedValues(design, Object.fromEntries(sources.map((fd, i) => [fd.name, row[`c${i}`] ?? null])), info, now);
    update.run(...values.map((v) => v.value), row.r as number);
  }
}
