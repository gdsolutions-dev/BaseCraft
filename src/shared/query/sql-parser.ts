// Parser of the BaseCraft SQL dialect (close to Access SQL) -> Query tree. Pure module.
// Recursive descent over the canonical tokens; every expression goes through the A2 engine (parseExprAt + QUERY_PARSE).
import { ExprSyntaxError, type Expr } from '../expr/ast';
import { asciiLower, tokenize, type Token } from '../expr/lexer';
import { parseExprAt, type ParseOptions } from '../expr/parser';
import { isReservedName, sameName, type FieldType, type NumberSize } from '../field-types';
import type { CrosstabQuery, FromItem, JoinKind, OrderItem, ParamDecl, Query, SelectItem, SelectQuery } from './ast';

/** SQL words that end an expression or a name: a bare one is never a field, an alias or a source (`[From]` is). Access
 *  reserves them too. */
const SQL_WORDS: ReadonlySet<string> = new Set([
  'select', 'distinct', 'distinctrow', 'top', 'percent', 'as', 'into', 'from', 'where', 'group', 'by', 'having', 'order',
  'asc', 'desc', 'union', 'all', 'inner', 'left', 'right', 'outer', 'join', 'on', 'insert', 'values', 'update', 'set',
  'delete', 'parameters', 'transform', 'pivot',
]);
/** First words of the statements SQLite would run but BaseCraft never accepts. */
const FORBIDDEN = new Set([
  'create', 'drop', 'alter', 'attach', 'detach', 'pragma', 'vacuum', 'reindex', 'analyze', 'begin', 'commit', 'rollback',
  'savepoint', 'release', 'replace', 'with', 'explain',
]);
/** `PARAMETERS` types: BaseCraft type, then the accepted words (Access's own included: `Value`, Access's untyped
 *  Variant, reads as text, like an undeclared parameter); the first word is the canonical one (`printSql`). */
export const PARAMETER_TYPES: readonly [FieldType, NumberSize | undefined, string[]][] = [
  ['shortText', undefined, ['Text', 'Value']],
  ['longText', undefined, ['Memo', 'LongText']],
  ['number', 'byte', ['Byte']],
  ['number', 'integer', ['Short', 'SmallInt']],
  ['number', 'longInteger', ['Long', 'Integer', 'Int']],
  ['number', 'single', ['Single', 'Real', 'IEEESingle']],
  ['number', 'double', ['Double', 'Float', 'IEEEDouble']],
  ['number', 'decimal', ['Decimal']],
  ['currency', undefined, ['Currency', 'Money']],
  ['dateTime', undefined, ['DateTime', 'Date']],
  ['yesNo', undefined, ['Bit', 'YesNo', 'Logical']],
];
const TYPE_WORDS = new Map(PARAMETER_TYPES.flatMap(([type, size, words]) => words.map((w) => [asciiLower(w), { type, size }] as const)));

/** Levels a query tree may nest: derived tables, subqueries, parenthesised and chained joins (Access allows 50 nested
 *  subqueries). Expressions keep their own MAX_NESTING, so the deepest tree stays far from a stack overflow. */
const MAX_QUERY_NESTING = 50;
/** Current query nesting, across the subquery hook: parsing is synchronous, every increment is undone in a `finally`. */
let level = 0;

class SqlParser {
  /** INTO of the SELECT just read (refused in a UNION). */
  private into: Token | undefined;
  constructor(private toks: Token[], private p: number) {}

  private get tok(): Token { return this.toks[this.p]; }
  private at(n: number): Token { return this.toks[Math.min(this.p + n, this.toks.length - 1)]; }
  private fail(t: Token = this.tok): never {
    throw new ExprSyntaxError(t.t === 'eof' ? 'unexpectedEnd' : 'unexpectedToken', { start: t.start, end: t.end });
  }
  private err(code: 'reservedName' | 'tooComplex' | 'forbiddenStatement' | 'badParameterType' | 'badCrosstab', t: Token): never {
    throw new ExprSyntaxError(code, { start: t.start, end: t.end });
  }
  private isOp(v: string, t: Token = this.tok): boolean { return t.t === 'op' && t.v === v; }
  private eatOp(v: string): boolean { if (this.isOp(v)) { this.p++; return true; } return false; }
  private expectOp(v: string): void { if (!this.eatOp(v)) this.fail(); }
  /** Bare SQL word (ASCII case-insensitive). */
  private isWord(w: string, t: Token = this.tok): boolean { return t.t === 'id' && t.bare === true && asciiLower(t.v) === w; }
  private eatWord(w: string): boolean { if (this.isWord(w)) { this.p++; return true; } return false; }
  private expectWord(w: string): void { if (!this.eatWord(w)) this.fail(); }

