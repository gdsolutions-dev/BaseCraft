import { describe, it, expect } from 'vitest';
import { appReducer, initialAppState as init, reopenMode, type AppState } from './app-state';

const s1: AppState = appReducer(init, { type: 'open', kind: 'table', name: 'Clients', mode: 'datasheet' });

describe('appReducer', () => {
  it('one tab per object; reopening switches mode', () => {
    let s = appReducer(init, { type: 'open', kind: 'table', name: 'Clients', mode: 'datasheet' });
    s = appReducer(s, { type: 'open', kind: 'table', name: 'Clients', mode: 'design' });
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].mode).toBe('design');
  });

  it('Open on a form shown in its Datasheet view only activates its tab (Access); from Design view it opens Form view', () => {
    let s = appReducer(init, { type: 'open', kind: 'form', name: 'F', mode: 'run' });
    const id = s.tabs[0].id;
    s = appReducer(s, { type: 'setMode', id, mode: 'datasheet' });
    s = appReducer(s, { type: 'open', kind: 'table', name: 'Clients', mode: 'datasheet' });
    s = appReducer(s, { type: 'open', kind: 'form', name: 'F', mode: 'run' });
    expect(s).toMatchObject({ activeId: id, tabs: [{ mode: 'datasheet' }, {}] });
    expect(reopenMode(s.tabs[0], 'run')).toBe('datasheet');
    s = appReducer(s, { type: 'setMode', id, mode: 'design' });
    expect(appReducer(s, { type: 'open', kind: 'form', name: 'F', mode: 'run' }).tabs[0].mode).toBe('run');
  });

  it('rename, drop, save', () => {
    expect(appReducer(s1, { type: 'tableRenamed', from: 'Clients', to: 'Contacts' }).tabs[0].name).toBe('Contacts');
    expect(appReducer(s1, { type: 'tableDropped', name: 'Clients' }).tabs).toEqual([]);
    expect(appReducer(s1, { type: 'tableSaved', name: 'Clients' }).tabs[0].reloadToken).toBe(1);
  });

  it('a description set from Properties reaches the open tabs of that table, never dirtying or reloading them', () => {
    let s = appReducer(s1, { type: 'open', kind: 'table', name: 'Produits', mode: 'design' });
    s = appReducer(s, { type: 'setDirty', id: s.tabs[1].id, dirty: true });
    s = appReducer(s, { type: 'tableDescribed', name: 'Produits', description: 'Catalogue' }); // the stored name, as tables are matched
    expect(s.tabs[1]).toMatchObject({ name: 'Produits', description: 'Catalogue', dirty: true, reloadToken: 0 });
    expect(s.tabs[0].description).toBeUndefined();
    expect(appReducer(s, { type: 'tableDescribed', name: 'Produits', description: '' }).tabs[1].description).toBe('');
  });

  it('data changed (an import): only datasheets of the table re-read their rows; a design is never reloaded', () => {
    let s = appReducer(s1, { type: 'open', kind: 'table', name: 'Produits', mode: 'design' });
    s = appReducer(s, { type: 'tableDataChanged', name: 'Clients' });
    expect(s.tabs.map((x) => [x.dataToken ?? 0, x.reloadToken])).toEqual([[1, 0], [0, 0]]);
    s = appReducer(s, { type: 'tableDataChanged', name: 'Produits' });
    expect(s.tabs[1]).toMatchObject({ reloadToken: 0 });
    expect(s.tabs[1].dataToken ?? 0).toBe(0);
  });

  it('query data changed (an action query ran): only query datasheets re-read their rows', () => {
    let s = appReducer(s1, { type: 'open', kind: 'query', name: 'Q1', mode: 'run' });
    s = appReducer(s, { type: 'open', kind: 'query', name: 'Q2', mode: 'design' });
    s = appReducer(s, { type: 'queryDataChanged' });
    expect(s.tabs.map((x) => [x.kind, x.dataToken ?? 0, x.reloadToken])).toEqual([['table', 0, 0], ['query', 1, 0], ['query', 0, 0]]);
  });

  it('opening activates; reopening an object activates its tab', () => {
    let s = appReducer(s1, { type: 'open', kind: 'table', name: 'Produits', mode: 'datasheet' });
    expect(s.activeId).toBe(s.tabs[1].id);
    s = appReducer(s, { type: 'open', kind: 'table', name: 'Clients', mode: 'datasheet' });
    expect(s.tabs).toHaveLength(2);
    expect(s.activeId).toBe(s.tabs[0].id);
  });

  it('names match exactly: twins "Été" and "été" (another tool made one) each have their own tab (A2-R15)', () => {
    let s = appReducer(init, { type: 'open', kind: 'table', name: 'Été', mode: 'datasheet' });
    s = appReducer(s, { type: 'open', kind: 'table', name: 'été', mode: 'datasheet' });
    expect(s.tabs.map((x) => x.name)).toEqual(['Été', 'été']);
    s = appReducer(s, { type: 'tableRenamed', from: 'été', to: 'Autre' });
    expect(s.tabs.map((x) => x.name)).toEqual(['Été', 'Autre']);
    s = appReducer(s, { type: 'tableDataChanged', name: 'Été' });
    expect(s.tabs.map((x) => x.dataToken ?? 0)).toEqual([1, 0]);
    s = appReducer(s, { type: 'tableSaved', name: 'Autre' });
    expect(s.tabs.map((x) => x.reloadToken)).toEqual([0, 1]);
    expect(appReducer(s, { type: 'tableDropped', name: 'Été' }).tabs.map((x) => x.name)).toEqual(['Autre']);
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
    const src = [{ kind: 'table', name: 'Commandes' } as const];
    expect(appReducer(s1, { type: 'setDirty', id, dirty: true, sources: src }).tabs[0]).toMatchObject({ dirty: true, dirtySources: src });   // a form's (action queries)
    const withSources = appReducer(s1, { type: 'setDirty', id, dirty: true, sources: src });
    expect(appReducer(withSources, { type: 'setDirty', id, dirty: false }).tabs[0].dirtySources).toBeUndefined();   // the view gone (its cleanup): none left
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

  it('one Relations window: reopening activates it; table changes reload it; a table named like it is another document', () => {
    const open = { type: 'open', kind: 'relations', name: 'Relations', mode: 'run' } as const;
    let s = appReducer(appReducer(s1, open), { type: 'open', kind: 'table', name: 'Relations', mode: 'datasheet' });
    expect(s.tabs.map((x) => [x.kind, x.name])).toEqual([['table', 'Clients'], ['relations', 'Relations'], ['table', 'Relations']]);
    s = appReducer(s, open);
    expect(s.tabs).toHaveLength(3);
    expect(s.activeId).toBe(s.tabs[1].id);
    s = appReducer(s, { type: 'tableRenamed', from: 'Relations', to: 'Liens' });
    expect(s.tabs.map((x) => [x.name, x.reloadToken])).toEqual([['Clients', 0], ['Relations', 1], ['Liens', 0]]);
    s = appReducer(s, { type: 'tableSaved', name: 'Clients' });
    expect(s.tabs.map((x) => x.reloadToken)).toEqual([1, 2, 0]);
    s = appReducer(s, { type: 'tableDropped', name: 'Relations' });
    expect(s.tabs.map((x) => [x.kind, x.reloadToken])).toEqual([['table', 1], ['relations', 3], ['table', 0]]);
    s = appReducer(s, { type: 'tableDropped', name: 'Liens' });
    expect(s.tabs.map((x) => [x.kind, x.reloadToken])).toEqual([['table', 1], ['relations', 4]]);
  });

  it('tables created elsewhere (an import): only the Relations window reloads, a design of the table is left alone', () => {
    let s = appReducer(s1, { type: 'open', kind: 'relations', name: 'Relations', mode: 'run' });
    s = appReducer(s, { type: 'open', kind: 'table', name: 'Produits', mode: 'design' });
    s = appReducer(s, { type: 'tablesChanged' });
    expect(s.tabs.map((x) => [x.kind, x.reloadToken, x.dataToken ?? 0])).toEqual([['table', 0, 0], ['relations', 1, 0], ['table', 0, 0]]);
  });

  it('toggleNav and reset', () => {
    expect(appReducer(init, { type: 'toggleNav' }).navVisible).toBe(false);
    const hidden = appReducer(s1, { type: 'toggleNav' });
    expect(appReducer(hidden, { type: 'reset' })).toEqual({ tabs: [], activeId: null, navVisible: false });
  });
  it('objects: one tab per kind and name; table actions never touch another kind', () => {
    let s = appReducer(s1, { type: 'open', kind: 'form', name: 'Clients', mode: 'run' });
    s = appReducer(s, { type: 'open', kind: 'report', name: 'Clients', mode: 'design' });
    s = appReducer(s, { type: 'open', kind: 'form', name: 'CLIENTS', mode: 'design' });
    expect(s.tabs.map((x) => [x.kind, x.mode])).toEqual([['table', 'datasheet'], ['form', 'design'], ['report', 'design']]);
    s = appReducer(s, { type: 'tableRenamed', from: 'Clients', to: 'Contacts' });
    expect(s.tabs.map((x) => x.name)).toEqual(['Contacts', 'Clients', 'Clients']);
    s = appReducer(s, { type: 'objectRenamed', kind: 'form', from: 'clients', to: 'Saisie' });
    expect(s.tabs.map((x) => x.name)).toEqual(['Contacts', 'Saisie', 'Clients']);
    s = appReducer(s, { type: 'objectSaved', kind: 'report', name: 'Clients' });
    expect(s.tabs[2]!.reloadToken).toBe(1);
    s = appReducer(s, { type: 'objectDeleted', kind: 'report', name: 'Clients' });
    s = appReducer(s, { type: 'tableDropped', name: 'Saisie' });
    expect(s.tabs.map((x) => `${x.kind}:${x.name}`)).toEqual(['table:Contacts', 'form:Saisie']);
  });

  it('a new object saved under its name', () => {
    let s = appReducer(init, { type: 'open', kind: 'query', name: 'Requête1', mode: 'design', isNew: true });
    s = appReducer(s, { type: 'objectSaved', kind: 'query', name: 'Commandes', tabId: s.tabs[0]!.id });
    expect(s.tabs[0]).toMatchObject({ name: 'Commandes', isNew: false, reloadToken: 1 });
  });
});
