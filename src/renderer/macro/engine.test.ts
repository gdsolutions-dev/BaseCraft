import { describe, expect, it, vi } from 'vitest';
import type { Value } from '../../shared/expr/ast';
import { fail, num, str } from '../../shared/expr/library';
import type { MacroDef, MacroItem } from '../../shared/macro/model';
import { FAILURE_NUMBERS, MAX_STEPS, MAX_TEMP_VARS, runMacro, runMacroDef, type ActionCall, type EventContext, type MacroHost, type StepInfo } from './engine';

const m = (items: MacroItem[]): MacroDef => ({ formatVersion: '1.0', items });
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });

type FakeHost = MacroHost & { calls: ActionCall[]; steps: StepInfo[] };
function host(macros: Record<string, MacroDef>, o: { enabled?: boolean; failOn?: string; step?: MacroHost['step'] } = {}): FakeHost {
  const calls: ActionCall[] = [], steps: StepInfo[] = [];
  return {
    calls, steps,
    load: async (name) => macros[name] ?? Promise.reject(new Error('bc:notFound')),
    contentEnabled: () => o.enabled ?? true,
    perform: async (call) => { if (call.action === o.failOn) throw new Error('boom'); calls.push(call); },
    tempVars: new Map<string, Value>(),
    step: o.step && (async (s) => { steps.push(s); return o.step!(s); }),
    locale: 'en-US', lang: 'en', now: () => new Date(Date.UTC(2026, 9, 25)),
  };
}
const names = (h: FakeHost): string[] => h.calls.map((c) => c.action);

