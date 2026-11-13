// Conditional formatting rules of a text box or a combo box (Format › Conditional Formatting): stored as JSON text in the control's
// FormatConditions property (not a catalog property: the dialog is its editor), read back validated (a bad rule is dropped).
// Form view and reports evaluate them per record: the first rule that holds applies its format.
import type { Expr, Value } from '../expr/ast';
import { evaluate, type EvalEnv } from '../expr/evaluate';
import { infoOf, truthy } from '../expr/library';
import { isColorValue, type ColorValue } from './colors';

export const COND_OPS = ['between', 'equal', 'notEqual', 'greater', 'less', 'greaterEqual', 'lessEqual', 'expression'] as const;
export type CondOp = (typeof COND_OPS)[number];
/** `a` and `b` are canonical expressions (the operands of a field-value rule, or `a` the expression of an Expression rule). */
export interface FormatCondition { op: CondOp; a: string; b?: string; bold?: boolean; italic?: boolean; underline?: boolean; fore?: ColorValue; back?: ColorValue }
export interface CompiledCondition { expr: Expr; fmt: FormatCondition }

const MAX_RULES = 50;
const SYMBOL = { equal: '=', notEqual: '<>', greater: '>', less: '<', greaterEqual: '>=', lessEqual: '<=' } as const;

/** The rules stored in a property value; anything unreadable gives none, a malformed rule is dropped. */
export function readConditions(raw: unknown): FormatCondition[] {
  if (typeof raw !== 'string' || raw === '') return [];
  let list: unknown;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const out: FormatCondition[] = [];
  for (const r of list.slice(0, MAX_RULES)) {
    if (r === null || typeof r !== 'object') continue;
    const x = r as Record<string, unknown>;
    if (!COND_OPS.includes(x.op as CondOp) || typeof x.a !== 'string' || !x.a.trim()) continue;
    if (x.op === 'between' && (typeof x.b !== 'string' || !x.b.trim())) continue;
    out.push({ op: x.op as CondOp, a: x.a, ...(x.op === 'between' ? { b: x.b as string } : {}),
      ...(x.bold === true ? { bold: true } : {}), ...(x.italic === true ? { italic: true } : {}), ...(x.underline === true ? { underline: true } : {}),
      ...(isColorValue(x.fore) ? { fore: x.fore } : {}), ...(isColorValue(x.back) ? { back: x.back } : {}) });
  }
  return out;
}

/** The value to store: undefined (property removed) when there is no rule. */
export const writeConditions = (rules: FormatCondition[]): string | undefined => (rules.length ? JSON.stringify(rules) : undefined);

/** The canonical text a rule evaluates, and whether it is a criterion (the control's value is its subject) or an expression. */
export function conditionText(r: FormatCondition): { text: string; criteria: boolean } {
  if (r.op === 'expression') return { text: r.a, criteria: false };
  if (r.op === 'between') return { text: `Between (${r.a}) And (${r.b})`, criteria: true };
  return { text: `${SYMBOL[r.op]}(${r.a})`, criteria: true };
}

/** The rules that parse (`parse` is the caller's, cached: it runs for every record). */
export function compileConditions(raw: unknown, parse: (text: string, criteria: boolean) => Expr): CompiledCondition[] {
  return readConditions(raw).flatMap((fmt) => { const { text, criteria } = conditionText(fmt); try { return [{ expr: parse(text, criteria), fmt }]; } catch { return []; } });
}

/** The format of the first rule that holds for `subject` (the control's value), null when none does; a rule that cannot be evaluated does not hold. */
export async function firstMatch(rules: CompiledCondition[], subject: Value, env: Omit<EvalEnv, 'subject'>): Promise<FormatCondition | null> {
  for (const r of rules) {
    try { if (truthy(await evaluate(r.expr, { ...env, subject }), infoOf(env.locale)) === true) return r.fmt; } catch { /* not evaluable: the rule does not hold */ }
  }
  return null;
}
