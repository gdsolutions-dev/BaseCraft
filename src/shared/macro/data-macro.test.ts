import { describe, expect, it } from 'vitest';
import type { Value } from '../expr/ast';
import { fail, num, str } from '../expr/library';
import { dataMacroIssue, dataMacrosIssue, MAX_DATA_MACRO_DEPTH, parseDataMacros, parseValues, runDataMacro, type DataMacroHost } from './data-macro';
import type { MacroDef, MacroItem } from './model';

const def = (...items: MacroItem[]): MacroDef => ({ formatVersion: '1.0', items });
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const when = (cond: string, ...items: MacroItem[]): MacroItem => ({ k: 'if', branches: [{ cond, items }] });

function host(row: Record<string, Value>, old: Record<string, Value> = {}, named: Record<string, MacroDef> = {}) {
  const sets: Record<string, Value> = {}, created: [string, Record<string, Value>][] = [];
  const h: DataMacroHost = {
    field: (n, o) => { const r = o ? old : { ...row, ...sets }; return n in r ? r[n]! : fail('unknownField'); },
    setField: (n, v) => { if (!(n in row)) fail('unknownField'); sets[n] = v; },
    createRecord: async (t, v) => { created.push([t, v]); },
    named: (n) => named[n], now: () => new Date(0), locale: 'en-US',
  };
  return { h, sets, created };
}

describe('runDataMacro', () => {
  it('SetField changes the row being written, [Old] is readable', async () => {
    const { h, sets } = host({ Nom: str('ab'), Solde: num(5) }, { Solde: num(9) });
    const r = await runDataMacro(def(act('SetField', { Name: 'Nom', Value: 'UCase([Nom])' }), when('[Solde] < [Old].[Solde]', act('SetField', { Name: 'Solde', Value: '[Old].[Solde]' }))), 'T', h, { event: 'beforeChange' });
    expect(r).toEqual({ ok: true });
    expect(sets).toEqual({ Nom: str('AB'), Solde: num(9) });
  });
  it('RaiseError stops with its message; the actions after it do not run', async () => {
    const { h, sets } = host({ Nom: null });
    const r = await runDataMacro(def(when('IsNull([Nom])', act('RaiseError', { ErrorDescription: 'Nom is required' })), act('SetField', { Name: 'Nom', Value: '"x"' })), 'T', h, { event: 'beforeChange' });
    expect(r).toEqual({ ok: false, message: 'Nom is required', raised: true });
    expect(sets).toEqual({});
  });
  it('SetLocalVar, StopMacro, RaiseError with an expression description', async () => {
    const { h } = host({ Nom: str('z') });
    const r = await runDataMacro(def(act('SetLocalVar', { Name: 'v', Expression: '[Nom] & "!"' }), act('RaiseError', { ErrorDescription: '=[LocalVars]![v]' })), 'T', h, { event: 'beforeDelete' });
    expect(r).toMatchObject({ ok: false, message: 'z!' });
    expect(await runDataMacro(def(act('StopMacro'), act('RaiseError')), 'T', h, { event: 'beforeDelete' })).toEqual({ ok: true });
  });
  it('refuses what the event does not allow, unknown actions and Python calls', async () => {
    const { h } = host({ Nom: str('z') });
    expect(await runDataMacro(def(act('SetField', { Name: 'Nom', Value: '"a"' })), 'T', h, { event: 'beforeDelete' })).toMatchObject({ ok: false, raised: false });
    expect(await runDataMacro(def(act('OpenForm', { FormName: 'F' })), 'T', h, { event: 'beforeChange' })).toMatchObject({ ok: false, raised: false });
    expect(await runDataMacro(def(act('RunSQL', { SQLStatement: 'DELETE FROM X' })), 'T', h, { event: 'afterInsert' })).toMatchObject({ ok: false });
    expect(await runDataMacro(def(act('SetLocalVar', { Name: 'a', Expression: 'MyPythonFn(1)' })), 'T', h, { event: 'beforeChange' })).toMatchObject({ ok: false });
  });
  it('an unknown field or a bad expression fails the run, never throws', async () => {
    const { h } = host({ Nom: str('z') });
    expect(await runDataMacro(def(act('SetField', { Name: 'Nope', Value: '1' })), 'T', h, { event: 'beforeChange' })).toMatchObject({ ok: false });
    expect(await runDataMacro(def(when('[Nope] = 1', act('StopMacro'))), 'T', h, { event: 'beforeChange' })).toMatchObject({ ok: false });
  });
  it('CreateRecord (After events only) evaluates its values', async () => {
    const { h, created } = host({ Nom: str('z') });
    const m = def(act('CreateRecord', { TableName: 'Journal', Values: 'Texte = "new " & [Nom]\nN = 2' }));
    expect(await runDataMacro(m, 'T', h, { event: 'afterInsert' })).toEqual({ ok: true });
    expect(created).toEqual([['Journal', { Texte: str('new z'), N: num(2) }]]);
    expect(await runDataMacro(m, 'T', h, { event: 'beforeChange' })).toMatchObject({ ok: false });
  });
  it('RunDataMacro runs a named macro, a recursion stops at the depth limit', async () => {
    const named = { Loop: def(act('RunDataMacro', { MacroName: 'Loop' })), Say: def(act('RaiseError', { ErrorDescription: 'named' })) };
    const { h } = host({ Nom: str('z') }, {}, named);
    expect(await runDataMacro(def(act('RunDataMacro', { MacroName: 'Say' })), 'T', h, { event: 'afterInsert' })).toMatchObject({ ok: false, message: 'named' });
    expect(await runDataMacro(def(act('RunDataMacro', { MacroName: 'Loop' })), 'T', h, { event: 'afterInsert' })).toMatchObject({ ok: false, raised: false });
    expect(MAX_DATA_MACRO_DEPTH).toBe(10);
    expect(await runDataMacro(def(act('RunDataMacro', { MacroName: 'Nope' })), 'T', h, { event: 'afterInsert' })).toMatchObject({ ok: false });
  });
  it('stops a runaway body at the step limit', async () => {
    const { h } = host({});
    const many = def(...Array.from({ length: 10_001 }, () => act('SetLocalVar', { Name: 'a', Expression: '1' })));
    expect(await runDataMacro(many, 'T', h, { event: 'afterInsert' })).toMatchObject({ ok: false, raised: false });
  });
});

