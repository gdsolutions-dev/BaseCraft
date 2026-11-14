import { describe, it, expect } from 'vitest';
import { DEFAULT_NAV_OPTIONS } from '../../shared/nav-view';
import { toggleGroup, addCategory, renameCategory, deleteCategory, moveCategory, addGroup, renameGroup, deleteGroup } from './navigation-options-model';

const all = ['table', 'query', 'macro'];
describe('toggleGroup', () => {
  it('unticking adds the group to hiddenGroups, ticking removes it', () => {
    const o = toggleGroup(DEFAULT_NAV_OPTIONS, 'type', 'macro', all);
    expect(o.hiddenGroups).toEqual({ type: ['macro'] });
    expect(toggleGroup(o, 'type', 'macro', all).hiddenGroups).toEqual({});
  });
  it('the last visible group cannot be unticked', () => {
    let o = toggleGroup(DEFAULT_NAV_OPTIONS, 'type', 'table', all);
    o = toggleGroup(o, 'type', 'query', all);
    expect(toggleGroup(o, 'type', 'macro', all)).toBe(o);
  });
});

const withV = addCategory(DEFAULT_NAV_OPTIONS, 'c2', ' Ventes ');
describe('category and group edits', () => {
  it('adds a trimmed category; refuses empty and duplicate (accent/case-insensitive)', () => {
    expect(withV.categories.map((c) => c.name)).toEqual(['', 'Ventes']);
    expect(addCategory(withV, 'c3', '  ')).toBe(withV);
    expect(addCategory(withV, 'c3', 'vèntes')).toBe(withV);
  });
  it('renames a custom category (the default too), refuses duplicates, built-ins and unknown ids', () => {
    expect(renameCategory(withV, 'custom', 'Mine').categories[0].name).toBe('Mine');
    expect(renameCategory(withV, 'c2', 'ventes')).not.toBe(withV); // same item renamed to its own folded name is allowed
    expect(renameCategory(renameCategory(withV, 'custom', 'Mine'), 'c2', 'MINE').categories[1].name).toBe('Ventes');
    expect(renameCategory(withV, 'type', 'X')).toBe(withV);
  });
  it('deletes a custom category, back to type when current; built-ins refused', () => {
    const cur = { ...withV, category: 'c2', hiddenGroups: { c2: ['g'] } };
    const d = deleteCategory(cur, 'c2');
    expect(d.categories.map((c) => c.id)).toEqual(['custom']);
    expect(d.category).toBe('type');
    expect(d.hiddenGroups).toEqual({});
    expect(deleteCategory(withV, 'type')).toBe(withV);
  });
  it('moves custom categories, refuses out of range', () => {
    expect(moveCategory(withV, 'c2', -1).categories.map((c) => c.id)).toEqual(['c2', 'custom']);
    expect(moveCategory(withV, 'c2', 1)).toBe(withV);
    expect(moveCategory(withV, 'type', 1)).toBe(withV);
  });
  it('adds, renames and deletes groups; unassigned is protected', () => {
    const a = addGroup(withV, 'c2', 'g1', ' Clients ');
    expect(a.categories[1].groups).toEqual([{ id: 'g1', name: 'Clients', items: [] }]);
    expect(addGroup(a, 'c2', 'g2', 'clients')).toBe(a);
    expect(addGroup(a, 'c2', 'unassigned', 'X')).toBe(a);
    expect(addGroup(a, 'type', 'g2', 'X')).toBe(a);
    expect(renameGroup(a, 'c2', 'g1', 'Comptes').categories[1].groups[0].name).toBe('Comptes');
    expect(renameGroup(a, 'c2', 'unassigned', 'Z')).toBe(a);
    const withItems = { ...a, categories: a.categories.map((c) => (c.id === 'c2' ? { ...c, groups: [{ id: 'g1', name: 'Clients', items: ['table:T'] }] } : c)), hiddenGroups: { c2: ['g1'] }, filterGroup: 'g1' };
    const d = deleteGroup(withItems, 'c2', 'g1');
    expect(d.categories[1].groups).toEqual([]);
    expect(d.hiddenGroups).toEqual({});
    expect(d.filterGroup).toBeNull();
    expect(deleteGroup(a, 'c2', 'unassigned')).toBe(a);
  });
});
