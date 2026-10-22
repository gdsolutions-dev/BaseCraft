// Analyse récursive descendante de la forme canonique, mode critère, sérialisation. Module pur.
import { sameName } from '../field-types';
import { ExprSyntaxError, type BinOp, type Expr, type FunctionTable } from './ast';
import { FUNCTION_TABLE } from './catalog';
import { tokenize, type Token } from './lexer';

export interface ParseOptions {
  /** Forme d'une règle « Valide si » ou d'un critère : le sujet implicite est inséré. */
  criteria?: boolean;
  /** Table des fonctions (nom canonique -> arité). Défaut : le catalogue. */
  functions?: FunctionTable;
}

const SUBJECT: Expr = { k: 'subject' };
const CMP_OPS = new Set(['=', '<>', '<', '<=', '>', '>=']);
const ARITH_OPS = new Set<string>(['^', '*', '/', '\\', 'Mod', '+', '-']);

class Parser {
  private toks: Token[];
  private p = 0;
  private depth = 0; // > 0 : entre parenthèses (le mode critère ne s'applique qu'au premier niveau)
  private fns: Map<string, [string, { min: number; max: number }]>;

  constructor(toks: Token[], private criteria: boolean, functions: FunctionTable) {
    this.toks = toks;
    this.fns = new Map(Object.entries(functions).map(([name, a]) => [name.toLowerCase(), [name, a]]));
  }

  private get tok(): Token { return this.toks[this.p]; }
  private peek(n = 1): Token { return this.toks[Math.min(this.p + n, this.toks.length - 1)]; }
  private fail(tok: Token = this.tok): never {
    throw new ExprSyntaxError(tok.t === 'eof' ? 'unexpectedEnd' : 'unexpectedToken', { start: tok.start, end: tok.end });
  }
  private isOp(v: string, t: Token = this.tok): boolean { return t.t === 'op' && t.v === v; }
  private isKw(v: string, t: Token = this.tok): boolean { return t.t === 'kw' && t.v === v; }
  private eatOp(v: string): boolean { if (this.isOp(v)) { this.p++; return true; } return false; }
  private eatKw(v: string): boolean { if (this.isKw(v)) { this.p++; return true; } return false; }
  private expectOp(v: string): void { if (!this.eatOp(v)) this.fail(); }
  private expectKw(v: string): void { if (!this.eatKw(v)) this.fail(); }
  private get crit(): boolean { return this.criteria && this.depth === 0; }

  parse(): Expr {
    const e = this.xor();
    if (this.tok.t !== 'eof') this.fail();
    return e;
  }

  // Xor < Or < And : gauche à droite. En mode critère, chaque opérande de premier niveau reçoit le sujet implicite.
  private xor(): Expr { return this.chain(() => this.or(), 'Xor'); }
  private or(): Expr { return this.chain(() => this.and(), 'Or'); }
  private and(): Expr { return this.chain(() => this.operand(), 'And'); }
  private chain(next: () => Expr, op: 'Xor' | 'Or' | 'And'): Expr {
    let l = next();
    while (this.eatKw(op)) l = { k: 'bin', op, l, r: next() };
    return l;
  }

  private operand(): Expr {
    const e = this.not();
    return this.crit ? withSubject(e) : e;
  }

  private not(): Expr {
    // « Not Like / Not In / Not Between » en tête de critère : Not appartient au prédicat, pas à un Not unaire.
    if (this.isKw('Not') && !(this.crit && this.isNegatedPredicate())) {
      this.p++;
      return { k: 'un', op: 'Not', e: this.not() };
    }
    if (this.crit && this.isOp('(')) {
      const g = this.tryGroup();
      if (g) return g;
    }
    return this.comparison();
  }

  /**
   * Mode critère : une parenthèse qui fait partie de la structure logique (suivie de And / Or / Xor, d'une parenthèse
   * fermante ou de la fin) est transparente : le sujet implicite s'applique à ses opérandes, comme au premier niveau.
   * Sinon (`(1 + 2) * 3`, `(a) = b`), c'est une parenthèse ordinaire : on revient en arrière.
   */
  private tryGroup(): Expr | null {
    const [p, depth] = [this.p, this.depth];
    let err: ExprSyntaxError | undefined;
    try {
      this.p++;
      const e = this.xor();
      this.expectOp(')');
      const t = this.tok;
      if (t.t === 'eof' || this.isOp(')') || this.isKw('And') || this.isKw('Or') || this.isKw('Xor')) return e;
    } catch (x) {
      if (!(x instanceof ExprSyntaxError)) throw x;
      err = x;
    }
    [this.p, this.depth] = [p, depth];
    if (err) { // l'analyse ordinaire peut réussir ; sinon on signale l'erreur la plus avancée
      try { this.comparison(); } catch (x) { if (x instanceof ExprSyntaxError && x.span.start >= err.span.start) throw x; throw err; }
      [this.p, this.depth] = [p, depth];
    }
    return null;
  }

