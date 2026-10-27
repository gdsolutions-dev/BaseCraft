import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import fr from '../../shared/i18n/fr.json';
import en from '../../shared/i18n/en.json';
import {
  MODAL_SCOPE, RIBBON, SHELL_SCOPE, commandEnabled, commandState, commandsVersion, isCommandAvailable, openPopupOf, registerCommandStates, registerCommands, runCommand,
  setActiveCommandTab, setOpenPopup,
  setCommandContext, subscribeCommands, tabAfterContextChange, visibleTabs, type CommandId, type PlannedIn, type RibbonContext, type RibbonTabId,
} from './ribbon-model';
import { parseSql } from '../../shared/query/sql-parser';

const cleanups: (() => void)[] = [];
const reg = (tab: string, h: Parameters<typeof registerCommands>[1]) => { const u = registerCommands(tab, h); cleanups.push(u); return u; };
const writableSheet: RibbonContext = { hasBase: true, readOnly: false, mode: 'datasheet', isNew: false, kind: 'table' };
beforeEach(() => setCommandContext(writableSheet));
afterEach(() => { cleanups.splice(0).forEach((u) => u()); setActiveCommandTab(null); });

describe('command registry', () => {
  it('runs the active tab handler only', () => {
    const a = vi.fn(); const b = vi.fn();
    reg('t1', { save: a }); reg('t2', { save: b });
    setActiveCommandTab('t2');
    runCommand('save');
    expect(b).toHaveBeenCalledOnce(); expect(a).not.toHaveBeenCalled();
  });

  it('falls back to shell handlers; a tab handler wins', () => {
    const shell = vi.fn(); const tab = vi.fn();
    reg(SHELL_SCOPE, { createTableDesign: shell, viewDesign: shell });
    reg('t1', { viewDesign: tab });
    setActiveCommandTab('t1');
    runCommand('createTableDesign'); runCommand('viewDesign');
    expect(shell).toHaveBeenCalledOnce(); expect(tab).toHaveBeenCalledOnce();
  });

  it('refresh is enabled only when the active document registered a handler (no shell fallback)', () => {
    setActiveCommandTab('t1');
    expect(commandEnabled('refresh', writableSheet)).toBe(false);
    reg('t1', { refresh: vi.fn() });
    expect(commandEnabled('refresh', writableSheet)).toBe(true);
    setActiveCommandTab('t2');
    expect(commandEnabled('refresh', writableSheet)).toBe(false);
  });

  it('a command without handler is unavailable and does nothing', () => {
    const h = vi.fn();
    const off = reg('t1', { sortAsc: h });
    setActiveCommandTab('t1');
    expect(isCommandAvailable('sortAsc')).toBe(true);
    expect(isCommandAvailable('sortDesc')).toBe(false);
    off();
    expect(isCommandAvailable('sortAsc')).toBe(false);
    runCommand('sortAsc');
    expect(h).not.toHaveBeenCalled();
  });

  it('a stale unregistration keeps the newer registration', () => {
    const h = vi.fn();
    const old = reg('t1', { save: vi.fn() });
    reg('t1', { save: h });
    old();
    setActiveCommandTab('t1');
    runCommand('save');
    expect(h).toHaveBeenCalledOnce();
  });

  it('notifies subscribers and bumps the version', () => {
    const cb = vi.fn();
    const unsub = subscribeCommands(cb);
    const v = commandsVersion();
    reg('t1', { save: vi.fn() });
    setActiveCommandTab('t1');
    expect(cb).toHaveBeenCalledTimes(2);
    expect(commandsVersion()).toBeGreaterThan(v);
    unsub();
  });

  it('a command whose ribbon entry is disabled is not run (keyboard paths obey the ribbon gating)', () => {
    const save = vi.fn(); const create = vi.fn();
    reg(SHELL_SCOPE, { createTableDesign: create });
    reg('t1', { save });
    setActiveCommandTab('t1');
    setCommandContext({ ...writableSheet, readOnly: true });
    runCommand('save'); runCommand('createTableDesign');
    expect(save).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
    expect(commandEnabled('save', { ...writableSheet, readOnly: true })).toBe(false);
    setCommandContext(writableSheet);
    runCommand('save'); runCommand('createTableDesign');
    expect(save).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
  });

  it('runCommand tells whether the command ran (F4 prevents the default only then)', () => {
    reg('t1', { save: () => {} });
    setActiveCommandTab('t1');
    expect(runCommand('save')).toBe(true);
    expect(runCommand('propertySheet')).toBe(false);
    setCommandContext({ ...writableSheet, readOnly: true });
    expect(runCommand('save')).toBe(false);
  });

  it('a failing handler does not throw out of runCommand', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    reg('t1', { save: () => Promise.reject(new Error('x')) });
    setActiveCommandTab('t1');
    expect(() => runCommand('save')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('ribbon model', () => {
  const ids = (tab: string) => RIBBON.find((t) => t.id === tab)!.groups.flatMap((g) => g.commands.map((c) => c.id));
  const ctx = (o: Partial<RibbonContext>): RibbonContext => ({ hasBase: true, readOnly: false, mode: null, isNew: false, kind: null, ...o });
  const cmd = (id: CommandId) => RIBBON.flatMap((t) => t.groups.flatMap((g) => g.commands)).find((c) => c.id === id)!;

  it('has the brief tabs and commands', () => {
    expect(RIBBON.filter((t) => !t.contextual).map((t) => t.id)).toEqual(['home', 'create', 'externalData', 'databaseTools', 'help']);
    expect(ids('externalData')).toContain('importText');
    const importText = cmd('importText');
    // Relationships sits where Access puts it, in Database Tools (and in Table Design and Table as well)
    expect(RIBBON.find((t) => t.id === 'databaseTools')!.groups.find((g) => g.id === 'relationships')).toMatchObject({ labelKey: 'ribbon.group.relationships' });
    expect(ids('databaseTools')).toContain('relationships');
    expect(importText.enabled(ctx({ mode: null }))).toBe(true); // a base open, no document needed
    expect(importText.enabled(ctx({ readOnly: true }))).toBe(false);
    expect(importText.enabled(ctx({ hasBase: false, mode: null }))).toBe(false);
    expect(cmd('importExcel').enabled(ctx({ mode: null }))).toBe(true);
    expect(cmd('importExcel').enabled(ctx({ readOnly: true }))).toBe(false);
    expect(cmd('compactRepair').planned).toBeUndefined(); // A6: Compact and Repair needs the write lock
    expect(cmd('compactRepair').enabled(ctx({ mode: null }))).toBe(true);
    expect(cmd('compactRepair').enabled(ctx({ readOnly: true }))).toBe(false);
    expect(cmd('compactRepair').enabled(ctx({ hasBase: false, mode: null }))).toBe(false);
    expect(ids('home')).toEqual(expect.arrayContaining(['viewDatasheet', 'viewDesign', 'newRecord', 'save', 'deleteRecord', 'sortAsc', 'sortDesc', 'sortClear']));
    expect(ids('create')).toContain('createTableDesign');
    expect(ids('design')).toEqual(expect.arrayContaining(['primaryKey', 'insertRows', 'deleteRows']));
    expect(RIBBON.find((t) => t.id === 'design')!.visible!(ctx({ mode: 'design', kind: 'table' }))).toBe(true);
    expect(RIBBON.find((t) => t.id === 'design')!.visible!(ctx({ mode: 'design', kind: 'form' }))).toBe(false); // the tables' tools only
    expect(RIBBON.find((t) => t.id === 'design')!.visible!(ctx({ mode: 'datasheet' }))).toBe(false);
  });

  it('enables commands by base, mode and read-only state', () => {
    expect(cmd('createTableDesign').enabled(ctx({}))).toBe(true);
    expect(cmd('createTableDesign').enabled(ctx({ readOnly: true }))).toBe(false);
    expect(cmd('createTableDesign').enabled(ctx({ hasBase: false }))).toBe(false);
    expect(cmd('newRecord').enabled(ctx({ mode: 'datasheet' }))).toBe(true);
    expect(cmd('newRecord').enabled(ctx({ mode: 'design' }))).toBe(false);
    expect(cmd('sortAsc').enabled(ctx({ mode: 'datasheet', readOnly: true }))).toBe(true);
    expect(cmd('primaryKey').enabled(ctx({ mode: 'design', readOnly: true }))).toBe(false);
    expect(cmd('viewDesign').enabled(ctx({ mode: 'datasheet' }))).toBe(true);
    expect(cmd('viewDesign').enabled(ctx({ mode: null }))).toBe(false);
    expect(cmd('viewDatasheet').enabled(ctx({ mode: 'design' }))).toBe(true);
    expect(cmd('viewDatasheet').enabled(ctx({ mode: 'design', isNew: true }))).toBe(false); // a table not saved yet has no data
  });

  it('refresh (Shift+F9): Home tab, Records group; on a datasheet or a Run view, never in Design view', () => {
    const records = RIBBON.find((t) => t.id === 'home')!.groups.find((g) => g.labelKey === 'ribbon.group.records')!;
    expect(records.commands.map((c) => c.id)).toContain('refresh');
    expect(cmd('refresh').enabled(ctx({ mode: 'datasheet', kind: 'table' }))).toBe(true);
    expect(cmd('refresh').enabled(ctx({ mode: 'run', kind: 'report', readOnly: true }))).toBe(true);
    expect(cmd('refresh').enabled(ctx({ mode: 'design', kind: 'table' }))).toBe(false);
    expect(cmd('refresh').enabled(ctx({ mode: null }))).toBe(false);
  });

  it('record and sort commands: a datasheet, or a query or form in Run view; no view switch for the Relations window', () => {
    for (const id of ['newRecord', 'deleteRecord', 'sortAsc', 'sortDesc', 'sortClear', 'filter', 'filterSelection', 'filterAdvanced', 'filterToggle'] as const) {
      expect(cmd(id).enabled(ctx({ mode: 'run', kind: 'query' })), id).toBe(true);
      expect(cmd(id).enabled(ctx({ mode: 'run', kind: 'form' })), id).toBe(true);
      expect(cmd(id).enabled(ctx({ mode: 'run', kind: 'report' })), id).toBe(false);
      expect(cmd(id).enabled(ctx({ mode: 'design', kind: 'form' })), id).toBe(false);
    }
    expect(cmd('newRecord').enabled(ctx({ mode: 'run', kind: 'form', readOnly: true }))).toBe(false);
    expect(cmd('sortAsc').enabled(ctx({ mode: 'run', kind: 'query', readOnly: true }))).toBe(true);
    for (const id of ['viewDatasheet', 'viewDesign'] as const) {
      expect(cmd(id).enabled(ctx({ mode: 'run', kind: 'relations' })), id).toBe(false);
      expect(cmd(id).enabled(ctx({ mode: 'run', kind: 'report' })), id).toBe(true);
    }
  });

  it('Relationship Design (A2-R16): shown for the Relations window only, with the foundation catalog ids in Access order', () => {
    const tab = RIBBON.find((t) => t.id === 'relationshipDesign')!;
    const relations = ctx({ kind: 'relations', mode: 'run' });
    expect(tab.contextual).toBe(true);
    expect(tab.visible!(relations)).toBe(true);
    expect(tab.visible!(ctx({ kind: 'table', mode: 'design' }))).toBe(false);
    expect(RIBBON.find((t) => t.id === 'design')!.visible!(relations)).toBe(false);
    expect(tab.groups.map((g) => [g.id, g.commands.map((c) => c.id)])).toEqual([
      ['tools', ['editRelationships', 'clearLayout', 'relationshipReport']],
      ['relationships', ['addTables', 'hideTable', 'directRelationships', 'allRelationships', 'closeRelationships']],
    ]);
    // Table Design opens the window too
    expect(RIBBON.find((t) => t.id === 'design')!.groups.at(-1)).toMatchObject({ id: 'relationships', labelKey: 'ribbon.group.relationships' });
    expect(ids('design')).toContain('relationships');
    expect(cmd('relationships').enabled(ctx({ kind: 'table', mode: 'design', readOnly: true }))).toBe(true);
    expect(cmd('relationships').enabled(ctx({ hasBase: false }))).toBe(false);
  });

  it('Relations window: the layout stays usable in read-only, relations do not; no view switch', () => {
    const relations = ctx({ kind: 'relations', mode: 'run' });
    const ro = { ...relations, readOnly: true };
    for (const id of ['clearLayout', 'addTables', 'hideTable', 'directRelationships', 'allRelationships', 'closeRelationships'] as const) {
      expect(cmd(id).enabled(ro), id).toBe(true);
      expect(cmd(id).enabled(ctx({ kind: 'table', mode: 'datasheet' })), id).toBe(false);
    }
    expect(cmd('editRelationships').enabled(relations)).toBe(true);
    expect(cmd('editRelationships').enabled(ro)).toBe(false);
    expect(cmd('viewDesign').enabled(relations)).toBe(false);
    expect(cmd('viewDatasheet').enabled(relations)).toBe(false);
  });
});

const FORMAT_DONE = ['objectList', 'selectAll', 'font', 'fontSize', 'bold', 'italic', 'underline', 'fontColor', 'backColor', 'alignLeft', 'alignCenter', 'alignRight',
  'format', 'currencyFormat', 'percentFormat', 'commaFormat', 'increaseDecimals', 'decreaseDecimals', 'shapeFill', 'shapeOutline'] as const;
const GALLERY_DONE = ['select', 'textBox', 'label', 'button', 'tabControl', 'optionGroup', 'insertPageBreak', 'comboBox', 'line', 'listBox', 'rectangle',
  'checkBox', 'optionButton', 'subform', 'image'] as const;
const HEADER_DONE = ['logo', 'title', 'dateTime'] as const;

describe('ribbon catalog (C11: every Access tab, group and command; placeholders name their batch)', () => {
  const PLANNED: PlannedIn[] = ['A3', 'A4', 'A5', 'A6', 'B1', 'B2', 'B3', 'B4', 'B5', 'C', 'D', 'E', 'later']; // A2 is merged: nothing waits for it
  const get = (o: unknown, k: string) => k.split('.').reduce<unknown>((a, p) => (a as Record<string, unknown> | undefined)?.[p], o);
  const commands = RIBBON.flatMap((t) => t.groups.flatMap((g) => g.commands));
  const ctx = (o: Partial<RibbonContext>): RibbonContext => ({ hasBase: true, readOnly: false, mode: null, isNew: false, kind: null, ...o });
  const kinds = [null, 'table', 'query', 'form', 'report', 'relations', 'macro'] as const;
  const modes = [null, 'design', 'datasheet', 'run'] as const;
  const contexts = kinds.flatMap((kind) => modes.map((mode) => ctx({ kind, mode })));

  it('A6 leaves no A6 placeholder', () => {
    expect(commands.filter((c) => c.planned === 'A6').map((c) => c.id)).toEqual([]);
  });

  it('B1 leaves no B1 placeholder', () => {
    expect(commands.filter((c) => c.planned === 'B1').map((c) => c.id)).toEqual([]);
  });

  it('B2 leaves no B2 placeholder; the Event tab is delivered in place', () => {
    expect(commands.filter((c) => c.planned === 'B2').map((c) => c.id)).toEqual([]);
    expect((fr.sheet as Record<string, unknown>).eventsLater).toBeUndefined();
    expect((en.sheet as Record<string, unknown>).eventsLater).toBeUndefined();
    const tag = (id: CommandId) => commands.find((c) => c.id === id)?.planned;
    expect([tag('crosstabQuery'), tag('createModule'), tag('viewCode')]).toEqual([undefined, 'D', 'D']);   // crosstabQuery delivered in B4 Task 8
  });

  it('B3 leaves no B3 placeholder', () => {
    expect(commands.filter((c) => c.planned === 'B3').map((c) => c.id)).toEqual([]);
    const tag = (id: CommandId) => commands.find((c) => c.id === id)?.planned;
    expect([tag('crosstabQuery'), tag('createModule'), tag('viewCode')]).toEqual([undefined, 'D', 'D']);   // crosstabQuery delivered in B4 Task 8
  });

  it('B4 leaves no B4 placeholder', () => {
    expect(commands.filter((c) => c.planned === 'B4').map((c) => c.id)).toEqual([]);
    expect(commands.find((c) => c.id === 'crosstabQuery')?.planned).toBeUndefined();
  });

  it('A3\'s refusal of TRANSFORM is gone', () => expect(() => parseSql('TRANSFORM Count(*) SELECT a FROM T GROUP BY a PIVOT b')).not.toThrow());

  it('every tab, group and command has a French and an English label; every batch has its tooltip', () => {
    const keys = [
      ...RIBBON.map((t) => t.labelKey), ...RIBBON.flatMap((t) => t.groups.map((g) => g.labelKey)), ...commands.map((c) => c.labelKey),
      ...PLANNED.map((p) => `ribbon.planned.${p}`),
    ];
    for (const k of keys) for (const cat of [fr, en]) expect(typeof get(cat, k) === 'string' && get(cat, k) !== '', k).toBe(true);
    expect(fr.ribbon.planned.A3).toBe('Prévu dans le lot A3 — Requêtes');
    expect(en.ribbon.planned.A5).toBe('Planned for batch A5 — Reports');
    expect(en.ribbon.planned.later).toBe('Planned for later');
  });

  it('stage B placeholders name their batch', () => {
    const tag = (id: CommandId) => commands.find((c) => c.id === id)?.planned;
    expect(tag('createMacro')).toBeUndefined(); expect(tag('macroRun')).toBeUndefined(); expect(tag('crosstabQuery')).toBeUndefined();
    expect(tag('beforeChange')).toBe('later'); expect(commands.some((c) => (c.planned as string) === 'B')).toBe(false);
    expect(fr.ribbon.planned.B1).toBe('Prévu dans le lot B1 — Macros et sécurité');
  });

  it('a placeholder has a valid batch and is never enabled; the implemented commands are not placeholders', () => {
    const planned = commands.filter((c) => c.planned !== undefined);
    expect(planned.length).toBeGreaterThan(130);
    for (const c of planned) {
      expect(PLANNED, c.id).toContain(c.planned);
      for (const x of contexts) expect(c.enabled(x), c.id).toBe(false);
    }
    const done = ['save', 'viewDesign', 'viewDatasheet', 'createTableDesign', 'primaryKey', 'newRecord', 'deleteRecord', 'sortAsc', 'sortDesc',
      'sortClear', 'importText', 'refresh',
      // A2 (merged into the foundation, step 2)
      'filter', 'filterSelection', 'filterAdvanced', 'filterToggle', 'relationships', 'testValidationRules', 'editRelationships', 'clearLayout',
      'hideTable', 'directRelationships', 'allRelationships', 'closeRelationships',
      // foundation step 2
      'tableProperties',
      // A4
      'sizeSpace', 'align', 'bringToFront', 'sendToBack', 'viewForm', 'createFormDesign', 'addExistingFields', 'propertySheet', 'tabOrder',
      ...FORMAT_DONE, 'createBlankForm', ...GALLERY_DONE, ...HEADER_DONE, 'createForm',
      // A3 Task 8: the query designer
      'createQueryDesign', 'runQuery', 'selectQuery', 'makeTableQuery', 'appendQuery', 'updateQuery', 'deleteQuery', 'addTables',
      'insertColumns', 'deleteColumns', 'queryTotals', 'builder',
      // B4 Task 8
      'crosstabQuery',
      // A5 Task 12
      'viewPrintPreview', 'createReportDesign', 'createBlankReport', 'pageSize', 'margins', 'portrait', 'landscape', 'morePages',
      // A5 Task 13
      'groupSort', 'reportTotals', 'hideDetails', 'pageNumbers',
      // A6 Task 8
      'dataType', 'validation', 'required', 'unique', 'indexed', 'find', 'goTo', 'selectMenu',
      // B1 Task 9
      'createMacro'];

    // the same ids stay other batches' placeholders in their own tabs (A6 Table Design and Table Fields, A3 Query Design, A5 Report Design)
    const elsewhere: Record<string, RibbonTabId[]> = { propertySheet: ['design', 'queryDesign', 'reportDesign'], addExistingFields: ['reportDesign'],
      ...Object.fromEntries([...GALLERY_DONE, ...HEADER_DONE].map((id) => [id, ['reportDesign']])) };
    const shownIn = (id: string) => RIBBON.filter((t) => !elsewhere[id]?.includes(t.id)).flatMap((t) => t.groups.flatMap((g) => g.commands)).filter((c) => c.id === id);
    for (const id of done) expect(shownIn(id).every((c) => c.planned === undefined), id).toBe(true);
    const tableProperties = RIBBON.find((t) => t.id === 'table')!.groups[0]!.commands[0]!;
    expect(tableProperties.id).toBe('tableProperties');
    expect(tableProperties.enabled(ctx({ kind: 'table', mode: 'datasheet' }))).toBe(true);
    expect(tableProperties.enabled(ctx({ kind: 'table', mode: 'datasheet', readOnly: true }))).toBe(true); // shown read-only
    expect(tableProperties.enabled(ctx({ kind: 'query', mode: 'run' }))).toBe(false);
    // builder and addTables: done in Table Design, the Relations window and (A3 Task 8) Query Design
    const inTab = (tab: RibbonTabId, id: CommandId) => RIBBON.find((t) => t.id === tab)!.groups.flatMap((g) => g.commands).filter((c) => c.id === id).map((c) => c.planned);
    expect(inTab('design', 'builder')).toEqual([undefined]);
    expect(inTab('relationshipDesign', 'addTables')).toEqual([undefined]);
    expect(inTab('queryDesign', 'builder')).toEqual([undefined]);
    expect(inTab('queryDesign', 'addTables')).toEqual([undefined]);
    expect(RIBBON.find((t) => t.id === 'create')!.groups.flatMap((g) => g.commands.map((c) => c.id))).toEqual(expect.arrayContaining(['createTableDesign', 'createQueryDesign']));
    const created = RIBBON.find((t) => t.id === 'create')!.groups.flatMap((g) => g.commands).find((c) => c.id === 'createQueryDesign')!;
    expect(created.enabled(ctx({}))).toBe(true);
    expect(created.enabled(ctx({ readOnly: true }))).toBe(false);
    // Query Design: the grid commands in a writable design, Run, SQL View and Table Names in any design (Task 9: no A3
    // placeholder left)
    const qd = RIBBON.find((t) => t.id === 'queryDesign')!.groups.flatMap((g) => g.commands);
    for (const id of ['selectQuery', 'makeTableQuery', 'appendQuery', 'updateQuery', 'crosstabQuery', 'deleteQuery', 'addTables', 'insertColumns', 'deleteColumns', 'queryTotals', 'builder',
      'unionQuery', 'insertRows', 'deleteRows', 'returnValues', 'parameters', 'propertySheet']) {
      const c = qd.find((x) => x.id === id)!;
      expect(c.enabled(ctx({ kind: 'query', mode: 'design' })), id).toBe(true);
      expect(c.enabled(ctx({ kind: 'query', mode: 'design', readOnly: true })), id).toBe(false);
    }
    expect(qd.find((x) => x.id === 'runQuery')!.enabled(ctx({ kind: 'query', mode: 'design', readOnly: true }))).toBe(true);
    for (const id of ['viewSql', 'tableNames']) expect(qd.find((x) => x.id === id)!.enabled(ctx({ kind: 'query', mode: 'design', readOnly: true })), id).toBe(true);
    expect(qd.find((x) => x.id === 'viewSql')!.enabled(ctx({ kind: 'query', mode: 'run' }))).toBe(true); // the datasheet's status bar
    expect(RIBBON.flatMap((t) => t.groups.flatMap((g) => g.commands)).filter((c) => c.planned === 'A3').map((c) => c.id)).toEqual([]);
    const sqlQuery = RIBBON.find((t) => t.id === 'create')!.groups.flatMap((g) => g.commands).find((c) => c.id === 'createSqlQuery')!;
    expect([sqlQuery.planned, sqlQuery.enabled(ctx({})), sqlQuery.enabled(ctx({ readOnly: true }))]).toEqual([undefined, true, false]);
    // insertRows / deleteRows: Table Design's rows and (Task 9) Query Design's criteria rows
    const design = RIBBON.find((t) => t.id === 'design')!.groups.flatMap((g) => g.commands);
    expect(design.filter((c) => c.id === 'insertRows' || c.id === 'deleteRows').map((c) => c.planned)).toEqual([undefined, undefined]);
  });

  it('A5 Task 8: the Print Preview tab, only for a report in run mode, delivers zoom, pages, page setup and close; print and PDF (Task 9)', () => {
    const tab = RIBBON.find((t) => t.id === 'printPreview')!;
    const run: RibbonContext = { hasBase: true, readOnly: false, mode: 'run', isNew: false, kind: 'report' };
    expect(tab.visible!(run)).toBe(true);
    expect(tab.visible!({ ...run, kind: 'form' })).toBe(false);
    expect(tab.visible!({ ...run, mode: 'design' })).toBe(false);
    const cmd = (id: CommandId) => tab.groups.flatMap((g) => g.commands).find((c) => c.id === id)!;
    for (const id of ['previewZoom', 'onePage', 'twoPages', 'pageSetupDialog', 'closePreview'] as CommandId[]) {
      expect(cmd(id).planned, id).toBeUndefined();
      expect(cmd(id).enabled(run), id).toBe(true);
    }
    expect(cmd('pageSetupDialog').enabled({ ...run, readOnly: true })).toBe(false); // the definition cannot be saved
    expect(cmd('closePreview').enabled({ ...run, readOnly: true })).toBe(true);
    // Task 9: print and PDF export, also on a read-only base (they write nothing into it)
    for (const id of ['print', 'exportPdf'] as CommandId[]) {
      expect(cmd(id).planned, id).toBeUndefined();
      expect(cmd(id).enabled({ ...run, readOnly: true }), id).toBe(true);
    }
    // record and sort commands stay off for a report (C3)
    for (const id of ['newRecord', 'deleteRecord', 'sortAsc', 'sortDesc', 'sortClear'] as CommandId[]) {
      const home = RIBBON.find((t) => t.id === 'home')!.groups.flatMap((g) => g.commands).find((c) => c.id === id)!;
      expect(home.enabled(run), id).toBe(false);
    }
  });

  it('report design: viewPrintPreview, activated controls, later re-tags', () => {
    const inTab = (tab: RibbonTabId, id: CommandId) => RIBBON.find((t) => t.id === tab)!.groups.flatMap((g) => g.commands).filter((c) => c.id === id).map((c) => c.planned);
    const entry = (tab: RibbonTabId, id: CommandId) => RIBBON.find((t) => t.id === tab)!.groups.flatMap((g) => g.commands).find((c) => c.id === id)!;
    expect(inTab('reportDesign', 'viewDatasheet')).toEqual([]);
    expect(inTab('reportDesign', 'viewPrintPreview')).toEqual([undefined]);
    expect(inTab('reportDesign', 'textBox')).toEqual([undefined]);
    expect(inTab('reportDesign', 'button')).toEqual(['later']);
    expect(inTab('pageSetup', 'showMargins')).toEqual(['later']);
    expect(inTab('printPreview', 'portrait')).toEqual([undefined]);
    expect(inTab('relationshipDesign', 'relationshipReport')).toEqual(['later']);
    for (const id of ['tabControl', 'optionGroup', 'listBox', 'subform'] as CommandId[]) expect(inTab('reportDesign', id), id).toEqual(['later']);
    for (const id of ['select', 'label', 'insertPageBreak', 'comboBox', 'line', 'rectangle', 'checkBox', 'optionButton', 'image', 'addExistingFields', 'propertySheet'] as CommandId[]) {
      expect(inTab('reportDesign', id), id).toEqual([undefined]);
    }
    expect(inTab('formDesign', 'textBox')).toEqual([undefined]); // A4's own entry (delivered by A4)
    const design = ctx({ kind: 'report', mode: 'design' }), ro = { ...design, readOnly: true };
    expect(entry('reportDesign', 'textBox').enabled(design)).toBe(true);
    expect(entry('reportDesign', 'textBox').enabled(ro)).toBe(false);
    expect(entry('reportDesign', 'propertySheet').enabled(ro)).toBe(true); // shown read-only
    const preview = entry('reportDesign', 'viewPrintPreview');
    expect(preview.enabled(design)).toBe(true);
    expect(preview.enabled(ro)).toBe(true);
    expect(preview.enabled({ ...design, isNew: true })).toBe(false);
    expect(preview.active!(ctx({ kind: 'report', mode: 'run' }))).toBe(true);
    expect(preview.active!(design)).toBe(false);
    for (const tab of ['pageSetup', 'printPreview'] as RibbonTabId[]) {
      for (const id of ['pageSize', 'margins', 'portrait', 'landscape'] as CommandId[]) expect(entry(tab, id).enabled(ro), id).toBe(false);
      expect(entry(tab, 'margins').popup).toBe(true);
      expect(entry(tab, 'pageSize').popup).toBe(true);
    }
    expect(entry('printPreview', 'morePages')).toMatchObject({ popup: true });
    expect(entry('printPreview', 'morePages').enabled({ ...ctx({ kind: 'report', mode: 'run' }), readOnly: true })).toBe(true);
    expect(entry('create', 'createReportDesign').enabled(ctx({}))).toBe(true);
    expect(entry('create', 'createBlankReport').enabled(ctx({ readOnly: true }))).toBe(false);
  });

  it('report design (A5 Task 13): grouping, totals, header/footer items; no A5 placeholder left in the report tabs', () => {
    const tab = (id: RibbonTabId) => RIBBON.find((t) => t.id === id)!.groups.flatMap((g) => g.commands);
    const entry = (id: CommandId) => tab('reportDesign').find((c) => c.id === id)!;
    const design = ctx({ kind: 'report', mode: 'design' }), ro = { ...design, readOnly: true };
    for (const id of ['groupSort', 'reportTotals', 'hideDetails', 'pageNumbers', 'logo', 'title', 'dateTime'] as CommandId[]) {
      expect(entry(id).planned, id).toBeUndefined();
      expect(entry(id).enabled(design), id).toBe(true);
      expect(entry(id).enabled(ro), id).toBe(id === 'groupSort');   // the pane opens read-only
      expect(entry(id).enabled(ctx({ kind: 'form', mode: 'design' })), id).toBe(false);
    }
    expect(entry('reportTotals').popup).toBe(true);
    for (const id of ['reportDesign', 'pageSetup'] as RibbonTabId[]) expect(tab(id).filter((c) => c.planned === 'A5').map((c) => c.id), id).toEqual([]);
    expect(tab('formDesign').filter((c) => ['logo', 'title', 'dateTime'].includes(c.id)).map((c) => c.planned)).toEqual([undefined, undefined, undefined]); // delivered by A4
  });

  it('creates no item marked "never"', () => {
    const never = ['dataverse', 'dataverseExport', 'sharePointLists', 'moveToSharePoint', 'convertMacros', 'memoSettings', 'quickStyles',
      'changeShape', 'shapeEffects', 'applicationParts', 'classModule', 'createClassModule', 'addIns', 'exportEmail', 'wordMerge',
      'dataDefinitionQuery', 'dataDefinition', 'edgeBrowser'];
    const ids = new Set(commands.map((c) => c.id as string));
    for (const id of never) expect(ids.has(id), id).toBe(false);
    expect(RIBBON.find((t) => t.id === 'reportDesign')!.groups.flatMap((g) => g.commands.map((c) => c.id))).not.toContain('tabOrder');
    expect(RIBBON.flatMap((t) => t.groups.map((g) => g.id))).not.toContain('addIns');
  });

  it('within one context, a command id has one batch and one enable rule', () => {
    for (const x of contexts) {
      const seen = new Map<string, { planned?: PlannedIn; enabled: unknown }>();
      for (const c of visibleTabs(x).flatMap((t) => t.groups.flatMap((g) => g.commands))) {
        const first = seen.get(c.id);
        if (!first) { seen.set(c.id, c); continue; }
        expect(c.planned, `${c.id} in ${x.kind}/${x.mode}`).toBe(first.planned);
        expect(c.enabled, `${c.id} in ${x.kind}/${x.mode}`).toBe(first.enabled);
      }
    }
  });

  it('the Query Builder: only Home and its contextual tabs, its Close group; its scope never falls back on the shell', () => {
    const builder = ctx({ kind: 'query', mode: 'design', builder: true });
    expect(visibleTabs(builder).map((t) => t.id)).toEqual(['home', 'queryDesign']);
    const groups = (c: RibbonContext) => RIBBON.find((t) => t.id === 'queryDesign')!.groups.filter((g) => !g.visible || g.visible(c)).map((g) => g.id);
    expect(groups(builder)).toContain('builderClose');
    expect(groups(ctx({ kind: 'query', mode: 'design' }))).not.toContain('builderClose');
    const shell = vi.fn(), own = vi.fn();
    reg(SHELL_SCOPE, { viewDesign: shell, save: shell });
    reg(MODAL_SCOPE, { viewDesign: own });
    setCommandContext(ctx({ kind: 'query', mode: 'run', builder: true }));
    setActiveCommandTab(`${MODAL_SCOPE}builder-run`);
    expect(runCommand('viewDesign')).toBe(true);
    expect(runCommand('save')).toBe(false);   // the shell would save the form behind
    expect(own).toHaveBeenCalledTimes(1);
    expect(shell).not.toHaveBeenCalled();
    setActiveCommandTab(null);
  });

  it('group ids and command ids are unique within a tab (one tab is rendered at a time: DOM ids rtip-<id>, test ids cmd-<id>)', () => {
    for (const t of RIBBON) {
      expect(new Set(t.groups.map((g) => g.id)).size, t.id).toBe(t.groups.length);
      const ids = t.groups.flatMap((g) => g.commands.map((c) => c.id));
      expect(new Set(ids).size, t.id).toBe(ids.length);
    }
  });

  it('the controls and header/footer galleries keep their owner per tab (A4 delivers the form ones without touching the report ones)', () => {
    const owners = (tab: RibbonTabId, group: string) =>
      new Set(RIBBON.find((t) => t.id === tab)!.groups.filter((g) => g.id === group).flatMap((g) => g.commands.map((c) => c.planned)));
    expect(owners('formDesign', 'controls')).toEqual(new Set([undefined, 'later']));
    expect(owners('reportDesign', 'controls')).toEqual(new Set([undefined, 'later']));
    expect(owners('formDesign', 'headerFooter')).toEqual(new Set([undefined]));
    expect(owners('reportDesign', 'headerFooter')).toEqual(new Set([undefined]));
  });

  it('Arrange › Sizing & Ordering is delivered (A4): a writable form or report in Design view', () => {
    const cmd = (id: CommandId) => commands.find((c) => c.id === id)!;
    for (const id of ['sizeSpace', 'align', 'bringToFront', 'sendToBack'] as const) {
      expect(cmd(id).planned, id).toBeUndefined();
      expect(cmd(id).enabled(ctx({ mode: 'design', kind: 'form' })), id).toBe(true);
      expect(cmd(id).enabled(ctx({ mode: 'design', kind: 'report' })), id).toBe(true);
      expect(cmd(id).enabled(ctx({ mode: 'design', kind: 'form', readOnly: true })), id).toBe(false);
    }
    expect(['sizeSpace', 'align', 'bringToFront', 'sendToBack'].map((id) => cmd(id as CommandId).popup)).toEqual([true, true, undefined, undefined]); });

  it('Macro Design (B1): the eight commands delivered, enabled in Design view of a macro (read-only too); Expand / Collapse Actions need a selection', () => {
    const ids: CommandId[] = ['macroRun', 'singleStep', 'expandActions', 'collapseActions', 'expandAll', 'collapseAll', 'actionCatalog', 'showAllActions'];
    const tab = RIBBON.find((t) => t.id === 'macroDesign')!.groups.flatMap((g) => g.commands);
    const handlers = Object.fromEntries(ids.map((id) => [id, () => {}]));
    reg('m1', handlers);
    setActiveCommandTab('m1');
    cleanups.push(registerCommandStates('m1', { expandActions: { enabled: false }, collapseActions: { enabled: false } }));
    for (const ro of [false, true]) {
      const c = ctx({ kind: 'macro', mode: 'design', readOnly: ro });
      expect(ids.filter((id) => commandEnabled(id, c)), String(ro)).toEqual(ids.filter((id) => id !== 'expandActions' && id !== 'collapseActions'));
    }
    expect(tab.filter((c) => c.planned !== undefined).map((c) => c.id)).toEqual([]);
    expect(tab.filter((c) => c.active).map((c) => c.id)).toEqual(['singleStep', 'actionCatalog', 'showAllActions']);
    expect(tab.every((c) => !c.enabled(ctx({ kind: 'form', mode: 'design' })))).toBe(true);
    cleanups.push(registerCommandStates('m1', {}));
    expect(commandEnabled('expandActions', ctx({ kind: 'macro', mode: 'design' }))).toBe(true);
    // an embedded macro (R16): no Run, no Single Step, the rest as usual
    expect(ids.filter((id) => commandEnabled(id, ctx({ kind: 'macro', mode: 'design', embedded: true })))).toEqual(ids.filter((id) => id !== 'macroRun' && id !== 'singleStep'));
  });

  it('View › Form View (A4): a saved form, in Design or Datasheet view; active in Form view', () => {
    const v = commands.find((c) => c.id === 'viewForm')!;
    expect(v.enabled(ctx({ kind: 'form', mode: 'design' }))).toBe(true); expect(v.enabled(ctx({ kind: 'form', mode: 'design', isNew: true }))).toBe(false);
    expect(v.enabled(ctx({ kind: 'table', mode: 'datasheet' }))).toBe(false);
    expect(v.active!(ctx({ kind: 'form', mode: 'run' }))).toBe(true); expect(v.active!(ctx({ kind: 'form', mode: 'design' }))).toBe(false); });

  it('a form tells Form view from Datasheet view', () => {
    const ds = RIBBON.find((t) => t.id === 'home')!.groups[0]!.commands.find((c) => c.id === 'viewDatasheet')!;
    expect(ds.active!(ctx({ kind: 'form', mode: 'datasheet' }))).toBe(true); expect(ds.active!(ctx({ kind: 'form', mode: 'run' }))).toBe(false);
    expect(ds.active!(ctx({ kind: 'query', mode: 'run' }))).toBe(true); expect(ds.active!(ctx({ kind: 'table', mode: 'datasheet' }))).toBe(true);
    expect(ds.active!(ctx({ kind: 'report', mode: 'run' }))).toBe(false); });   // a report's Print Preview is no datasheet

  it('Home › View shows the views of the active object only (Access): Form View only for a form, Print Preview only for a report', () => {
    const view = RIBBON.find((t) => t.id === 'home')!.groups[0]!.commands;
    const shown = (o: Partial<RibbonContext>) => view.filter((c) => !c.visible || c.visible(ctx(o))).map((c) => c.id);
    expect(shown({ kind: 'form', mode: 'run' })).toEqual(['viewForm', 'viewDatasheet', 'viewDesign']);
    expect(shown({ kind: 'table', mode: 'datasheet' })).toEqual(['viewDatasheet', 'viewDesign']);
    expect(shown({ kind: 'query', mode: 'design' })).toEqual(['viewDatasheet', 'viewDesign']);
    expect(shown({})).toEqual(['viewDatasheet', 'viewDesign']);   // no document: disabled
    expect(shown({ kind: 'report', mode: 'run' })).toEqual(['viewPrintPreview', 'viewDesign']);   // a report has no datasheet
    expect(shown({ kind: 'macro', mode: 'design' })).toEqual(['viewDesign']);   // nor a macro
    expect(view.find((c) => c.id === 'viewDatasheet')!.enabled(ctx({ kind: 'macro', mode: 'design' }))).toBe(false);
  });

  it('Create › Form is delivered (A4)', () => {
    const cmd = (id: CommandId) => commands.find((c) => c.id === id)!;
    expect(cmd('createForm').planned).toBeUndefined(); expect(cmd('createForm').enabled(ctx({}))).toBe(true);
    expect(cmd('createForm').enabled(ctx({ readOnly: true }))).toBe(false); expect(cmd('createForm').enabled(ctx({ hasBase: false }))).toBe(false);
  });

  it('Create › Macro is delivered (B1), in the same group and slot', () => {
    const create = RIBBON.find((t) => t.id === 'create')!;
    const macros = create.groups.find((g) => g.id === 'macrosCode')!.commands;
    const cmd = macros.find((c) => c.id === 'createMacro')!;
    expect(macros.map((c) => c.id)).toEqual(['createMacro', 'createModule', 'pythonEditor']);
    expect(cmd.planned).toBeUndefined(); expect(cmd.enabled(ctx({}))).toBe(true);
    expect(cmd.enabled(ctx({ readOnly: true }))).toBe(false); expect(cmd.enabled(ctx({ hasBase: false }))).toBe(false);
  });

  it('Create › Form Design and the Form Design tools are delivered (A4); the tools open read-only too', () => {
    const inTab = (tab: RibbonTabId, id: CommandId) => RIBBON.find((t) => t.id === tab)!.groups.flatMap((g) => g.commands).find((c) => c.id === id)!;
    expect(inTab('create', 'createFormDesign').enabled(ctx({}))).toBe(true);
    expect(inTab('create', 'createFormDesign').enabled(ctx({ readOnly: true }))).toBe(false);
    for (const id of ['addExistingFields', 'propertySheet', 'tabOrder'] as const) {
      const c = inTab('formDesign', id);
      expect(c.planned, id).toBeUndefined();
      expect(c.enabled(ctx({ kind: 'form', mode: 'design', readOnly: true })), id).toBe(true);
      expect(c.enabled(ctx({ kind: 'report', mode: 'design' })), id).toBe(false);
    }
    expect(inTab('reportDesign', 'propertySheet').planned).toBeUndefined();   // the report's own entry, delivered by A5
  });

  it('Format and Create › Blank Form are delivered (A4); Subform in New Window is later', () => {
    const inTab = (tab: RibbonTabId, id: CommandId) => RIBBON.find((t) => t.id === tab)!.groups.flatMap((g) => g.commands).filter((c) => c.id === id).map((c) => c.planned);
    for (const id of FORMAT_DONE) expect(inTab('format', id), id).toEqual([undefined]);
    expect(inTab('tableFields', 'format')).toEqual([undefined]);   // delivered in Table Fields too (A6 Task 8)
    expect(inTab('create', 'createBlankForm')).toEqual([undefined]); expect(inTab('formDesign', 'subformInNewWindow')).toEqual(['later']);
    const bold = RIBBON.find((t) => t.id === 'format')!.groups.flatMap((g) => g.commands).find((c) => c.id === 'bold')!;
    expect(bold.enabled(ctx({ mode: 'design', kind: 'form' }))).toBe(true); expect(bold.enabled(ctx({ mode: 'design', kind: 'form', readOnly: true }))).toBe(false);
    const selectAll = commands.find((c) => c.id === 'selectAll')!;
    expect(selectAll.enabled(ctx({ mode: 'design', kind: 'report', readOnly: true }))).toBe(true);   // selecting works read-only
    const blank = commands.find((c) => c.id === 'createBlankForm')!;
    expect(blank.enabled(ctx({}))).toBe(true); expect(blank.enabled(ctx({ readOnly: true }))).toBe(false); expect(blank.enabled(ctx({ hasBase: false }))).toBe(false);
    const textBox = RIBBON.find((t) => t.id === 'formDesign')!.groups.flatMap((g) => g.commands).find((c) => c.id === 'textBox')!;
    expect(textBox.enabled(ctx({ mode: 'design', kind: 'form' }))).toBe(true); expect(textBox.enabled(ctx({ mode: 'design', kind: 'form', readOnly: true }))).toBe(false);
    expect(RIBBON.find((t) => t.id === 'format')!.groups.flatMap((g) => g.commands).filter((c) => c.popup).map((c) => c.id))
      .toEqual(['objectList', 'font', 'fontSize', 'fontColor', 'backColor', 'format', 'shapeFill', 'shapeOutline']);
    // a font field or colour choices are no menu items: those open a dialog (aria-haspopup="dialog")
    expect(RIBBON.find((t) => t.id === 'format')!.groups.flatMap((g) => g.commands).filter((c) => c.popup === 'dialog').map((c) => c.id))
      .toEqual(['font', 'fontColor', 'backColor', 'shapeFill', 'shapeOutline']);
  });

  it('the open ribbon menu is known (its button shows aria-expanded) and a change notifies the ribbon', () => {
    const v = commandsVersion();
    setOpenPopup('sizeSpace'); expect(openPopupOf()).toBe('sizeSpace'); expect(commandsVersion()).toBe(v + 1);
    setOpenPopup('sizeSpace'); expect(commandsVersion()).toBe(v + 1);
    setOpenPopup(null); expect(openPopupOf()).toBeNull(); });

  it('contextual tabs by object kind and mode, in Access order', () => {
    const shown = (kind: RibbonContext['kind'], mode: RibbonContext['mode']) => visibleTabs(ctx({ kind, mode })).filter((t) => t.contextual).map((t) => t.id);
    expect(shown(null, null)).toEqual([]);
    expect(shown('table', 'design')).toEqual(['design']);
    expect(shown('table', 'datasheet')).toEqual(['tableFields', 'table']);
    expect(shown('relations', 'run')).toEqual(['relationshipDesign']);
    expect(shown('query', 'design')).toEqual(['queryDesign']);
    expect(shown('query', 'run')).toEqual([]);
    expect(shown('form', 'design')).toEqual(['formDesign', 'arrange', 'format']);
    expect(shown('form', 'run')).toEqual([]);
    expect(shown('report', 'design')).toEqual(['reportDesign', 'arrange', 'format', 'pageSetup']);
    expect(shown('report', 'run')).toEqual(['printPreview']);
    expect(shown('macro', 'design')).toEqual(['macroDesign']);
  });

  it('the simplified ribbon keeps Home and Print Preview', () => {
    const base: RibbonContext = { hasBase: true, readOnly: false, mode: 'design', isNew: false, kind: 'form' };
    expect(visibleTabs({ ...base, ribbon: 'simplified' }).map((t) => t.id)).toEqual(['home']);
    expect(visibleTabs({ ...base, mode: 'run', kind: 'report', ribbon: 'simplified' }).map((t) => t.id)).toEqual(['home', 'printPreview']);
    expect(visibleTabs(base).map((t) => t.id)).toContain('formDesign');
  });

  it('the Query Builder under the simplified ribbon and run mode keeps its own tabs, and has no Design View either', () => {
    const builder: RibbonContext = { hasBase: true, readOnly: false, mode: 'design', isNew: false, kind: 'query', builder: true };
    expect(visibleTabs({ ...builder, ribbon: 'simplified', runMode: true }).map((t) => t.id)).toEqual(['home', 'queryDesign']);   // Close and Save As stay
    const home = (c: RibbonContext) => visibleTabs(c).find((t) => t.id === 'home')!.groups[0]!.commands.filter((x) => !x.visible || x.visible(c)).map((x) => x.id);
    expect(home({ ...builder, ribbon: 'simplified', runMode: true })).not.toContain('viewDesign');
    expect(home(builder)).toContain('viewDesign');
  });

  it('run mode hides Design View', () => {
    const home = (c: RibbonContext) => visibleTabs(c).find((t) => t.id === 'home')!.groups[0]!.commands.filter((x) => !x.visible || x.visible(c)).map((x) => x.id);
    expect(home({ hasBase: true, readOnly: false, mode: 'run', isNew: false, kind: 'form', ribbon: 'simplified', runMode: true })).toEqual(['viewForm', 'viewDatasheet']);
    expect(home({ hasBase: true, readOnly: false, mode: 'run', isNew: false, kind: 'form' })).toEqual(['viewForm', 'viewDatasheet', 'viewDesign']);   // full: unchanged
  });

  it('C10: entering a context selects its first contextual tab, leaving restores the tab selected before', () => {
    const at = (kind: RibbonContext['kind'], mode: RibbonContext['mode']) => visibleTabs(ctx({ kind, mode }));
    let s: { selected: RibbonTabId; before: RibbonTabId } = { selected: 'create', before: 'home' };
    s = tabAfterContextChange(at('table', 'design'), s);
    expect(s).toEqual({ selected: 'design', before: 'create' });
    s = tabAfterContextChange(at('query', 'design'), s); // from one contextual tab to another: the tab to restore stays
    expect(s).toEqual({ selected: 'queryDesign', before: 'create' });
    expect(tabAfterContextChange(at(null, null), s).selected).toBe('create');
    // a table's datasheet shows Table Fields and Table without taking the ribbon away from Home (as in Access)
    expect(tabAfterContextChange(at('table', 'datasheet'), { selected: 'home', before: 'home' }).selected).toBe('home');
    // a tab the user picked in the datasheet comes back after a trip to Design view
    s = tabAfterContextChange(at('table', 'design'), { selected: 'tableFields', before: 'home' });
    expect(s).toEqual({ selected: 'design', before: 'tableFields' });
    expect(tabAfterContextChange(at('table', 'datasheet'), s).selected).toBe('tableFields');
    // the tab to restore is gone: Home
    expect(tabAfterContextChange(at(null, null), { selected: 'design', before: 'tableFields' }).selected).toBe('home');
    expect(tabAfterContextChange(at('form', 'design'), { selected: 'help', before: 'home' })).toEqual({ selected: 'formDesign', before: 'help' });
    expect(tabAfterContextChange(at('report', 'design'), { selected: 'arrange', before: 'help' })).toEqual({ selected: 'reportDesign', before: 'help' });
  });

  it('A6 Tasks 1-2: Export › Text File and Excel are live in External Data and Print Preview, on a read-only base too', () => {
    for (const id of ['exportText', 'exportExcel'] as const) {
      const h = vi.fn();
      reg('t1', { [id]: h });
      setActiveCommandTab('t1');
      for (const tab of ['externalData', 'printPreview'] as const) {
        const cmd = RIBBON.find((t) => t.id === tab)!.groups.flatMap((g) => g.commands).find((c) => c.id === id)!;
        expect(cmd.planned).toBeUndefined();
      }
      setCommandContext(ctx({ readOnly: true, kind: 'report', mode: 'run' }));
      expect(runCommand(id)).toBe(true);
      expect(h).toHaveBeenCalledOnce();
      expect(commandEnabled(id, ctx({ hasBase: false }))).toBe(false);
    }
  });

  it('A6 Task 4: Home > Cut, Copy, Paste are live; a read-only base keeps Copy only', () => {
    const home = RIBBON.find((t) => t.id === 'home')!.groups.find((g) => g.id === 'clipboard')!.commands;
    for (const id of ['cut', 'copy', 'paste'] as const) expect(home.find((c) => c.id === id)!.planned).toBeUndefined();
    const on = (id: 'cut' | 'copy' | 'paste', o: Partial<RibbonContext>) => home.find((c) => c.id === id)!.enabled(ctx(o));
    expect(on('copy', { readOnly: true })).toBe(true);
    expect(on('cut', { readOnly: true })).toBe(false);
    expect(on('paste', { readOnly: true })).toBe(false);
    expect(on('paste', {})).toBe(true);
    expect(on('copy', { hasBase: false })).toBe(false);
  });

  it('A6 Task 7: Table Fields Add & Delete and Properties are live on a writable datasheet; Create > Table needs a writable base', () => {
    const ids: CommandId[] = ['addShortText', 'addNumber', 'addCurrency', 'addDateTime', 'addYesNo', 'moreFields', 'deleteField', 'nameCaption', 'defaultValue', 'fieldSize'];
    const entries = RIBBON.find((x) => x.id === 'tableFields')!.groups.flatMap((g) => g.commands);
    for (const id of ids) {
      const c = entries.find((x) => x.id === id)!;
      expect(c.planned, id).toBeUndefined();
      expect(c.enabled(ctx({ kind: 'table', mode: 'datasheet' })), id).toBe(true);
      expect(c.enabled(ctx({ kind: 'table', mode: 'datasheet', readOnly: true })), id).toBe(false);
    }
    expect(entries.find((x) => x.id === 'moreFields')!.popup).toBe(true);
    const create = RIBBON.find((x) => x.id === 'create')!.groups.flatMap((g) => g.commands).find((x) => x.id === 'createTable')!;
    expect(create.planned).toBeUndefined();
    expect(create.enabled(ctx({ readOnly: true }))).toBe(false);
  });

  it('A6 Task 8: Table Fields formatting and validation, and Home > Find, Go To, Select are live; Replace waits', () => {
    const ids: CommandId[] = ['dataType', 'format', 'currencyFormat', 'percentFormat', 'commaFormat', 'increaseDecimals', 'decreaseDecimals', 'required', 'unique', 'indexed', 'validation'];
    const entries = RIBBON.find((x) => x.id === 'tableFields')!.groups.flatMap((g) => g.commands);
    for (const id of ids) {
      const c = entries.find((x) => x.id === id)!;
      expect(c.planned, id).toBeUndefined();
      expect(c.enabled(ctx({ kind: 'table', mode: 'datasheet' })), id).toBe(true);
      expect(c.enabled(ctx({ kind: 'table', mode: 'datasheet', readOnly: true })), id).toBe(false);
    }
    expect(['dataType', 'format', 'validation'].every((id) => entries.find((x) => x.id === id)!.popup)).toBe(true);
    const home = RIBBON.find((x) => x.id === 'home')!.groups.flatMap((g) => g.commands);
    for (const id of ['find', 'goTo', 'selectMenu'] as const) {
      const c = home.find((x) => x.id === id)!;
      expect(c.planned, id).toBeUndefined();
      expect(c.enabled(ctx({ kind: 'table', mode: 'datasheet', readOnly: true })), id).toBe(true);
      expect(c.enabled(ctx({ kind: 'report', mode: 'design' })), id).toBe(false);
    }
    expect(home.find((x) => x.id === 'replace')!.planned).toBe('later');
  });

  it('Table Design Property Sheet is active (A6), read-only base included, as in Query Design', () => {
    const h = vi.fn();
    reg('t1', { propertySheet: h });
    setActiveCommandTab('t1');
    expect(commandEnabled('propertySheet', ctx({ kind: 'query', mode: 'design' }))).toBe(true);
    expect(commandEnabled('propertySheet', ctx({ kind: 'table', mode: 'design' }))).toBe(true);
    expect(commandEnabled('propertySheet', ctx({ kind: 'table', mode: 'design', readOnly: true }))).toBe(true); // shown, its fields disabled
    expect(RIBBON.find((x) => x.id === 'design')!.groups.flatMap((g) => g.commands).find((c) => c.id === 'propertySheet')!.planned).toBeUndefined();
    setCommandContext(ctx({ kind: 'table', mode: 'design' }));
    runCommand('propertySheet');
    expect(h).toHaveBeenCalledOnce();
  });

  it('Table Design Indexes is active (A6), read-only base included (the dialog is then shown only)', () => {
    const h = vi.fn();
    reg('t1', { indexes: h });
    setActiveCommandTab('t1');
    expect(commandEnabled('indexes', ctx({ kind: 'table', mode: 'design' }))).toBe(true);
    expect(commandEnabled('indexes', ctx({ kind: 'table', mode: 'design', readOnly: true }))).toBe(true);
    expect(RIBBON.find((x) => x.id === 'design')!.groups.flatMap((g) => g.commands).find((c) => c.id === 'indexes')!.planned).toBeUndefined();
    setCommandContext(ctx({ kind: 'table', mode: 'design' }));
    runCommand('indexes');
    expect(h).toHaveBeenCalledOnce();
  });

  it('a document state of a command: off despite its handler, pressed or not past its entry rule (A3 SQL view)', () => {
    const h = vi.fn();
    reg('t1', { viewDesign: h });
    setActiveCommandTab('t1');
    const x = ctx({ kind: 'query', mode: 'design' });
    setCommandContext(x);
    const off = registerCommandStates('t1', { viewDesign: { enabled: false, active: false }, viewSql: { active: true } });
    expect(commandEnabled('viewDesign', x)).toBe(false);
    runCommand('viewDesign');
    expect(h).not.toHaveBeenCalled();
    expect([commandState('viewDesign')?.active, commandState('viewSql')?.active]).toEqual([false, true]);
    setActiveCommandTab('t2'); // another document: its own states
    expect(commandState('viewSql')).toBeUndefined();
    setActiveCommandTab('t1');
    off();
    expect(commandEnabled('viewDesign', x)).toBe(true);
    runCommand('viewDesign');
    expect(h).toHaveBeenCalledOnce();
  });

  it('keeps Access order in every tab', () => {
    const order = Object.fromEntries(RIBBON.map((t) => [t.id, t.groups.map((g) => `${g.id}: ${g.commands.map((c) => c.id).join(' ')}`)]));
    expect(order).toMatchInlineSnapshot(`
      {
        "arrange": [
          "layoutTable: layoutGridlines stacked tabular removeLayout",
          "rowsColumns: insertAbove insertBelow insertLeft insertRight selectLayout selectColumn selectRow",
          "mergeSplit: merge splitVertically splitHorizontally",
          "move: moveUp moveDown",
          "position: controlMargins controlPadding anchoring",
          "sizingOrdering: sizeSpace align bringToFront sendToBack",
        ],
        "create": [
          "tables: createTable createTableDesign",
          "queries: queryWizard createQueryDesign createSqlQuery",
          "forms: createForm createFormDesign createBlankForm formWizard navigationForm moreForms",
          "reports: createReport createReportDesign createBlankReport reportWizard labels",
          "macrosCode: createMacro createModule pythonEditor",
        ],
        "databaseTools": [
          "tools: compactRepair",
          "macro: pythonEditor runMacro",
          "relationships: relationships objectDependencies",
          "analyze: databaseDocumenter analyzePerformance analyzeTable",
          "moveData: splitDatabase moveToServer",
        ],
        "design": [
          "view: viewDatasheet",
          "tools: primaryKey builder testValidationRules insertRows deleteRows modifyLookups",
          "showHide: propertySheet indexes",
          "tableEvents: createDataMacros renameDeleteMacro",
          "relationships: relationships objectDependencies",
        ],
        "externalData": [
          "import: importExcel importXml importText importAccess importSqlServer importPostgreSql importOdbc savedImports linkedTableManager",
          "export: savedExports exportExcel exportText exportPdf exportAccess exportXml exportMore",
        ],
        "formDesign": [
          "view: viewForm viewDatasheet",
          "themes: themes themeColors themeFonts",
          "controls: select textBox label button tabControl hyperlink navigationControl optionGroup insertPageBreak comboBox line toggleButton listBox rectangle checkBox unboundObjectFrame attachment optionButton subform boundObjectFrame image webBrowser chart insertImage insertModernChart",
          "headerFooter: logo title dateTime",
          "tools: addExistingFields propertySheet tabOrder chartSettings subformInNewWindow viewCode",
        ],
        "format": [
          "selection: objectList selectAll",
          "font: font fontSize formatPainter bold italic underline fontColor backColor alignLeft alignCenter alignRight",
          "number: format currencyFormat percentFormat commaFormat increaseDecimals decreaseDecimals",
          "background: backgroundImage alternateRowColor",
          "controlFormatting: conditionalFormatting shapeFill shapeOutline",
        ],
        "help": [
          "help: help contactSupport feedback showTraining whatsNew",
        ],
        "home": [
          "view: viewForm viewPrintPreview viewDatasheet viewDesign",
          "clipboard: paste cut copy formatPainter showClipboard",
          "sort: filter sortAsc sortDesc sortClear filterSelection filterAdvanced filterToggle",
          "records: refresh newRecord save deleteRecord recordsTotals spelling moreRecords",
          "find: find replace goTo selectMenu",
          "textFormatting: textFont textFontSize bullets numbering indentIncrease indentDecrease textDirection textBold textItalic textUnderline textFontColor textHighlight textBackColor textAlignLeft textAlignCenter textAlignRight datasheetGridlines alternateRowColor datasheetFormatting",
          "zoom: zoom",
        ],
        "macroDesign": [
          "tools: macroRun singleStep",
          "expandCollapse: expandActions collapseActions expandAll collapseAll",
          "showHide: actionCatalog showAllActions",
        ],
        "pageSetup": [
          "pageSize: pageSize margins showMargins printDataOnly",
          "pageLayout: portrait landscape columns pageSetupDialog",
        ],
        "printPreview": [
          "print: print",
          "pageSize: pageSize margins printDataOnly",
          "pageLayout: portrait landscape columns pageSetupDialog",
          "zoom: previewZoom onePage twoPages morePages",
          "data: refresh exportExcel exportText exportPdf exportMore",
          "closePreview: closePreview",
        ],
        "queryDesign": [
          "results: viewDatasheet viewSql runQuery",
          "queryType: selectQuery makeTableQuery appendQuery updateQuery crosstabQuery deleteQuery unionQuery passThroughQuery",
          "querySetup: addTables insertRows deleteRows builder insertColumns deleteColumns returnValues",
          "showHide: queryTotals parameters propertySheet tableNames",
          "builderClose: builderSaveAs builderClose",
        ],
        "relationshipDesign": [
          "tools: editRelationships clearLayout relationshipReport",
          "relationships: addTables hideTable directRelationships allRelationships closeRelationships",
        ],
        "reportDesign": [
          "view: viewPrintPreview",
          "themes: themes themeColors themeFonts",
          "groupingTotals: groupSort reportTotals hideDetails",
          "controls: select textBox label button tabControl hyperlink optionGroup insertPageBreak comboBox line toggleButton listBox rectangle checkBox unboundObjectFrame attachment optionButton subform boundObjectFrame image webBrowser chart insertImage insertModernChart",
          "headerFooter: pageNumbers logo title dateTime",
          "tools: addExistingFields propertySheet chartSettings subreportInNewWindow viewCode",
        ],
        "table": [
          "properties: tableProperties",
          "beforeEvents: beforeChange beforeDelete",
          "afterEvents: afterInsert afterUpdate afterDelete",
          "namedMacros: namedMacro",
          "relationships: relationships objectDependencies",
        ],
        "tableFields": [
          "view: viewDesign",
          "addDelete: addShortText addNumber addCurrency addDateTime addYesNo moreFields deleteField",
          "properties: nameCaption defaultValue fieldSize modifyLookups modifyExpression",
          "formatting: dataType format currencyFormat percentFormat commaFormat increaseDecimals decreaseDecimals",
          "fieldValidation: required unique indexed validation",
        ],
      }
    `);
  });
});