describe('runMacro', () => {
  it('runs up to the first submacro; M.Sub runs it', async () => {
    const h = host({ M: m([act('Beep'), { k: 'submacro', name: 'S', items: [act('CloseDatabase')] }]) });
    await runMacro('M', h); expect(names(h)).toEqual(['Beep']);
    await runMacro('M.S', h); expect(names(h)).toEqual(['Beep', 'CloseDatabase']);
    expect(await runMacro('M.Absent', h)).toMatchObject({ ok: false, failure: { code: 'notFound', number: 2002 } });
    expect(await runMacro('Absent', h)).toMatchObject({ ok: false, failure: { code: 'notFound' } });
  });

  it('comments are skipped, groups run their items', async () => {
    const h = host({ M: m([{ k: 'comment', text: 'x' }, { k: 'group', name: 'G', items: [act('Beep'), act('Quit')] }]) });
    expect(await runMacro('M', h)).toEqual({ ok: true }); expect(names(h)).toEqual(['Beep', 'Quit']);
  });

  it('If / Else If / Else on TempVars, arguments resolved', async () => {
    const h = host({ M: m([act('SetTempVar', { Name: 'n', Expression: '2' }),
      { k: 'if', branches: [{ cond: '[TempVars]![n] > 5', items: [act('Beep')] }, { cond: '[TempVars]![n] = 2', items: [act('MessageBox', { Message: '="n=" & [TempVars]![n]' })] }], else: [act('Quit')] }]) });
    expect(await runMacro('M', h)).toEqual({ ok: true });
    expect(h.calls).toEqual([expect.objectContaining({ action: 'MessageBox', args: expect.objectContaining({ Message: 'n=2', Beep: 'yes', Type: 'none' }) })]);
  });

  it('a Null condition is false: Else runs', async () => {
    const h = host({ M: m([{ k: 'if', branches: [{ cond: '[TempVars]![absent]', items: [act('Beep')] }], else: [act('Quit')] }]) });
    await runMacro('M', h); expect(names(h)).toEqual(['Quit']);
  });

  it('where condition gets the value, not the reference', async () => {
    const h = host({ M: m([act('SetTempVar', { Name: 'v', Expression: '"Lyon"' }),
      act('OpenForm', { FormName: 'F', WhereCondition: '[Ville] = [TempVars]![v]' })]) });
    await runMacro('M', h); expect(h.calls[0]!.args.WhereCondition).toBe('[Ville] = "Lyon"');
  });

  it('a reference argument is passed as written, never evaluated (SetValue)', async () => {
    const h = host({ M: m([act('SetValue', { Item: '[Forms]![F]![C]', Expression: '1 + 2' })]) });
    expect(await runMacro('M', h)).toEqual({ ok: true });   // evaluating [Forms]! would fail: this host has no objectMember
    expect(h.calls[0]!.args).toEqual({ Item: '[Forms]![F]![C]', Expression: { t: 'num', v: 3 } });
    expect(await runMacro('M', host({ M: m([act('SetValue', { Item: '[Forms]![F]![C]', Expression: '1' })]) }, { enabled: false })))
      .toMatchObject({ ok: false, failure: { code: 'blocked' } });   // unsafe: blocked in disabled mode (R5)
  });

  it('a blank required argument is missing', async () => {
    expect(await runMacro('M', host({ M: m([act('SetTempVar', { Name: 'n', Expression: '' })]) })))
      .toMatchObject({ ok: false, failure: { code: 'missingArgument', action: 'SetTempVar' } });
    expect(await runMacro('M', host({ M: m([act('OpenForm')]) }))).toMatchObject({ ok: false, failure: { code: 'missingArgument' } });
  });

  it('an expression error fails the action with expression', async () => {
    expect(await runMacro('M', host({ M: m([act('MessageBox', { Message: '=1/0' })]) })))
      .toMatchObject({ ok: false, failure: { code: 'expression', number: 2005, detail: 'divByZero' } });
  });

  it('OnError Next records MacroError and goes on', async () => {
    const h = host({ M: m([act('OnError', { GoTo: 'next' }), act('OpenForm', { FormName: 'Absent' }),
      act('MessageBox', { Message: '=[MacroError]![Number]' })]) }, { failOn: 'OpenForm' });
    expect(await runMacro('M', h)).toEqual({ ok: true }); expect(h.calls.at(-1)?.args.Message).toBe(String(FAILURE_NUMBERS.actionFailed));
  });

  it('ClearMacroError resets MacroError', async () => {
    const h = host({ M: m([act('OnError'), act('OpenForm', { FormName: 'A' }), act('ClearMacroError'),
      act('MessageBox', { Message: '=[MacroError]![Number] & "/" & [MacroError]![ActionName]' })]) }, { failOn: 'OpenForm' });
    await runMacro('M', h); expect(h.calls.at(-1)?.args.Message).toBe('0/');
  });

  it('OnError MacroName jumps to the submacro', async () => {
    const h = host({ M: m([act('OnError', { GoTo: 'macroName', MacroName: 'Err' }), act('OpenForm', { FormName: 'A' }), act('Quit'),
      { k: 'submacro', name: 'Err', items: [act('MessageBox', { Message: '=[MacroError]![ActionName]' })] }]) }, { failOn: 'OpenForm' });
    expect(await runMacro('M', h)).toEqual({ ok: true });
    expect(h.calls).toEqual([expect.objectContaining({ action: 'MessageBox', macro: 'M.Err', args: expect.objectContaining({ Message: 'OpenForm' }) })]);
  });

  it('a failure in a called macro is the failure of the RunMacro action', async () => {
    const h = host({ M: m([act('OnError', { GoTo: 'next' }), act('RunMacro', { MacroName: 'N' }), act('MessageBox', { Message: '=[MacroError]![Number]' })]),
      N: m([act('OpenForm', { FormName: 'A' }), act('Beep')]) }, { failOn: 'OpenForm' });
    expect(await runMacro('M', h)).toEqual({ ok: true });
    expect(names(h)).toEqual(['MessageBox']);   // N starts in fail mode: its Beep does not run
    expect(await runMacro('M', host({ M: m([act('RunMacro', { MacroName: 'Absent' })]) })))
      .toMatchObject({ ok: false, failure: { code: 'notFound', action: 'RunMacro', macro: 'M' } });
  });

  it('unsafe action blocked while disabled, whatever OnError says', async () => {   // Review Focus 2
    const h = host({ M: m([act('OnError', { GoTo: 'next' }), act('RunSQL', { SQLStatement: 'DELETE FROM Clients' }), act('Beep')]) }, { enabled: false });
    expect(await runMacro('M', h)).toMatchObject({ ok: false, failure: { code: 'blocked', action: 'RunSQL' } }); expect(h.calls).toEqual([]);
    const n = host({ M: m([act('OnError'), act('RunMacro', { MacroName: 'N' }), act('Beep')]), N: m([act('SetWarnings')]) }, { enabled: false });
    expect(await runMacro('M', n)).toMatchObject({ ok: false, failure: { code: 'blocked', action: 'SetWarnings', macro: 'N' } }); expect(n.calls).toEqual([]);
  });

  it('runaway macros stop', async () => {   // Review Focus 1
    // setTimeout(0) waits ~15 ms on Windows' Node: the yield runs at once here, and is counted
    const yields = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((f: () => void) => { queueMicrotask(f); return 0; }) as never);
    expect(await runMacro('M', host({ M: m([act('RunMacro', { MacroName: 'M' })]) }))).toMatchObject({ ok: false, failure: { code: 'tooDeep' } });
    expect(await runMacro('M', host({ M: m([act('RunMacro', { MacroName: 'N', RepeatExpression: 'True' })]), N: m([act('Beep')]) })))
      .toMatchObject({ ok: false, failure: { code: 'tooManySteps' } });
    expect(await runMacro('M', host({ M: m([act('OnError'), act('RunMacro', { MacroName: 'N', RepeatExpression: 'True' })]), N: m([]) })))
      .toMatchObject({ ok: false, failure: { code: 'tooManySteps' } });   // an empty macro repeated forever, OnError Next ignored
    expect(yields).toHaveBeenCalledTimes(2 * MAX_STEPS / 100);   // the window gets a turn every 100 steps
    yields.mockRestore();
  });

  it('RepeatCount', async () => {
    const h = host({ M: m([act('RunMacro', { MacroName: 'N', RepeatCount: '3' })]), N: m([act('Beep')]) });
    await runMacro('M', h); expect(h.calls).toHaveLength(3);
    for (const bad of ['1.5', '0x10', '-1', '1e1', 'x']) {
      const b = host({ M: m([act('RunMacro', { MacroName: 'N', RepeatCount: bad })]), N: m([act('Beep')]) });
      expect(await runMacro('M', b)).toMatchObject({ ok: false, failure: { code: 'actionFailed' } });
      expect(b.calls).toHaveLength(0);
    }
  });

  it('RepeatExpression is evaluated before each repeat', async () => {
    const h = host({ M: m([act('SetTempVar', { Name: 'i', Expression: '0' }), act('RunMacro', { MacroName: 'N', RepeatExpression: '[TempVars]![i] < 2' })]),
      N: m([act('SetTempVar', { Name: 'i', Expression: '[TempVars]![i] + 1' }), act('Beep')]) });
    await runMacro('M', h); expect(h.calls).toHaveLength(2);
  });

  it('StopMacro ends only the called macro; StopAllMacros ends all', async () => {
    const h = host({ M: m([act('RunMacro', { MacroName: 'N' }), act('CloseDatabase')]), N: m([act('Beep'), act('StopMacro'), act('Quit')]) });
    expect(await runMacro('M', h)).toEqual({ ok: true }); expect(names(h)).toEqual(['Beep', 'CloseDatabase']);
    const a = host({ M: m([act('RunMacro', { MacroName: 'N' }), act('CloseDatabase')]), N: m([act('Beep'), act('StopAllMacros'), act('Quit')]) });
    expect(await runMacro('M', a)).toEqual({ ok: true }); expect(names(a)).toEqual(['Beep']);
  });

  it('LocalVars are per run, TempVars shared', async () => {
    const h = host({ M: m([act('SetLocalVar', { Name: 'l', Expression: '1' }), act('SetTempVar', { Name: 'T', Expression: '2' }),
      act('MessageBox', { Message: '=[LocalVars]![L]' }), act('RunMacro', { MacroName: 'N' })]),
      N: m([act('MessageBox', { Message: '=IsNull([LocalVars]![l]) & "/" & [TempVars]![t]' })]) });
    await runMacro('M', h);
    expect(h.calls.map((c) => c.args.Message)).toEqual(['1', 'True/2']);
    expect(h.tempVars.get('t')).toEqual({ t: 'num', v: 2 });
  });

  it('RemoveTempVar, RemoveAllTempVars, and the TempVars limit', async () => {
    const h = host({ M: m([act('SetTempVar', { Name: 'a', Expression: '1' }), act('SetTempVar', { Name: 'b', Expression: '1' }), act('RemoveTempVar', { Name: 'A' })]) });
    await runMacro('M', h); expect([...h.tempVars.keys()]).toEqual(['b']);
    await runMacro('M', { ...h, load: async () => m([act('RemoveAllTempVars')]) }); expect(h.tempVars.size).toBe(0);
    const full = host({ M: m([act('SetTempVar', { Name: 'x', Expression: '1' })]) });
    for (let i = 0; i < MAX_TEMP_VARS; i++) full.tempVars.set(`v${i}`, null);
    expect(await runMacro('M', full)).toMatchObject({ ok: false, failure: { code: 'actionFailed', action: 'SetTempVar' } });
  });

  it('unknown action fails with its name', async () => {
    expect(await runMacro('M', host({ M: m([act('ImportXML')]) })))
      .toMatchObject({ ok: false, failure: { code: 'unknownAction', action: 'ImportXML' } });
  });

  it('an invalid definition is badDefinition', async () => {
    expect(await runMacro('M', host({ M: m([act('Beep'), { k: 'if', branches: [{ cond: '', items: [] }] }]) })))
      .toMatchObject({ ok: false, failure: { code: 'badDefinition' } });
  });

  it('single step: stopAll ends the run', async () => {
    const h = host({ M: m([act('Beep')]) }, { step: async () => 'stopAll' });
    expect(await runMacro('M', h, { singleStep: true })).toEqual({ ok: true }); expect(h.calls).toEqual([]);
    expect(h.steps).toEqual([{ macro: 'M', condition: null, action: 'Beep', args: {} }]);
  });

  it('single step: continue stops stepping; the condition is shown', async () => {
    const h = host({ M: m([{ k: 'if', branches: [{ cond: 'True', items: [act('Beep'), act('Quit')] }] }]) }, { step: async () => 'continue' });
    await runMacro('M', h, { singleStep: true });
    expect(names(h)).toEqual(['Beep', 'Quit']); expect(h.steps).toEqual([{ macro: 'M', condition: 'True', action: 'Beep', args: {} }]);
  });
});