  private isNegatedPredicate(): boolean {
    const n = this.peek();
    return this.isKw('Not') && (this.isKw('Like', n) || this.isKw('In', n) || this.isKw('Between', n));
  }

  private startsPredicate(): boolean {
    const t = this.tok;
    return (t.t === 'op' && CMP_OPS.has(t.v)) || this.isKw('Like') || this.isKw('Between') || this.isKw('In') || this.isKw('Is')
      || this.isNegatedPredicate();
  }

  private comparison(): Expr {
    let l: Expr = this.crit && this.startsPredicate() ? SUBJECT : this.concat();
    for (;;) {
      const t = this.tok;
      if (t.t === 'op' && CMP_OPS.has(t.v)) {
        this.p++;
        l = { k: 'bin', op: t.v as BinOp, l, r: this.concat() };
        continue;
      }
      const not = this.isKw('Not') && (this.isKw('Like', this.peek()) || this.isKw('In', this.peek()) || this.isKw('Between', this.peek()));
      if (not) this.p++;
      if (this.eatKw('Like')) l = { k: 'like', e: l, pattern: this.concat(), not };
      else if (this.eatKw('Between')) {
        const lo = this.concat();
        this.expectKw('And');
        l = { k: 'between', e: l, lo, hi: this.concat(), not };
      } else if (this.eatKw('In')) {
        this.expectOp('(');
        this.depth++;
        const list = [this.xor()];
        while (this.eatOp(',')) list.push(this.xor());
        this.expectOp(')');
        this.depth--;
        l = { k: 'in', e: l, list, not };
      } else if (!not && this.eatKw('Is')) {
        const neg = this.eatKw('Not');
        this.expectKw('Null');
        l = { k: 'isnull', e: l, not: neg };
      } else return l;
    }
  }

  private left(next: () => Expr, ops: string[]): Expr {
    let l = next();
    for (;;) {
      const t = this.tok;
      if (!((t.t === 'op' || t.t === 'kw') && ops.includes(t.v))) return l;
      this.p++;
      l = { k: 'bin', op: t.v as BinOp, l, r: next() };
    }
  }

  private concat(): Expr { return this.left(() => this.add(), ['&']); }
  private add(): Expr { return this.left(() => this.mod(), ['+', '-']); }
  private mod(): Expr { return this.left(() => this.intDiv(), ['Mod']); }
  private intDiv(): Expr { return this.left(() => this.mul(), ['\\']); }
  private mul(): Expr { return this.left(() => this.unary(), ['*', '/']); }

  private unary(): Expr {
    if (this.eatOp('-')) return { k: 'un', op: '-', e: this.unary() };
    return this.power();
  }

  // `^` est plus fort que le moins unaire (-2^2 = -4) ; son exposant peut porter un moins : 2^-1.
  private power(): Expr {
    let l = this.primary();
    while (this.eatOp('^')) l = { k: 'bin', op: '^', l, r: this.exponent() };
    return l;
  }
  private exponent(): Expr {
    return this.eatOp('-') ? { k: 'un', op: '-', e: this.exponent() } : this.primary();
  }

  private primary(): Expr {
    const t = this.tok;
    switch (t.t) {
      case 'num': this.p++; return { k: 'num', v: t.v };
      case 'str': this.p++; return { k: 'str', v: t.v };
      case 'date': this.p++; return { k: 'date', v: t.v };
      case 'kw':
        if (t.v === 'True' || t.v === 'False') { this.p++; return { k: 'bool', v: t.v === 'True' }; }
        if (t.v === 'Null') { this.p++; return { k: 'null' }; }
        return this.fail();
      case 'id':
        if (!t.bare && t.v === '') return this.fail();
        this.p++;
        if (t.bare && this.isOp('(')) return this.call(t);
        return { k: 'id', name: t.v };
      case 'op':
        if (t.v === '(') {
          this.p++; this.depth++;
          const e = this.xor();
          this.expectOp(')');
          this.depth--;
          return e;
        }
        return this.fail();
      default: return this.fail();
    }
  }

  private call(name: Token): Expr {
    const f = this.fns.get(name.v.toLowerCase());
    if (!f) throw new ExprSyntaxError('unknownFunction', { start: name.start, end: name.end });
    this.p++; this.depth++; // '('
    const args: Expr[] = [];
    if (!this.isOp(')')) {
      args.push(this.xor());
      while (this.eatOp(',')) args.push(this.xor());
    }
    this.expectOp(')');
    this.depth--;
    if (args.length < f[1].min || args.length > f[1].max) throw new ExprSyntaxError('arity', { start: name.start, end: name.end });
    return { k: 'call', name: f[0], args };
  }
}

