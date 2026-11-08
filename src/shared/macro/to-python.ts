// Converts a macro to Python source (D4). Pure. Access's "Convert Macros to Visual Basic", with docmd / tempvars / msgbox as the target API.
import { ExprSyntaxError, type Expr } from '../expr/ast'
import { FUNCTION_TABLE } from '../expr/catalog'
import { parseCanonical, serialize } from '../expr/parser'
import { withUserFunctions } from '../expr/user-functions'
import { foldName } from '../field-types'
import { parsePythonCall } from '../python/call-text'
import { DOCMD_NAMES, snake } from '../python/docmd-names'
import { isModuleName } from '../python/module-def'
import { actionDef, type ActionDef, type ArgDef } from './catalog'
import type { MacroDef, MacroItem } from './model'

export interface ConvertOptions { errorHandling: boolean; comments: boolean }
export interface ConvertEnv { moduleOf(fn: string): { module: string; fn: string } | null }   // module exporting fn, with the exported spelling of its name; null = unknown
export interface Note { path: string; action: string; kind: 'todo' | 'approx' }   // path like items[2].branches[0].items[1]
export interface Converted { source: string; functions: string[]; notes: Note[] }

const IND = '    '
// A JSON string is a valid Python literal; U+2028 / U+2029 / U+0085 are escaped too (JSON leaves them raw, other tools read them as line breaks).
const lit = (s: string): string => JSON.stringify(s).replace(/[\u2028\u2029\u0085]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`)
const LINE_BREAK = /\r\n|[\r\n\u2028\u2029\v\f\u0085]/
/** Free text placed after a `#`: one line, so it can never open a Python statement. */
const oneLine = (s: string): string => s.replace(new RegExp(LINE_BREAK.source, 'g'), ' ').replace(/\0/g, ' ')   // NUL is a SyntaxError even in a comment
const RESERVED = new Set(['msgbox', 'inputbox', 'docmd', 'tempvars', 'forms', 'reports', 'me', 'screen', 'app', 'db', 'eval_expr',
  'range', 'str', 'int', 'Exception', 'suppress', 'datetime', 'eval_cond', 'eval_text', 'localvars'].map(foldName))
const isBuiltinFn = (n: string): boolean => Object.keys(FUNCTION_TABLE).some((k) => k.toLowerCase() === n.toLowerCase())

/** A Python identifier from free text; never a keyword, a built-in expression function or a name the generated code uses. */
export function pyName(s: string): string {
  let n = s.replace(/[^\p{L}\p{Nd}_]/gu, '_')
  if (!/^[\p{L}_]/u.test(n)) n = `m_${n}`
  if (!isModuleName(n) || RESERVED.has(foldName(n)) || isBuiltinFn(n)) n += '_'
  return n
}

export function convertedModuleName(macro: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(foldName))
  const base = [...`Converted_Macro_${macro.replace(/[^\p{L}\p{Nd}_]/gu, '_')}`].slice(0, 56).join('')   // keeps room for a _N suffix under the 64-character object-name limit
  let n = base, i = 1
  while (used.has(foldName(n))) n = `${base}_${++i}`
  return n
}

class Unconvertible extends Error {}
interface Ctx { o: ConvertOptions; env: ConvertEnv; notes: Note[]; imports: Set<string>; usesLocals: boolean; subs: Map<string, string> }

const parse = (t: string): Expr => {
  try { return parseCanonical(t, { functions: withUserFunctions() }) } catch (e) { if (e instanceof ExprSyntaxError) throw new Unconvertible(); throw e }
}
/** A literal Python writes exactly as BaseCraft reads it (numbers, text, True / False / None); null otherwise. */
function literal(e: Expr): string | null {
  switch (e.k) {
    case 'num': return e.v
    case 'str': return lit(e.v)
    case 'bool': return e.v ? 'True' : 'False'
    case 'null': return 'None'
    case 'un': return e.op === '-' && e.e.k === 'num' ? `-${e.e.v}` : null
    default: return null
  }
}

