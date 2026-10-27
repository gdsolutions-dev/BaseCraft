// Design grid (QBE) <-> query tree (A3). Pure module. The grid is never stored: it is rebuilt from the stored SQL by toQbe,
// and fromQbe(toQbe(q)) gives q back for every tree the grid made (hidden columns keep the order of conjuncts and sorts).
import type { BinOp, Expr } from '../expr/ast';
import { FUNCTIONS } from '../expr/catalog';
import { bracket } from '../expr/lexer';
import { CANONICAL_DIALECT, hasAggregate, parseCanonical, sameTree, serializeCriteria, serializeWith, type Dialect } from '../expr/parser';
import { sameName } from '../field-types';
import type { FromItem, JoinKind, ParamDecl, Query, SelectItem, SelectQuery } from './ast';
import { printSelect } from './print';
import { QUERY_PARSE } from './sql-parser';

export type QbeTotal = 'groupBy' | 'sum' | 'avg' | 'min' | 'max' | 'count' | 'stDev' | 'var' | 'first' | 'last' | 'expression' | 'where';
export type QbeKind = 'select' | 'makeTable' | 'append' | 'update' | 'delete' | 'crosstab';
/** The Crosstab row (B4 R13). */
export type QbeCrosstab = 'rowHeading' | 'columnHeading' | 'value' | 'none';
export interface QbeColumn {
  field: string;                 // canonical: '[Montant]', '*', 'Total: [Prix] * [Qté]' (alias « Name: expr », as in Access)
  table?: string;                // source alias; absent for an expression
  total?: QbeTotal;              // present when totals
  sort?: 'asc' | 'desc'; show: boolean;
  criteria: string[];            // Criteria, Or, Or…: short canonical criterion (A2-R4), '' = empty
  appendTo?: string; updateTo?: string /* canonical expression */; deleteRole?: 'from' | 'where';
  crosstab?: QbeCrosstab;        // crosstab kind only; absent = not chosen yet
}
export interface QbeTable { name: string; alias?: string }
/** `kind` 'left': every row of `l` ("Include ALL records from l"), whichever side of the JOIN it ends up on. */
export interface QbeJoin { l: string; lField: string; r: string; rField: string; kind: JoinKind }
/** The catalog's answer, when there is one: `field` is a field of the table or query `source` (its real name, not an alias).
 *  Without it, a bare name is taken for a field of the only source; with it, any other name (a parameter) stays bare. */
export type IsField = (source: string, field: string) => boolean;
export interface QbeDesign {
  kind: QbeKind; target?: string /* makeTable, append */; tables: QbeTable[]; joins: QbeJoin[]; totals: boolean; distinct: boolean;
  top?: { n: number; percent: boolean }; params: ParamDecl[]; columns: QbeColumn[];
  headings?: string[];           // crosstab: Column Headings, canonical literals (PIVOT … IN)
}

/** The Total row's aggregates. StDevP and VarP are SQL-only, as in Access: an Expression column. */
const AGG: Partial<Record<QbeTotal, string>> = {
  sum: 'Sum', avg: 'Avg', min: 'Min', max: 'Max', count: 'Count', stDev: 'StDev', var: 'Var', first: 'First', last: 'Last',
};
const TOTAL_OF = new Map(Object.entries(AGG).map(([total, fn]) => [fn, total as QbeTotal]));
const CMP = new Set<string>(['=', '<>', '<', '<=', '>', '>=']);
const SUBJECT: Expr = { k: 'subject' };
const DIALECT: Dialect = { ...CANONICAL_DIALECT, sub: printSelect };
const CRITERIA = { ...QUERY_PARSE, printSub: printSelect };

