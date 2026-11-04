// R1: the text `=name(args)` of an event property (or RunCode's FunctionName) is a call of a Python function of a module.
// Stored canonical; shown localized with toDisplay/toCanonical and `pythonCallFunctions(text)`. Pure module.
import type { Expr, FunctionTable } from '../expr/ast';
import { FUNCTION_TABLE } from '../expr/catalog';
import { parseCanonical } from '../expr/parser';
import { isModuleName } from './module-def';

const HEAD = /^\s*=?\s*([\p{L}_][\p{L}\p{N}_]*)\s*\(/u;
const isBuiltin = (name: string): boolean => Object.keys(FUNCTION_TABLE).some((k) => k.toLowerCase() === name.toLowerCase());

/** `name(args)` with an optional leading `=`; null for anything else (not a single call, a bad name, a built-in name, a syntax error). */
export function parsePythonCall(text: string): { name: string; args: Expr[] } | null {
  const name = HEAD.exec(text)?.[1];
  if (!name || !isModuleName(name) || isBuiltin(name)) return null;
  try {
    const e = parseCanonical(text.replace(/^\s*=/, ''), { functions: pythonCallFunctions(text) });
    return e.k === 'call' && e.name.toLowerCase() === name.toLowerCase() ? { name, args: e.args } : null;
  } catch { return null; }
}

/** FUNCTION_TABLE plus the called name, for toDisplay/toCanonical of the text without `=`. */
export function pythonCallFunctions(text: string): FunctionTable {
  const name = HEAD.exec(text)?.[1];
  return name ? { ...FUNCTION_TABLE, [name]: { min: 0, max: 255 } } : FUNCTION_TABLE;
}