/** A plain reference whose value goes straight to an API argument. */
function reference(e: Expr, c: Ctx): string | null {
  if (e.k === 'id') return e.table ? null : `me[${lit(e.name)}].value`
  if (e.k !== 'member') return null
  const [root, a, b] = e.path
  if (root === 'TempVars' && e.path.length === 2) return `tempvars[${lit(a!)}]`
  if (root === 'LocalVars' && e.path.length === 2) { c.usesLocals = true; return `localvars.get(${lit(foldName(a!))})` }
  if ((root === 'Forms' || root === 'Reports') && e.path.length === 3) return `${root.toLowerCase()}[${lit(a!)}][${lit(b!)}].value`
  return null
}

const UNBOUND = new Set(['LocalVars', 'MacroError'].map(foldName))
/** True when the tree refers to LocalVars or MacroError, which the engine binds but the bridge and docmd do not. */
function refersToUnbound(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(refersToUnbound)
  if (typeof node !== 'object' || node === null) return false
  const n = node as { k?: unknown; path?: unknown }
  if (n.k === 'member' && Array.isArray(n.path) && typeof n.path[0] === 'string' && UNBOUND.has(foldName(n.path[0]))) return true
  return Object.values(node).some(refersToUnbound)
}
/** The expression evaluated by the BaseCraft engine: `fn` is eval_expr, eval_cond or eval_text. */
function bridged(fn: string, e: Expr): string {
  if (refersToUnbound(e)) throw new Unconvertible()
  return `${fn}(${lit(serialize(e))})`
}
/** A where condition, passed as text to docmd: it must not need a binding docmd lacks. Unparsable: passed as is (docmd reports it). */
function whereArg(raw: string): string {
  let e: Expr | undefined
  try { e = parseCanonical(raw, { functions: withUserFunctions() }) } catch (x) { if (!(x instanceof ExprSyntaxError)) throw x }
  if (e ? refersToUnbound(e) : /\[\s*(LocalVars|MacroError)\s*\]\s*!/i.test(raw)) throw new Unconvertible()
  return lit(raw)
}

/** A value: a literal, or (`plain`, nothing applied to it) a reference; anything else is evaluated by the engine. */
function py(e: Expr, c: Ctx, plain = false): string {
  return literal(e) ?? (plain ? reference(e, c) : null) ?? bridged('eval_expr', e)
}
/** A condition, with the engine's truthiness (Null and errors included). */
const cond = (e: Expr): string => (e.k === 'bool' ? (e.v ? 'True' : 'False') : bridged('eval_cond', e))

/** A `text` / `number` argument: a literal, or `=` + an expression. */
function textArg(raw: string, c: Ctx): string {
  if (raw.startsWith('=')) { const e = parse(raw.slice(1)); return e.k === 'str' ? lit(e.v) : bridged('eval_text', e) }
  return lit(raw)   // number arguments too: docmd reads the text as the engine does ("07", "1.50"); a bare 07 is a Python SyntaxError
}

function argValue(a: ArgDef, raw: string, c: Ctx): string {
  switch (a.type) {
    case 'expression': return py(parse(raw), c, true)
    case 'where': return whereArg(raw)
    case 'text': return textArg(raw, c)
    case 'number': return textArg(raw, c)
    case 'enum': return a.options?.length === 2 && a.options[0] === 'yes' ? (raw === 'yes' ? 'True' : 'False') : lit(raw)
    default: return lit(raw)
  }
}

function docmdCall(def: ActionDef, args: Record<string, string>, c: Ctx): string {
  const kws: string[] = []
  for (const a of def.args) {
    const raw = args[a.name]
    if (raw === undefined || raw.trim() === '') { if (a.required) throw new Unconvertible(); continue }
    const yesNo = a.type === 'enum' && a.options?.[0] === 'yes'
    if (!yesNo && raw === a.default) continue   // yes/no values are always written: set_warnings() alone would not say what it does
    kws.push(`${snake(a.name)}=${argValue(a, raw, c)}`)
  }
  return `docmd.${snake(def.name)}(${kws.join(', ')})`
}

const need = (a: Record<string, string>, n: string): string => { const v = a[n]; if (v === undefined || v.trim() === '') throw new Unconvertible(); return v }

