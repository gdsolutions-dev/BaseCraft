import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CANON } from '../shared/coerce';
import { getObject } from '../main/db/objects';
import { registerFunctions } from '../main/db/file-format';
import { newBase } from './new-base';
import { applyScript } from './script';
import { run as cli } from './main';
import { scanExports } from './ops-module';
import { tmp } from './test-tmp';

const run = async (ops: unknown[]) => { const p = tmp(); newBase(p, '0.3.1'); return { p, r: await applyScript(p, ops as never, CANON) }; };
const message = (r: { ok: boolean }): string => ('message' in r ? String(r.message) : '');
const read = (p: string, name: string) => { const db = new DatabaseSync(p); registerFunctions(db); try { return getObject(db, 'module', name); } finally { db.close(); } };
const hash = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const mod = (name: string, code: string) => ({ op: 'module.create', name, code });

describe('scanExports', () => {
  it('lists public top-level defs with their parameter names, like basecraft.exports.of', () => {
    const src = [
      'import os',
      'def hello(name, greeting="hi", *args, flag=False, **kw):',
      '    def inner(x): pass',
      '    return 1',
      'async def later(a, /, b, *, c): pass',
      'def _private(x): pass',
      'def multi(a,',
      '          b=(1, 2),',
      '          c: int = 3): pass',
      'class K:',
      '    def method(self): pass',
      "doc = '''",
      'def in_string(x): pass',
      "'''",
    ].join('\n');
    expect(scanExports(src)).toEqual([
      { name: 'hello', params: ['name', 'greeting', 'flag'] },
      { name: 'later', params: ['a', 'b', 'c'] },
      { name: 'multi', params: ['a', 'b', 'c'] },
    ]);
  });
  it('returns [] for an empty source and does not throw on broken code', () => {
    expect(scanExports('')).toEqual([]);
    expect(() => scanExports('def (:\n  def f(\n')).not.toThrow();
  });
});

describe('module.create', () => {
  it('stores the source and its exports, with the description', async () => {
    const { p, r } = await run([{ ...mod('Outils', 'def bonjour(nom):\n    return nom\n'), description: 'd' }]);
    expect(r).toMatchObject({ ok: true, applied: 1 });
    expect(read(p, 'Outils')?.definition).toEqual({ formatVersion: '1.0', source: 'def bonjour(nom):\n    return nom\n', exports: [{ name: 'bonjour', params: ['nom'] }] });
  });
  it('stores a module with a syntax error as written (no engine to check it)', async () => {
    const { p, r } = await run([mod('Casse', 'def f(:\n')]);
    expect(r.ok).toBe(true);
    expect((read(p, 'Casse')!.definition as { source: string }).source).toBe('def f(:\n');
  });
  it('accepts an empty source and an accented name', async () => {
    const { p, r } = await run([mod('Éléments', '')]);
    expect(r.ok).toBe(true);
    expect(read(p, 'Éléments')?.definition).toMatchObject({ source: '', exports: [] });
  });
  it('refuses an invalid name, a Python keyword, a duplicate (case-insensitive) and wrong types, file unchanged', async () => {
    for (const bad of ['a.b', '1x', 'class', '', 'a b']) {
      const { p, r } = await run([mod(bad, 'x = 1')]);
      expect(r).toMatchObject({ ok: false, index: 0 });
      expect(message(r)).toBe(`invalid module name: ${bad}`);
      expect(read(p, bad)).toBeNull();
    }
    expect(message((await run([mod('M', ''), mod('m', '')])).r)).toBe('module name already used: m');
    expect(message((await run([{ op: 'module.create', name: 'M', code: 3 }])).r)).toBe('"code" must be a string');
    expect(message((await run([{ op: 'module.create', name: 3, code: '' }])).r)).toBe('"name" must be a string');
    expect(message((await run([{ ...mod('M', ''), description: 1 }])).r)).toBe('"description" must be a string');
  });
  it('leaves the file byte-identical when a later op fails', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = hash(p);
    const r = await applyScript(p, [mod('M', 'def f(): pass'), { op: 'nope' }] as never, CANON);
    expect(r).toMatchObject({ ok: false, index: 1 });
    expect(hash(p)).toBe(before);
  });
});

