import { expect, it, vi } from 'vitest';
import type { ActionResult, BasecraftApi } from '../../shared/api';
import { localeInfo } from '../../shared/locale-format';
import type { RecordSourceRef } from '../../shared/record-source';
import type { ConfirmOptions, ModalApi, ModalButton } from '../shell/Modal';

const actionCount = vi.fn();
const runAction = vi.fn();
const tablesList = vi.fn(async () => [{ name: 'Commandes' }]);
const cascadeChildren = vi.fn(async (_t: string): Promise<{ table: string; effect: 'deleted' | 'modified' }[]> => []);
const relationsList = vi.fn(async (): Promise<object[]> => []);
const baseState = vi.fn(async () => ({ readOnly: false }));
const getSettings = vi.fn(async () => ({ confirmActionQueries: true }));
const describe = vi.fn(async ({ name }: { name: string }) => name === 'QV' // a join (B4): Commandes, and Clients through it
  ? { fields: [], updatable: true, keyTable: 'Commandes', parameters: [], tables: [{ table: 'Commandes', role: 'key', readOnly: [], lookupBy: [] }, { table: 'Clients', role: 'one', readOnly: ['N°'], lookupBy: ['Client'] }] }
  : { fields: [], updatable: true, keyTable: name === 'QCommandes' ? 'Commandes' : 'Clients', parameters: [] });
(globalThis as unknown as { window: { basecraft: Partial<BasecraftApi> } }).window = {
  basecraft: { queries: { actionCount, runAction }, tables: { list: tablesList } as unknown as BasecraftApi['tables'],
    sources: { describe } as unknown as BasecraftApi['sources'], base: { state: baseState } as unknown as BasecraftApi['base'],
    relations: { cascadeChildren, list: relationsList } as unknown as BasecraftApi['relations'],
    app: { getSettings } as unknown as BasecraftApi['app'] },
};
const { runActionFlow, setOpenTabs } = await import('./run-action');
const { onContentBlocked } = await import('../shell/Banners');

/** Answers the confirmations and prompts in turn; records what was asked. */
function fakeModal(confirms: ModalButton[], prompts: string[] = []) {
  const asked: ConfirmOptions[] = [];
  const labels: string[] = [];
  const modal: ModalApi = {
    confirm: async (o) => { asked.push(o); return confirms.shift() ?? 'no'; },
    prompt: async (o) => { labels.push((o.labelParams as { name: string }).name); return prompts.shift() ?? null; },
    custom: async () => null,
  };
  return { modal, asked, labels };
}
const deps = (modal: ModalApi) => ({ modal, region: localeInfo('fr-FR'), showError: vi.fn(async () => {}), dispatch: vi.fn() });
const ref = { kind: 'sql', sql: 'DELETE Commandes.* FROM Commandes INNER JOIN Clients ON Clients.[N°] = Commandes.Client WHERE Ville = [V] AND Nom = [N]' } as const;

it('a select query (a saved query it reads became an action query: bc:notSelectQuery from describe) shows why, never closes silently', async () => {
  actionCount.mockReset();
  const d = deps(fakeModal([]).modal);
  await runActionFlow({ kind: 'sql', sql: 'SELECT * FROM QB' }, d);
  expect(d.showError).toHaveBeenCalledWith(new Error('bc:notSelectQuery'));
  expect(actionCount).not.toHaveBeenCalled();
});

it('asks each missing parameter, confirms the count (No by default), then runs', async () => {
  actionCount.mockReset().mockRejectedValueOnce(new Error("Error invoking remote method 'bc:queries:actionCount': Error: bc:missingParameter||V"))
    .mockRejectedValueOnce(new Error('bc:missingParameter||N')).mockResolvedValueOnce({ count: 4, table: 'Commandes' });
  runAction.mockReset().mockResolvedValueOnce({ ok: true, count: 4 } satisfies ActionResult);
  const m = fakeModal(['yes'], ['lyon', 'Dupont']);
  const d = deps(m.modal);
  expect(await runActionFlow(ref, d)).toBe('done');
  expect(m.labels).toEqual(['V', 'N']);
  expect(m.asked[0]).toMatchObject({ messageKey: 'query.action.confirm_delete', params: { count: 4 }, defaultButton: 'no' });
  expect(runAction).toHaveBeenCalledWith(ref, { V: 'lyon', N: 'Dupont' }, { skipFailures: false, replaceTable: false });
  expect(d.dispatch).toHaveBeenCalledWith({ type: 'tableDataChanged', name: 'Commandes' });
  expect(d.showError).not.toHaveBeenCalled();
});