/** Lines for one action (no indentation). Throws Unconvertible. OnError is handled by `emit`. */
function action(it: Extract<MacroItem, { k: 'action' }>, c: Ctx, path: string): string[] {
  const def = actionDef(it.action), a = it.args
  if (!def) throw new Unconvertible()
  switch (def.name) {
    case 'StopMacro': return ['return']
    case 'StopAllMacros': c.notes.push({ path, action: it.action, kind: 'approx' }); return ['return  # StopAllMacros: BaseCraft also stops the calling macros']
    case 'CancelEvent': return ['docmd.cancel_event()']
    case 'ClearMacroError': case 'OnError': return []
    case 'RemoveAllTempVars': return ['tempvars.clear()']
    case 'RemoveTempVar': return [`del tempvars[${textArg(need(a, 'Name'), c)}]`]
    case 'SetTempVar': return [`tempvars[${textArg(need(a, 'Name'), c)}] = ${py(parse(need(a, 'Expression')), c, true)}`]
    case 'SetLocalVar': {
      const name = need(a, 'Name')
      if (name.startsWith('=')) throw new Unconvertible()
      c.usesLocals = true
      return [`localvars[${lit(foldName(name))}] = ${py(parse(need(a, 'Expression')), c, true)}`]   // one dict per function: a variable never set reads Null
    }
    case 'SetValue': {
      const item = parse(need(a, 'Item'))
      const target = item.k === 'member' && item.path[0] === 'Forms' && item.path.length === 3 ? `forms[${lit(item.path[1]!)}][${lit(item.path[2]!)}].value`
        : item.k === 'id' && !item.table ? `me[${lit(item.name)}].value` : null
      if (!target) throw new Unconvertible()
      return [`${target} = ${py(parse(need(a, 'Expression')), c, true)}`]
    }
    case 'MessageBox': {
      const kws = [textArg(need(a, 'Message'), c)]
      if (a.Title?.trim()) kws.push(`title=${textArg(a.Title, c)}`)
      if (a.Type && a.Type !== 'none') kws.push(`icon=${lit(a.Type)}`)
      return [...((a.Beep ?? 'yes') === 'yes' ? ['docmd.beep()'] : []), `msgbox(${kws.join(', ')})`]
    }
    case 'RunCode': {
      const call = parsePythonCall(need(a, 'FunctionName'))
      if (!call) throw new Unconvertible()
      const mod = c.env.moduleOf(call.name), args = call.args.map((x) => py(x, c, true)).join(', ')
      if (mod) { c.imports.add(`import ${mod.module}`); return [`${mod.module}.${mod.fn}(${args})`] }
      c.notes.push({ path, action: it.action, kind: 'approx' })
      return [`${call.name}(${args})  # TODO: import the module that defines ${oneLine(call.name)}`]
    }
    case 'RunMacro': {
      const call = `docmd.run_macro(${lit(need(a, 'MacroName'))})`
      const cnt = a.RepeatCount?.trim(), rep = a.RepeatExpression?.trim()
      if (!cnt && !rep) return [call]
      if (cnt && !cnt.startsWith('=') && !/^\d+$/.test(cnt)) throw new Unconvertible()
      const count = cnt ? `range(int(${textArg(cnt, c)}))` : null, test = rep ? cond(parse(rep)) : null
      if (count && test) return [`for _ in ${count}:`, `${IND}if not ${test}:`, `${IND}${IND}break`, `${IND}${call}`]
      return count ? [`for _ in ${count}:`, `${IND}${call}`] : [`while ${test}:`, `${IND}${call}`]
    }
    default:
      if (!DOCMD_NAMES.includes(snake(def.name))) throw new Unconvertible()
      return [docmdCall(def, a, c)]
  }
}

const todo = (c: Ctx, path: string, what: string): string[] => {
  c.notes.push({ path, action: what, kind: 'todo' })
  return [`# TODO(convert): ${oneLine(what)} cannot be converted`, `raise NotImplementedError(${lit(`${what} cannot be converted`)})`]
}
const body = (lines: string[]): string[] => (lines.length ? lines : ['pass'])
const indent = (lines: string[], n = 1): string[] => lines.map((l) => (l ? IND.repeat(n) + l : l))