  /** One level deeper in the query tree; past MAX_QUERY_NESTING, tooComplex at `t`. */
  private enter(t: Token): void {
    if (level >= MAX_QUERY_NESTING) this.err('tooComplex', t);
    level++;
  }
  private nested<X>(f: () => X): X {
    this.enter(this.tok);
    try { return f(); } finally { level--; }
  }

  /** A name: `[any]` or a bare word that is not a SQL word. */
  private name(): Token {
    const t = this.tok;
    if (t.t !== 'id' || (t.bare ? SQL_WORDS.has(asciiLower(t.v)) : t.v === '')) this.fail();
    this.p++;
    return t;
  }
  /** A table name: a source, a target or a qualifier, never `bc_*`, `bcx_*` or `sqlite_*`. */
  private table(t: Token = this.name()): string {
    if (isReservedName(t.v)) this.err('reservedName', t);
    return t.v;
  }
  /** `T.*` at the current token. */
  private isAllOf(): boolean { return this.tok.t === 'id' && this.isOp('.', this.at(1)) && this.isOp('*', this.at(2)); }
  /** Reads `T.*` (isAllOf): T is a name, as any table name. */
  private allOf(): string {
    const table = this.table();
    this.p += 2;
    return table;
  }

  /** An expression; `toks` ends it earlier (PIVOT's expression stops at its IN). */
  private expr(toks: Token[] = this.toks): Expr {
    const { e, end } = parseExprAt(toks, this.p, QUERY_PARSE);
    for (let i = this.p; i < end; i++) if (toks[i].t === 'id' && this.isOp('.', toks[i + 1])) this.table(toks[i]);
    this.p = end;
    return e;
  }
  private exprList(): Expr[] {
    const out = [this.expr()];
    while (this.eatOp(',')) out.push(this.expr());
    return out;
  }

  query(): Query {
    const params = this.eatWord('parameters') ? this.parameters() : [];
    const first = this.tok;
    if (first.t === 'id' && first.bare) {
      const w = asciiLower(first.v);
      if (FORBIDDEN.has(w)) this.err('forbiddenStatement', first);
    }
    let body: Query['body'];
    if (this.isWord('select')) body = this.selectStatement();
    else if (this.eatWord('transform')) body = this.crosstab();
    else if (this.eatWord('insert')) body = this.insert();
    else if (this.eatWord('update')) body = this.update();
    else if (this.eatWord('delete')) body = this.delete();
    else return this.fail();
    const semicolon = this.eatOp(';');
    const t = this.tok;
    if (t.t !== 'eof') {
      if (semicolon) throw new ExprSyntaxError('multipleStatements', { start: t.start, end: this.toks[this.toks.length - 1].start });
      this.fail();
    }
    return { params, body };
  }

  private parameters(): ParamDecl[] {
    const out: ParamDecl[] = [];
    do {
      const n = this.name();
      if (out.some((p) => sameName(p.name, n.v))) this.fail(n);
      const t = this.tok;
      if (t.t !== 'id' && t.t !== 'kw') this.fail(); // a keyword (Null, Like…) is a word, just not a type
      const type = t.t === 'id' && t.bare ? TYPE_WORDS.get(asciiLower(t.v)) : undefined;
      if (!type) this.err('badParameterType', t);
      this.p++;
      if (asciiLower(t.v) === 'text' && this.eatOp('(')) { // Access writes `Text (255)`: the size is not kept
        const size = this.tok;
        if (size.t !== 'num' || !/^\d+$/.test(size.v) || Number(size.v) < 1 || Number(size.v) > 255) this.err('badParameterType', size);
        this.p++;
        this.expectOp(')');
      }
      out.push(type.size ? { name: n.v, type: type.type, numberSize: type.size } : { name: n.v, type: type.type });
    } while (this.eatOp(','));
    this.expectOp(';');
    return out;
  }

  /** SELECT … {UNION [ALL] SELECT …} [ORDER BY …], at the top of a statement: the only place INTO is read. */
  private selectStatement(): Query['body'] {
    const first = this.selectCore(true);
    if (!this.isWord('union')) return { ...first, orderBy: this.orderBy() };
    if (this.into) this.fail(this.into);
    const parts = [first], all: boolean[] = [];
    while (this.eatWord('union')) {
      all.push(this.eatWord('all'));
      parts.push(this.selectCore(false));
    }
    return { k: 'union', parts, all, orderBy: this.orderBy() };
  }

