import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadPyodide, type PyodideInterface } from 'pyodide'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { installBasecraftLib } from '../renderer/python/install-lib'

const dir = join(__dirname, 'basecraft')
const files = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith('.py'))
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')])
)

let py: PyodideInterface
let calls: Array<[string, unknown[]]>
let handler: (method: string, args: unknown[]) => unknown
const mods: Record<string, string> = {}

const run = (code: string) => py.runPython(code)
const imm = (line: string) => py.runPython(`import basecraft.immediate as i\ni.run(${JSON.stringify(line)})`)

beforeAll(async () => {
  py = await loadPyodide()
  py.registerJsModule('_bc_bridge', {
    call: (method: string, args: unknown[]) => {
      calls.push([method, args])
      return handler(method, args)
    }
  })
  installBasecraftLib(py, files)
}, 60_000)

beforeEach(() => {
  calls = []
  handler = (m, a) => (m === 'modules.source' ? (mods[a[0] as string] ?? null) : null)
})

describe('basecraft', () => {
  it('immediate', () => {
    expect(imm('?2+2')).toBe('4')
    expect(imm('x = 3')).toBe('')
    expect(imm('?x*2')).toBe('6')
    expect(imm('?"é😀"')).toBe('é😀')
  })

  it('print goes to log.write', () => {
    imm('print("hello")')
    expect(calls).toContainEqual(['log.write', ['hello\n']])
  })

  it('msgbox / inputbox', () => {
    handler = () => 'yes'
    expect(run("msgbox('Hi', 'yes_no')")).toBe('yes')
    expect(calls[0]).toEqual(['ui.msgbox', ['Hi', 'yes_no', 'BaseCraft', null]])
    run('msgbox(object())')
    expect((calls[1][1][0] as string).startsWith('<object object')).toBe(true)
    // sys.stderr is the host log, so PythonError.message is empty: check .type
    let type: string | undefined
    try {
      run("msgbox('a', 'nope')")
    } catch (e) {
      type = (e as { type?: string }).type
    }
    expect(type).toBe('ValueError')
    expect(calls.filter(([m]) => m === 'ui.msgbox')).toHaveLength(2)
    handler = () => null
    expect(run("inputbox('p') is None")).toBe(true)
  })

  it('eval_expr asks the host to evaluate an expression', () => {
    handler = () => 5
    expect(run("eval_expr('[a] + 1')")).toBe(5)
    expect(calls[0]).toEqual(['expr.eval', ['[a] + 1']])
  })

  it('eval_cond and eval_text ask the host for the engine boolean and text', () => {
    handler = () => true
    expect(run("eval_cond('[a] > 1')")).toBe(true)
    expect(calls[calls.length - 1]).toEqual(['expr.eval', ['[a] > 1', 'bool']])
    handler = () => ''
    expect(run("eval_text('[a]')")).toBe('')
    expect(calls[calls.length - 1]).toEqual(['expr.eval', ['[a]', 'text']])
  })

  it('modules, nested import and reset', () => {
    mods.A = 'import B\ndef f():\n    return B.g() + 1'
    mods.B = 'def g():\n    return 41'
    const call = "import basecraft.modules as m\nm.call('A','f',[])"
    expect(run(call)).toBe(42)
    mods.B = 'def g():\n    return 1'
    run('import basecraft.modules as m\nm.reset()')
    expect(run(call)).toBe(2)
  })

  it('errors.describe', () => {
    mods.X = 'def f():\n    a = 1\n    return a / 0'
    const d = JSON.parse(
      run(`import json, basecraft.modules as m, basecraft.errors as e
try:
    m.call('X','f',[])
except Exception as ex:
    r = json.dumps(e.describe(ex))
r`)
    )
    expect(d).toMatchObject({ type: 'ZeroDivisionError', module: 'X', line: 3 })
  })

  it('exports.of', () => {
    const r = (src: string) => JSON.parse(run(`import json, basecraft.exports as x\njson.dumps(x.of(${JSON.stringify(src)}))`))
    expect(r('def a(x, y=1): pass\ndef _p(): pass\nclass C: pass\nb = lambda: 0').exports).toEqual([{ name: 'a', params: ['x', 'y'] }])
    const bad = r('def f(:\n')
    expect(bad.exports).toEqual([])
    expect(bad.error.line).toBe(1)
  })

  it('flush sends a trailing partial line', () => {
    run("import basecraft\nprint('a', end='')")
    expect(calls.filter(([m]) => m === 'log.write')).toHaveLength(0)
    run('basecraft.flush()')
    expect(calls.filter(([m]) => m === 'log.write')).toEqual([['log.write', ['a']]])
  })

  it('log writer looks like a text stream', () => {
    expect(run('import sys\n[sys.stdout.isatty(), sys.stdout.encoding, sys.stdout.errors, sys.stdout.writable()]').toJs()).toEqual([false, 'utf-8', 'strict', true])
  })

  it('bridge sanitizes nan/inf and non-str keys', () => {
    run("from basecraft._bridge import call\ncall('t', [{'a': float('nan'), 'b': float('inf'), (1, 2): object()}])")
    const d = calls[0][1][0] as Record<string, string>
    expect(d.a).toBe('nan')
    expect(d.b).toBe('inf')
    expect(d['(1, 2)'].startsWith('<object')).toBe(true)
  })

  it('bridge refuses dict keys that collide after conversion', () => {
    let type: string | undefined
    try { run("from basecraft._bridge import call\ncall('t', [{1: 'a', '1': 'b'}])") } catch (e) { type = (e as { type?: string }).type }
    expect(type).toBe('TypeError')
  })

  it('modules.call only reaches public functions of BaseCraft modules', () => {
    mods.Pub = 'import json\nfrom os import getcwd\ndef ok():\n    return 7\ndef _hid():\n    return 1'
    const err = (m: string, f: string) => {
      try { run(`import basecraft.modules as m\nm.call(${JSON.stringify(m)}, ${JSON.stringify(f)}, [])`); return undefined } catch (e) { return (e as { type?: string }).type }
    }
    expect(run("import basecraft.modules as m\nm.call('Pub','ok',[])")).toBe(7)
    expect(err('Pub', '_hid')).toBe('LookupError')
    expect(err('Pub', 'getcwd')).toBe('LookupError')
    expect(err('Pub', 'json')).toBe('LookupError')
    expect(err('json', 'dumps')).toBe('LookupError')
    expect(err('js', 'eval')).toBe('LookupError')
  })

  it('modules.deps collects the imports of user modules, transitively', () => {
    mods.Da = 'import Db, pandas\nfrom numpy import array'
    mods.Db = 'import Da, scipy.stats\nimport json'
    const d = (code: string | null, module: string | null) =>
      run(`import json, basecraft.modules as m\njson.dumps(sorted(m.deps(${code === null ? 'None' : JSON.stringify(code)}, ${module === null ? 'None' : JSON.stringify(module)})))`)
    run('import basecraft.modules as m\nm.reset()')
    expect(JSON.parse(d('import Da', null))).toEqual(expect.arrayContaining(['Da', 'Db', 'pandas', 'numpy', 'scipy']))
    expect(JSON.parse(d('?1+1', 'Db'))).toEqual(expect.arrayContaining(['Da', 'pandas', 'numpy', 'scipy']))
    expect(JSON.parse(d('def (', null))).toEqual([])
  })

  it('traceback shows user module source lines', () => {
    mods.TB = 'def f():\n    return 1 / 0  # boom'
    const d = JSON.parse(
      run(`import json, basecraft.modules as m, basecraft.errors as e
try:
    m.call('TB','f',[])
except Exception as ex:
    r = json.dumps(e.describe(ex))
r`)
    )
    expect(d.traceback).toContain('return 1 / 0')
  })

  it('circular imports work', () => {
    mods.CA = 'import CB\ndef f():\n    return CB.g()\ndef h():\n    return 1'
    mods.CB = 'import CA\ndef g():\n    return CA.h() + 1'
    run('import basecraft.modules as m\nm.reset()')
    expect(run("import basecraft.modules as m\nm.call('CA','f',[])")).toBe(2)
  })

  it('syntax error in ?x = 1 has no module', () => {
    const d = JSON.parse(
      run(`import json, basecraft.immediate as i, basecraft.errors as e
try:
    i.run('?x = 1')
except Exception as ex:
    r = json.dumps(e.describe(ex))
r`)
    )
    expect(d.type).toBe('SyntaxError')
    expect(d.module).toBeNull()
  })
})

