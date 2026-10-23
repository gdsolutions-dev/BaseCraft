// Générateur d'expressions, partie pure : les listes (éléments, catégories, valeurs), l'insertion au curseur et le contrôle
// du texte avant « OK ». Le texte est en forme affichée (langue de l'interface, région) ; OK rend la forme canonique.
import { ExprSyntaxError, type ExprErrorCode, type Span } from '../../shared/expr/ast';
import { FUNCTIONS, KEYWORDS, type KeywordName } from '../../shared/expr/catalog';
import { tokenize } from '../../shared/expr/lexer';
import { lexConfig, listSeparator, toCanonical, type LocalizeOptions } from '../../shared/expr/localize';
import { sameName } from '../../shared/field-types';
import en from '../../shared/i18n/en.json';
import fr from '../../shared/i18n/fr.json';
import type { LocaleInfo } from '../../shared/locale-format';

/** fields: the names an expression may use here (a rule: its own field; a default value: none; a filter: the table's). */
/** aggregates: a group exists (A3 totals query, A5 report group); otherwise aggregates are neither offered nor accepted. */
/** query: a query grid cell (A3): these parse options (qualified names, subqueries), and any name is accepted (a parameter). */
export interface BuilderContext { fields: string[]; lang: 'fr' | 'en'; region: LocaleInfo; criteria: boolean; aggregates?: boolean
  query?: Pick<LocalizeOptions, 'qualified' | 'subquery' | 'printSub'> }
export type BuilderElement = 'functions' | 'fields' | 'operators' | 'constants';
/** fn: the canonical name of a function (its description is `expr.fn.<fn>`). */
export interface BuilderItem { label: string; snippet: string; fn?: string }

const OPERATORS: Record<string, string[]> = {
  arithmetic: ['+', '-', '*', '/', '\\', '^', 'Mod'],
  comparison: ['=', '<>', '<', '<=', '>', '>=', 'Between', 'Like', 'In'],
  logical: ['And', 'Or', 'Not', 'Xor'],
  string: ['&'],
};
const word = (k: string, ctx: BuilderContext): string => (ctx.lang === 'fr' && k in KEYWORDS ? KEYWORDS[k as KeywordName].fr : k);

/** Fields only when some may be used (a default value names none). */
export function elements(ctx: BuilderContext): BuilderElement[] {
  return ctx.fields.length ? ['functions', 'fields', 'operators', 'constants'] : ['functions', 'operators', 'constants'];
}

/** 'all' first; function categories are `expr.cat.<c>`, operator ones `builder.op.<c>`. */
export function categories(el: BuilderElement): string[] {
  if (el === 'functions') return ['all', 'text', 'number', 'date', 'logic', 'conversion'];
  return el === 'operators' ? ['all', ...Object.keys(OPERATORS)] : ['all'];
}

export function items(el: BuilderElement, cat: string, ctx: BuilderContext): BuilderItem[] {
  switch (el) {
    case 'functions':
      return FUNCTIONS.filter((f) => (cat === 'all' || f.category === cat) && (ctx.aggregates || f.category !== 'aggregate'))
        .map((f) => ({ label: ctx.lang === 'fr' ? f.fr : f.name, snippet: functionSnippet(f.name, ctx), fn: f.name }))
        .sort((a, b) => a.label.localeCompare(b.label, ctx.lang));
    case 'fields': return ctx.fields.map((n) => ({ label: n, snippet: `[${n}]` }));
    case 'operators':
      return Object.entries(OPERATORS).filter(([c]) => cat === 'all' || c === cat)
        .flatMap(([, ops]) => ops.map((o) => ({ label: word(o, ctx), snippet: word(o, ctx) })));
    case 'constants': return ['""', 'True', 'False', 'Null'].map((k) => ({ label: word(k, ctx), snippet: word(k, ctx) }));
  }
}

/** « VraiFaux(«expr»; «vrai»; «faux») »: every argument as a placeholder, as Access writes them (optional ones too). */
export function functionSnippet(name: string, ctx: BuilderContext): string {
  const f = FUNCTIONS.find((x) => x.name === name);
  if (!f) throw new Error(`unknown function ${name}`);
  const args = ((ctx.lang === 'fr' ? fr : en).expr.args as Record<string, string[]>)[name] ?? [];
  return `${ctx.lang === 'fr' ? f.fr : f.name}(${args.map((a) => `«${a}»`).join(`${listSeparator(ctx.region)} `)})`;
}

/** Inserts `snippet` at `caret`, a space apart from a neighbouring word; the caret goes after it, or on its first placeholder. */
export function insertAt(text: string, caret: number, snippet: string): { text: string; caret: number } {
  const before = text.slice(0, caret), after = text.slice(caret);
  const pre = before && !/[\s(]$/.test(before) ? ' ' : '';
  const post = after && !/^[\s),;]/.test(after) ? ' ' : '';
  const hole = snippet.indexOf('«');
  return { text: before + pre + snippet + post + after, caret: before.length + pre.length + (hole >= 0 ? hole : snippet.length) };
}

/** The faulty part to select: a whole placeholder, or the last element of an incomplete expression. */
function faultyPart(text: string, code: ExprErrorCode, span: Span, ctx: BuilderContext): Span {
  const close = text[span.start] === '«' ? text.indexOf('»', span.start) : -1;
  if (close > 0) return { start: span.start, end: close + 1 };
  if (code === 'unexpectedEnd' && span.start === span.end) {
    const last = tokenize(text, lexConfig(ctx)).at(-2); // before eof
    if (last) return { start: last.start, end: last.end };
  }
  return span;
}

/** OK of the builder: the canonical form, or why not and where (positions in `text`). Empty text: ''. */
export function check(text: string, ctx: BuilderContext): { ok: true; canonical: string } | { ok: false; code: ExprErrorCode; span: Span } {
  if (!text.trim()) return { ok: true, canonical: '' };
  let canonical: string;
  try {
    canonical = toCanonical(text, ctx, { ...ctx.query, criteria: ctx.criteria, aggregates: !!ctx.aggregates });
  } catch (e) {
    if (e instanceof ExprSyntaxError) return { ok: false, code: e.code, span: faultyPart(text, e.code, e.span, ctx) };
    if (e instanceof RangeError) return { ok: false, code: 'tooComplex', span: { start: 0, end: text.length } }; // nesting too deep
    throw e;
  }
  if (ctx.query) return { ok: true, canonical };
  // A name not followed by « ( » is a field (Access ignores its case).
  const toks = tokenize(text, lexConfig(ctx));
  const bad = toks.find((x, i) => x.t === 'id' && !(x.bare && toks[i + 1].t === 'op' && toks[i + 1].v === '(') && !ctx.fields.some((n) => sameName(n, x.v)));
  return bad ? { ok: false, code: 'unknownField', span: { start: bad.start, end: bad.end } } : { ok: true, canonical };
}
