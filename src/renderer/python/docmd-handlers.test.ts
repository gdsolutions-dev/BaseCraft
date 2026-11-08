import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { num, str } from '../../shared/expr/library'
import { registerForm, type FormInstance } from '../form/form-instances'
import type { EventContext, MacroHost } from '../macro/engine'
import { tempVars } from '../macro/temp-vars'
import { pushEvent } from './event-stack'

vi.mock('../bridge', () => ({ api: {} }))
vi.mock('../i18n', () => ({ i18n: { t: (k: string) => k, exists: () => false } }))
const h0 = vi.hoisted(() => ({
  state: 'running', subs: new Set<() => void>(), macros: {} as Record<string, unknown>, shell: null as unknown,
  perform: undefined as unknown as ReturnType<typeof vi.fn>, shellHost: undefined as unknown as ReturnType<typeof vi.fn>,
}))
vi.mock('./python-host', () => ({
  PythonError: class extends Error {},
  pythonHost: () => ({ state: () => h0.state, subscribe: (f: () => void) => { h0.subs.add(f); return () => h0.subs.delete(f) } }),
}))
vi.mock('../macro/macro-shell', async () => {
  const { vi: v } = await import('vitest')
  h0.perform = v.fn(async () => {})
  h0.shellHost = v.fn((): MacroHost => ({
    load: async (n: string) => { if (!h0.macros[n]) throw new Error('bc:notFound'); return h0.macros[n] as never },
    contentEnabled: () => true, perform: h0.perform as never, tempVars, locale: 'fr-FR', lang: 'fr', now: () => new Date(),
  }))
  return { currentShell: () => h0.shell, shellHost: h0.shellHost }
})
const performSpy = { get mock() { return h0.perform.mock }, mockClear: () => h0.perform.mockClear(), mockRejectedValueOnce: (e: unknown) => h0.perform.mockRejectedValueOnce(e) }
const shellHost = { get mock() { return h0.shellHost.mock }, mockClear: () => h0.shellHost.mockClear() }
const subs = h0.subs
import { actionFor, argsFor, docmdHandlers } from './docmd-handlers'
import { actionDef } from '../../shared/macro/catalog'

const offs: (() => void)[] = []
beforeEach(() => { h0.state = 'running'; h0.shell = { contentEnabled: () => true }; h0.macros = {}; performSpy.mockClear(); shellHost.mockClear(); subs.forEach((f) => f()) })
afterEach(() => { offs.splice(0).forEach((f) => f()); tempVars.clear() })
const openForm = actionDef('OpenForm')!
const ctx = (): EventContext => ({ object: { kind: 'form', name: 'F' }, event: 'OnClick', field: () => null, cancellable: false, cancelled: false })

describe('actionFor', () => {
  it('matches without underscores, aliases close, refuses and rejects', () => {
    expect(actionFor('open_form').name).toBe('OpenForm')
    expect(actionFor('run_sql').name).toBe('RunSQL')
    expect(actionFor('close').name).toBe('CloseWindow')
    expect(actionFor('GoToRecord').name).toBe('GoToRecord')
    expect(() => actionFor('set_value')).toThrow(/\.value/)
    expect(() => actionFor('run_macro')).toThrow('bc:refusedDocmd|run_macro|docmd.run_macro(name)')
    expect(() => actionFor('nope')).toThrow('bc:noSuchDocmd|nope')
  })
})