type Call = Extract<Expr, { k: 'call' }>;
/** A Total-row aggregate over one value (not Count(*), not StDevP). */
const isAgg = (e: Expr): e is Call => e.k === 'call' && TOTAL_OF.has(e.name) && e.args.length === 1 && e.args[0].k !== 'star';
const COUNT_STAR: Expr = { k: 'call', name: 'Count', args: [{ k: 'star' }] };
const isCountStar = (e: Expr): boolean => sameTree(e, COUNT_STAR);
const bin = (op: BinOp, l: Expr, r: Expr): Expr => ({ k: 'bin', op, l, r });
const fold = (es: Expr[], op: 'And' | 'Or'): Expr => es.reduce((a, b) => bin(op, a, b));
/** Operands of the left-associative chain `a op b op c`; a right operand that is itself an `op` stays whole. */
const spine = (e: Expr, op: 'And' | 'Or'): Expr[] => (e.k === 'bin' && e.op === op ? [...spine(e.l, op), e.r] : [e]);
const selectLike = (k: QbeKind): boolean => k === 'select' || k === 'makeTable' || k === 'append' || k === 'crosstab';
const aliasOf = (t: QbeTable): string => t.alias ?? t.name;
const flip = (k: JoinKind): JoinKind => (k === 'left' ? 'right' : k === 'right' ? 'left' : k);
const invalid = (sub: string, detail = ''): never => { throw new TypeError(`bc:invalidQuery|${sub}|${detail}`); };

/** For each UTF-16 unit of a canonical text: inside a [name] (`]]` included), a "string", a 'string' or a #date#. */
function inLiteral(s: string): boolean[] {
  const m: boolean[] = [];
  let close = '';
  for (let i = 0; i < s.length; i++) {
    if (!close) { close = s[i] === '[' ? ']' : '"\'#'.includes(s[i]) ? s[i] : ''; m.push(close !== ''); continue; }
    m.push(true);
    if (s[i] !== close) continue;
    if (close === ']' && s[i + 1] === ']') { m.push(true); i++; } else close = '';
  }
  return m;
}
/** A grid cell is one line: the printer's line breaks (subqueries) become spaces; a break inside a literal stays. */
export function oneLine(s: string): string {
  const m = inLiteral(s);
  return s.replace(/\n/g, (_, i: number) => (m[i] ? '\n' : ' '));
}
const text = (e: Expr): string => oneLine(serializeWith(e, DIALECT));

/** 'Name: expr' -> alias and expression: the first ':' outside the literals; `[a:b]: expr` for an alias holding one. */
export function splitAlias(field: string): { alias?: string; expr: string } {
  const m = inLiteral(field);
  let i = 0;
  while (i < field.length && (field[i] !== ':' || m[i])) i++;
  if (i === field.length) return { expr: field };
  const a = field.slice(0, i).trim();
  return { alias: /^\[.*\]$/s.test(a) ? a.slice(1, -1).replace(/]]/g, ']') : a, expr: field.slice(i + 1) };
}
/** A `*` column (`N: *` when it counts with an alias): `[T].*`, or Count(*) under Total Count. */
const isStar = (c: QbeColumn): boolean => splitAlias(c.field).expr.trim() === '*';
const aliasText = (a: string): string => (/^[^\s[\]:"'#](?:[^[\]:"'#]*[^\s[\]:"'#])?$/.test(a) ? a : bracket(a));
export const named = (alias: string | undefined, s: string): string => (alias === undefined ? s : `${aliasText(alias)}: ${s}`);

/** A Field cell's display form of a field (`[Nom]`, `[Clients].[Nom]`) with brackets only where needed, as Access shows
 *  `Nom`: a part keeps them unless it is a plain word that is no function name of the interface language (`[Date]`,
 *  `[Somme]`), and the whole stays bracketed unless `reads(candidate)` (the cell's own parser gives back the same field:
 *  `Vrai`… would read as something else). Storage stays canonical. */
export function plainField(display: string, reads: (candidate: string) => boolean, lang: 'fr' | 'en'): string {
  const m = /^\[((?:[^\]]|\]\])+)\](?:\.\[((?:[^\]]|\]\])+)\])?$/.exec(display.trim());
  if (!m) return display;
  const fn = (p: string) => FUNCTIONS.some((f) => sameName(lang === 'fr' ? f.fr : f.name, p));
  const part = (p: string) => (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(p) && !fn(p) ? p : `[${p}]`);
  const candidate = [m[1], m[2]].filter((p) => p !== undefined).map((p) => part(p!)).join('.');
  return candidate !== display.trim() && reads(candidate) ? candidate : display;
}