/** Valeur (par opposition à une condition) : littéral, champ, appel, moins unaire, arithmétique ou `&`. */
function isValue(e: Expr): boolean {
  switch (e.k) {
    case 'num': case 'str': case 'date': case 'bool': case 'id': case 'call': return true;
    case 'un': return e.op === '-';
    case 'bin': return ARITH_OPS.has(e.op) || e.op === '&';
    default: return false;
  }
}

/**
 * Opérande de premier niveau d'un critère, comme dans Access : une valeur seule signifie `= valeur`.
 * `Null` seul : `<sujet> Is Null`. `Not valeur` : `<sujet> <> valeur` ; `Not Null` : `<sujet> Is Not Null`.
 */
function withSubject(e: Expr): Expr {
  if (e.k === 'null') return { k: 'isnull', e: SUBJECT, not: false };
  if (isValue(e)) return { k: 'bin', op: '=', l: SUBJECT, r: e };
  if (e.k === 'un' && e.op === 'Not') {
    if (e.e.k === 'null') return { k: 'isnull', e: SUBJECT, not: true };
    if (isValue(e.e)) return { k: 'bin', op: '<>', l: SUBJECT, r: e.e };
  }
  return e;
}

/** Analyse un flux de lexèmes canoniques (produit par `tokenize`, éventuellement depuis la forme affichée). */
export function parseTokens(toks: Token[], opts: ParseOptions = {}): Expr {
  return new Parser(toks, opts.criteria === true, opts.functions ?? FUNCTION_TABLE).parse();
}

export function parseCanonical(text: string, opts: ParseOptions = {}): Expr {
  return parseTokens(tokenize(text), opts);
}

// --- Sérialisation -------------------------------------------------------------------------------------------

const PREC: Record<BinOp, number> = {
  Xor: 1, Or: 2, And: 3, '=': 5, '<>': 5, '<': 5, '<=': 5, '>': 5, '>=': 5, '&': 6, '+': 7, '-': 7,
  Mod: 8, '\\': 9, '*': 10, '/': 10, '^': 12,
};
const P_NOT = 4, P_CMP = 5, P_CONCAT = 6, P_NEG = 11, P_ATOM = 13;

function prec(e: Expr): number {
  switch (e.k) {
    case 'bin': return PREC[e.op];
    case 'like': case 'between': case 'in': case 'isnull': return P_CMP;
    case 'un': return e.op === 'Not' ? P_NOT : P_NEG;
    default: return P_ATOM;
  }
}

/** Écriture des éléments qui varient avec la langue et la région ; la structure (priorités, parenthèses) est commune. */
export interface Dialect {
  /** Mot-clé canonique (And, Is, Null, True...) -> texte. */
  kw: (k: string) => string;
  fn: (name: string) => string;
  /** Nombre canonique ('1.5') -> texte. */
  num: (v: string) => string;
  /** Date canonique ('YYYY-MM-DD HH:MM:SS') -> littéral complet, `#…#` compris. */
  date: (v: string) => string;
  /** Entre arguments et éléments de liste, espace comprise. */
  sep: string;
}

export const CANONICAL_DIALECT: Dialect = {
  kw: (k) => k, fn: (n) => n, num: (v) => v, sep: ', ',
  date: (v) => `#${v.endsWith(' 00:00:00') ? v.slice(0, 10) : v}#`,
};

const LOGICAL = new Set<string>(['Xor', 'Or', 'And']);
const isLogical = (e: Expr): boolean => e.k === 'bin' && LOGICAL.has(e.op);
const join = (...parts: string[]): string => parts.filter(Boolean).join(' ');

/** Critère : l'opérande commence par un Like / Between / In non négatif sur le sujet implicite. */
function startsWithPlainPredicate(e: Expr): boolean {
  for (;;) {
    if (e.k === 'bin') e = e.l;
    else if (e.k === 'isnull') e = e.e;
    else if (e.k === 'like' || e.k === 'between' || e.k === 'in') {
      if (e.e.k === 'subject') return !e.not;
      e = e.e;
    } else return false;
  }
}