describe('bridge values and errors', () => {
  it('encodes and decodes dates, numpy scalars', () => {
    handler = (_m, a) => a[0]
    const r = run(`import datetime, json
from basecraft._bridge import call
r = call('echo', [datetime.datetime(2026,1,31,14,5)])
d = call('echo', [datetime.date(2026,1,31)])
json.dumps([repr(r), repr(d)])`)
    expect(JSON.parse(r)).toEqual(['datetime.datetime(2026, 1, 31, 14, 5)', 'datetime.datetime(2026, 1, 31, 0, 0)'])
    expect(calls[0][1]).toEqual([{ $date: '2026-01-31 14:05:00' }])
    expect(calls[1][1]).toEqual([{ $date: '2026-01-31 00:00:00' }])
  })

  it('numpy scalar is sent as its item()', () => {
    run(`class N:
    __module__ = 'numpy'
    def item(self): return 3
from basecraft._bridge import call
call('t', [N()])`)
    expect(calls[0][1]).toEqual([3])
  })

  it('BridgeCallError becomes BaseCraftError with its code', () => {
    handler = () => { throw Object.assign(new Error('Le formulaire X'), { name: 'BridgeCallError', code: 'notOpen' }) }
    const r = run(`import basecraft
from basecraft._bridge import call
try:
    call('t', [])
except basecraft.BaseCraftError as e:
    r = [e.code, str(e)]
r`).toJs()
    expect(r).toEqual(['notOpen', 'Le formulaire X'])
  })
})

