import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  RIBBON, SHELL_SCOPE, commandEnabled, commandsVersion, isCommandAvailable, registerCommands, runCommand, setActiveCommandTab,
  setCommandContext, subscribeCommands, type CommandId, type RibbonContext,
} from './ribbon-model';

const cleanups: (() => void)[] = [];
const reg = (tab: string, h: Parameters<typeof registerCommands>[1]) => { const u = registerCommands(tab, h); cleanups.push(u); return u; };
const writableSheet: RibbonContext = { hasBase: true, readOnly: false, mode: 'datasheet', isNew: false };
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
  const ctx = (o: Partial<RibbonContext>): RibbonContext => ({ hasBase: true, readOnly: false, mode: null, isNew: false, ...o });
  const cmd = (id: CommandId) => RIBBON.flatMap((t) => t.groups.flatMap((g) => g.commands)).find((c) => c.id === id)!;

  it('has the brief tabs and commands', () => {
    expect(RIBBON.map((t) => t.id)).toEqual(['home', 'create', 'externalData', 'design']);
    expect(ids('externalData')).toEqual(['importText']);
    const importText = RIBBON.find((t) => t.id === 'externalData')!.groups[0].commands[0];
    expect(importText.enabled(ctx({ mode: null }))).toBe(true); // a base open, no document needed
    expect(importText.enabled(ctx({ readOnly: true }))).toBe(false);
    expect(importText.enabled(ctx({ hasBase: false, mode: null }))).toBe(false);
    expect(ids('home')).toEqual(expect.arrayContaining(['viewDatasheet', 'viewDesign', 'newRecord', 'save', 'deleteRecord', 'sortAsc', 'sortDesc', 'sortClear']));
    expect(ids('create')).toEqual(['createTableDesign']);
    expect(ids('design')).toEqual(expect.arrayContaining(['primaryKey', 'insertRows', 'deleteRows']));
    expect(RIBBON.find((t) => t.id === 'design')!.visible!(ctx({ mode: 'design' }))).toBe(true);
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
});
