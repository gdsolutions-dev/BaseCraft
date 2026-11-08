import type { DatabaseSync } from 'node:sqlite';
import { sameName } from '../shared/field-types';
import type { ModuleExport } from '../shared/python/bridge';
import { isModuleName, parseModuleDef, type ModuleDef } from '../shared/python/module-def';
import { getObject, listObjects, saveObject, setObjectDescription } from '../main/db/objects';
import type { OpOutcome } from './ops';

const refuse = (message: string): OpOutcome => ({ ok: false, message });

const DEF = /^(?:async\s+)?def\s+([\p{L}_][\p{L}\p{N}_]*)\s*\(/u;

/** Parameter names of a `def` signature body (text between its parentheses): like the engine's posonlyargs + args + kwonlyargs, so no `*args`, `**kw`, `/` or bare `*`. */
function paramNames(sig: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = '';
  for (const ch of sig) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p && !p.startsWith('*') && p !== '/')
    .map((p) => /^[\p{L}_][\p{L}\p{N}_]*/u.exec(p)?.[0] ?? '').filter(Boolean);
}

/**
 * The exports basecraft.exports.of (src/python/basecraft/exports.py) would give, without Python: public (no leading `_`) `def` / `async def` at column 0.
 * ponytail: a scanner, not a parser. A column-0 `def` inside a triple-quoted string is skipped by a quote toggle; code with a syntax error may still give
 * exports (the engine gives none). BaseCraft recomputes them with the real parser at the next save of the module.
 */
export function scanExports(source: string): ModuleExport[] {
  const lines = source.split(/\r\n|\r|\n/);
  const out: ModuleExport[] = [];
  let quote: string | null = null; // the open triple-quote delimiter, if any
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const inString = quote !== null;
    for (const m of line.matchAll(/'''|"""/g)) quote = quote === null ? m[0] : quote === m[0] ? null : quote;
    if (inString) continue;
    const m = DEF.exec(line);
    if (!m || m[1]!.startsWith('_')) continue;
    let sig = line.slice(m[0].length), depth = 1, j = i; // gather the signature up to the matching `)`, over several lines
    let text = '';
    for (;;) {
      let end = -1;
      for (let k = 0; k < sig.length; k++) { const ch = sig[k]!; if ('([{'.includes(ch)) depth++; else if (')]}'.includes(ch) && --depth === 0) { end = k; break; } }
      if (end >= 0) { text += sig.slice(0, end); break; }
      text += sig + ' ';
      if (++j >= lines.length) break; // unterminated: keep what we have, the engine would report a syntax error
      sig = lines[j]!;
    }
    out.push({ name: m[1]!, params: paramNames(text) });
  }
  return out;
}

function moduleCreate(db: DatabaseSync, args: Record<string, unknown>): OpOutcome {
  const { name: rawName, code, description } = args;
  if (typeof rawName !== 'string') return refuse('"name" must be a string');
  if (typeof code !== 'string') return refuse('"code" must be a string');
  if (description !== undefined && typeof description !== 'string') return refuse('"description" must be a string');
  const name = rawName.normalize('NFC');
  if (!isModuleName(name)) return refuse(`invalid module name: ${rawName}`);
  const def: ModuleDef = parseModuleDef({ formatVersion: '1.0', source: code, exports: scanExports(code) });
  const r = saveObject(db, 'module', name, def, null);
  if (!r.ok) return refuse(r.reason === 'nameExists' ? `module name already used: ${name}` : r.reason === 'nameInvalid' ? `invalid module name: ${rawName}` : r.reason);
  if (description !== undefined) setObjectDescription(db, 'module', name, description);
  return { ok: true };
}

/** The module whose saved exports hold `name` (renderer/python/function-index.ts resolveFunction, on the temp copy): exactly one, else a refusal. */
export function findPythonFunction(db: DatabaseSync, name: string): { ok: true; module: string } | { ok: false; message: string } {
  const owners: string[] = [];
  for (const { name: module } of listObjects(db, 'module')) {
    const exports = (getObject(db, 'module', module)?.definition as Partial<ModuleDef> | null)?.exports;
    // one owner per matching export, as the app's resolveFunction counts: a module exporting f twice (or f and F) is ambiguous
    if (Array.isArray(exports)) for (const e of exports) if (typeof e?.name === 'string' && sameName(e.name, name)) owners.push(module);
  }
  if (owners.length === 0) return { ok: false, message: `python function not found: ${name}` };
  if (owners.length > 1) return { ok: false, message: `python function is ambiguous: ${name} (${owners.join(', ')})` };
  return { ok: true, module: owners[0]! };
}

export const MODULE_HANDLERS = { 'module.create': moduleCreate };
