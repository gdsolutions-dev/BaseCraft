import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasecraftApi } from '../../shared/api';
import { localeInfo } from '../../shared/locale-format';
import type { MacroDef, MacroItem } from '../../shared/macro/model';
import type { ModalApi } from '../shell/Modal';
import type { DocTab } from '../state/app-state';
import type { Value } from '../../shared/expr/ast';
import { bool, num, str } from '../../shared/expr/library';
import type { EventBinding } from '../../shared/design/events';
import { formCancelled, formReady, registerForm, type FormInstance } from '../form/form-instances';
import type { SectionEvent } from '../../shared/report/types';
import type { ActionCall, EventContext } from './engine';

const runActionFlow = vi.fn(async (): Promise<string> => 'done');
vi.mock('../query/run-action', () => ({ runActionFlow }));
const outputSavedReport = vi.fn(async (..._: unknown[]) => false);
vi.mock('../report/ReportPreviewView', () => ({ outputSavedReport }));

const m = (items: MacroItem[]): MacroDef => ({ formatVersion: '1.0', items });
const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
let macros: Record<string, MacroDef> = {};
const objects: Record<string, string[]> = { form: ['FClients'], report: ['Factures par client'], query: ['QSel', 'QMaj'] };
const sql: Record<string, string> = { QSel: 'SELECT * FROM Clients;', QMaj: 'UPDATE Clients SET Ville = "x";' };
const beep = vi.fn(async () => {});
(globalThis as unknown as { window: { basecraft: Partial<BasecraftApi> } }).window = {
  basecraft: {
    app: { beep, getSettings: async () => ({ region: 'fr-FR', uiLanguage: 'fr' }) } as unknown as BasecraftApi['app'],
    tables: { list: async () => [{ name: 'Clients' }] } as unknown as BasecraftApi['tables'],
    objects: {
      list: async (kind?: string) => (kind === 'macro' ? Object.keys(macros) : objects[kind!] ?? []).map((name) => ({ name, kind })),
      get: async (kind: string, name: string) => {
        if (kind === 'macro' && macros[name]) return { name, definition: macros[name] };
        if (kind === 'query' && sql[name]) return { name, definition: { formatVersion: '1.0', sql: sql[name] } };
        throw new Error(`Error invoking remote method 'bc:objects:get': Error: bc:notFound`);
      },
    } as unknown as BasecraftApi['objects'],
  },
};
const { clearTempVars, macroNamesWithSubs, MAX_EVENT_DEPTH, runEvent, runMacroByName, setMacroShell, shellHost } = await import('./macro-shell');
const { failureMessage } = await import('./MacroFailedDialog');
const { onContentBlocked } = await import('../shell/Banners');
const { reportShown } = await import('../report/report-events');
const { i18n } = await import('../i18n');

const tab = (id: string, kind: DocTab['kind'], name: string): DocTab => ({ id, kind, name, mode: 'run' }) as DocTab;
let enabled = true;
let shown: string[] = [];
const modal: ModalApi = { confirm: vi.fn(), prompt: vi.fn(), custom: vi.fn(async (_r, o) => { shown.push(o.titleKey); return true as never; }) };
const d = {
  dispatch: vi.fn(), modal, tabs: () => [tab('a', 'form', 'FClients'), tab('b', 'table', 'Clients')], active: () => tab('b', 'table', 'Clients'),
  contentEnabled: () => enabled, closeTab: vi.fn(async () => true), closeBase: vi.fn(async () => true), quit: vi.fn(async () => true),
  region: () => localeInfo('fr-FR'), lang: () => 'fr' as const, showError: vi.fn(async () => {}),
};
const call = (action: string, args: Record<string, string | Value>, extra: Partial<ActionCall> = {}): ActionCall =>
  ({ macro: 'M', action: action as ActionCall['action'], args, raw: args as Record<string, string>, ...extra });
const perform = (c: ActionCall) => shellHost(d, { singleStep: false }).perform(c);

/** A form instance recording its calls. */
type StubForm = FormInstance & { [K in 'setValue' | 'setProperty' | 'goToRecord' | 'goToControl' | 'applyFilter' | 'showAllRecords' | 'find' | 'requery'
  | 'saveRecord' | 'undoRecord' | 'deleteRecord' | 'refreshRecord']: ReturnType<typeof vi.fn> };
function stubForm(name: string, tabId = `t-${name}`): StubForm {
  return {
    name, tabId, value: () => str('x'), setValue: vi.fn(async () => {}), setProperty: vi.fn(), goToRecord: vi.fn(async () => {}),
    goToControl: vi.fn(), applyFilter: vi.fn(async () => {}), showAllRecords: vi.fn(async () => {}), find: vi.fn(async () => true),
    requery: vi.fn(async () => {}), saveRecord: vi.fn(async () => {}), undoRecord: vi.fn(), deleteRecord: vi.fn(async () => {}), refreshRecord: vi.fn(async () => {}),
  };
}
const offs: (() => void)[] = [];
const open = <F extends FormInstance>(f: F): F => { offs.push(registerForm(f)); formReady(f.name); return f; };
const ctx = (o: Partial<EventContext> = {}): EventContext =>
  ({ object: { kind: 'form', name: 'FCommandes' }, event: 'OnClick', field: () => null, cancellable: false, cancelled: false, ...o });