it('No writes nothing; row errors and an existing table ask again', async () => {
  actionCount.mockReset().mockResolvedValue({ count: 2, table: 'Commandes' });
  runAction.mockReset();
  expect(await runActionFlow(ref, deps(fakeModal(['no']).modal))).toBe('cancelled'); // a macro's action fails
  expect(runAction).not.toHaveBeenCalled();

  runAction.mockResolvedValueOnce({ ok: false, reason: 'tableExists', table: 'Totaux' })
    .mockResolvedValueOnce({ ok: false, reason: 'rowErrors', failed: 1, total: 2, errors: [{ field: 'Montant', code: 'validation' }],
      byCause: { conversion: 0, key: 0, lock: 0, validation: 1 } })
    .mockResolvedValueOnce({ ok: true, count: 1 });
  const m = fakeModal(['yes', 'yes', 'yes']);
  const dd = deps(m.modal);
  await runActionFlow({ kind: 'sql', sql: 'SELECT * INTO Totaux FROM Commandes' }, dd);
  expect(dd.dispatch).toHaveBeenCalledWith({ type: 'tableSaved', name: 'Totaux' }); // its open tabs read the new table
  expect(dd.dispatch).toHaveBeenCalledWith({ type: 'queryDataChanged' });
  expect(m.asked.map((x) => x.messageKey)).toEqual(['query.action.confirm_makeTable', 'query.action.replace', 'query.action.partial']);
  expect(m.asked[2].params).toMatchObject({ total: 2, conversion: '0 fields set to Null', key: '0 records not changed', lock: '0 records not changed', validation: '1 record not changed' });
  expect(runAction.mock.calls.map((c) => c[2])).toEqual([
    { skipFailures: false, replaceTable: false }, { skipFailures: false, replaceTable: true }, { skipFailures: true, replaceTable: true },
  ]);
});

it('a declared parameter is asked with its type; a value the main process refuses is asked again', async () => {
  const validates: ((v: string) => string | null)[] = [];
  const labels: string[] = [];
  const answers = ['01/10/2026', 'x', 'lyon'];
  const modal: ModalApi = {
    confirm: async () => 'no',
    prompt: async (o) => { labels.push((o.labelParams as { name: string }).name); validates.push(o.validate!); return answers.shift() ?? null; },
    custom: async () => null,
  };
  actionCount.mockReset().mockRejectedValueOnce(new Error('bc:missingParameter||d'))
    .mockRejectedValueOnce(new Error('bc:missingParameter||V'))
    .mockRejectedValueOnce(new Error('bc:invalidParameter|invalidDate|V'))
    .mockResolvedValueOnce({ count: 1, table: 'Commandes' });
  const d = deps(modal);
  await runActionFlow({ kind: 'sql', sql: 'PARAMETERS [D] DateTime; DELETE * FROM Commandes WHERE Le > [D] AND Le < [V]' }, d);
  expect(labels).toEqual(['d', 'V', 'V']);
  expect(validates[0]!('pas une date')).toBeTruthy(); // checked as a date
  expect(validates[1]!('pas une date')).toBeNull(); // undeclared: any text
  expect(d.showError).toHaveBeenCalledTimes(1);
  expect(actionCount).toHaveBeenLastCalledWith(expect.anything(), { d: '01/10/2026', V: 'lyon' });
});