describe('object library', () => {
  const sent = (m: string) => calls.filter(([x]) => x === m).map(([, a]) => a)
  const table = (t: Record<string, unknown>) => {
    handler = (m, a) => {
      const v = t[m]
      return typeof v === 'function' ? (v as (a: unknown[]) => unknown)(a) : (v ?? null)
    }
  }
  const imp = `from basecraft.objects import forms, reports, me, screen, docmd, tempvars, app
from basecraft.data import db
def err(exc, f):
    try:
        f()
    except exc as e:
        return str(e)
`

  it('forms and controls', () => {
    table({ 'form.get': 'v', 'forms.name': (a: unknown[]) => (a[0] === 'Absent' ? null : a[0]), 'forms.list': ['A', 'B'] })
    run(imp + 'forms["Clients"].nom.value; forms.Clients["Nom client"].value = 3; forms.F.Total.fore_color = "#ff0000"; forms.F.Total.visible')
    expect(calls.filter(([m]) => m !== 'forms.name')).toEqual([
      ['form.get', ['Clients', 'nom', 'value']],
      ['form.set', ['Clients', 'Nom client', 'value', 3]],
      ['form.set', ['F', 'Total', 'foreColor', '#ff0000']],
      ['form.get', ['F', 'Total', 'visible']]
    ])
    expect(run(imp + 'err(KeyError, lambda: forms["Absent"]) is not None')).toBe(true)
    expect(run(imp + '("Clients" in forms, "Absent" in forms, len(forms), [f.name for f in forms])').toJs()).toEqual([true, false, 2, ['A', 'B']])
  })

  it('form methods and member-named controls', () => {
    table({ 'forms.name': 'F' })
    run(imp + 'forms.F["requery"].value; forms.F.requery(); forms.F.go_to_record("last"); forms.F.apply_filter("a=1")')
    expect(sent('form.get')).toEqual([['F', 'requery', 'value']])
    expect(sent('form.do')).toEqual([['F', 'requery', []], ['F', 'goToRecord', ['last', 1]], ['F', 'applyFilter', ['a=1']]])
  })

  it('me, reports, screen', () => {
    table({ 'event.current': { kind: 'form', name: 'F', control: 'Btn', event: 'OnClick' } })
    run(imp + 'me.Total.value = 5')
    expect(sent('form.set')).toEqual([['F', 'Total', 'value', 5]])
    expect(run(imp + 'err(AttributeError, lambda: setattr(me, "Total", 5))')).toContain('me.<Control>.value')
    table({ 'event.current': { kind: 'report', name: 'R', control: null, event: 'OnFormat' } })
    run(imp + 'me.section.height = 2')
    expect(sent('report.set')).toEqual([['R', '', 'height', 2]])
    table({})
    expect(run(imp + 'err(RuntimeError, lambda: me.X)')).toContain('event')
    table({ 'screen.active': { form: null, control: null } })
    expect(run(imp + 'screen.active_control is None and screen.active_form is None')).toBe(true)
    table({ 'screen.active': { form: 'F', control: 'C' } })
    expect(run(imp + '(screen.active_form.name, screen.active_control.name)').toJs()).toEqual(['F', 'C'])
  })

  it('docmd', () => {
    table({})
    run(imp + 'docmd.open_form("DChoix", window_mode="dialog"); docmd.cancel_event(); docmd.run_macro("M"); app.quit(); docmd.close()')
    expect(sent('docmd.run')).toEqual([['open_form', ['DChoix'], { window_mode: 'dialog' }], ['quit', [], {}], ['close', [], {}]])
    expect(sent('event.cancel')).toEqual([[]])
    expect(sent('docmd.runMacro')).toEqual([['M']])
    expect(run(imp + 'err(AttributeError, lambda: docmd.set_temp_var("a", 1))')).toContain('tempvars')
    expect(run(imp + 'err(AttributeError, lambda: docmd.message_box("a"))')).toContain('msgbox')
    expect(sent('docmd.run')).toHaveLength(3)
  })

  it('tempvars and app', () => {
    table({ 'tempvars.get': 4, 'tempvars.names': ['x', 'y'], 'app.project': { name: 'Base' } })
    run(imp + 'tempvars["x"] = 1; tempvars["x"]; del tempvars["x"]; tempvars.clear()')
    expect(calls.map(([m]) => m)).toEqual(['tempvars.set', 'tempvars.get', 'tempvars.delete', 'tempvars.clear'])
    expect(run(imp + '("x" in tempvars, len(tempvars), app.current_project.name)').toJs()).toEqual([true, 2, 'Base'])
  })

  it('recordset', () => {
    table({
      'db.open': { handle: 1, fields: [{ name: 'Montant', type: 'currency' }], updatable: true, total: 2500 },
      'db.page': (a: unknown[]) => {
        const [, off, lim] = a as number[]
        const n = Math.max(0, Math.min(lim, 2500 - off))
        return { rows: Array.from({ length: n }, () => [1]), rowids: Array.from({ length: n }, (_, i) => off + i), total: 2500 }
      },
      'db.execute': 7,
      'db.save': { rowid: 9 }
    })
    expect(run(imp + 'rs = db.open_recordset("Commandes"); sum(r["Montant"] for r in rs)')).toBe(2500)
    expect(sent('db.page')).toEqual([[1, 0, 1000], [1, 1000, 1000], [1, 2000, 1000]])
    expect(run(imp + '(len(rs), rs.fields)').toJs()).toEqual([2500, ['Montant']])
    run(imp + 'rs.add({"Montant": 5}); row = next(iter(rs)); row.update({"Montant": 2}); row.delete()')
    expect(sent('db.save')).toEqual([[1, null, { Montant: 5 }], [1, 0, { Montant: 2 }]])
    expect(sent('db.delete')).toEqual([[1, 0]])
    expect(run(imp + 'err(KeyError, lambda: row["Absent"]) is not None')).toBe(true)
    calls.length = 0
    run(imp + 'row.update({"montant": 3})')
    expect(sent('db.save')).toEqual([[1, 0, { Montant: 3 }]])
    expect(run(imp + 'row["Montant"]')).toBe(3)
    expect(run(imp + 'err(KeyError, lambda: row.update({"Absent": 1})) is not None')).toBe(true)
    expect(sent('db.save')).toHaveLength(1)
    expect(run(imp + 'db.execute("DELETE FROM T", {"p": 1})')).toBe(7)
    expect(sent('db.execute')).toEqual([['DELETE FROM T', { p: 1 }]])
    expect(run("import basecraft.modules as m\n'pandas' in m.deps(code='x = rs.to_pandas()')")).toBe(true)
  })

  describe('recordset iteration with changes', () => {
    // host stub: db.page serves from a list, db.delete removes from it, db.save without rowid appends
    const host = (n: number) => {
      const data = Array.from({ length: n }, (_, i) => ({ id: i }))
      table({
        'db.open': () => ({ handle: 1, fields: [{ name: 'id', type: 'number' }], updatable: true, total: data.length }),
        'db.page': (a: unknown[]) => {
          const [, off, lim] = a as number[]
          const rows = data.slice(off, off + lim)
          return { rows: rows.map((r) => [r.id]), rowids: rows.map((r) => r.id), total: data.length }
        },
        'db.delete': (a: unknown[]) => {
          data.splice(data.findIndex((r) => r.id === (a as number[])[1]), 1)
          return null
        },
        'db.save': (a: unknown[]) => {
          data.push({ id: 100000 + data.length })
          return a && null
        }
      })
      return data
    }

    it('deleting every row while iterating deletes all of them', () => {
      const data = host(2500)
      run(imp + `rs = db.open_recordset("T")
for r in rs:
    r.delete()`)
      expect(data.length).toBe(0)
    })

    it('deleting every other row deletes exactly half', () => {
      const data = host(2500)
      run(imp + `rs = db.open_recordset("T")
for r in rs:
    if r["id"] % 2 == 0:
        r.delete()`)
      expect(data.map((r) => r.id)).toEqual(Array.from({ length: 1250 }, (_, i) => 2 * i + 1))
    })

    it('a table that grows through rs.add during the loop terminates', () => {
      const data = host(1500)
      expect(run(imp + `rs = db.open_recordset("T")
n = 0
for r in rs:
    n += 1
    if n == 1:
        rs.add({})
n`)).toBe(1501)
      expect(data.length).toBe(1501)
    })
  })
})
