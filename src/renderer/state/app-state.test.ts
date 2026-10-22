import { describe, it, expect } from 'vitest';
import { appReducer, initialAppState as init, type AppState } from './app-state';

const s1: AppState = appReducer(init, { type: 'open', kind: 'table', name: 'Clients', mode: 'datasheet' });

describe('appReducer', () => {
  it('one tab per object; reopening switches mode', () => {
    let s = appReducer(init, { type: 'open', kind: 'table', name: 'Clients', mode: 'datasheet' });
    s = appReducer(s, { type: 'open', kind: 'table', name: 'Clients', mode: 'design' });
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].mode).toBe('design');
  });

  it('rename, drop, save', () => {
    expect(appReducer(s1, { type: 'tableRenamed', from: 'Clients', to: 'Contacts' }).tabs[0].name).toBe('Contacts');
    expect(appReducer(s1, { type: 'tableDropped', name: 'Clients' }).tabs).toEqual([]);
    expect(appReducer(s1, { type: 'tableSaved', name: 'Clients' }).tabs[0].reloadToken).toBe(1);
  });

  it('data changed (an import): only datasheets of the table re-read their rows; a design is never reloaded', () => {
    let s = appReducer(s1, { type: 'open', kind: 'table', name: 'Produits', mode: 'design' });
    s = appReducer(s, { type: 'tableDataChanged', name: 'clients' });
    expect(s.tabs.map((x) => [x.dataToken ?? 0, x.reloadToken])).toEqual([[1, 0], [0, 0]]);
    s = appReducer(s, { type: 'tableDataChanged', name: 'Produits' });
    expect(s.tabs[1]).toMatchObject({ reloadToken: 0 });
    expect(s.tabs[1].dataToken ?? 0).toBe(0);
  });

  it('opening activates; reopening an object activates its tab; names match case-insensitively', () => {
    let s = appReducer(s1, { type: 'open', kind: 'table', name: 'Produits', mode: 'datasheet' });
    expect(s.activeId).toBe(s.tabs[1].id);
    s = appReducer(s, { type: 'open', kind: 'table', name: 'clients', mode: 'datasheet' });
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it('closing the active tab activates its neighbour; closing the last leaves none', () => {
    let s = appReducer(s1, { type: 'open', kind: 'table', name: 'A', mode: 'datasheet' });
    s = appReducer(s, { type: 'open', kind: 'table', name: 'B', mode: 'datasheet' });
    s = appReducer(s, { type: 'activate', id: s.tabs[1].id });
    const [, a, b] = s.tabs;
    s = appReducer(s, { type: 'close', id: a.id });
    expect(s.activeId).toBe(b.id);
    s = appReducer(s, { type: 'close', id: b.id });
    expect(s.activeId).toBe(s.tabs[0].id);
    s = appReducer(s, { type: 'close', id: s.tabs[0].id });
    expect(s).toMatchObject({ tabs: [], activeId: null });
  });

  it('setMode, setDirty, unknown ids are ignored', () => {
    const id = s1.tabs[0].id;
    expect(appReducer(s1, { type: 'setMode', id, mode: 'design' }).tabs[0].mode).toBe('design');
    expect(appReducer(s1, { type: 'setDirty', id, dirty: true }).tabs[0].dirty).toBe(true);
    expect(appReducer(s1, { type: 'activate', id: 'nope' })).toBe(s1);
  });

  it('rename and save touch only the tabs of that table; drop keeps an active tab', () => {
    let s = appReducer(s1, { type: 'open', kind: 'table', name: 'Produits', mode: 'design' });
    s = appReducer(s, { type: 'tableSaved', name: 'Produits' });
    expect(s.tabs.map((x) => x.reloadToken)).toEqual([0, 1]);
    expect(appReducer(s, { type: 'tableRenamed', from: 'Produits', to: 'Articles' }).tabs.map((x) => x.name)).toEqual(['Clients', 'Articles']);
    const d = appReducer(s, { type: 'tableDropped', name: 'Produits' });
    expect(d.tabs.map((x) => x.name)).toEqual(['Clients']);
    expect(d.activeId).toBe(d.tabs[0].id);
  });

  it('a new table gets its own tab even if the name exists; saving it gives the tab its real name', () => {
    let s = appReducer(s1, { type: 'open', kind: 'table', name: 'Clients', mode: 'design', isNew: true });
    expect(s.tabs).toHaveLength(2);
    expect(s.tabs[1]).toMatchObject({ isNew: true, mode: 'design' });
    s = appReducer(s, { type: 'open', kind: 'table', name: 'Clients', mode: 'datasheet' });
    expect(s.activeId).toBe(s.tabs[0].id); // the saved table, not the new one
    s = appReducer(s, { type: 'tableSaved', name: 'Clients2', tabId: s.tabs[1].id });
    expect(s.tabs[1]).toMatchObject({ name: 'Clients2', isNew: false, reloadToken: 1 });
    expect(appReducer(s, { type: 'tableDropped', name: 'Clients' }).tabs.map((x) => x.name)).toEqual(['Clients2']);
  });

  it('toggleNav and reset', () => {
    expect(appReducer(init, { type: 'toggleNav' }).navVisible).toBe(false);
    const hidden = appReducer(s1, { type: 'toggleNav' });
    expect(appReducer(hidden, { type: 'reset' })).toEqual({ tabs: [], activeId: null, navVisible: false });
  });
});