/** `from` > 0: the rest of a list after an OnError. `suppress`: OnError Next is in force. */
function emit(items: MacroItem[], from: number, c: Ctx, path: string, suppress: boolean): string[] {
  const out: string[] = []
  for (let i = from; i < items.length; i++) {
    const it = items[i]!, p = `${path}[${i}]`
    switch (it.k) {
      case 'submacro': break
      case 'comment': if (c.o.comments) out.push(...it.text.split(LINE_BREAK).map((l) => `# ${l}`)); break
      case 'group':
        if (c.o.comments) out.push(`# Group: ${oneLine(it.name)}`)
        out.push(...emit(it.items, 0, c, `${p}.items`, suppress))
        break
      case 'if':
        try {
          const lines: string[] = []
          it.branches.forEach((b, j) => {
            lines.push(`${j === 0 ? 'if' : 'elif'} ${cond(parse(b.cond))}:`, ...indent(body(emit(b.items, 0, c, `${p}.branches[${j}].items`, suppress))))
          })
          if (it.else) lines.push('else:', ...indent(body(emit(it.else, 0, c, `${p}.else`, suppress))))
          out.push(...lines)
        } catch (e) { if (!(e instanceof Unconvertible)) throw e; out.push(...todo(c, p, 'If')) }
        break
      case 'action': {
        if (it.action === 'OnError') {
          const goTo = it.args.GoTo || 'next'
          if (goTo === 'macroName') {
            const fn = c.subs.get(foldName(it.args.MacroName ?? ''))
            if (!fn) { out.push(...todo(c, p, 'OnError')); break }
            out.push('try:', ...indent(body(emit(items, i + 1, c, path, false))), 'except Exception:', `${IND}${fn}()`, `${IND}return`)
            return out   // the rest of the list is inside the try
          }
          suppress = goTo === 'next'
          break
        }
        let lines: string[]
        try { lines = action(it, c, p) } catch (e) { if (!(e instanceof Unconvertible)) throw e; lines = todo(c, p, it.action) }
        if (suppress && lines.length && !/^(return|raise|#)/.test(lines[0]!)) { c.imports.add('from contextlib import suppress'); lines = ['with suppress(Exception):', ...indent(lines)] }
        out.push(...lines)
        break
      }
    }
  }
  return out
}

function fn(name: string, label: string, items: MacroItem[], c: Ctx, path: string): string {
  c.usesLocals = false
  const b = emit(items, 0, c, path, false)
  const lines = c.o.errorHandling ? ['try:', ...indent(body(b)), 'except Exception as e:', `${IND}msgbox(str(e))`] : body(b)
  if (c.usesLocals) lines.unshift('localvars = {}')
  return [`# ${'-'.repeat(60)}`, `# ${oneLine(label)}`, `# ${'-'.repeat(60)}`, `def ${name}():`, ...indent(lines)].join('\n')
}

export function convertMacro(name: string, def: MacroDef, o: ConvertOptions, env: ConvertEnv): Converted {
  const c: Ctx = { o, env, notes: [], imports: new Set(), usesLocals: false, subs: new Map() }
  const used = new Set<string>()
  const uniq = (n: string): string => { let r = n, i = 1; while (used.has(foldName(r))) r = `${n}_${++i}`; used.add(foldName(r)); return r }
  const main = uniq(pyName(name))
  const subs = def.items.flatMap((it, i) => (it.k === 'submacro' ? [{ it, i }] : []))
  for (const { it } of subs) c.subs.set(foldName(it.name), uniq(pyName(`${name}_${it.name}`)))
  const head = def.items.filter((x) => x.k !== 'submacro')
  const fns: { name: string; text: string }[] = []
  if (head.length || !subs.length) fns.push({ name: main, text: fn(main, name, head, c, 'items') })
  for (const { it, i } of subs) {
    const n = c.subs.get(foldName(it.name))!
    fns.push({ name: n, text: fn(n, `${name}.${it.name}`, it.items, c, `items[${i}].items`) })
  }
  const imports = [...c.imports].sort()
  const source = `# Converted from the macro ${lit(name)} by BaseCraft.\n${imports.length ? `${imports.join('\n')}\n` : ''}\n\n${fns.map((f) => f.text).join('\n\n\n')}\n`
  return { source, functions: fns.map((f) => f.name), notes: c.notes }
}