it('Make-Table replacing a table spelled another way: its open tabs take the new spelling and read the new table', async () => {
  actionCount.mockReset().mockResolvedValue({ count: 3, table: 'totaux' });
  runAction.mockReset().mockResolvedValueOnce({ ok: false, reason: 'tableExists', table: 'totaux' }).mockResolvedValueOnce({ ok: true, count: 3 });
  tablesList.mockReset().mockResolvedValueOnce([{ name: 'totaux' }]).mockResolvedValue([{ name: 'Totaux' }]);
  const d = deps(fakeModal(['yes', 'yes']).modal);
  await runActionFlow({ kind: 'sql', sql: 'SELECT * INTO Totaux FROM Commandes' }, d);
  const calls = d.dispatch.mock.calls.map((c) => c[0]);
  expect(calls.slice(0, 2)).toEqual([{ type: 'tableRenamed', from: 'totaux', to: 'Totaux' }, { type: 'tableSaved', name: 'Totaux' }]);
});

it('a target table open with a record being edited, or a Make-Table target open in a design not saved: refused, nothing run', async () => {
  const tab = (mode: 'datasheet' | 'design' | 'run', name: string) => ({ id: name + mode, kind: mode === 'run' ? 'query' as const : 'table' as const, name, mode, dirty: true, reloadToken: 0 });
  runAction.mockReset().mockResolvedValue({ ok: true, count: 1 });
  try {
    setOpenTabs(() => [tab('datasheet', 'Commandes')]);
    actionCount.mockReset().mockResolvedValue({ count: 2, table: 'Commandes' });
    const m = fakeModal(['yes']);
    await runActionFlow(ref, deps(m.modal));
    expect(m.asked.map((x) => x.messageKey)).toEqual(['query.action.inUse']);
    expect(m.asked[0].params).toMatchObject({ table: 'Commandes' });
    expect(runAction).not.toHaveBeenCalled();

    setOpenTabs(() => [tab('design', 'Totaux')]); // Make-Table replacing it
    actionCount.mockReset().mockResolvedValue({ count: 2, table: 'Totaux' });
    const m2 = fakeModal(['yes', 'yes']);
    await runActionFlow({ kind: 'sql', sql: 'SELECT * INTO Totaux FROM Commandes' }, deps(m2.modal));
    expect(m2.asked.map((x) => x.messageKey)).toEqual(['query.action.inUse']);
    expect(runAction).not.toHaveBeenCalled();

    setOpenTabs(() => [tab('run', 'QCommandes')]); // a query datasheet that writes Commandes
    actionCount.mockReset().mockResolvedValue({ count: 2, table: 'Commandes' });
    const m3 = fakeModal(['yes']);
    await runActionFlow(ref, deps(m3.modal));
    expect(m3.asked.map((x) => x.messageKey)).toEqual(['query.action.inUse']);
    expect(runAction).not.toHaveBeenCalled();

    // a design not saved does not hold an Update; another table's pending row holds nothing
    setOpenTabs(() => [tab('design', 'Commandes'), tab('datasheet', 'Clients'), tab('run', 'QClients'), { ...tab('datasheet', 'Commandes'), dirty: false }]);
    actionCount.mockReset().mockResolvedValue({ count: 2, table: 'Commandes' });
    await runActionFlow(ref, deps(fakeModal(['yes']).modal));
    expect(runAction).toHaveBeenCalledTimes(1);
  } finally {
    setOpenTabs(() => []);
  }
});

it('a form (Form or Datasheet view) with a record being edited on a source that writes the target (its own or a subform one, as the tab says): refused, nothing run', async () => {
  const T = { kind: 'table', name: 'Commandes' } as const, Q = { kind: 'query', name: 'QCommandes' } as const, C = { kind: 'table', name: 'Clients' } as const;
  const form = (name: string, mode: 'run' | 'datasheet' | 'design', dirtySources: RecordSourceRef[]) =>
    ({ id: name + mode, kind: 'form' as const, name, mode, dirty: dirtySources.length > 0, dirtySources, reloadToken: 0 });
  runAction.mockReset().mockResolvedValue({ ok: true, count: 1 });
  actionCount.mockReset().mockResolvedValue({ count: 2, table: 'Commandes' });
  try {
    // the form's record, in Form or Datasheet view; a query source that writes Commandes; a subform's row on Commandes under a clean master
    for (const tabs of [[form('FCommandes', 'run', [T])], [form('FCommandes', 'datasheet', [T])], [form('FQCommandes', 'run', [Q])], [form('FFiche', 'run', [T])]]) {
      setOpenTabs(() => tabs);
      const m = fakeModal(['yes']);
      await runActionFlow(ref, deps(m.modal));
      expect(m.asked.map((x) => x.messageKey)).toEqual(['query.action.inUse']);
      expect(m.asked[0].params).toMatchObject({ table: 'Commandes' });
    }
    expect(runAction).not.toHaveBeenCalled();
    // a form design not saved, nothing being edited, a master being edited on Clients (its Commandes subform clean): nothing held
    setOpenTabs(() => [{ ...form('FCommandes', 'design', [T]), dirtySources: undefined }, form('FCommandes', 'run', []), form('FFiche', 'run', [C])]);
    await runActionFlow(ref, deps(fakeModal(['yes']).modal));
    expect(runAction).toHaveBeenCalledTimes(1);
  } finally {
    setOpenTabs(() => []);
  }
});