afterEach(() => { offs.splice(0).forEach((off) => off()); });

beforeEach(() => {
  vi.clearAllMocks();
  enabled = true; shown = []; macros = {};
  clearTempVars();
  setMacroShell(d);
});

describe('macro shell actions', () => {
  it('OpenForm with a condition dispatches the open arguments', async () => {
    open(stubForm('FClients'));
    await perform(call('OpenForm', { FormName: 'FClients', View: 'form', WhereCondition: '[Ville] = "Lyon"', DataMode: '' }));
    expect(d.dispatch).toHaveBeenCalledWith({ type: 'open', kind: 'form', name: 'FClients', mode: 'run', args: { where: '[Ville] = "Lyon"' } });
    await perform(call('OpenForm', { FormName: 'fclients', View: 'datasheet', DataMode: 'readOnly' }));   // the stored spelling
    expect(d.dispatch).toHaveBeenLastCalledWith({ type: 'open', kind: 'form', name: 'FClients', mode: 'datasheet', args: { dataMode: 'readOnly' } });
  });

  it('OpenForm in Design view takes no arguments; an open the form refuses (its record kept) fails the action', async () => {
    open(stubForm('FClients'));
    await perform(call('OpenForm', { FormName: 'FClients', View: 'design', WhereCondition: '[Ville] = "Lyon"', DataMode: 'edit' }));
    expect(d.dispatch).toHaveBeenLastCalledWith({ type: 'open', kind: 'form', name: 'FClients', mode: 'design' });
    d.dispatch.mockResolvedValueOnce(false as never);
    await expect(perform(call('OpenForm', { FormName: 'FClients', View: 'form', WhereCondition: '[Ville] = "Lyon"' }))).rejects.toThrow('bc:actionCancelled');
  });

  it('unknown form fails the action', async () => {
    await expect(perform(call('OpenForm', { FormName: 'Absent', View: 'form' }))).rejects.toThrow('bc:notFound');
  });

  it('OpenReport: preview with its condition (waits for On Open / On No Data), print through outputSavedReport, design', async () => {
    const R = 'Factures par client';
    let done = false;
    const p = perform(call('OpenReport', { ReportName: R, View: 'preview', WhereCondition: '[Client] = "A"' })).then(() => { done = true; });
    await vi.waitFor(() => expect(d.dispatch).toHaveBeenLastCalledWith({ type: 'open', kind: 'report', name: R, mode: 'run', args: { where: '[Client] = "A"' } }));
    expect(done).toBe(false);   // the preview has not passed On Open yet
    reportShown(R, true);
    await p;
    const q = perform(call('OpenReport', { ReportName: R, View: 'preview' }));
    await vi.waitFor(() => expect(d.dispatch).toHaveBeenCalledTimes(2));
    reportShown(R, false);   // On Open or On No Data cancelled, or the preview closed first
    await expect(q).rejects.toThrow('bc:actionCancelled');
    await perform(call('OpenReport', { ReportName: R, View: 'print', WhereCondition: '[Client] = "A"' }));
    expect(outputSavedReport).toHaveBeenCalledWith(modal, R, 'printer', '[Client] = "A"');   // the Where Condition, as the preview
    outputSavedReport.mockResolvedValueOnce(true);   // its On Open cancelled
    await expect(perform(call('OpenReport', { ReportName: R, View: 'print' }))).rejects.toThrow('bc:actionCancelled');
    await perform(call('OpenReport', { ReportName: 'Factures par client', View: 'design' }));
    expect(d.dispatch).toHaveBeenLastCalledWith({ type: 'open', kind: 'report', name: 'Factures par client', mode: 'design' });
  });

  it('OpenQuery: a select query opens, an action query runs through runActionFlow', async () => {
    await perform(call('OpenQuery', { QueryName: 'QSel', View: 'datasheet' }));
    expect(d.dispatch).toHaveBeenLastCalledWith({ type: 'open', kind: 'query', name: 'QSel', mode: 'run' });
    await perform(call('OpenQuery', { QueryName: 'QMaj', View: 'datasheet' }));
    expect(runActionFlow).toHaveBeenCalledWith({ kind: 'query', name: 'QMaj' }, expect.objectContaining({ warnings: true }));
    await expect(perform(call('OpenTable', { TableName: 'Absent', View: 'datasheet' }))).rejects.toThrow('bc:notFound||Absent');
  });

  it('RunSQL refuses a select', async () => {
    await expect(perform(call('RunSQL', { SQLStatement: 'SELECT * FROM Clients;' }))).rejects.toThrow(/runSqlSelect/);
    expect(runActionFlow).not.toHaveBeenCalled();
  });

  it('SetWarnings off reaches runActionFlow and resets after the run', async () => {
    macros = { W: m([act('SetWarnings', { WarningsOn: 'no' }), act('RunSQL', { SQLStatement: 'DELETE FROM Clients;' })]), R: m([act('RunSQL', { SQLStatement: 'DELETE FROM Clients;' })]) };
    expect(await runMacroByName('W')).toEqual({ ok: true });
    expect(runActionFlow).toHaveBeenLastCalledWith({ kind: 'sql', sql: 'DELETE FROM Clients;' }, expect.objectContaining({ warnings: false }));
    expect(await runMacroByName('R')).toEqual({ ok: true });
    expect(runActionFlow).toHaveBeenLastCalledWith({ kind: 'sql', sql: 'DELETE FROM Clients;' }, expect.objectContaining({ warnings: true }));
  });

  it('CloseWindow without arguments closes the active tab', async () => {
    await perform(call('CloseWindow', { ObjectType: '', ObjectName: '' }));
    expect(d.closeTab).toHaveBeenCalledWith(tab('b', 'table', 'Clients'));
    await perform(call('CloseWindow', { ObjectType: 'form', ObjectName: 'fclients' }));
    expect(d.closeTab).toHaveBeenLastCalledWith(tab('a', 'form', 'FClients'));
    await perform(call('CloseWindow', { ObjectType: 'report', ObjectName: 'Absent' }));   // not open: nothing
    expect(d.closeTab).toHaveBeenCalledTimes(2);
  });

  it('MessageBox beeps and shows its title, Beep beeps, Quit and CloseDatabase go through the shell', async () => {
    await perform(call('MessageBox', { Message: 'Bonjour', Beep: 'yes', Type: 'information', Title: '' }));
    expect(beep).toHaveBeenCalledTimes(1);
    expect(modal.custom).toHaveBeenCalledWith(expect.any(Function), { titleKey: 'macro.msgbox.title', titleParams: { title: 'BaseCraft' } });
    await perform(call('Beep', {}));
    await perform(call('Quit', {}));
    await perform(call('CloseDatabase', {}));
    expect(beep).toHaveBeenCalledTimes(2);
    expect(d.quit).toHaveBeenCalled();
    expect(d.closeBase).toHaveBeenCalled();
  });

  it('Single Step asks before each action: Step runs it, Continue stops asking, Stop All ends the run (ok); not asked without it', async () => {
    macros = { M: m([act('Beep'), act('Beep'), act('Beep')]) };
    const answers = ['step', 'continue'];
    vi.mocked(modal.custom).mockImplementation(async (_r, o) => { shown.push(o.titleKey); return (o.titleKey === 'macro.step.title' ? answers.shift() : true) as never; });
    expect(await runMacroByName('M', { singleStep: true })).toEqual({ ok: true });
    expect([shown, beep.mock.calls.length]).toEqual([['macro.step.title', 'macro.step.title'], 3]);
    shown = []; beep.mockClear();
    vi.mocked(modal.custom).mockImplementation(async (_r, o) => { shown.push(o.titleKey); return 'stopAll' as never; });
    expect(await runMacroByName('M', { singleStep: true })).toEqual({ ok: true });
    expect([shown, beep.mock.calls.length]).toEqual([['macro.step.title'], 0]);
    shown = [];
    expect(await runMacroByName('M')).toEqual({ ok: true });
    expect([shown, beep.mock.calls.length]).toEqual([[], 3]);
    vi.mocked(modal.custom).mockImplementation(async (_r, o) => { shown.push(o.titleKey); return true as never; });
  });

  it('a blocked action shows Action Failed and brings the security bar back; temporary variables live until cleared', async () => {
    enabled = false;
    macros = { M: m([act('SetTempVar', { Name: 'v', Expression: '1' }), act('RunSQL', { SQLStatement: 'DELETE FROM Clients;' })]), N: m([act('MessageBox', { Message: '=[TempVars]![v]' })]) };
    let bar = 0;
    const off = onContentBlocked(() => { bar++; });
    const r = await runMacroByName('M');
    off();
    expect(r).toMatchObject({ ok: false, failure: { code: 'blocked' } });
    expect(bar).toBe(1);
    expect(shown).toEqual(['macro.failed.title']);
    expect(runActionFlow).not.toHaveBeenCalled();
    const host = shellHost(d, { singleStep: false });
    expect(host.tempVars.get('v')).toMatchObject({ v: 1 });
    clearTempVars();
    expect(host.tempVars.size).toBe(0);
  });

  it('an action query answered No fails the action; OnError Next goes on; a blocked one stops the run', async () => {
    const sql = { SQLStatement: 'DELETE FROM Clients;' };
    macros = { M: m([act('RunSQL', sql), act('Beep')]), N: m([act('OnError', { GoTo: 'next' }), act('RunSQL', sql), act('Beep')]) };
    runActionFlow.mockResolvedValueOnce('cancelled');
    const r = await runMacroByName('M');
    expect(r).toMatchObject({ ok: false, failure: { code: 'actionFailed', action: 'RunSQL', detail: 'bc:actionCancelled' } });
    expect(beep).not.toHaveBeenCalled();
    if (r && !r.ok) expect(failureMessage(r.failure)).toBe(i18n.t('macro.error.actionCancelled', { action: i18n.t('macro.action.RunSQL') }));
    runActionFlow.mockResolvedValueOnce('failed');
    expect(await runMacroByName('N')).toEqual({ ok: true });
    expect(beep).toHaveBeenCalledTimes(1);
    runActionFlow.mockResolvedValueOnce('blocked');   // the content was disabled meanwhile: OnError does not go on
    expect(await runMacroByName('N')).toMatchObject({ ok: false, failure: { code: 'blocked' } });
    expect(beep).toHaveBeenCalledTimes(1);
  });

  it('a document kept open fails CloseWindow, Quit and CloseDatabase; once closed, the run ends there', async () => {
    d.closeTab.mockResolvedValueOnce(false);
    await expect(perform(call('CloseWindow', { ObjectType: '', ObjectName: '' }))).rejects.toThrow('bc:actionCancelled');
    for (const [action, fn] of [['Quit', d.quit], ['CloseDatabase', d.closeBase]] as const) {
      macros = { M: m([act(action), act('Beep')]) };
      expect(await runMacroByName('M')).toEqual({ ok: true });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(beep).not.toHaveBeenCalled();
      fn.mockResolvedValueOnce(false);
      expect(await runMacroByName('M')).toMatchObject({ ok: false, failure: { action, detail: 'bc:actionCancelled' } });
      expect(beep).not.toHaveBeenCalled();
    }
  });

  it('one run at a time: a run asked during another is ignored with a beep', async () => {
    macros = { M: m([act('MessageBox', { Message: 'x', Beep: 'no' })]) };
    let release!: () => void;
    vi.mocked(modal.custom).mockImplementationOnce(() => new Promise((r) => { release = () => r(true as never); }));
    const first = runMacroByName('M');
    await vi.waitFor(() => expect(modal.custom).toHaveBeenCalledTimes(1));
    expect(await runMacroByName('M')).toBeNull();
    expect(beep).toHaveBeenCalledTimes(1);
    release();
    expect(await first).toEqual({ ok: true });
    expect(await runMacroByName('M')).toEqual({ ok: true });   // released at its end
    expect(modal.custom).toHaveBeenCalledTimes(2);
  });

  it('[Forms]! is read in a run outside an event (Navigation Pane, Run Macro, RunMacro inside them)', async () => {
    open(stubForm('FClients'));
    macros = { M: m([act('SetTempVar', { Name: 'v', Expression: '[Forms]![FClients]![Ville]' }), act('RunMacro', { MacroName: 'N' })]),
      N: m([act('SetTempVar', { Name: 'w', Expression: '[Forms]![FClients]![Ville]' })]) };
    expect(await runMacroByName('M')).toEqual({ ok: true });
    const host = shellHost(d, { singleStep: false });
    expect([host.tempVars.get('v'), host.tempVars.get('w')]).toEqual([str('x'), str('x')]);
  });

  it('names with submacros', async () => {
    macros = { N: m([act('Beep')]), M: m([act('Beep'), { k: 'submacro', name: 'S', items: [] }]) };
    expect(await macroNamesWithSubs()).toEqual(['M', 'M.S', 'N']);
  });
});

