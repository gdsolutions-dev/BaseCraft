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
