import { beforeAll, describe, expect, it } from 'vitest'
import { setUserFunctions } from '../expr/user-functions'
import { isValidObjectName } from '../field-types'
import { isModuleName } from '../python/module-def'
import { ACTIONS } from './catalog'
import type { MacroDef, MacroItem } from './model'
import { convertedModuleName, convertMacro, pyName, type ConvertEnv, type ConvertOptions } from './to-python'

beforeAll(() => setUserFunctions(['remise']))

const A = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args })
const def = (...items: MacroItem[]): MacroDef => ({ formatVersion: '1.0', items })
const none: ConvertEnv = { moduleOf: () => null }
const O: ConvertOptions = { errorHandling: false, comments: true }
const conv = (items: MacroItem[], o = O, env = none, name = 'M') => convertMacro(name, def(...items), o, env)
const src = (items: MacroItem[], o = O) => conv(items, o).source

describe('convertMacro', () => {
  it('writes a banner, one function and the messagebox beep', () => {
    expect(conv([A('Beep'), A('MessageBox', { Message: 'Hi' })], O, none, 'Hello').source).toBe(`# Converted from the macro "Hello" by BaseCraft.


# ------------------------------------------------------------
# Hello
# ------------------------------------------------------------
def Hello():
    docmd.beep()
    docmd.beep()
    msgbox("Hi")
`)
  })

  it('wraps the body with error handling', () => {
    const s = src([A('Beep')], { errorHandling: true, comments: true })
    expect(s).toContain('def M():\n    try:\n        docmd.beep()\n    except Exception as e:\n        msgbox(str(e))\n')
  })

  it('keeps or drops comments and group labels', () => {
    const items: MacroItem[] = [{ k: 'comment', text: 'a\nb' }, { k: 'group', name: 'G', items: [A('Beep')] }]
    expect(src(items)).toContain('    # a\n    # b\n    # Group: G\n    docmd.beep()')
    const s = src(items, { errorHandling: false, comments: false })
    expect(s).not.toContain('# a')
    expect(s).not.toContain('# Group')
    expect(s).toContain('    docmd.beep()')
  })

  it('converts If / Else If / Else', () => {
    const s = src([{ k: 'if', branches: [{ cond: '[TempVars]![n] > 3', items: [A('Beep')] }, { cond: '[Name] = "x"', items: [] }], else: [A('StopMacro')] }])
    expect(s).toContain('    if eval_cond("[TempVars]![n] > 3"):\n        docmd.beep()\n    elif eval_cond("[Name] = \\"x\\""):\n        pass\n    else:\n        return\n')
  })

  it('makes one function per submacro; only submacros: no head function', () => {
    const r = conv([A('Beep'), { k: 'submacro', name: 'S1', items: [A('Beep')] }, { k: 'submacro', name: 'S2', items: [] }])
    expect(r.functions).toEqual(['M', 'M_S1', 'M_S2'])
    expect(conv([{ k: 'submacro', name: 'S1', items: [A('Beep')] }]).functions).toEqual(['M_S1'])
  })

  it('names are valid python identifiers and unique', () => {
    expect(pyName('Mon macro-1')).toBe('Mon_macro_1')
    expect(pyName('1abc')).toBe('m_1abc')
    expect(pyName('class')).toBe('class_')
    expect(pyName('msgbox')).toBe('msgbox_')
    expect(pyName('Left')).toBe('Left_')
    const m = convertedModuleName('A b', ['converted_macro_a_b'])
    expect(m).toBe('Converted_Macro_A_b_2')
    expect(isModuleName(m) && isValidObjectName(m)).toBe(true)
    expect(isValidObjectName(convertedModuleName('x'.repeat(100), [])  + '_12')).toBe(true)
    const dup = conv([{ k: 'submacro', name: 'a b', items: [] }, { k: 'submacro', name: 'a-b', items: [] }])
    expect(new Set(dup.functions.map((f) => f.toLowerCase())).size).toBe(2)
  })

  it('writes arguments by keyword, omits defaults, always writes yes/no', () => {
    expect(src([A('OpenForm', { FormName: 'F', View: 'form', WhereCondition: '[Id] = 3', WindowMode: 'dialog' })]))
      .toContain('docmd.open_form(form_name="F", where_condition="[Id] = 3", window_mode="dialog")')
    expect(src([A('SetWarnings', { WarningsOn: 'no' })])).toContain('docmd.set_warnings(warnings_on=False)')
    expect(src([A('GoToRecord', { Record: 'goTo', Offset: '=[TempVars]![n]' })])).toContain('docmd.go_to_record(record="goTo", offset=eval_text("[TempVars]![n]"))')
  })

  it('variables: literals and plain references native, eval_expr otherwise, local vars', () => {
    expect(src([A('SetTempVar', { Name: 'x', Expression: '1 + 2' })])).toContain('tempvars["x"] = eval_expr("1 + 2")')
    expect(src([A('SetTempVar', { Name: 'x', Expression: '-5' })])).toContain('tempvars["x"] = -5')
    expect(src([A('SetTempVar', { Name: 'x', Expression: '[TempVars]![y]' })])).toContain('tempvars["x"] = tempvars["y"]')
    expect(src([A('SetTempVar', { Name: 'x', Expression: '"a" & [y]' })])).toContain('tempvars["x"] = eval_expr("\\"a\\" & [y]")')
    const s = src([A('SetLocalVar', { Name: 'n', Expression: '4' }), A('SetTempVar', { Name: 'y', Expression: '[LocalVars]![N]' })])
    expect(s).toContain('def M():\n    localvars = {}\n    localvars["n"] = 4\n    tempvars["y"] = localvars.get("n")')
    const r = conv([A('MessageBox', { Message: '=[LocalVars]![n] & "x"' })])
    expect(r.notes).toEqual([{ path: 'items[0]', action: 'MessageBox', kind: 'todo' }])
  })

  it('SetValue', () => {
    expect(src([A('SetValue', { Item: '[Forms]![F]![C]', Expression: '5' })])).toContain('forms["F"]["C"].value = 5')
    expect(src([A('SetValue', { Item: '[C]', Expression: '5' })])).toContain('me["C"].value = 5')
    expect(conv([A('SetValue', { Item: '[Reports]![R]![C]', Expression: '5' })]).notes).toHaveLength(1)
  })

  it('RunMacro with repeats', () => {
    expect(src([A('RunMacro', { MacroName: 'M2', RepeatCount: '3' })])).toContain('for _ in range(int("3")):\n        docmd.run_macro("M2")')
    expect(src([A('RunMacro', { MacroName: 'M2', RepeatExpression: '[TempVars]![n] < 3' })])).toContain('while eval_cond("[TempVars]![n] < 3"):\n        docmd.run_macro("M2")')
    expect(src([A('RunMacro', { MacroName: 'M2', RepeatCount: '2', RepeatExpression: '[TempVars]![n] < 3' })])).toContain('if not eval_cond("[TempVars]![n] < 3"):\n            break')
  })

  it('RunCode: module found or approximated', () => {
    const r = conv([A('RunCode', { FunctionName: 'remise([Prix])' })], O, { moduleOf: () => ({ module: 'Calculs', fn: 'remise' }) })
    expect(r.source).toContain('import Calculs')
    expect(r.source).toContain('Calculs.remise(me["Prix"].value)')
    expect(r.notes).toEqual([])
    const u = conv([A('RunCode', { FunctionName: 'remise(1)' })])
    expect(u.source).toContain('    remise(1)')
    expect(u.notes[0]!.kind).toBe('approx')
  })

  it('OnError', () => {
    const next = src([A('OnError', { GoTo: 'next' }), A('Beep'), A('StopMacro'), A('OnError', { GoTo: 'fail' }), A('Beep')])
    expect(next).toContain('from contextlib import suppress')
    expect(next).toContain('    with suppress(Exception):\n        docmd.beep()\n    return\n    docmd.beep()')
    const named = src([A('OnError', { GoTo: 'macroName', MacroName: 'Err' }), A('Beep'), A('Beep'), { k: 'submacro', name: 'Err', items: [A('Beep')] }])
    expect(named).toContain('    try:\n        docmd.beep()\n        docmd.beep()\n    except Exception:\n        M_Err()\n        return\n')
    expect(conv([A('OnError', { GoTo: 'macroName', MacroName: 'Nope' })]).notes).toHaveLength(1)
  })

  it('unconvertible and approximate items are loud', () => {
    const r = conv([A('ImportXML')])
    expect(r.source).toContain('# TODO(convert): ImportXML cannot be converted\n    raise NotImplementedError("ImportXML cannot be converted")')
    expect(r.notes).toEqual([{ path: 'items[0]', action: 'ImportXML', kind: 'todo' }])
    const s = conv([A('StopAllMacros')])
    expect(s.source).toContain('return  # StopAllMacros')
    expect(s.notes).toEqual([{ path: 'items[0]', action: 'StopAllMacros', kind: 'approx' }])
  })

  it('guard: every catalogue action converts without a TODO', () => {
    for (const a of ACTIONS) {
      const args: Record<string, string> = {}
      for (const g of a.args) if (g.required) args[g.name] = g.type === 'expression' ? '1' : g.type === 'reference' ? '[C]' : g.type === 'functionCall' ? 'remise()' : 'x'
      if (a.name === 'RunMacro') args.RepeatCount = '2'
      const r = conv([A(a.name, args)], O, { moduleOf: () => ({ module: 'Calculs', fn: 'remise' }) })
      expect(r.notes.filter((n) => n.kind === 'todo'), a.name).toEqual([])
    }
  })

  it('indentation is always a multiple of 4', () => {
    const items: MacroItem[] = [A('OnError', { GoTo: 'next' }), { k: 'if', branches: [{ cond: '[TempVars]![n] > 1', items: [A('RunMacro', { MacroName: 'X', RepeatCount: '2' }), A('ImportXML')] }], else: [A('Beep')] },
      { k: 'submacro', name: 'E', items: [A('MessageBox', { Message: 'x' })] }]
    for (const l of src(items, { errorHandling: true, comments: true }).split('\n')) expect((l.length - l.trimStart().length) % 4, l).toBe(0)
  })

  // ---- fix round: the generated Python behaves like the macro engine ----
  it('C1: only literals and plain references are native; operators, calls, Not/And/Or go through the engine', () => {
    for (const e of ['[TempVars]![n] <> 0', '[TempVars]![n] < 3', '[TempVars]![n] + 1', '-[TempVars]![n]', 'Not ([TempVars]![n] = 5)', '[TempVars]![a] = 1 Or [TempVars]![b] = 2', '[Id] = "5"', 'Remise(2)', 'True And False']) {
      const s = src([A('SetTempVar', { Name: 'b', Expression: e })])
      expect(s, e).toMatch(/tempvars\["b"\] = eval_expr\("/)
    }
    expect(src([A('SetTempVar', { Name: 'b', Expression: 'True' })])).toContain('tempvars["b"] = True')
    expect(src([A('SetTempVar', { Name: 'b', Expression: 'Null' })])).toContain('tempvars["b"] = None')
  })

  it('C1: conditions use the engine truthiness (eval_cond), except a literal boolean', () => {
    const s = src([{ k: 'if', branches: [{ cond: '[TempVars]![x]', items: [A('Beep')] }, { cond: 'True', items: [] }], else: [] }])
    expect(s).toContain('if eval_cond("[TempVars]![x]"):')
    expect(s).toContain('elif True:')
    expect(src([A('RunMacro', { MacroName: 'X', RepeatExpression: '[TempVars]![n]' })])).toContain('while eval_cond("[TempVars]![n]"):')
  })

  it('I1: the exported spelling of a function is emitted', () => {
    const r = conv([A('RunCode', { FunctionName: 'REMISE(2)' })], O, { moduleOf: (f) => (f.toLowerCase() === 'remise' ? { module: 'Calculs', fn: 'remise' } : null) })
    expect(r.source).toContain('    Calculs.remise(2)')
    expect(r.source).not.toContain('REMISE')
  })

  it('I2: a where argument with LocalVars or MacroError is a TODO', () => {
    for (const w of ['[Id] = [LocalVars]![x]', '[Id] = [MacroError]![Number]', '[Id] = [LocalVars] ! [x]', '[Id] = [localvars]![x]']) {
      const r = conv([A('OpenForm', { FormName: 'F', WhereCondition: w })])
      expect(r.notes, w).toEqual([{ path: 'items[0]', action: 'OpenForm', kind: 'todo' }])
      expect(r.source).toContain('raise NotImplementedError')
    }
    expect(conv([A('OpenForm', { FormName: 'F', WhereCondition: '[Id] = [TempVars]![x]' })]).notes).toEqual([])
  })

  it('I3: local variables live in one dict per function; unset ones read Null', () => {
    const items: MacroItem[] = [{ k: 'if', branches: [{ cond: '[TempVars]![c]', items: [A('SetLocalVar', { Name: 'x', Expression: '1' })] }] }, A('SetTempVar', { Name: 'y', Expression: '[LocalVars]![x]' })]
    expect(src(items)).toContain('def M():\n    localvars = {}\n    if eval_cond("[TempVars]![c]"):\n        localvars["x"] = 1\n    tempvars["y"] = localvars.get("x")')
    expect(src(items, { errorHandling: true, comments: true })).toContain('def M():\n    localvars = {}\n    try:')
    expect(src([A('Beep')])).not.toContain('localvars')
    const two = conv([A('SetLocalVar', { Name: 'x', Expression: '1' }), { k: 'submacro', name: 'S', items: [A('Beep')] }]).source
    expect(two.match(/localvars = \{\}/g)).toHaveLength(1)
    // an expression (not a plain reference) over a local variable cannot reach the engine bridge
    expect(conv([A('SetLocalVar', { Name: 'x', Expression: '1' }), A('SetTempVar', { Name: 'y', Expression: '[LocalVars]![x] + 1' })]).notes).toEqual([{ path: 'items[1]', action: 'SetTempVar', kind: 'todo' }])
  })

  it('I4: = text arguments are converted by the engine (eval_text), literal text stays literal', () => {
    expect(src([A('MessageBox', { Message: '=[TempVars]![n]', Title: '="T"', Beep: 'no' })])).toContain('msgbox(eval_text("[TempVars]![n]"), title="T")')
    expect(src([A('MessageBox', { Message: '=3.5 & "x"', Beep: 'no' })])).toContain('msgbox(eval_text(')
    expect(src([A('RemoveTempVar', { Name: '=[TempVars]![k]' })])).toContain('del tempvars[eval_text("[TempVars]![k]")]')
  })

  it('number arguments stay text: a leading zero or trailing zero is never a bare Python number', () => {
    expect(src([A('RunMacro', { MacroName: 'M2', RepeatCount: '07' })])).toContain('for _ in range(int("07")):')
  })

  it('I5: no free text can start a Python line', () => {
    for (const br of ['\n', '\r', '\r\n', '\u2028', '\u2029', '\v', '\f', '\u0085']) {
      const bad = 'x' + br + 'import os'
      const r = convertMacro(bad, def(
        { k: 'comment', text: bad }, { k: 'group', name: bad, items: [A('Beep')] },
        A('MessageBox', { Message: bad }), A('SetTempVar', { Name: bad, Expression: '"' + bad + '"' }),
        { k: 'submacro', name: bad, items: [A('ImportXML')] }), O, none)
      for (const l of r.source.split(/\r\n|[\r\n\u2028\u2029\v\f\u0085]/)) expect(l, JSON.stringify(br)).not.toMatch(/^\s*import os/)
      // the generator's own \n are the only line breaks left: strings are escaped, comments are one line
      expect(r.source.replace(/\n/g, '')).not.toMatch(/[\r\u2028\u2029\v\f\u0085]/)
    }
  })

  it('M1/M2: identifiers follow Python (no superscripts), module names are cut by code point', () => {
    expect(pyName('Tarif²')).toBe('Tarif_')
    const m = convertedModuleName('a'.repeat(40) + '\u{1D4D0}'.repeat(30), [])
    expect(m).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    expect([...m].length).toBeLessThanOrEqual(56)
  })
})