/** A column's expression (its field without the alias); a field of a table is qualified by it. Throws on a bad cell. */
function columnExpr(c: QbeColumn): { alias?: string; e: Expr } {
  const { alias, expr } = splitAlias(c.field);
  const e = parseCanonical(expr, QUERY_PARSE);
  return { alias, e: c.table !== undefined && e.k === 'id' && e.table === undefined ? { ...e, table: c.table } : e };
}

/** What a column puts in WHERE ('where'), or in SELECT, HAVING and ORDER BY ('output'); null when it takes no part. */
function exprOf(c: QbeColumn, part: 'where' | 'output', totals: boolean): Expr | null {
  if (isStar(c)) return totals && c.total === 'count' && part === 'output' ? COUNT_STAR : null;
  const { e } = columnExpr(c);
  if (c.crosstab === 'columnHeading') return part === 'where' ? e : null; // its criteria go to WHERE (R13)
  if (!totals) return e;
  if ((c.total === 'where') !== (part === 'where')) return null;
  const fn = c.total && AGG[c.total];
  return fn ? { k: 'call', name: fn, args: [e] } : e;
}

/** FROM order: from the first table, each table linked to the ones before it, with the joins that link it; an unlinked
 *  table (no joins) starts a new comma-separated item. A join naming an unknown table, or a table to itself, is left out. */
function attachOrder(tables: QbeTable[], joins: QbeJoin[]): { t: QbeTable; js: QbeJoin[] }[] {
  const out: { t: QbeTable; js: QbeJoin[] }[] = [], done: string[] = [], left = [...tables];
  const isDone = (a: string): boolean => done.some((d) => sameName(d, a));
  const links = (j: QbeJoin, x: string): boolean => (sameName(j.l, x) && isDone(j.r)) || (sameName(j.r, x) && isDone(j.l));
  while (left.length) {
    const [t] = left.splice(Math.max(0, left.findIndex((u) => joins.some((j) => links(j, aliasOf(u))))), 1);
    out.push({ t, js: joins.filter((j) => links(j, aliasOf(t))) });
    done.push(aliasOf(t));
  }
  return out;
}
/** Kind of the `… JOIN x` a join attaches `x` with. */
const oriented = (j: QbeJoin, x: string): JoinKind => (sameName(j.l, x) ? flip(j.kind) : j.kind);

function fromItems(d: QbeDesign): FromItem[] {
  const out: FromItem[] = [];
  for (const { t, js } of attachOrder(d.tables, d.joins)) {
    const src: FromItem = t.alias === undefined ? { k: 'source', name: t.name } : { k: 'source', name: t.name, alias: t.alias };
    if (!js.length) { out.push(src); continue; }
    const on = fold(js.map((j) => bin('=', { k: 'id', name: j.lField, table: j.l }, { k: 'id', name: j.rField, table: j.r })), 'And');
    out.push({ k: 'join', kind: oriented(js[0], aliasOf(t)), l: out.pop()!, r: src, on });
  }
  return out;
}

/** The criterion's implicit subject replaced by `L` (subqueries never hold one). */
function withSubject<X>(x: X, L: Expr): X {
  if (Array.isArray(x)) return x.map((v) => withSubject(v, L)) as X;
  if (typeof x !== 'object' || x === null) return x;
  if ((x as { k?: unknown }).k === 'subject') return L as X;
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, withSubject(v, L)])) as X;
}

/** The grid's query: every cell parsed in criteria mode with its column's expression as subject. Throws ExprSyntaxError on a
 *  bad cell, and TypeError('bc:invalidQuery|<sub>|<detail>') when no statement can say the grid: unlinkedTables (UPDATE or
 *  DELETE over tables no join links), updateTarget (Update To under an expression), noTarget (Make-Table, Append). */
