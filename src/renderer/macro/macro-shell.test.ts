import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BasecraftApi } from '../../shared/api';
import { localeInfo } from '../../shared/locale-format';
import type { MacroDef, MacroItem } from '../../shared/macro/model';
import type { ModalApi } from '../shell/Modal';
import type { DocTab } from '../state/app-state';
import type { ActionCall } from './engine';

const runActionFlow = vi.fn(async (): Promise<string> => 'done');
vi.mock('../query/run-action', () => ({ runActionFlow }));
const outputReport = vi.fn(async () => {});
vi.mock('../report/ReportPreviewView', () => ({ outputReport, layoutEnv: vi.fn(), askParameters: vi.fn() }));
const layoutSavedReport = vi.fn();
vi.mock('../report/load', () => ({ layoutSavedReport }));

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
const { clearTempVars, macroNamesWithSubs, runMacroByName, setMacroShell, shellHost } = await import('./macro-shell');
const { failureMessage } = await import('./MacroFailedDialog');
const { onContentBlocked } = await import('../shell/Banners');
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
const call = (action: string, args: Record<string, string>): ActionCall => ({ macro: 'M', action: action as ActionCall['action'], args, raw: args });
const perform = (c: ActionCall) => shellHost(d, { singleStep: false }).perform(c);

beforeEach(() => {
  vi.clearAllMocks();
  enabled = true; shown = []; macros = {};
  clearTempVars();
  setMacroShell(d);
});

describe('macro shell actions', () => {
  it('OpenForm with a condition dispatches the open arguments', async () => {
    await perform(call('OpenForm', { FormName: 'FClients', View: 'form', WhereCondition: '[Ville] = "Lyon"', DataMode: '' }));
    expect(d.dispatch).toHaveBeenCalledWith({ type: 'open', kind: 'form', name: 'FClients', mode: 'run', args: { where: '[Ville] = "Lyon"' } });
    await perform(call('OpenForm', { FormName: 'fclients', View: 'datasheet', DataMode: 'readOnly' }));   // the stored spelling
    expect(d.dispatch).toHaveBeenLastCalledWith({ type: 'open', kind: 'form', name: 'FClients', mode: 'datasheet', args: { dataMode: 'readOnly' } });
  });

  it('OpenForm in Design view takes no arguments; an open the form refuses (its record kept) fails the action', async () => {
    await perform(call('OpenForm', { FormName: 'FClients', View: 'design', WhereCondition: '[Ville] = "Lyon"', DataMode: 'edit' }));
    expect(d.dispatch).toHaveBeenLastCalledWith({ type: 'open', kind: 'form', name: 'FClients', mode: 'design' });
    d.dispatch.mockResolvedValueOnce(false as never);
    await expect(perform(call('OpenForm', { FormName: 'FClients', View: 'form', WhereCondition: '[Ville] = "Lyon"' }))).rejects.toThrow('bc:actionCancelled');
  });

  it('unknown form fails the action', async () => {
    await expect(perform(call('OpenForm', { FormName: 'Absent', View: 'form' }))).rejects.toThrow('bc:notFound');
  });

  it('OpenReport: preview with its condition, print through outputReport, design', async () => {
    await perform(call('OpenReport', { ReportName: 'Factures par client', View: 'preview', WhereCondition: '[Client] = "A"' }));
    expect(d.dispatch).toHaveBeenLastCalledWith({ type: 'open', kind: 'report', name: 'Factures par client', mode: 'run', args: { where: '[Client] = "A"' } });
    await perform(call('OpenReport', { ReportName: 'Factures par client', View: 'print', WhereCondition: '[Client] = "A"' }));
    expect(outputReport).toHaveBeenCalledWith(modal, 'Factures par client', expect.any(Function), 'printer');
    const layout = (outputReport.mock.calls[0] as unknown[])[2] as (signal: AbortSignal, ready: () => void) => Promise<unknown>;
    const signal = new AbortController().signal, ready = () => {};
    await layout(signal, ready);   // laid out with the Where Condition, as the preview
    expect(layoutSavedReport).toHaveBeenCalledWith(expect.anything(), 'Factures par client', undefined, undefined, signal, ready, '[Client] = "A"');
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

  it('names with submacros', async () => {
    macros = { N: m([act('Beep')]), M: m([act('Beep'), { k: 'submacro', name: 'S', items: [] }]) };
    expect(await macroNamesWithSubs()).toEqual(['M', 'M.S', 'N']);
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
