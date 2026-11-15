// SearchForRecord (E6b), apart from the form view: the condition parsed once and tested on a row's stored values, and where the
// search starts and which way it goes. No React.
import type { SqlValue } from '../../shared/coerce';
import { ExprRuntimeError, type Value } from '../../shared/expr/ast';
import { evaluate, fromStored, truthy, type EvalEnv } from '../../shared/expr/evaluate';
import { fieldRefs } from '../../shared/expr/parser';
import { infoOf } from '../../shared/expr/library';
import { sameName } from '../../shared/field-types';
import type { SourceField } from '../../shared/record-source';
import { parseExpr } from './calc';

export type SearchRecord = 'previous' | 'next' | 'first' | 'last';

/** The condition as a test of a row (values in the order of `fields`). Rejects before any search when it does not parse or names an
 *  unknown field (ExprRuntimeError unknownField). */
export function rowTest(where: string, fields: readonly SourceField[], base: Omit<EvalEnv, 'field'>): (row: SqlValue[]) => Promise<boolean> {
  const e = parseExpr(where, false);
  for (const n of fieldRefs(e)) if (!fields.some((f) => sameName(f.name, n))) throw new ExprRuntimeError('unknownField', n);
  const loc = infoOf(base.locale);
  return async (row) => {
    const field = (n: string): Value => { const k = fields.findIndex((f) => sameName(f.name, n)); return fromStored(fields[k]!, row[k] ?? null); };   // names checked above
    return truthy(await evaluate(e, { ...base, field }), loc) === true;
  };
}

/** FormRecords.find's `from` (excluded) and direction; `here`: the current record's index, a new record being `total`. */
export const searchStart = (record: SearchRecord, here: number, total: number): { from: number; dir: 'up' | 'down' } =>
  ({ from: record === 'first' ? -1 : record === 'last' ? total : here, dir: record === 'previous' || record === 'last' ? 'up' : 'down' });