describe('events', () => {
  const ev = (over: Partial<EventContext> = {}): EventContext => ({ object: { kind: 'form', name: 'FCommandes' }, event: 'BeforeUpdate',
    field: (n) => (n === 'Montant' ? num(5000) : fail('unknownField')), cancellable: true, cancelled: false, ...over });

  it('bare names read the event object; CancelEvent cancels', async () => {
    const e = ev();
    const h = host({ M: m([{ k: 'if', branches: [{ cond: '[Montant] > 1000', items: [act('MessageBox', { Message: 'Trop' }), act('CancelEvent')] }] }]) });
    expect(await runMacro('M', h, { event: e })).toEqual({ ok: true }); expect(e.cancelled).toBe(true);
    expect(h.calls).toEqual([expect.objectContaining({ action: 'MessageBox', event: e })]);
  });

  it('a bare name without an event is an unknown field', async () => {
    expect(await runMacro('M', host({ M: m([act('MessageBox', { Message: '=[Montant]' })]) })))
      .toMatchObject({ ok: false, failure: { code: 'expression', detail: 'unknownField' } });
  });

  it('CancelEvent in a non-cancellable event does nothing', async () => {
    const e = ev({ event: 'AfterUpdate', cancellable: false });
    expect(await runMacro('M', host({ M: m([act('CancelEvent')]) }), { event: e })).toEqual({ ok: true }); expect(e.cancelled).toBe(false);
  });

  it('[Forms]! goes to the host', async () => {
    const h = host({ M: m([act('MessageBox', { Message: '=[Forms]![FClients]![Nom]' })]) });
    h.objectMember = (p) => (p.join('!') === 'Forms!FClients!Nom' ? str('Dupont') : fail('unknownField'));
    await runMacro('M', h); expect(h.calls[0]!.args.Message).toBe('Dupont');
    expect(await runMacro('M', host({ M: m([act('MessageBox', { Message: '=[Reports]![R]![C]' })]) })))
      .toMatchObject({ ok: false, failure: { code: 'expression', detail: 'unknownField' } });   // no objectMember: unknownField
  });

  it('an embedded definition runs with its label', async () => {
    expect(await runMacroDef(m([act('ImportXML')]), 'FClients : B : OnClick', host({})))
      .toMatchObject({ ok: false, failure: { macro: 'FClients : B : OnClick', code: 'unknownAction' } });
  });

  it('an embedded definition stops at its first submacro, which OnError MacroName reaches', async () => {
    const h = host({});
    const def = m([act('OnError', { GoTo: 'macroName', MacroName: 'Err' }), act('ImportXML'),
      { k: 'submacro', name: 'Err', items: [act('MessageBox', { Message: '=[MacroError]![MacroName]' })] }]);
    expect(await runMacroDef(def, 'FClients : B : OnClick', h, { event: ev() })).toEqual({ ok: true });
    expect(h.calls).toEqual([expect.objectContaining({ macro: 'FClients : B : OnClick.Err', args: expect.objectContaining({ Message: 'FClients : B : OnClick' }) })]);
  });

  it('RunMacro keeps the event', async () => {
    const e = ev();
    const h = host({ M: m([act('RunMacro', { MacroName: 'N' })]), N: m([act('MessageBox', { Message: '=[Montant]' }), act('CancelEvent')]) });
    expect(await runMacro('M', h, { event: e })).toEqual({ ok: true });
    expect(e.cancelled).toBe(true); expect(h.calls[0]).toMatchObject({ macro: 'N', event: e, args: { Message: '5000' } });
  });
});