it('a read-only base: refused at once (dialog.op.readOnly), before any parameter or count', async () => {
  baseState.mockResolvedValueOnce({ readOnly: true });
  actionCount.mockReset();
  runAction.mockReset();
  const m = fakeModal([]);
  await runActionFlow(ref, deps(m.modal));
  expect(m.asked.map((x) => x.messageKey)).toEqual(['dialog.op.readOnly']);
  expect(m.labels).toEqual([]);
  expect(actionCount).not.toHaveBeenCalled();
  expect(runAction).not.toHaveBeenCalled();
});

it('the tables a cascade reaches are checked too: Delete (deleted, transitively; modified), Update (Cascade Update Related Fields)', async () => {
  const pending = (name: string) => ({ id: name, kind: 'table' as const, name, mode: 'datasheet' as const, dirty: true, reloadToken: 0 });
  const children: Record<string, { table: string; effect: 'deleted' | 'modified' }[]> = {
    Clients: [{ table: 'Commandes', effect: 'deleted' }, { table: 'Visites', effect: 'modified' }],
    Commandes: [{ table: 'Lignes', effect: 'deleted' }],
    Visites: [{ table: 'Notes', effect: 'deleted' }], // never reached: a modified row is not deleted
  };
  cascadeChildren.mockImplementation(async (t) => children[t] ?? []);
  const del = { kind: 'sql', sql: 'DELETE * FROM Clients' } as const;
  const upd = { kind: 'sql', sql: 'UPDATE Clients SET [N°] = [N°] + 10' } as const;
  const run = async (r: typeof del | typeof upd, tabs: string[]) => {
    setOpenTabs(() => tabs.map(pending));
    actionCount.mockReset().mockResolvedValue({ count: 1, table: 'Clients' });
    runAction.mockReset().mockResolvedValue({ ok: true, count: 1 });
    const m = fakeModal(['yes']);
    await runActionFlow(r, deps(m.modal));
    return { asked: m.asked.map((x) => [x.messageKey, (x.params as { table?: string }).table]), ran: runAction.mock.calls.length };
  };
  try {
    expect(await run(del, ['Lignes'])).toEqual({ asked: [['query.action.inUse', 'Lignes']], ran: 0 });
    expect(await run(del, ['Visites'])).toEqual({ asked: [['query.action.inUse', 'Visites']], ran: 0 });
    expect((await run(del, ['Notes'])).ran).toBe(1);
    expect((await run(upd, ['Commandes'])).ran).toBe(1); // no relation cascades updates
    relationsList.mockResolvedValue([
      { parentTable: 'Clients', childTable: 'Commandes', enforce: true, cascadeUpdate: true },
      { parentTable: 'Commandes', childTable: 'Lignes', enforce: true, cascadeUpdate: true },
      { parentTable: 'Clients', childTable: 'Visites', enforce: true, cascadeUpdate: false },
    ]);
    expect(await run(upd, ['Lignes'])).toEqual({ asked: [['query.action.inUse', 'Lignes']], ran: 0 });
    expect((await run(upd, ['Visites'])).ran).toBe(1);
  } finally {
    setOpenTabs(() => []);
    cascadeChildren.mockReset().mockResolvedValue([]);
    relationsList.mockReset().mockResolvedValue([]);
  }
});