describe('events and form actions', () => {
  it('runEvent: CancelEvent cancels; none does nothing', async () => {
    expect(await runEvent({ kind: 'none' }, ctx())).toBe(false);
    expect(await runEvent({ kind: 'other', text: '[Event Procedure]' }, ctx())).toBe(false);
    expect(await runEvent({ kind: 'embedded', def: m([act('CancelEvent')]) }, ctx({ event: 'BeforeUpdate', cancellable: true }))).toBe(true);
    expect(await runEvent({ kind: 'embedded', def: m([act('CancelEvent')]) }, ctx())).toBe(false);   // not cancellable
    setMacroShell(null);
    expect(await runEvent({ kind: 'embedded', def: m([act('CancelEvent')]) }, ctx({ cancellable: true }))).toBe(false);   // no base
  });

  it('a failing guard cancels and is shown once; a failure in a non-cancellable event does not cancel', async () => {
    expect(await runEvent({ kind: 'macro', name: 'Absent' }, ctx({ cancellable: true }))).toBe(true);
    expect(shown).toEqual(['macro.failed.title']);
    expect(await runEvent({ kind: 'macro', name: 'Absent' }, ctx())).toBe(false);
  });

  it('a blocked action in an event brings the security bar back and cancels the guard', async () => {
    enabled = false;
    let bar = 0;
    const off = onContentBlocked(() => { bar++; });
    const r = await runEvent({ kind: 'embedded', def: m([act('SetValue', { Item: '[Nom]', Expression: '1' })]) }, ctx({ cancellable: true }));
    off();
    expect([r, bar, shown]).toEqual([true, 1, ['macro.failed.title']]);
  });

  it('events bypass the one-run-at-a-time rule of manual runs (R6)', async () => {
    const f = open(stubForm('FCommandes'));
    macros = { M: m([act('GoToRecord', { Record: 'next' })]) };
    f.goToRecord.mockImplementationOnce(async () => {
      expect(await runEvent({ kind: 'embedded', def: m([act('Beep')]) }, ctx({ event: 'OnCurrent' }))).toBe(false);
    });
    const active = vi.spyOn(d, 'active').mockReturnValue(tab('t-FCommandes', 'form', 'FCommandes'));
    expect(await runMacroByName('M')).toEqual({ ok: true });
    active.mockRestore();
    expect(beep).toHaveBeenCalledTimes(1);
  });

  it('nesting stops at 20', async () => {
    const f = open(stubForm('FCommandes'));
    const binding: EventBinding = { kind: 'embedded', def: m([act('Beep'), act('GoToRecord', { Record: 'next' })]) };
    f.goToRecord.mockImplementation(async () => { await runEvent(binding, ctx({ event: 'OnCurrent' })); });   // On Current raises On Current
    expect(await runEvent(binding, ctx({ event: 'OnCurrent' }))).toBe(false);
    expect(beep).toHaveBeenCalledTimes(MAX_EVENT_DEPTH);
    expect(shown).toEqual(['macro.failed.title']);
    const render = vi.mocked(modal.custom).mock.calls[0]![0] as unknown as (close: () => void) => { props: { f: { code: string } } };
    const failure = render(() => {}).props.f as Parameters<typeof failureMessage>[0];
    expect(failure.code).toBe('tooDeep');
    expect(failureMessage(failure)).toBe(i18n.t('macro.error.eventTooDeep'));
    expect(await runEvent({ kind: 'embedded', def: m([act('Beep')]) }, ctx())).toBe(false);   // the counter came back down
    expect(beep).toHaveBeenCalledTimes(MAX_EVENT_DEPTH + 1);
  });

  it('form actions reach the event\'s form, else the active tab\'s; none fails', async () => {
    const f = open(stubForm('FCommandes')), g = open(stubForm('FClients', 'a'));
    const ev = { event: ctx({ object: { kind: 'form', name: 'FCommandes' } }) };
    await perform(call('GoToRecord', { ObjectType: '', Record: 'goTo', Offset: '3' }, ev));
    expect(f.goToRecord).toHaveBeenCalledWith('goTo', 3);
    await perform(call('GoToRecord', { ObjectType: '', Record: 'next' }, ev));
    expect(f.goToRecord).toHaveBeenLastCalledWith('next', 1);
    await perform(call('GoToRecord', { ObjectType: '', Record: 'first' }, ev));
    expect(f.goToRecord).toHaveBeenLastCalledWith('first');
    await perform(call('GoToRecord', { ObjectType: 'form', ObjectName: 'fclients', Record: 'previous', Offset: '2' }, ev));
    expect(g.goToRecord).toHaveBeenCalledWith('previous', 2);
    await expect(perform(call('GoToRecord', { ObjectType: '', Record: 'goTo', Offset: 'x' }, ev))).rejects.toThrow(/cantGoToRecord/);
    await expect(perform(call('GoToRecord', { ObjectType: '', Record: 'next', Offset: '0' }, ev))).rejects.toThrow(/cantGoToRecord/);
    await expect(perform(call('GoToRecord', { ObjectType: '', Record: 'goTo', Offset: '0' }, ev))).rejects.toThrow(/cantGoToRecord/);
    await perform(call('GoToControl', { ControlName: 'Nom' }, ev));
    await perform(call('ApplyFilter', { WhereCondition: '[Ville] = "Lyon"' }, ev));
    await perform(call('ShowAllRecords', {}, ev));
    await perform(call('Requery', {}, ev));
    await perform(call('Requery', { ControlName: 'Liste' }, ev));
    await perform(call('SaveRecord', {}, ev));
    await perform(call('UndoRecord', {}, ev));
    await perform(call('RefreshRecord', {}, ev));
    expect([f.goToControl.mock.calls, f.applyFilter.mock.calls, f.showAllRecords.mock.calls.length, f.requery.mock.calls, f.saveRecord.mock.calls.length,
      f.undoRecord.mock.calls.length, f.refreshRecord.mock.calls.length]).toEqual([[['Nom']], [['[Ville] = "Lyon"']], 1, [[undefined], ['Liste']], 1, 1, 1]);
    const active = vi.spyOn(d, 'active').mockReturnValue(tab('a', 'form', 'FClients'));   // no event: the active tab's form (a dialog when one is open)
    await perform(call('SaveRecord', {}));
    expect(g.saveRecord).toHaveBeenCalledTimes(1);
    active.mockReturnValue(tab('b', 'table', 'Clients'));
    await expect(perform(call('SaveRecord', {}))).rejects.toThrow('bc:noActiveForm');
    active.mockRestore();
  });

  it('DeleteRecord follows the run\'s SetWarnings', async () => {
    const f = open(stubForm('FCommandes'));
    expect(await runEvent({ kind: 'embedded', def: m([act('SetWarnings', { WarningsOn: 'no' }), act('DeleteRecord')]) }, ctx())).toBe(false);
    expect(await runEvent({ kind: 'embedded', def: m([act('DeleteRecord')]) }, ctx())).toBe(false);
    expect(f.deleteRecord.mock.calls).toEqual([[false], [true]]);
  });

  it('SetProperty parses its value', async () => {
    const f = open(stubForm('FCommandes'));
    const ev = { event: ctx({ control: 'Bouton' }) };
    const set = async (Property: string, Value: string, ControlName = 'Total') => {
      await perform(call('SetProperty', { ControlName, Property, Value }, ev));
      return f.setProperty.mock.lastCall;
    };
    expect(await set('visible', 'Non')).toEqual(['Total', 'visible', bool(false)]);
    expect(await set('enabled', 'VRAI')).toEqual(['Total', 'enabled', bool(true)]);
    expect(await set('locked', '-1')).toEqual(['Total', 'locked', bool(true)]);
    await expect(set('locked', 'peut-être')).rejects.toThrow(/badValue/);
    expect(await set('width', '2,5')).toEqual(['Total', 'width', num(1418)]);
    expect(await set('top', '1 cm')).toEqual(['Total', 'top', num(567)]);
    await expect(set('left', 'loin')).rejects.toThrow(/badValue/);
    expect(await set('foreColor', '#FF8000')).toEqual(['Total', 'foreColor', str('#ff8000')]);
    expect(await set('backColor', '255')).toEqual(['Total', 'backColor', str('#ff0000')]);   // BGR: 255 is red
    expect(await set('backColor', '16711680')).toEqual(['Total', 'backColor', str('#0000ff')]);
    await expect(set('backColor', 'rouge')).rejects.toThrow(/badValue/);
    expect(await set('caption', 'Total HT')).toEqual(['Total', 'caption', str('Total HT')]);
    expect(await set('value', '12.5')).toEqual(['Total', 'value', num(12.5)]);
    expect(await set('value', '"a"')).toEqual(['Total', 'value', str('a')]);
    expect(await set('value', 'Dupont et fils')).toEqual(['Total', 'value', str('Dupont et fils')]);
    expect(await set('visible', 'non', '')).toEqual(['Bouton', 'visible', bool(false)]);   // no control: the event's
    await expect(perform(call('SetProperty', { ControlName: 'T', Property: 'visible', Value: 'non' },
      { event: ctx({ object: { kind: 'report', name: 'R' }, event: 'OnOpen' }) }))).rejects.toThrow(/propertyNotSupported/);   // no band
    expect(f.setProperty).toHaveBeenCalledTimes(13);
  });

  it('SetProperty in On Format acts on the band (R9, R10)', async () => {
    const e: SectionEvent = { section: 'groupHeader', groupLevel: 0, formatCount: 1, page: 1, values: { Client: str('A') }, visible: { Client: true, Etiquette: true },
      sectionVisible: true, cancel: false, height: 454, field: () => null };
    const set = (ControlName: string, Property: string, Value: string) =>
      perform(call('SetProperty', { ControlName, Property, Value }, { event: ctx({ object: { kind: 'report', name: 'R' }, event: 'OnFormat', report: e }) }));
    await set('client', 'visible', 'Non'); await set('Etiquette', 'value', '12'); await set('groupheader0', 'height', '1'); await set('GroupHeader0', 'visible', 'Non');
    expect(e).toMatchObject({ visible: { Client: false, Etiquette: true }, values: { Client: str('A'), Etiquette: num(12) }, height: 567, sectionVisible: false });
    await expect(set('Client', 'enabled', 'Non')).rejects.toThrow(/propertyNotSupported/);
    await expect(set('GroupHeader0', 'value', '1')).rejects.toThrow(/propertyNotSupported/);
    await set('Detail', 'visible', 'Non'); await set('Montant', 'value', '1');   // not in the band being formatted: nothing (R9)
    expect(e).toMatchObject({ visible: { Client: false, Etiquette: true }, values: { Client: str('A'), Etiquette: num(12) }, sectionVisible: false });
    expect(Object.keys(e.values)).toEqual(['Client', 'Etiquette']);
  });

  it('SetValue reaches [Forms]![F]![C] or the current form\'s control; anything else is a bad reference', async () => {
    const f = open(stubForm('FCommandes')), g = open(stubForm('FClients', 'a'));
    const ev = { event: ctx() };
    await perform(call('SetValue', { Item: '[Forms]![FClients]![Ville]', Expression: str('Lyon') }, ev));
    expect(g.setValue).toHaveBeenCalledWith('Ville', str('Lyon'));
    await perform(call('SetValue', { Item: '[Total]', Expression: num(3) }, ev));
    expect(f.setValue).toHaveBeenCalledWith('Total', num(3));
    await expect(perform(call('SetValue', { Item: '[Forms]![Ferme]![X]', Expression: num(1) }, ev))).rejects.toThrow(/notOpen/);
    await expect(perform(call('SetValue', { Item: '[Reports]![R]![X]', Expression: num(1) }, ev))).rejects.toThrow(/badReference/);
    await expect(perform(call('SetValue', { Item: '[a] + 1', Expression: num(1) }, ev))).rejects.toThrow(/badReference/);
  });

  it('an instance gone fails with notOpen', async () => {
    await expect(perform(call('GoToControl', { ControlName: 'Nom' }, { event: ctx({ object: { kind: 'form', name: 'Ferme' } }) }))).rejects.toThrow(/notOpen/);
    await expect(perform(call('GoToRecord', { ObjectType: 'form', ObjectName: 'Ferme', Record: 'next' }))).rejects.toThrow('bc:notOpen||Ferme');
  });

  it('OpenForm waits for the form to be open; a cancelled On Open fails it; Dialog waits for its close', async () => {
    objects.form = ['FClients', 'F'];
    let done = false;
    const p = perform(call('OpenForm', { FormName: 'F', View: 'form' })).then(() => { done = true; });
    await vi.waitFor(() => expect(d.dispatch).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(done).toBe(false);
    open(stubForm('F'));
    await p;
    offs.splice(0).forEach((off) => off());
    const q = perform(call('OpenForm', { FormName: 'F', View: 'form' }));
    await vi.waitFor(() => expect(d.dispatch).toHaveBeenCalledTimes(2));
    formCancelled('F');
    await expect(q).rejects.toThrow('bc:actionCancelled');
    let release!: () => void;
    const whenClosed = vi.fn((_id: string) => new Promise<void>((r) => { release = r; }));
    const host = shellHost({ ...d, whenClosed, tabs: () => [{ ...tab('dlg', 'form', 'F'), dialog: true }] }, { singleStep: false });
    done = false;
    const r = host.perform(call('OpenForm', { FormName: 'F', View: 'form', WindowMode: 'dialog' })).then(() => { done = true; });
    await vi.waitFor(() => expect(d.dispatch).toHaveBeenCalledTimes(3));
    open(stubForm('F', 'dlg'));
    await vi.waitFor(() => expect(whenClosed).toHaveBeenCalledWith('dlg'));
    expect(done).toBe(false);
    release();
    await r;
    await host.perform(call('OpenForm', { FormName: 'F', View: 'form', WindowMode: 'dialog' }));   // already open: only activated
    expect(whenClosed).toHaveBeenCalledTimes(1);
    objects.form = ['FClients'];
  });

  it('OpenForm in Dialog mode of a form open in Design view: it opens in its tab, the action waits for it to be open, not closed', async () => {
    objects.form = ['FClients', 'F'];
    const whenClosed = vi.fn(async (_id: string) => {});
    const host = shellHost({ ...d, whenClosed, tabs: () => [{ ...tab('t1', 'form', 'F'), mode: 'design' }] }, { singleStep: false });
    const p = host.perform(call('OpenForm', { FormName: 'F', View: 'form', WindowMode: 'dialog' }));
    await vi.waitFor(() => expect(d.dispatch).toHaveBeenCalledWith({ type: 'open', kind: 'form', name: 'F', mode: 'run', args: { windowMode: 'dialog' } }));
    open(stubForm('F', 't1'));   // its tab now in Form view (the reducer)
    await p;
    expect(whenClosed).not.toHaveBeenCalled();
    objects.form = ['FClients'];
  });

  it('the base closed or switched: a macro waiting for a form or a preview fails instead of hanging', async () => {
    objects.form = ['FClients', 'F'];
    const f = perform(call('OpenForm', { FormName: 'F', View: 'form' }));
    const r = perform(call('OpenReport', { ReportName: 'Factures par client', View: 'preview' }));
    await vi.waitFor(() => expect(d.dispatch).toHaveBeenCalledTimes(2));
    formCancelled(); reportShown(null, false);   // App, when the base's path changes
    await expect(f).rejects.toThrow('bc:actionCancelled');
    await expect(r).rejects.toThrow('bc:actionCancelled');
    objects.form = ['FClients'];
  });

  it('Quit, CloseDatabase or StopAllMacros in a nested run (the OK macro of a dialog) stops every run in progress, with no Action Failed', async () => {
    objects.form = ['FClients', 'F'];
    for (const stop of ['CloseDatabase', 'Quit', 'StopAllMacros']) {
      for (const after of ['resolves', 'throws']) {
        macros = { M: m([act('OpenForm', { FormName: 'F', View: 'form', WindowMode: 'dialog' }), act('Beep')]) };
        // the dialog's OK button: its macro stops everything, then the dialog goes (or the base gone, the wait fails)
        const whenClosed = vi.fn(async (_id: string) => {
          await runEvent({ kind: 'embedded', def: m([act(stop), act('Beep')]) }, ctx({ object: { kind: 'form', name: 'F' } }));
          if (after === 'throws') throw new Error('bc:noBase');
        });
        setMacroShell({ ...d, whenClosed, tabs: () => [{ ...tab('dlg', 'form', 'F'), dialog: true }] });
        d.dispatch.mockImplementationOnce((() => { open(stubForm('F', 'dlg')); }) as never);
        expect(await runMacroByName('M')).toEqual({ ok: true });
        expect([beep.mock.calls.length, shown, stop]).toEqual([0, [], stop]);
        offs.splice(0).forEach((off) => off());
      }
    }
    objects.form = ['FClients'];
  });

  it('OpenForm of a form whose own open is under way (its On Open, On Load, first On Current; A and B opening each other) does not wait for it', async () => {
    objects.form = ['FClients', 'F'];
    offs.push(registerForm(stubForm('F')));   // registered, not ready: its open events are running up the chain
    await perform(call('OpenForm', { FormName: 'F', View: 'form' }, { event: ctx({ object: { kind: 'form', name: 'F' }, event: 'OnOpen' }) }));
    await perform(call('OpenForm', { FormName: 'F', View: 'form', WindowMode: 'dialog' }, { event: ctx({ object: { kind: 'form', name: 'G' }, event: 'OnOpen' }) }));
    expect(d.dispatch).toHaveBeenCalledTimes(2);
    objects.form = ['FClients'];
  });

  it('OpenForm: an On Open cancelled before the dispatch resolves still fails the action (no wait forever)', async () => {
    objects.form = ['FClients', 'F'];
    d.dispatch.mockImplementationOnce((() => { formCancelled('F'); }) as never);   // the form mounts and cancels inside the dispatch
    await expect(perform(call('OpenForm', { FormName: 'F', View: 'form' }))).rejects.toThrow('bc:actionCancelled');
    d.dispatch.mockResolvedValueOnce(false as never);   // a refused dispatch: its own failure, no unhandled rejection
    await expect(perform(call('OpenForm', { FormName: 'F', View: 'form' }))).rejects.toThrow('bc:actionCancelled');
    objects.form = ['FClients'];
  });

  it('FindRecord not found shows a message, not a failure; FindWhat is at most 255 characters', async () => {
    const f = open(stubForm('FCommandes'));
    const ev = { event: ctx() };
    f.find.mockResolvedValueOnce(false);
    await perform(call('FindRecord', { FindWhat: 'Lyon', Match: 'whole', MatchCase: 'no', Search: 'all', OnlyCurrentField: 'yes', FindFirst: 'yes' }, ev));
    expect(f.find).toHaveBeenCalledWith({ what: 'Lyon', match: 'whole', matchCase: false, search: 'all', onlyCurrentField: true, findFirst: true });
    expect(shown).toEqual(['macro.msgbox.title']);
    await perform(call('FindRecord', { FindWhat: 'x'.repeat(255), Match: 'start', MatchCase: 'yes', Search: 'down', OnlyCurrentField: 'no', FindFirst: 'no' }, ev));
    expect(f.find).toHaveBeenLastCalledWith({ what: 'x'.repeat(255), match: 'start', matchCase: true, search: 'down', onlyCurrentField: false, findFirst: false });
    await expect(perform(call('FindRecord', { FindWhat: 'x'.repeat(256) }, ev))).rejects.toThrow(/findWhatTooLong/);
    expect(f.find).toHaveBeenCalledTimes(2);
  });

  it('the new refusals have their own words', () => {
    const f = (detail: string) => failureMessage({ macro: 'M', action: 'GoToControl', raw: {}, code: 'actionFailed', number: 2004, detail });
    expect(f('bc:notOpen||Ferme')).toBe(i18n.t('macro.error.actionFailed', { action: i18n.t('macro.action.GoToControl'), detail: i18n.t('macro.error.notOpen', { name: 'Ferme' }) }));
    expect(f('bc:noActiveForm')).toContain(i18n.t('macro.error.noActiveForm'));
    expect(f('bc:cantFocus')).toContain(i18n.t('macro.error.cantFocus'));
  });
});

describe('failureMessage', () => {
  const f = (o: object) => ({ macro: 'M', action: 'OpenForm', raw: { FormName: 'Absent' }, code: 'actionFailed' as const, number: 2004, ...o });
  it('names the missing object, the blocked action, the select given to RunSQL', () => {
    expect(failureMessage(f({ detail: 'bc:notFound||Absent' }))).toBe(i18n.t('macro.error.notFound', { name: 'Absent' }));
    expect(failureMessage(f({ action: 'RunSQL', code: 'blocked', number: 2003 }))).toBe(i18n.t('macro.error.blocked', { action: i18n.t('macro.action.RunSQL') }));
    expect(failureMessage(f({ action: 'RunSQL', detail: 'bc:runSqlSelect' }))).toBe(i18n.t('macro.error.runSqlSelect'));
    expect(failureMessage({ macro: 'Absent', action: '', raw: {}, code: 'notFound', number: 2002, detail: 'bc:notFound' })).toContain('Absent');
  });
});
