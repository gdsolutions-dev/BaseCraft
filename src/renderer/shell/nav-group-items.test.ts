import { describe, expect, it } from 'vitest';
import { DEFAULT_NAV_OPTIONS, type NavOptions } from '../../shared/nav-view';
import { addTargets, addToGroup, hideInGroup, removeFromGroup, setHidden, unhideInGroup, type NavCtx } from './nav-group-items';

const opts: NavOptions = { ...DEFAULT_NAV_OPTIONS, category: 'c1', categories: [{ id: 'c1', name: 'V', groups: [
  { id: 'a', name: 'A', items: ['form:F'] }, { id: 'b', name: 'B', items: [] }] }] };
const nav = (group: string, o = opts): NavCtx => ({ opts: o, category: 'c1', group, set: () => {} });
const F = { kind: 'form', name: 'F' };

describe('nav group items', () => {
  it('addTargets excludes groups holding the item; addToGroup refuses those', () => {
    expect(addTargets(nav('a'), F).map((g) => g.id)).toEqual(['b']);
    expect(addToGroup(nav('a'), F, 'a')).toBeNull();
    expect(addToGroup(nav('a'), F, 'b')!.categories![0]!.groups[1]!.items).toEqual(['form:F']);
  });
  it('removeFromGroup only in a real group holding it', () => {
    expect(removeFromGroup(nav('a'), F)!.categories![0]!.groups[0]!.items).toEqual([]);
    expect(removeFromGroup(nav('unassigned'), F)).toBeNull();
    expect(removeFromGroup(nav('b'), F)).toBeNull();
  });
  it('hide / unhide in this group', () => {
    const p = hideInGroup(nav('a'), F)!;
    expect(p.hiddenIn).toEqual(['c1|a|form:F']);
    expect(hideInGroup(nav('a', { ...opts, ...p }), F)).toBeNull();
    expect(unhideInGroup(nav('a', { ...opts, ...p }), F)).toEqual({ hiddenIn: [] });
    expect(unhideInGroup(nav('a'), F)).toBeNull();
  });
  it('setHidden toggles the global attribute', () => {
    const on = setHidden(opts, F, true);
    expect(on.hidden).toEqual(['form:F']);
    expect(setHidden({ ...opts, ...on }, F, false).hidden).toEqual([]);
  });
});