it('a row refused by the table rule (no field): its table-level message, never the related-records one', async () => {
  const { i18n } = await import('../i18n');
  actionCount.mockReset().mockResolvedValue({ count: 2, table: 'Commandes' });
  const refused = (e: object) => ({ ok: false, reason: 'rowErrors', failed: 1, total: 2, errors: [e], byCause: { conversion: 0, key: 0, lock: 0, validation: 1 } });
  runAction.mockReset()
    .mockResolvedValueOnce(refused({ field: '', code: 'expressionError', table: 'Commandes' }))
    .mockResolvedValueOnce(refused({ field: '', code: 'validation', table: 'Commandes' }))
    .mockResolvedValueOnce(refused({ field: '', code: 'validation', table: 'Commandes', message: 'Livraison avant commande' }));
  const messages: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    const m = fakeModal(['yes', 'no']);
    await runActionFlow({ kind: 'sql', sql: 'UPDATE Commandes SET Montant = 1' }, deps(m.modal));
    messages.push((m.asked[1]!.params as { message: string }).message);
  }
  expect(messages).toEqual([i18n.t('fieldError.tableRuleError', { table: 'Commandes' }), i18n.t('fieldError.tableRule', { table: 'Commandes', context: 'short' }),
    'Livraison avant commande']);
  expect(messages[0]).not.toBe(i18n.t('query.action.relatedRow', { table: 'Commandes' }));
});

it('content not enabled: actionCount refuses (bc:contentDisabled), the blocked message is shown, nothing else is asked or run, whatever the confirmation setting', async () => {
  for (const confirmActions of [undefined, async () => false]) { // O1: turning the count question off never lets a disabled base run
    actionCount.mockReset().mockRejectedValue(new Error("Error invoking remote method 'bc:queries:actionCount': Error: bc:contentDisabled"));
    runAction.mockReset();
    const m = fakeModal([]);
    const d = { ...deps(m.modal), confirmActions };
    let barShown = 0;
    const off = onContentBlocked(() => { barShown++; });
    expect(await runActionFlow(ref, d)).toBe('blocked');
    off();
    expect(barShown).toBe(1); // a dismissed security bar comes back: the message points at it
    expect(m.asked.map((x) => [x.messageKey, x.buttons])).toEqual([['query.action.contentDisabled', ['ok']]]);
    expect(m.labels).toEqual([]); // no parameter asked
    expect(runAction).not.toHaveBeenCalled();
    expect(d.showError).not.toHaveBeenCalled();
  }
});

it('action queries off (O1): no count question; the partial, replace and refusal questions still show', async () => {
  const off = async () => false;
  actionCount.mockReset().mockResolvedValue({ count: 2, table: 'Commandes' });
  runAction.mockReset().mockResolvedValueOnce({ ok: true, count: 2 });
  const a = fakeModal([]); // a modal.confirm would answer No
  expect(await runActionFlow(ref, { ...deps(a.modal), confirmActions: off })).toBe('done');
  expect(a.asked).toEqual([]);
  expect(runAction).toHaveBeenCalledTimes(1);

  runAction.mockReset()
    .mockResolvedValueOnce({ ok: false, reason: 'rowErrors', failed: 1, total: 2, errors: [{ field: 'Montant', code: 'validation' }],
      byCause: { conversion: 0, key: 0, lock: 0, validation: 1 } })
    .mockResolvedValueOnce({ ok: true, count: 1 });
  const b = fakeModal(['yes']);
  expect(await runActionFlow(ref, { ...deps(b.modal), confirmActions: off })).toBe('done');
  expect(b.asked.map((x) => x.messageKey)).toEqual(['query.action.partial']);
  expect(runAction.mock.calls.map((c) => c[2])).toEqual([{ skipFailures: false, replaceTable: false }, { skipFailures: true, replaceTable: false }]);

  runAction.mockReset().mockResolvedValueOnce({ ok: false, reason: 'tableExists', table: 'Totaux' }).mockResolvedValueOnce({ ok: true, count: 2 });
  const c = fakeModal(['no']);
  expect(await runActionFlow({ kind: 'sql', sql: 'SELECT * INTO Totaux FROM Commandes' }, { ...deps(c.modal), confirmActions: off })).toBe('cancelled');
  expect(c.asked.map((x) => x.messageKey)).toEqual(['query.action.replace']);

  runAction.mockReset().mockResolvedValueOnce({ ok: false, reason: 'related', table: 'Clients' });
  const e = fakeModal([]);
  expect(await runActionFlow(ref, { ...deps(e.modal), confirmActions: off })).toBe('failed');
  expect(e.asked.map((x) => x.messageKey)).toEqual(['query.action.related']);

  actionCount.mockReset().mockResolvedValue({ count: 2, table: 'Commandes' });
  runAction.mockReset();
  const w = fakeModal(['no']); // setting on, a count answered No: still asked
  expect(await runActionFlow(ref, { ...deps(w.modal), confirmActions: async () => true })).toBe('cancelled');
  expect(w.asked.map((x) => x.messageKey)).toEqual(['query.action.confirm_delete']);
  expect(runAction).not.toHaveBeenCalled();
});