const eventDoc = (props: Record<string, unknown>, controlProps: Record<string, unknown> = {}) => ({
  formatVersion: '1.0', recordSource: null, props,
  sections: [{ kind: 'detail', height: 1000, props: {}, controls: [{ kind: 'commandButton', name: 'Cmd', left: 0, top: 0, width: 1000, height: 300, props: controlProps }] }],
});
const form = (props: Record<string, unknown>, controlProps: Record<string, unknown> = {}) => ({ op: 'form.create', name: 'F', layout: 'doc', doc: eventDoc(props, controlProps) });
const SRC = 'def Foo(x):\n    pass\n\ndef _hidden():\n    pass\n\nclass K:\n    def method(self):\n        pass\n';
const getForm = (p: string) => { const db = new DatabaseSync(p); registerFunctions(db); try { return getObject(db, 'form', 'F')!.definition as { props: Record<string, unknown> }; } finally { db.close(); } };

describe('Python event handlers', () => {
  it('accepts =Foo() and =foo(1, 2) on a form and a control when a module created earlier defines Foo', async () => {
    const { p, r } = await run([mod('Outils', SRC), form({ OnOpen: '=Foo()' }, { OnClick: '=foo(1, 2)' })]);
    expect(r).toMatchObject({ ok: true, applied: 2, activeContent: true });
    expect((getForm(p).props)).toEqual({ OnOpen: '=Foo()' });
  });
  it('accepts a function of a module already in the base (a second script)', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    expect((await applyScript(p, [mod('Outils', SRC)] as never, CANON)).ok).toBe(true);
    expect((await applyScript(p, [form({ OnOpen: '=Foo()' })] as never, CANON)).ok).toBe(true);
  });
  it('accepts a report event', async () => {
    const rep = { op: 'report.create', name: 'R', layout: 'doc', doc: eventDoc({ OnOpen: '=Foo()' }) };
    expect((await run([mod('Outils', SRC), rep])).r.ok).toBe(true);
  });
  it('refuses a function no module defines, naming the property path, file unchanged', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const before = hash(p);
    const r = await applyScript(p, [mod('Outils', SRC), form({ OnOpen: '=Absent()' })] as never, CANON);
    expect(r).toMatchObject({ ok: false, index: 1 });
    expect(message(r)).toBe('design.props.OnOpen: python function not found: Absent');
    expect(hash(p)).toBe(before);
  });
  it('refuses a private function, a nested function, a method, and a module created later', async () => {
    for (const fn of ['_hidden', 'method']) expect(message((await run([mod('Outils', SRC), form({ OnOpen: `=${fn}()` })])).r)).toMatch(/python function not found/);
    expect((await run([form({ OnOpen: '=Foo()' }), mod('Outils', SRC)])).r.ok).toBe(false);
  });
  it('refuses a function exported by two modules, naming both', async () => {
    const m = message((await run([mod('A', SRC), mod('B', 'def foo(): pass'), form({ OnOpen: '=Foo()' })])).r);
    expect(m).toBe('design.props.OnOpen: python function is ambiguous: Foo (A, B)');
  });
  it('refuses a function one module exports twice (f and F), as the app counts each export', async () => {
    const m = message((await run([mod('A', 'def f(): pass\ndef F(): pass'), form({ OnOpen: '=f()' })])).r);
    expect(m).toBe('design.props.OnOpen: python function is ambiguous: f (A, A)');
  });
  it('keeps refusing a built-in function name and a malformed call', async () => {
    expect(message((await run([mod('M', 'def Len(x): pass'), form({ OnOpen: '=Len("a")' })])).r)).toMatch(/OnOpen: badFunctionCall/);
    expect(message((await run([form({ OnOpen: '=Foo(' })])).r)).toMatch(/OnOpen: badFunctionCall/);
  });
});

describe('active content', () => {
  it('a module alone makes the script report activeContent: true', async () => {
    expect((await run([mod('Outils', 'x = 1')])).r).toEqual({ ok: true, applied: 1, activeContent: true });
  });
  it('an empty script on a base holding a module reports it too', async () => {
    const { p } = await run([mod('Outils', '')]);
    expect(await applyScript(p, [], CANON)).toEqual({ ok: true, applied: 0, activeContent: true });
  });
  it('the CLI output carries the notice', async () => {
    const p = tmp(); newBase(p, '0.3.1');
    const spec = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bccli-')), 's.json');
    fs.writeFileSync(spec, JSON.stringify([mod('Outils', 'x = 1')]));
    const out: string[] = [], err: string[] = [];
    const code = await cli(['script', spec, p], { out: (s) => out.push(s), err: (s) => err.push(s) });
    expect({ code, out: out.join(''), err: err.join('') }).toEqual({ code: 0, out: 'This file contains active content; BaseCraft will ask to enable it when opened.\n', err: '' });
  });
});