export function fromQbe(design: QbeDesign, isField?: IsField): Query {
  const d = normalizeQbe(design, isField);
  const from = fromItems(d);
  const rows = d.columns[0]?.criteria.length ?? 0;
  const cond = (part: 'where' | 'output'): Expr | undefined => {
    const ors: Expr[] = [];
    for (let r = 0; r < rows; r++) {
      const ands = d.columns.flatMap((c) => {
        const L = c.criteria[r] ? exprOf(c, part, d.totals) : null;
        return L ? [withSubject(parseCanonical(c.criteria[r], { ...QUERY_PARSE, criteria: true }), L)] : [];
      });
      if (ands.length) ors.push(fold(ands, 'And'));
    }
    return ors.length ? fold(ors, 'Or') : undefined;
  };
  const where = cond('where'), having = d.totals ? cond('output') : undefined;
  const items = d.columns.filter((c) => c.show).map((c): SelectItem => {
    const e = exprOf(c, 'output', d.totals);
    if (!e) return c.table === undefined ? { all: true } : { all: true, table: c.table };
    const { alias } = splitAlias(c.field);
    return alias === undefined ? { e } : { e, alias };
  });
  const select = (into?: string): SelectQuery => ({
    k: 'select', distinct: d.distinct, ...(d.top && { top: d.top }), items, from,
    groupBy: d.totals ? d.columns.filter((c) => c.total === 'groupBy' && !isStar(c) && c.crosstab !== 'columnHeading').map((c) => columnExpr(c).e) : [],
    orderBy: d.columns.filter((c) => c.sort).map((c) => ({ e: exprOf(c, 'output', d.totals)!, dir: c.sort! })),
    ...(into !== undefined && { into }), ...(where && { where }), ...(having && { having }),
  });
  const target = (): string => d.target ?? invalid('noTarget');
  const single = (): FromItem => (from.length === 1 ? from[0] : invalid('unlinkedTables'));
  const params = d.params;
  switch (d.kind) {
    case 'select': return { params, body: select() };
    case 'makeTable': return { params, body: select(target()) };
    case 'append': {
      const shown = d.columns.filter((c) => c.show);
      const columns = shown.every((c) => c.appendTo === '*') ? [] : shown.map((c) => c.appendTo!);
      return { params, body: { k: 'insert', target: target(), columns, source: select() } };
    }
    case 'update': {
      const set = d.columns.filter((c) => c.updateTo !== undefined).map((c) => {
        const { e } = columnExpr(c);
        return { target: e.k === 'id' ? e : invalid('updateTarget', c.field), value: parseCanonical(c.updateTo!, QUERY_PARSE) };
      });
      return { params, body: { k: 'update', from: single(), set, ...(where && { where }) } };
    }
    case 'delete': {
      const t = d.columns.find((c) => c.deleteRole === 'from')?.table;
      return { params, body: { k: 'delete', ...(t !== undefined && { target: t }), from: single(), ...(where && { where }) } };
    }
    case 'crosstab': {
      const h = d.columns.find((c) => c.crosstab === 'columnHeading') ?? invalid('crosstabColumnHeading');
      const v = d.columns.find((c) => c.crosstab === 'value') ?? invalid('crosstabValue');
      const pivotAlias = splitAlias(h.field).alias, valueAlias = splitAlias(v.field).alias;
      return { params, body: {
        k: 'crosstab', value: exprOf(v, 'output', true)!, ...(valueAlias !== undefined && { valueAlias }), select: select(),
        pivot: columnExpr(h).e, ...(pivotAlias !== undefined && { pivotAlias }),
        ...(d.headings?.length && { headings: d.headings.map((s) => parseCanonical(s, QUERY_PARSE)) }),
      } };
    }
  }
}

