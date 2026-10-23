// Query tree (A3), engine-independent. Its expressions are the A2 engine's `Expr`. Pure module.
// Stored form: the canonical SQL text (`printSql`, Task 2), read back by `parseSql`.
import type { Expr } from '../expr/ast';
import type { FieldType, NumberSize } from '../field-types';

export type JoinKind = 'inner' | 'left' | 'right';
export type FromItem = { k: 'source'; name: string; alias?: string }               // table or saved query
  | { k: 'derived'; q: SelectQuery; alias: string }
  | { k: 'join'; kind: JoinKind; l: FromItem; r: FromItem; on: Expr };
export type SelectItem = { e: Expr; alias?: string } | { all: true; table?: string };   // * and [T].*
export interface OrderItem { e: Expr; dir: 'asc' | 'desc' }
export interface SelectQuery {
  k: 'select'; distinct: boolean; top?: { n: number; percent: boolean }; items: SelectItem[];
  from: FromItem[] /* comma = cross product */; where?: Expr; groupBy: Expr[]; having?: Expr; orderBy: OrderItem[];
  into?: string /* SELECT … INTO */
}
export interface UnionQuery { k: 'union'; parts: SelectQuery[]; all: boolean[] /* parts.length - 1 */; orderBy: OrderItem[] }
export interface InsertQuery { k: 'insert'; target: string; columns: string[]; source: SelectQuery | { values: Expr[] } }
export interface UpdateQuery { k: 'update'; from: FromItem; set: { target: Expr /* id */; value: Expr }[]; where?: Expr }
export interface DeleteQuery { k: 'delete'; target?: string /* DELETE [T].* */; from: FromItem; where?: Expr }
export interface ParamDecl { name: string; type: FieldType; numberSize?: NumberSize }
export interface Query { params: ParamDecl[]; body: SelectQuery | UnionQuery | InsertQuery | UpdateQuery | DeleteQuery }
/** A select or union query (it has a datasheet), not an action query. */
export const isSelectBody = ({ body }: Query): boolean => body.k === 'union' || (body.k === 'select' && body.into === undefined);
/** Definition stored in `bc_objects` for a query; unknown keys are kept. */
export interface QueryDefinition { formatVersion: '1.0'; sql: string; layout?: QbeLayout; [unknownKey: string]: unknown }
export interface QbeLayout { tables: Record<string /* alias */, { x: number; y: number }>; widths?: number[] }