  /** TRANSFORM (read) value [AS a] SELECT … [ORDER BY …] PIVOT e [AS a] [IN (literal, …)]; any other SELECT form is
   *  badCrosstab (B4 R8). */
  private crosstab(): CrosstabQuery {
    const value = this.expr();
    const valueAlias = this.eatWord('as') ? this.name().v : undefined;
    const head = this.at(1);
    if (this.isWord('select') && ['distinct', 'distinctrow', 'top'].some((w) => this.isWord(w, head))) this.err('badCrosstab', head);
    const core = this.selectCore(true);
    if (core.into !== undefined) this.err('badCrosstab', this.into!);
    if (this.isWord('union')) this.err('badCrosstab', this.tok);
    const select = { ...core, orderBy: this.orderBy() };
    if (!this.eatWord('pivot')) return this.tok.t === 'eof' || this.isOp(';') ? this.err('badCrosstab', this.tok) : this.fail();
    const at = topLevelIn(this.toks, this.p);
    const inTok = this.toks[at];
    const pivot = at < 0 ? this.expr() : this.expr([...this.toks.slice(0, at), { t: 'eof', v: '', start: inTok.start, end: inTok.end }]);
    const q: CrosstabQuery = { k: 'crosstab', value, ...(valueAlias !== undefined && { valueAlias }), select, pivot };
    if (this.eatWord('as')) q.pivotAlias = this.name().v;
    if (at >= 0) {
      if (this.p !== at) this.fail();
      this.p++;
      this.expectOp('(');
      q.headings = [];
      do {
        const t = this.tok;
        const h = this.expr();
        if (!isHeadingLiteral(h)) this.err('badCrosstab', t);
        q.headings.push(h);
      } while (this.eatOp(','));
      this.expectOp(')');
    }
    return q;
  }

  /** The expression parser's subquery hook: SELECT at the current token, one query level deeper. */
  subquery(): { q: SelectQuery; end: number } {
    return this.nested(() => ({ q: this.select(), end: this.p }));
  }

  /** A subquery, a derived table or INSERT's source: one SELECT with its ORDER BY, without INTO. */
  private select(): SelectQuery {
    const q = this.selectCore(false);
    return { ...q, orderBy: this.orderBy() };
  }

  private selectCore(allowInto: boolean): SelectQuery {
    this.expectWord('select');
    const distinct = this.eatWord('distinct') || this.eatWord('distinctrow');
    let top: SelectQuery['top'];
    if (this.eatWord('top')) {
      const n = this.tok;
      if (n.t !== 'num' || !/^\d+$/.test(n.v) || !Number.isSafeInteger(Number(n.v)) || Number(n.v) < 1) this.fail();
      this.p++;
      top = { n: Number(n.v), percent: this.eatWord('percent') };
    }
    const items: SelectItem[] = [];
    do items.push(this.item()); while (this.eatOp(','));
    const intoTok = this.isWord('into') ? this.tok : undefined;
    let into: string | undefined;
    if (allowInto && this.eatWord('into')) into = this.table();
    this.expectWord('from');
    const from = [this.from()];
    while (this.eatOp(',')) from.push(this.from());
    const q: SelectQuery = { k: 'select', distinct, ...(top && { top }), items, from, groupBy: [], orderBy: [] };
    if (into !== undefined) q.into = into;
    if (this.eatWord('where')) q.where = this.expr();
    if (this.eatWord('group')) { this.expectWord('by'); q.groupBy = this.exprList(); }
    if (this.eatWord('having')) q.having = this.expr();
    this.into = intoTok; // after the derived tables and subqueries, which read their own SELECT
    return q;
  }

  private item(): SelectItem {
    if (this.eatOp('*')) return { all: true };
    if (this.isAllOf()) return { all: true, table: this.allOf() };
    const e = this.expr();
    return this.eatWord('as') ? { e, alias: this.name().v } : { e };
  }

  private orderBy(): OrderItem[] {
    if (!this.eatWord('order')) return [];
    this.expectWord('by');
    const out: OrderItem[] = [];
    do {
      const e = this.expr();
      const dir = this.eatWord('desc') ? 'desc' : 'asc';
      if (dir === 'asc') this.eatWord('asc');
      out.push({ e, dir });
    } while (this.eatOp(','));
    return out;
  }

  /** source {INNER | LEFT [OUTER] | RIGHT [OUTER] JOIN source ON e}: left-associative, each join one level deeper. */
  private from(): FromItem {
    let l = this.fromPrimary();
    let joins = 0;
    try {
      for (;;) {
        const t = this.tok;
        const kind: JoinKind | null = this.eatWord('inner') ? 'inner' : this.eatWord('left') ? 'left' : this.eatWord('right') ? 'right' : null;
        if (!kind) return l;
        if (kind !== 'inner') this.eatWord('outer');
        this.expectWord('join');
        this.enter(t);
        joins++;
        const r = this.fromPrimary();
        this.expectWord('on');
        l = { k: 'join', kind, l, r, on: this.expr() };
      }
    } finally { level -= joins; }
  }