/** Tables and joins of a FROM whose every ON is an And of `[a].[x] = [b].[y]` between its two sides; null otherwise.
 *  ponytail: a join nested on the right (`A LEFT JOIN (B INNER JOIN C ON …) ON …`) is read as plain pairs, and fromQbe
 *  writes it back left-deep (`A LEFT JOIN B ON … INNER JOIN C ON …`). For inner joins that is the same query; with an
 *  outer join it can change which rows come back (here, A's rows whose B has no C are lost). Access's grid has the
 *  same limit. If it matters, return null for a right-nested join whose kinds differ, so that it stays in SQL view. */
function sources(items: FromItem[]): { tables: QbeTable[]; joins: QbeJoin[] } | null {
  const tables: QbeTable[] = [], joins: QbeJoin[] = [];
  const walk = (f: FromItem): string[] | null => {
    if (f.k === 'derived') return null;
    if (f.k === 'source') {
      tables.push(f.alias === undefined ? { name: f.name } : { name: f.name, alias: f.alias });
      return [f.alias ?? f.name];
    }
    const l = walk(f.l), r = l && walk(f.r);
    if (!l || !r) return null;
    const of = (side: string[], t: string | undefined): string | undefined => (t === undefined ? undefined : side.find((n) => sameName(n, t)));
    for (const c of spine(f.on, 'And')) {
      if (c.k !== 'bin' || c.op !== '=') return null;
      const [a, b] = [c.l, c.r];
      if (a.k !== 'id' || b.k !== 'id') return null;
      const [la, rb, ra, lb] = [of(l, a.table), of(r, b.table), of(r, a.table), of(l, b.table)];
      if (la !== undefined && rb !== undefined) joins.push({ l: la, lField: a.name, r: rb, rField: b.name, kind: f.kind });
      else if (ra !== undefined && lb !== undefined) joins.push({ l: ra, lField: a.name, r: lb, rField: b.name, kind: flip(f.kind) });
      else return null;
    }
    return [...l, ...r];
  };
  return items.every((f) => walk(f) !== null) ? { tables, joins } : null;
}

/** The grid of a query, or null when only SQL view can show it: UNION, a derived table, a join that is not an And of
 *  equalities between its sides, a WHERE or HAVING that is not an Or of And whose every conjunct has a single subject,
 *  a criterion A2-R5 refuses, INSERT … VALUES, or INSERT without a column list over named fields. */
