// R1: the names of the public Python functions of the modules, known to the parser at the sites that may call Python.
// The renderer fills it (the main process never does: table rules, defaults and SQL cannot reach Python). Pure module.
import { ExprSyntaxError, type ExprErrorCode, type FunctionTable } from './ast';
import { FUNCTION_TABLE } from './catalog';

const isBuiltin = (name: string): boolean => Object.keys(FUNCTION_TABLE).some((k) => k.toLowerCase() === name.toLowerCase());

let names: ReadonlySet<string> = new Set();   // folded, for membership
let spelled: readonly string[] = [];          // the exports' own spelling, the call node's name
let version = 0;
let table: FunctionTable | undefined;

/** Replaces the registry; a built-in name is never added. */
export function setUserFunctions(list: Iterable<string>): void {
  const kept = [...list].filter((n) => !isBuiltin(n));
  names = new Set(kept.map((n) => n.toLowerCase()));
  spelled = kept;
  version++;
  table = undefined;
}

export const userFunctionNames = (): ReadonlySet<string> => names;
export const userFunctionsVersion = (): number => version;

/** FUNCTION_TABLE plus each user name with {min:0,max:255}; the same object until the next setUserFunctions. */
export function withUserFunctions(): FunctionTable {
  return table ??= { ...FUNCTION_TABLE, ...Object.fromEntries(spelled.map((n) => [n, { min: 0, max: 255 }])) };
}

/** R6: an unknownFunction whose name is a user function becomes pythonNotAllowed (carrying the name). */
export function refineUnknownFunction(e: ExprSyntaxError, text: string): ExprSyntaxError {
  if (e.code !== 'unknownFunction') return e;
  const name = text.slice(e.span.start, e.span.end);
  return names.has(name.toLowerCase()) ? new ExprSyntaxError('pythonNotAllowed', e.span, name) : e;
}

/** R6 for the places that keep an error as a code string: `pythonNotAllowed:<name>` (read by the renderer's exprErrorText). */
export function refinedCode(e: ExprSyntaxError, text: string): ExprErrorCode {
  const r = refineUnknownFunction(e, text);
  return (r.code === 'pythonNotAllowed' ? `pythonNotAllowed:${r.fn}` : r.code) as ExprErrorCode;
}
