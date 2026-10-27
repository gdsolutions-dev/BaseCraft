// Query tree -> canonical BaseCraft SQL (SQL view, stored form). Pure module.
// Upper-case keywords, bracketed identifiers, one clause per line, A2 canonical expressions; parseSql reads it back.
import type { Expr } from '../expr/ast';
import { bracket as id, tokenize } from '../expr/lexer';
import { CANONICAL_DIALECT, serializeWith, type Dialect } from '../expr/parser';
import type { FromItem, OrderItem, ParamDecl, Query, SelectItem, SelectQuery } from './ast';
import { PARAMETER_TYPES, topLevelIn } from './sql-parser';

const DIALECT: Dialect = { ...CANONICAL_DIALECT, sub: (q) => printSelect(q) };
const ex = (e: Expr): string => serializeWith(e, DIALECT);

function paramType(p: ParamDecl): string {
  const size = p.type === 'number' ? (p.numberSize ?? 'longInteger') : undefined;
  const hit = PARAMETER_TYPES.find(([type, s]) => type === p.type && s === size);
  if (!hit) throw new Error(`no PARAMETERS type for ${p.type}`); // AutoNumber, Hyperlink: never declared (ParamDecl from parseSql)
  return hit[2][0];
}

function item(i: SelectItem): string {
  if ('all' in i) return i.table === undefined ? '*' : `${id(i.table)}.*`;
  return i.alias === undefined ? ex(i.e) : `${ex(i.e)} AS ${id(i.alias)}`;
}

/** A join prints left first; a join nested on the right is parenthesised, as in Access. */
function from(f: FromItem): string {
  switch (f.k) {
    case 'source': return f.alias === undefined ? id(f.name) : `${id(f.name)} AS ${id(f.alias)}`;
    case 'derived': return `(${printSelect(f.q)}) AS ${id(f.alias)}`;
    case 'join': {
      const r = f.r.k === 'join' ? `(${from(f.r)})` : from(f.r);
      return `${from(f.l)} ${f.kind.toUpperCase()} JOIN ${r} ON ${ex(f.on)}`;
    }
  }
}

const orderBy = (o: OrderItem[]): string[] =>
  o.length ? [`ORDER BY ${o.map((x) => (x.dir === 'desc' ? `${ex(x.e)} DESC` : ex(x.e))).join(', ')}`] : [];

/** One SELECT, without the final `;` (a subquery, a derived table, a UNION part; `Dialect.sub`). */
export function printSelect(q: SelectQuery): string {
  const head = ['SELECT', q.distinct && 'DISTINCT', q.top && `TOP ${q.top.n}${q.top.percent ? ' PERCENT' : ''}`,
    q.items.map(item).join(', '), q.into !== undefined && `INTO ${id(q.into)}`].filter(Boolean).join(' ');
  return [
    head,
    ...(q.from.length ? [`FROM ${q.from.map(from).join(', ')}`] : []),
    ...(q.where ? [`WHERE ${ex(q.where)}`] : []),
    ...(q.groupBy.length ? [`GROUP BY ${q.groupBy.map(ex).join(', ')}`] : []),
    ...(q.having ? [`HAVING ${ex(q.having)}`] : []),
    ...orderBy(q.orderBy),
  ].join('\n');
}

function body(b: Query['body']): string[] {
  switch (b.k) {
    case 'select': return [printSelect(b)];
    case 'union': return [...b.parts.flatMap((p, i) => (i ? [b.all[i - 1] ? 'UNION ALL' : 'UNION', printSelect(p)] : [printSelect(p)])), ...orderBy(b.orderBy)];
    case 'insert': return [
      `INSERT INTO ${id(b.target)}${b.columns.length ? ` (${b.columns.map(id).join(', ')})` : ''}`,
      'values' in b.source ? `VALUES (${b.source.values.map(ex).join(', ')})` : printSelect(b.source),
    ];
    case 'update': return [
      `UPDATE ${from(b.from)}`, `SET ${b.set.map((s) => `${ex(s.target)} = ${ex(s.value)}`).join(', ')}`,
      ...(b.where ? [`WHERE ${ex(b.where)}`] : []),
    ];
    case 'crosstab': {
      const as = (a: string | undefined): string => (a === undefined ? '' : ` AS ${id(a)}`);
      const pivot = ex(b.pivot);
      return [
        `TRANSFORM ${ex(b.value)}${as(b.valueAlias)}`, printSelect(b.select),
        `PIVOT ${topLevelIn(tokenize(pivot), 0) < 0 ? pivot : `(${pivot})`}${as(b.pivotAlias)}${b.headings?.length ? ` IN (${b.headings.map(ex).join(', ')})` : ''}`,
      ];
    }
    case 'delete': return [
      `DELETE ${b.target === undefined ? '*' : `${id(b.target)}.*`}`, `FROM ${from(b.from)}`, ...(b.where ? [`WHERE ${ex(b.where)}`] : []),
    ];
  }
}

/** Canonical SQL of a query: the SQL view's text and the stored form (`parseSql(printSql(q))` gives `q` back). */
export function printSql(q: Query): string {
  const params = q.params.length ? [`PARAMETERS ${q.params.map((p) => `${id(p.name)} ${paramType(p)}`).join(', ')};`] : [];
  return `${[...params, ...body(q.body)].join('\n')};`;
}