it('the action queries setting is read when the count would be asked, from the window by default', async () => {
  actionCount.mockReset().mockResolvedValue({ count: 3, table: 'Commandes' });
  runAction.mockReset().mockResolvedValue({ ok: true, count: 3 });
  getSettings.mockResolvedValueOnce({ confirmActionQueries: false });
  const off = fakeModal([]);
  expect(await runActionFlow(ref, deps(off.modal))).toBe('done');
  expect(off.asked).toEqual([]);
  const on = fakeModal(['yes']); // the stub answers true again
  expect(await runActionFlow(ref, deps(on.modal))).toBe('done');
  expect(on.asked.map((x) => x.messageKey)).toEqual(['query.action.confirm_delete']);
});

it('warnings: false (SetWarnings): the count, partial and replace questions are answered Yes unseen; errors are still shown', async () => {
  actionCount.mockReset().mockResolvedValue({ count: 2, table: 'Totaux' });
  runAction.mockReset()
    .mockResolvedValueOnce({ ok: false, reason: 'tableExists', table: 'Totaux' })
    .mockResolvedValueOnce({ ok: false, reason: 'rowErrors', failed: 1, total: 2, errors: [{ field: 'Montant', code: 'validation' }],
      byCause: { conversion: 0, key: 0, lock: 0, validation: 1 } })
    .mockResolvedValueOnce({ ok: true, count: 1 });
  const m = fakeModal([]); // a modal.confirm would answer No
  await runActionFlow({ kind: 'sql', sql: 'SELECT * INTO Totaux FROM Commandes' }, { ...deps(m.modal), warnings: false });
  expect(m.asked).toEqual([]);
  expect(runAction.mock.calls.map((c) => c[2])).toEqual([
    { skipFailures: false, replaceTable: false }, { skipFailures: false, replaceTable: true }, { skipFailures: true, replaceTable: true },
  ]);

  runAction.mockReset().mockResolvedValueOnce({ ok: false, reason: 'related', table: 'Clients' });
  const e = fakeModal([]);
  await runActionFlow(ref, { ...deps(e.modal), warnings: false });
  expect(e.asked.map((x) => x.messageKey)).toEqual(['query.action.related']); // an error is shown
});

it('a dirty datasheet of a join query holds every table it writes (B4): an Update query on its one side is refused', async () => {
  setOpenTabs(() => [{ id: 'qv', kind: 'query', name: 'QV', mode: 'run', dirty: true, reloadToken: 0 }]);
  try {
    actionCount.mockReset().mockResolvedValue({ count: 1, table: 'Clients' });
    runAction.mockReset().mockResolvedValue({ ok: true, count: 1 });
    const m = fakeModal(['yes']);
    expect(await runActionFlow({ kind: 'sql', sql: 'UPDATE Clients SET Nom = "X" WHERE [N°] = 1' }, deps(m.modal))).toBe('failed');
    expect(m.asked.map((x) => [x.messageKey, x.params])).toEqual([['query.action.inUse', { table: 'Clients' }]]);
    expect(runAction).not.toHaveBeenCalled();
  } finally {
    setOpenTabs(() => []);
  }
});