describe('argsFor', () => {
  it('maps positional and keyword arguments, binds where members', async () => {
    const f = { name: 'G', tabId: 't', value: () => num(7) } as unknown as FormInstance
    offs.push(registerForm(f))
    const r = await argsFor(openForm, ['F'], { window_mode: 'dialog', where_condition: '[Id]=[Forms]![G]![Id]' })
    expect(r.args).toMatchObject({ FormName: 'F', WindowMode: 'dialog', View: 'form' })
    expect(String(r.args.WhereCondition)).toContain('7')
    expect(String(r.args.WhereCondition)).not.toContain('Forms')
    expect(r.raw.FormName).toBe('F')
  })
  it('bad enum, missing, yes/no booleans', async () => {
    await expect(argsFor(openForm, ['F'], { window_mode: 'popup' })).rejects.toThrow(/^bc:badArgument/)
    await expect(argsFor(openForm, [], {})).rejects.toThrow('bc:missingArgument|FormName')
    await expect(argsFor(openForm, ['F'], { nope: 1 })).rejects.toThrow(/^bc:badArgument/)
    expect((await argsFor(actionFor('set_warnings'), [false], {})).args).toEqual({ WarningsOn: 'no' })
  })
})

describe('docmd handlers', () => {
  it('run goes through perform with the top event; one host per outermost call', async () => {
    const h = docmdHandlers()
    const e = ctx()
    const pop = pushEvent(e)
    await h['docmd.run']!(['open_form', ['F'], {}])
    await h['docmd.run']!(['set_warnings', [false], {}])
    pop()
    expect(performSpy.mock.calls[0]![0]).toMatchObject({ macro: '(Python)', action: 'OpenForm', event: e })
    expect(shellHost.mock.calls).toHaveLength(1)
    h0.state = 'idle'; subs.forEach((f) => f())
    h0.state = 'running'
    await h['docmd.run']!(['beep', [], {}])
    expect(shellHost.mock.calls).toHaveLength(2)
  })
  it('refuses a refused name and no base', async () => {
    const h = docmdHandlers()
    await expect(h['docmd.run']!(['set_value', [], {}])).rejects.toMatchObject({ code: 'refusedDocmd' })
    h0.shell = null
    await expect(h['docmd.run']!(['beep', [], {}])).rejects.toMatchObject({ code: 'noBase' })
  })
  it('runMacro runs the macro; a failure rejects with its text', async () => {
    const h = docmdHandlers()
    h0.macros.M = { formatVersion: '1.0', items: [{ k: 'action', action: 'Beep', args: {} }] }
    await h['docmd.runMacro']!(['M'])
    expect(performSpy.mock.calls).toHaveLength(1)
    performSpy.mockRejectedValueOnce(new Error('boom'))
    await expect(h['docmd.runMacro']!(['M'])).rejects.toThrow(/actionFailed/)
    await expect(h['docmd.runMacro']!(['Absent'])).rejects.toThrow(/notFound/)
  })
  it('expr.eval evaluates a canonical expression like a macro', async () => {
    const h = docmdHandlers()
    tempVars.set('n', num(2))
    expect(await h['expr.eval']!(['[TempVars]![n] + 1'])).toBe(3)
    const pop = pushEvent({ ...ctx(), field: () => str('V') })
    expect(await h['expr.eval']!(['"a" & [x]'])).toBe('aV')
    pop()
    expect(await h['expr.eval']!(['Null'])).toBeNull()
    await expect(h['expr.eval']!(['[Nope]![x]'])).rejects.toThrow()
    await expect(h['expr.eval']!(['[x]'])).rejects.toThrow()
  })
  it('expr.eval modes: bool follows the engine truthiness, text its conversion of an argument', async () => {
    const h = docmdHandlers()
    expect(await h['expr.eval']!(['[TempVars]![absent] <> 0', 'bool'])).toBe(false)   // Null: the If is not taken
    expect(await h['expr.eval']!(['"False"', 'bool'])).toBe(false)
    expect(await h['expr.eval']!(['"True"', 'bool'])).toBe(true)
    expect(await h['expr.eval']!(['2', 'bool'])).toBe(true)
    await expect(h['expr.eval']!(['"abc"', 'bool'])).rejects.toThrow()
    expect(await h['expr.eval']!(['Null', 'text'])).toBe('')
    expect(await h['expr.eval']!(['True', 'text'])).toBe('True')
    expect(await h['expr.eval']!(['3', 'text'])).toBe('3')
  })
})