export function toQbe(q: Query, isField?: IsField): QbeDesign | null {
  const b = q.body;
  if (b.k === 'union' || (b.k === 'insert' && 'values' in b.source)) return null;
  const sel = b.k === 'select' ? b : b.k === 'crosstab' ? b.select : b.k === 'insert' && !('values' in b.source) ? b.source : undefined;
  const src = sources(sel ? sel.from : b.k === 'update' || b.k === 'delete' ? [b.from] : []);
  if (!src) return null;
  const kind: QbeKind = b.k === 'select' ? (b.into === undefined ? 'select' : 'makeTable') : b.k === 'insert' ? 'append' : b.k;
  const action = kind === 'update' || kind === 'delete', ct = kind === 'crosstab';
  const totals = ct || !!sel && (sel.groupBy.length > 0 || sel.having !== undefined
    || sel.items.some((i) => 'e' in i && hasAggregate(i.e)) || sel.orderBy.some((o) => hasAggregate(o.e)));

  // An unqualified field belongs to the only source, when there is one; never a name that is an output alias (bind reads
  // it as the field when the source has one, else as the alias: kept bare, it keeps that meaning). An item's own alias
  // does not count: `Nom AS Nom` binds its expression before the alias exists.
  const one = src.tables.length === 1 ? aliasOf(src.tables[0]) : undefined;
  const oneName = src.tables[0]?.name;
  const aliases = sel?.items.flatMap((i) => ('e' in i && i.alias !== undefined ? [i.alias] : [])) ?? [];
  const qualify = (e: Expr, own?: string): Expr => {
    if (e.k !== 'id' || e.table !== undefined || one === undefined || (isField && !isField(oneName!, e.name))) return e;
    const n = aliases.filter((a) => sameName(a, e.name)).length - (own !== undefined && sameName(own, e.name) ? 1 : 0);
    return n > 0 ? e : { ...e, table: one };
  };
  const key = (e: Expr): Expr => (isAgg(e) ? { ...e, args: [qualify(e.args[0])] } : qualify(e));
  const same = (a: Expr | null, e: Expr): boolean => a !== null && sameTree(key(a), key(e));
  const fieldOf = (e: Expr, alias?: string): { field: string; table?: string } => {
    const k = qualify(e, alias);
    return k.k === 'id' && k.table !== undefined ? { field: named(alias, bracket(k.name)), table: k.table } : { field: named(alias, text(e)) };
  };

  const cols: QbeColumn[] = [];
  const add = (c: QbeColumn): number => cols.push(c) - 1;
  /** A column made for a criterion or a sort whose subject no column shows. */
  const hidden = (e: Expr, part: 'where' | 'output'): QbeColumn => {
    const base = { show: action, criteria: [], ...(kind === 'delete' && { deleteRole: 'where' as const }) };
    if (!totals) return { ...fieldOf(e), ...base };
    if (part === 'where') return { ...fieldOf(e), ...base, total: 'where', ...(ct && { crosstab: 'none' as const }) };
    if (isCountStar(e)) return { field: '*', ...base, total: 'count' };
    return isAgg(e) ? { ...fieldOf(e.args[0]), ...base, total: TOTAL_OF.get(e.name)! } : { ...fieldOf(e), ...base, total: 'expression' };
  };
  /** Conjunct -> its subject and the criterion with the subject made implicit, when every leaf (predicate under And, Or,
   *  Xor, Not) has that same subject on its left. */
  const criterion = (e: Expr): { L: Expr; c: Expr } | null => {
    let L: Expr | null = null;
    const go = (x: Expr): Expr | null => {
      if (x.k === 'bin' && (x.op === 'And' || x.op === 'Or' || x.op === 'Xor')) {
        const l = go(x.l), r = l && go(x.r);
        return l && r && { ...x, l, r };
      }
      if (x.k === 'un' && x.op === 'Not') { const y = go(x.e); return y && { ...x, e: y }; }
      const left = x.k === 'bin' ? (CMP.has(x.op) ? x.l : null)
        : x.k === 'like' || x.k === 'between' || x.k === 'in' || x.k === 'inSub' || x.k === 'isnull' ? x.e : null;
      if (!left || (L && !same(L, left))) return null;
      L ??= left;
      return (x.k === 'bin' ? { ...x, l: SUBJECT } : { ...x, e: SUBJECT }) as Expr;
    };
    const c = go(e);
    return c && L && { L, c };
  };
  /** A WHERE or HAVING into the criteria rows, one per Or operand. Each row's conjuncts go, left to right, into the
   *  columns showing their subject, or into new hidden columns: the row's And comes back in the same order. */
  const place = (cond: Expr | undefined, part: 'where' | 'output'): boolean => {
    if (!cond) return true;
    const rows = spine(cond, 'Or');
    for (let r = 0; r < rows.length; r++) {
      const conj = spine(rows[r], 'And').map(criterion);
      if (conj.some((x) => !x)) return false;
      const cs = conj as { L: Expr; c: Expr }[];
      let n = 1; // the leading conjuncts on one subject share a cell (`>= 1 And <= 5`): the And keeps its grouping
      while (n < cs.length && same(cs[0].L, cs[n].L)) n++;
      let pos = -1;
      for (const { L, c } of [{ L: cs[0].L, c: fold(cs.slice(0, n).map((x) => x.c), 'And') }, ...cs.slice(n)]) {
        let s: string;
        try { s = oneLine(serializeCriteria(c, CRITERIA)); } catch { return false; } // A2-R5
        let i = cols.findIndex((col, k) => k > pos && same(exprOf(col, part, totals), L));
        if (i < 0) i = add(hidden(L, part));
        cols[i].criteria[r] = s;
        pos = i;
      }
    }
    return true;
  };

  if (sel) {
    let appendTo: string[] = [];
    if (b.k === 'insert') {
      const stars = sel.items.every((i) => 'all' in i);
      if (b.columns.length ? b.columns.length !== sel.items.length || sel.items.some((i) => 'all' in i) : !stars) return null;
      appendTo = b.columns.length ? b.columns : sel.items.map(() => '*');
    }
    let g = 0; // GROUP BY entries already shown: a groupBy column only in GROUP BY order
    sel.items.forEach((it, i) => {
      const extra = { show: true, criteria: [], ...(appendTo[i] !== undefined && { appendTo: appendTo[i] }), ...(ct && { crosstab: 'rowHeading' as const }) };
      if ('all' in it) { add({ field: '*', ...(it.table !== undefined && { table: it.table }), ...(totals && { total: 'groupBy' as const }), ...extra }); return; }
      if (!totals) { add({ ...fieldOf(it.e, it.alias), ...extra }); return; }
      if (g < sel.groupBy.length && same(sel.groupBy[g], it.e)) { g++; add({ ...fieldOf(it.e, it.alias), total: 'groupBy', ...extra }); return; }
      if (isCountStar(it.e)) add({ field: named(it.alias, '*'), total: 'count', ...extra });
      else if (isAgg(it.e)) add({ ...fieldOf(it.e.args[0], it.alias), total: TOTAL_OF.get(it.e.name)!, ...extra });
      else add({ ...fieldOf(it.e, it.alias), total: 'expression', ...extra });
    });
    for (; g < sel.groupBy.length; g++) add({ ...fieldOf(sel.groupBy[g]), total: 'groupBy', show: false, criteria: [] });
    if (b.k === 'crosstab') {
      add({ ...fieldOf(b.pivot, b.pivotAlias), total: 'groupBy', show: false, criteria: [], crosstab: 'columnHeading' });
      const v = b.value, a = b.valueAlias, value = { show: false, criteria: [], crosstab: 'value' as const };
      if (isCountStar(v)) add({ field: named(a, '*'), total: 'count', ...value });
      else if (isAgg(v)) add({ ...fieldOf(v.args[0], a), total: TOTAL_OF.get(v.name)!, ...value });
      else add({ ...fieldOf(v, a), total: 'expression', ...value });
    }
    if (!place(sel.where, 'where') || !place(sel.having, 'output')) return null;
    let pos = -1; // sorts left to right; an out-of-order one gets a hidden column further right
    for (const o of sel.orderBy) {
      let i = cols.findIndex((c, k) => k > pos && same(exprOf(c, 'output', totals), o.e));
      if (i < 0) i = add(hidden(o.e, 'output'));
      cols[i].sort = o.dir;
      pos = i;
    }
    // the crosstab grid has no Show row: a `*` item, a GROUP BY not shown, a hidden HAVING or ORDER BY column: SQL view only
    if (ct && cols.some((c) => !c.crosstab || (isStar(c) && c.total !== 'count'))) return null;
  } else if (b.k === 'update') {
    for (const s of b.set) add({ ...fieldOf(s.target), show: true, criteria: [], updateTo: text(s.value) });
    if (!place(b.where, 'where')) return null;
  } else if (b.k === 'delete') {
    if (b.target !== undefined) add({ field: '*', table: b.target, show: true, criteria: [], deleteRole: 'from' });
    if (!place(b.where, 'where')) return null;
  }
  const target = b.k === 'insert' ? b.target : b.k === 'select' ? b.into : undefined;
  return normalizeQbe({
    kind, ...(target !== undefined && { target }), ...src, totals, distinct: sel?.distinct ?? false, ...(sel?.top && { top: sel.top }),
    params: q.params, columns: cols, ...(b.k === 'crosstab' && b.headings?.length && { headings: b.headings.map(text) }),
  }, isField);
}