/** Égalité structurelle de deux arbres. */
export function sameTree(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const [ka, kb] = [Object.keys(a), Object.keys(b)];
  return ka.length === kb.length && ka.every((k) => sameTree((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** `criteria` : forme saisie d'un critère ; le sujet implicite s'écrit « rien » (l'analyseur le remet en tête de l'opérande). */
function emitter(d: Dialect, criteria: boolean) {
  /** Opérande qui exige au moins le niveau `min` ; parenthésé sinon. */
  const ser = (e: Expr, min: number): string => (prec(e) < min ? `(${raw(e)})` : raw(e));
  /** Exposant : `2 ^ -3` est lu comme 2 ^ (-3), mais `2 ^ -3 ^ 2` comme (2 ^ -3) ^ 2 : l'argument du moins reste atomique. */
  const exponent = (e: Expr): string => (e.k === 'un' && e.op === '-' ? `-${exponent(e.e)}` : ser(e, P_ATOM));
  const neg = (not: boolean): string => (not ? `${d.kw('Not')} ` : '');

  function raw(e: Expr): string {
    switch (e.k) {
      case 'num': return d.num(e.v);
      case 'str': return `"${e.v.replace(/"/g, '""')}"`;
      case 'date': return d.date(e.v);
      case 'bool': return d.kw(e.v ? 'True' : 'False');
      case 'null': return d.kw('Null');
      case 'id': return `[${e.name}]`;
      case 'subject': return criteria ? '' : '<subject>';
      case 'un':
        if (e.op === '-') return `-${ser(e.e, P_NEG)}`;
        // `Not Like …` serait relu comme le prédicat négatif `<sujet> Not Like …` : on garde la parenthèse du groupe.
        return join(d.kw('Not'), criteria && startsWithPlainPredicate(e.e) ? `(${raw(e.e)})` : ser(e.e, P_NOT));
      case 'bin': {
        const op = e.op === 'Mod' || LOGICAL.has(e.op) ? d.kw(e.op) : e.op;
        return join(ser(e.l, PREC[e.op]), op, e.op === '^' ? exponent(e.r) : ser(e.r, PREC[e.op] + 1));
      }
      case 'like': return join(ser(e.e, P_CMP), `${neg(e.not)}${d.kw('Like')}`, ser(e.pattern, P_CONCAT));
      case 'between':
        return join(ser(e.e, P_CMP), `${neg(e.not)}${d.kw('Between')}`, ser(e.lo, P_CONCAT), d.kw('And'), ser(e.hi, P_CONCAT));
      case 'in': return join(ser(e.e, P_CMP), `${neg(e.not)}${d.kw('In')}`, `(${e.list.map(raw).join(d.sep)})`);
      case 'isnull': return join(ser(e.e, P_CMP), d.kw('Is'), `${neg(e.not)}${d.kw('Null')}`);
      case 'call': return `${d.fn(e.name)}(${e.args.map(raw).join(d.sep)})`;
    }
  }

  /** Structure logique d'un critère (And / Or / Xor, Not devant un groupe) : la valeur seule s'écrit sans « = ». */
  function crit(e: Expr, min: number): string {
    if (e.k === 'bin' && LOGICAL.has(e.op)) {
      const p = PREC[e.op];
      const s = join(crit(e.l, p), d.kw(e.op), crit(e.r, p + 1));
      return p < min ? `(${s})` : s;
    }
    if (e.k === 'un' && e.op === 'Not' && isLogical(e.e)) return join(d.kw('Not'), `(${crit(e.e, 0)})`);
    return e.k === 'bin' && e.op === '=' && e.l.k === 'subject' && isValue(e.r) ? raw(e.r) : raw(e);
  }
  return { raw, crit: (e: Expr) => crit(e, 0) };
}

export function serializeWith(e: Expr, d: Dialect, criteria = false): string {
  const em = emitter(d, criteria);
  return criteria ? em.crit(e) : em.raw(e);
}

export function serialize(e: Expr): string { return serializeWith(e, CANONICAL_DIALECT); }

/**
 * Forme canonique stockée d'un critère : sans le sujet implicite, relue à l'identique en mode critère.
 * Garde-fou : si la relecture ne redonne pas l'arbre, on lève une erreur plutôt que de stocker un sens différent.
 */
export function serializeCriteria(e: Expr, functions?: FunctionTable): string {
  const out = serializeWith(e, CANONICAL_DIALECT, true);
  let back: Expr | undefined;
  try { back = parseCanonical(out, { criteria: true, functions }); } catch { /* signalé ci-dessous */ }
  if (!back || !sameTree(back, e)) throw new ExprSyntaxError('unexpectedToken', { start: 0, end: out.length }); // jamais stocker un sens différent
  return out;
}

/** Noms de champs référencés, sans doublon au sens d'Access (casse ignorée), dans l'ordre d'apparition. */
export function fieldRefs(e: Expr): string[] {
  const out: string[] = [];
  const walk = (x: Expr): void => {
    switch (x.k) {
      case 'id': if (!out.some((n) => sameName(n, x.name))) out.push(x.name); break;
      case 'un': walk(x.e); break;
      case 'bin': walk(x.l); walk(x.r); break;
      case 'like': walk(x.e); walk(x.pattern); break;
      case 'between': walk(x.e); walk(x.lo); walk(x.hi); break;
      case 'in': walk(x.e); x.list.forEach(walk); break;
      case 'isnull': walk(x.e); break;
      case 'call': x.args.forEach(walk); break;
      default: break;
    }
  };
  walk(e);
  return out;
}