describe('storage', () => {
  it('parseDataMacros keeps readable macros only', () => {
    expect(parseDataMacros(null)).toEqual({});
    const ok = def(act('StopMacro'));
    expect(parseDataMacros({ events: { beforeChange: ok, afterInsert: 'x', bogus: ok }, named: { Good: ok, '': ok, Worse: 3 } }))
      .toEqual({ events: { beforeChange: ok }, named: { Good: ok } });
  });
  it('dataMacrosIssue reports the first problem', () => {
    expect(dataMacrosIssue({ events: { beforeChange: def(act('SetField', { Name: 'a', Value: '1' })) } })).toBeNull();
    expect(dataMacrosIssue({ events: { afterInsert: def(act('SetField', { Name: 'a', Value: '1' })) } })).toMatch(/afterInsert.*SetField/);
    expect(dataMacrosIssue({ named: { N: def(act('Quit')) } })).toMatch(/N: unknownAction: Quit/);
    expect(dataMacroIssue(def(when('1 +', act('StopMacro'))))).not.toBeNull();
    expect(dataMacroIssue(def(act('CreateRecord', { TableName: 'J', Values: 'noequals' })), 'afterInsert')).toMatch(/Values/);
    expect(parseValues('A = 1\n\n[B]=2')).toEqual([{ field: 'A', expr: ' 1' }, { field: 'B', expr: '2' }]);
  });
});
