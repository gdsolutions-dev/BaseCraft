import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_NAV_OPTIONS, type NavOptions } from '../../shared/nav-view';
import { backgroundMenu, headerMenu, type PaneMenuEnv } from './nav-pane-menu';
import type { NavMenuItem } from './nav-menu';

const env = (o: Partial<NavOptions> = {}, x: Partial<PaneMenuEnv> = {}): PaneMenuEnv => ({
  opts: { ...DEFAULT_NAV_OPTIONS, ...o }, groups: [{ id: 'table', label: { key: 'nav.tables' }, items: [] }, { id: 'g1', label: 'Mine', items: [] }],
  customCategories: [], relatedAvailable: true, runtime: false, canPaste: true, set: vi.fn(), showAllGroups: vi.fn(), paste: vi.fn(), openOptions: vi.fn(), ...x,
});
const ids = (gs: NavMenuItem[][]) => gs.map((g) => g.map((i) => i.id).join(',')).join('|');
const find = (gs: NavMenuItem[][], id: string) => gs.flat().flatMap((i) => [i, ...(i.submenu ?? [])]).find((i) => i.id === id)!;
const ctx = {} as never;
const checkedIds = (items: NavMenuItem[]) => items.filter((i) => i.checked?.(ctx)).map((i) => i.id);

describe('headerMenu related availability', () => {
  it('hides Tables and Related Views when the design module is absent', () => {
    expect(ids(headerMenu(env({}, { relatedAvailable: false })))).toContain('cat-type');
    expect(ids(headerMenu(env({}, { relatedAvailable: false })))).not.toContain('cat-related');
    expect(ids(backgroundMenu(env({}, { relatedAvailable: false }))).includes('cat-related')).toBe(false);
  });
});

describe('headerMenu', () => {
  it('layout and checks', () => {
    const m = headerMenu(env());
    expect(ids(m)).toBe('heading-goto,cat-related,cat-type,cat-created,cat-modified|heading-filter,group-table,group-g1,all');
    expect(checkedIds(m.flat())).toEqual(['cat-type', 'all']);
    expect(find(m, 'group-g1')).toMatchObject({ labelKey: 'Mine', literal: true });
    expect(find(m, 'group-table')).toMatchObject({ labelKey: 'nav.tables' });
  });
  it('selecting', () => {
    const e = env(); const m = headerMenu(e);
    find(m, 'cat-created').run!(ctx);
    expect(e.set).toHaveBeenCalledWith({ category: 'created', filterGroup: null });
    find(m, 'group-g1').run!(ctx);
    expect(e.set).toHaveBeenCalledWith({ filterGroup: 'g1' });
    expect(checkedIds(headerMenu(env({ filterGroup: 'g1' })).flat())).toEqual(['cat-type', 'group-g1']);
  });
  it('custom categories by name', () => {
    expect(ids(headerMenu(env({}, { customCategories: [{ id: 'c1', name: 'Mine' }] }))).startsWith('heading-goto,cat-c1,')).toBe(true);
  });
});

describe('backgroundMenu', () => {
  it('layout, runtime drops Paste and Options', () => {
    expect(ids(backgroundMenu(env()))).toBe('category,sort,viewBy,showAllGroups|paste|options,searchBar');
    expect(ids(backgroundMenu(env({}, { runtime: true })))).toBe('category,sort,viewBy,showAllGroups|searchBar');
    expect(find(backgroundMenu(env({}, { canPaste: false })), 'paste').enabled!(ctx)).toBe(false);
  });
  it('sort submenu layout and checks', () => {
    const sub = find(backgroundMenu(env()), 'sort').submenu!;
    expect(sub.map((i) => i.id + (i.sepBefore ? '+' : ''))).toEqual(['sort-asc', 'sort-desc', 'sort-name+', 'sort-type', 'sort-created', 'sort-modified', 'sort-none']);
    expect(checkedIds(sub)).toEqual(['sort-asc', 'sort-type']);
    expect(find(backgroundMenu(env({ viewBy: 'icon' })), 'view-icon').checked!(ctx)).toBe(true);
    expect(find(backgroundMenu(env({ searchBar: false })), 'searchBar').checked!(ctx)).toBe(false);
  });
  it('actions', () => {
    const e = env({ sort: { by: 'type', dir: 'desc' } }); const m = backgroundMenu(e);
    find(m, 'sort-name').run!(ctx);
    expect(e.set).toHaveBeenCalledWith({ sort: { by: 'name', dir: 'desc' } });
    find(m, 'sort-asc').run!(ctx);
    expect(e.set).toHaveBeenCalledWith({ sort: { by: 'type', dir: 'asc' } });
    find(m, 'sort-none').run!(ctx);
    expect(e.set).toHaveBeenCalledWith({ sort: null });
    const e2 = env({ sort: null }); find(backgroundMenu(e2), 'sort-name').run!(ctx);
    expect(e2.set).toHaveBeenCalledWith({ sort: { by: 'name', dir: 'asc' } });
    find(m, 'view-list').run!(ctx); expect(e.set).toHaveBeenCalledWith({ viewBy: 'list' });
    find(m, 'searchBar').run!(ctx); expect(e.set).toHaveBeenCalledWith({ searchBar: false });
    find(m, 'showAllGroups').run!(ctx); expect(e.showAllGroups).toHaveBeenCalled();
  });
});