  private fromPrimary(): FromItem {
    if (this.isOp('(')) {
      return this.nested(() => {
        this.p++;
        if (this.isWord('select')) {
          const q = this.select();
          this.expectOp(')');
          this.eatWord('as');
          return { k: 'derived', q, alias: this.table() };
        }
        const f = this.from();
        this.expectOp(')');
        return f;
      });
    }
    const name = this.table();
    const t = this.tok;
    if (this.eatWord('as') || (t.t === 'id' && !(t.bare && SQL_WORDS.has(asciiLower(t.v))))) return { k: 'source', name, alias: this.table() };
    return { k: 'source', name };
  }

  private insert(): Query['body'] {
    this.expectWord('into');
    const target = this.table();
    const columns: string[] = [];
    if (this.eatOp('(')) {
      do columns.push(this.name().v); while (this.eatOp(','));
      this.expectOp(')');
    }
    if (!this.eatWord('values')) return { k: 'insert', target, columns, source: this.select() };
    this.expectOp('(');
    const values = this.exprList();
    this.expectOp(')');
    return { k: 'insert', target, columns, source: { values } };
  }

  private update(): Query['body'] {
    const from = this.from();
    this.expectWord('set');
    const set: { target: Expr; value: Expr }[] = [];
    do {
      const n = this.name();
      let target: Expr = { k: 'id', name: n.v };
      if (this.eatOp('.')) {
        const f = this.tok;
        if (f.t !== 'id' || (!f.bare && f.v === '')) this.fail();
        this.p++;
        target = { k: 'id', name: f.v, table: this.table(n) };
      }
      this.expectOp('=');
      set.push({ target, value: this.expr() });
    } while (this.eatOp(','));
    return this.eatWord('where') ? { k: 'update', from, set, where: this.expr() } : { k: 'update', from, set };
  }

  private delete(): Query['body'] {
    let target: string | undefined;
    if (!this.eatOp('*') && this.isAllOf()) target = this.allOf();
    this.expectWord('from');
    const from = this.from();
    const q: Query['body'] = { k: 'delete', ...(target !== undefined && { target }), from };
    return this.eatWord('where') ? { ...q, where: this.expr() } : q;
  }
}

const LITERALS = new Set<Expr['k']>(['num', 'str', 'date', 'bool', 'null']);
/** A column heading of PIVOT … IN (B4 R8): a literal, or `-` on a number (-1: literalOf's form). */
export const isHeadingLiteral = (h: Expr): boolean => LITERALS.has(h.k) || (h.k === 'un' && h.op === '-' && h.e.k === 'num');

/** Position of the first `In` at parenthesis depth 0 from `pos` to the statement's end (`;`), or -1: after PIVOT, its column headings list (Access
 *  reads `PIVOT x In (…)` so; the printer parenthesises a pivot expression that would read so). */
export function topLevelIn(toks: Token[], pos: number): number {
  for (let depth = 0, i = pos; toks[i].t !== 'eof'; i++) {
    const t = toks[i];
    if (t.t === 'op' && t.v === ';') return -1;
    if (t.t === 'op' && t.v === '(') depth++;
    else if (t.t === 'op' && t.v === ')') depth--;
    else if (depth === 0 && t.t === 'kw' && t.v === 'In') return i;
  }
  return -1;
}

/** Subquery hook of the expression parser: `toks[pos]` is SELECT; `end` is the closing parenthesis. */
const readSubquery = (toks: Token[], pos: number): { q: SelectQuery; end: number } => new SqlParser(toks, pos).subquery();

/** Expression options of the dialect, also used by the design grid cells (Field, Criteria, Update To…): qualified
 *  references, SQL words as stop words, subqueries read by this parser. */
export const QUERY_PARSE: ParseOptions = { qualified: true, stopWords: SQL_WORDS, subquery: readSubquery };

/** The dialect has no comments: two touching `-` become one `--` token, which no rule accepts, so it is refused where it
 *  stands (a double negation is written `- -`, as the printer does). */
function noComments(toks: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of toks) {
    const prev = out[out.length - 1];
    if (t.t === 'op' && t.v === '-' && prev?.t === 'op' && prev.v === '-' && prev.end === t.start) out[out.length - 1] = { ...prev, v: '--', end: t.end };
    else out.push(t);
  }
  return out;
}

/** BaseCraft SQL -> query tree. Throws ExprSyntaxError (code, span in the text). */
export function parseSql(text: string): Query {
  return new SqlParser(noComments(tokenize(text)), 0).query();
}