/** The grid as toQbe gives it back: columns without a field dropped; what the kind or the Total row ignores dropped (a
 *  Where column is hidden and unsorted, `*` has no criteria); a bare field of the only table qualified by it; tables and
 *  joins in FROM order (the joins attaching one table share the first one's kind); every column with as many criteria
 *  rows, up to the grid's last non-empty row. */
export function normalizeQbe(d: QbeDesign, isField?: IsField): QbeDesign {
  const sel = selectLike(d.kind), ct = d.kind === 'crosstab', totals = ct || (sel && d.totals);
  const order = attachOrder(d.tables, d.joins);
  const tables = order.map((o) => o.t);
  const joins = order.flatMap(({ t, js }) => {
    const k = js.length ? oriented(js[0], aliasOf(t)) : 'inner';
    return js.map((j) => ({ ...j, kind: sameName(j.l, aliasOf(t)) ? flip(k) : k }));
  });
  const one = tables.length === 1 ? aliasOf(tables[0]) : undefined;
  const filled = (s: string | undefined): string | undefined => (s?.trim() ? s.trim() : undefined);
  const columns = d.columns.filter((c) => c.field.trim() !== '').map((c): QbeColumn => {
    const field = c.field.trim(), table = c.table;
    const star = isStar(c);
    const count = star && totals && c.total === 'count';
    const total = totals ? (star && !count ? 'groupBy' : c.total ?? 'groupBy') : undefined;
    const where = total === 'where';
    const crosstab = ct ? c.crosstab : undefined;
    const sort = sel && (!star || count) && !where && crosstab !== 'columnHeading' ? c.sort : undefined;
    const appendTo = d.kind === 'append' && !where ? filled(c.appendTo) : undefined;
    const updateTo = d.kind === 'update' ? filled(c.updateTo) : undefined;
    const deleteRole = d.kind === 'delete' ? c.deleteRole ?? 'where' : undefined;
    const show = d.kind === 'update' || d.kind === 'delete' ? true : d.kind === 'append' ? appendTo !== undefined
      : ct ? crosstab === 'rowHeading' && !where : c.show && !where;
    return {
      field, ...(table !== undefined && !count && { table }), ...(total && { total }), ...(sort && { sort }), show,
      criteria: star && !count ? [] : Array.from(c.criteria, (s) => s?.trim() ?? ''),
      ...(appendTo !== undefined && { appendTo }), ...(updateTo !== undefined && { updateTo }), ...(deleteRole && { deleteRole }),
      ...(crosstab && { crosstab }),
    };
  });
  // A field of a table keeps (or, alone or qualified in the cell, gets) its table; an expression has none; a bare name
  // that is another column's output alias (shown, not `[T].*`) stays bare, as toQbe leaves it.
  const outputs = columns.map((c) => (c.show && (!isStar(c) || c.total === 'count') ? splitAlias(c.field).alias : undefined));
  columns.forEach((c, k) => {
    if (isStar(c)) return;
    try {
      const { alias, expr } = splitAlias(c.field);
      const e = parseCanonical(expr, QUERY_PARSE);
      if (e.k !== 'id') { delete c.table; return; }
      const isAlias = outputs.some((a, j) => j !== k && a !== undefined && sameName(a, e.name));
      const notField = isField !== undefined && one !== undefined && !isField(tables[0].name, e.name);
      const table = e.table ?? c.table ?? (isAlias || notField ? undefined : one);
      if (table !== undefined) Object.assign(c, { field: named(alias, bracket(e.name)), table });
    } catch { /* a bad cell stays as typed; fromQbe reports it */ }
  });
  const rows = Math.max(0, ...columns.map((c) => c.criteria.findLastIndex((s) => s !== '') + 1));
  for (const c of columns) c.criteria = Array.from({ length: rows }, (_, i) => c.criteria[i] ?? '');
  return {
    kind: d.kind, ...((d.kind === 'makeTable' || d.kind === 'append') && d.target !== undefined && { target: d.target }),
    tables, joins, totals, distinct: sel && !ct && d.distinct, ...(sel && !ct && d.top && { top: d.top }), params: d.params, columns,
    ...(ct && d.headings?.length && { headings: d.headings }),
  };
}
