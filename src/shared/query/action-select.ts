// The SELECT an action query reads its rows with (A3's compileAction, C7 R14's server path). Pure module.
import type { Expr } from '../expr/ast';
import type { FromItem, SelectQuery } from './ast';
import { columnProps, exprType, type BoundQuery } from './bind';

/**
 * The rows an action query writes, as one SELECT of the action's own (bound) expressions, registered in `b.selects`:
 * - DELETE: no column, over the action's FROM and WHERE (the caller reads the target's row of each: its rowid, its token);
 * - UPDATE: the SET values in their order, over the same;
 * - INSERT … SELECT: its SELECT; INSERT … VALUES: one row of the values (`values`: them, for an evaluator);
 * - SELECT … INTO (`makeTable`): the SELECT itself.
 * `target`: the table written. Error('bc:invalidArgument') for a SELECT or UNION.
 */
export function actionSelect(b: BoundQuery): { q: SelectQuery; target: string; mode: 'insert' | 'update' | 'delete' | 'makeTable'; values?: Expr[] } {
  const body = b.query.body;
  /** A SELECT made of `items` over `from`, its columns typed as the binding types an output column. */
  const own = (items: Expr[], from: FromItem[], where?: Expr): SelectQuery => {
    const q: SelectQuery = { k: 'select', distinct: false, items: items.map((e) => ({ e })), from, ...(where && { where }), groupBy: [], orderBy: [] };
    b.selects.set(q, { sources: b.sources, grouped: false, columns: items.map((expr) => ({ name: '', type: exprType(expr, b), props: columnProps(expr, b), expr })) });
    return q;
  };
  switch (body.k) {
    case 'select':
      if (body.into === undefined) break;
      return { q: body, target: body.into, mode: 'makeTable' };
    case 'insert':
      if ('values' in body.source) return { q: own(body.source.values, []), target: b.keyTable!, mode: 'insert', values: body.source.values };
      return { q: body.source, target: b.keyTable!, mode: 'insert' };
    case 'update':
    case 'delete':
      return { q: own(body.k === 'update' ? body.set.map((x) => x.value) : [], [body.from], body.where), target: b.keyTable!, mode: body.k };
  }
  throw new Error('bc:invalidArgument');
}
