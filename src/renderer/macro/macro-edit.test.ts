import { describe, expect, it } from 'vitest';
import type { MacroItem } from '../../shared/macro/model';
import { addPoint, addableActions, initialEdit, macroEdit, pathKey } from './macro-edit';

const act = (action: string, args: Record<string, string> = {}): MacroItem => ({ k: 'action', action, args });
const names = (items: MacroItem[]) => items.map((i) => (i.k === 'action' ? i.action : i.k));
const s0 = initialEdit({ formatVersion: '1.0', items: [act('Beep'), { k: 'submacro', name: 'S', items: [] }] });

describe('macroEdit', () => {
  it('adds before the submacros and keeps them last', () => {
    const s = macroEdit(s0, { type: 'add', at: [2], item: act('Quit') });
    expect(names(s.def.items)).toEqual(['Beep', 'Quit', 'submacro']);
    expect(s.dirty).toBe(true);
    expect(s.selected).toEqual([1]);
  });

  it('a submacro is always appended at the top level', () => {
    const g = macroEdit(s0, { type: 'add', at: [0], item: { k: 'group', name: 'G', items: [] } });
    const s = macroEdit(g, { type: 'add', at: [0, 0], item: { k: 'submacro', name: 'T', items: [] } });
    expect(names(s.def.items)).toEqual(['group', 'Beep', 'submacro', 'submacro']);
    expect(s.selected).toEqual([3]);
  });

  it('adds inside an If branch and its Else', () => {
    let s = macroEdit(s0, { type: 'add', at: [1], item: { k: 'if', branches: [{ cond: 'True', items: [] }], else: [] } });
    s = macroEdit(s, { type: 'add', at: [1, 0, 0], item: act('Beep') });
    s = macroEdit(s, { type: 'add', at: [1, -1, 0], item: act('Quit') });
    expect(s.def.items[1]).toEqual({ k: 'if', branches: [{ cond: 'True', items: [act('Beep')] }], else: [act('Quit')] });
  });

  it('move cannot cross a submacro', () => expect(macroEdit(s0, { type: 'move', path: [0], dir: 1 }).def).toEqual(s0.def));

  it('move stays inside its block', () => {
    const s = initialEdit({ formatVersion: '1.0', items: [{ k: 'group', name: 'G', items: [act('Beep'), act('Quit')] }, act('StopMacro')] });
    const m = macroEdit(s, { type: 'move', path: [0, 1], dir: 1 });
    expect(m).toBe(s);
    const up = macroEdit(s, { type: 'move', path: [0, 1], dir: -1 });
    expect(up.def.items[0]).toEqual({ k: 'group', name: 'G', items: [act('Quit'), act('Beep')] });
    expect(up.selected).toEqual([0, 0]);
    expect(up.dirty).toBe(true);
  });

  it('else if and else', () => {
    let s = macroEdit(s0, { type: 'add', at: [1], item: { k: 'if', branches: [{ cond: 'True', items: [] }] } });
    s = macroEdit(s, { type: 'addElseIf', path: [1] });
    s = macroEdit(s, { type: 'addElse', path: [1] });
    expect(s.def.items[1]).toEqual({ k: 'if', branches: [{ cond: 'True', items: [] }, { cond: '', items: [] }], else: [] });
    s = macroEdit(s, { type: 'setCondition', path: [1], branch: 1, cond: 'False' });
    expect(s.def.items[1]).toMatchObject({ branches: [{ cond: 'True' }, { cond: 'False' }] });
  });

  it('removing the last branch of an If removes the If; the Else goes alone', () => {
    let s = initialEdit({ formatVersion: '1.0', items: [{ k: 'if', branches: [{ cond: 'A', items: [] }, { cond: 'B', items: [] }], else: [act('Beep')] }] });
    s = macroEdit(s, { type: 'remove', path: [0, -1] });
    expect(s.def.items[0]).toEqual({ k: 'if', branches: [{ cond: 'A', items: [] }, { cond: 'B', items: [] }] });
    s = macroEdit(s, { type: 'remove', path: [0, 0] });
    expect(s.def.items[0]).toEqual({ k: 'if', branches: [{ cond: 'B', items: [] }] });
    s = macroEdit(s, { type: 'remove', path: [0, 0] });
    expect(s.def.items).toEqual([]);
  });

  it('removes an item inside a group', () => {
    const s = initialEdit({ formatVersion: '1.0', items: [{ k: 'group', name: 'G', items: [act('Beep'), act('Quit')] }] });
    const r = macroEdit({ ...s, selected: [0, 0] }, { type: 'remove', path: [0, 0] });
    expect(r.def.items[0]).toEqual({ k: 'group', name: 'G', items: [act('Quit')] });
    expect(r.selected).toBeNull();
  });

  it('setArg keeps unknown keys and removes on undefined', () => {
    const item = { k: 'action', action: 'OpenForm', args: { FormName: 'F', X: '1' }, note: 'n' } as MacroItem;
    let s = initialEdit({ formatVersion: '1.0', items: [item] });
    s = macroEdit(s, { type: 'setArg', path: [0], name: 'View', value: 'design' });
    s = macroEdit(s, { type: 'setArg', path: [0], name: 'FormName', value: undefined });
    expect(s.def.items[0]).toEqual({ k: 'action', action: 'OpenForm', args: { X: '1', View: 'design' }, note: 'n' });
    expect(s.dirty).toBe(true);
  });

  it('setText sets a comment text, a group or submacro name', () => {
    let s = initialEdit({ formatVersion: '1.0', items: [{ k: 'comment', text: '' }, { k: 'group', name: '', items: [] }, { k: 'submacro', name: 'S', items: [] }] });
    s = macroEdit(s, { type: 'setText', path: [0], text: 'note' });
    s = macroEdit(s, { type: 'setText', path: [1], text: 'G' });
    s = macroEdit(s, { type: 'setText', path: [2], text: 'T' });
    expect(s.def.items).toEqual([{ k: 'comment', text: 'note' }, { k: 'group', name: 'G', items: [] }, { k: 'submacro', name: 'T', items: [] }]);
  });

  it('collapse, collapseAll, toggles, select and saved', () => {
    const g = initialEdit({ formatVersion: '1.0', items: [{ k: 'group', name: 'G', items: [act('Beep')] }, act('Quit')] });
    let s = macroEdit(g, { type: 'collapse', path: [0, 0], on: true });
    expect([...s.collapsed]).toEqual([pathKey([0, 0])]);
    expect(s.dirty).toBe(false);
    s = macroEdit(s, { type: 'collapseAll', on: true });
    expect([...s.collapsed].sort()).toEqual(['0', '0.0', '1']);
    s = macroEdit(s, { type: 'collapseAll', on: false });
    expect(s.collapsed.size).toBe(0);
    s = macroEdit(s, { type: 'toggleCatalog' });
    s = macroEdit(s, { type: 'toggleShowAll' });
    s = macroEdit(s, { type: 'select', path: [1] });
    expect([s.catalog, s.showAll, s.selected]).toEqual([true, true, [1]]);
    s = macroEdit(macroEdit(s, { type: 'remove', path: [1] }), { type: 'saved' });
    expect(s.dirty).toBe(false);
  });
});

describe('addableActions', () => {
  it('unsafe actions only with Show All Actions', () => {
    expect(addableActions(false).map((a) => a.name)).not.toContain('RunSQL');
    expect(addableActions(true).map((a) => a.name)).toContain('RunSQL');
    expect(addableActions(false).map((a) => a.name)).not.toContain('SetValue');
    expect(addableActions(true).map((a) => a.name)).toContain('SetValue');
    expect(addableActions(false).map((a) => a.name)).toContain('SetProperty');   // the safe way to set a control's value (R5)
  });
});

describe('addPoint (the Action Catalog adds there)', () => {
  const def = { formatVersion: '1.0' as const, items: [act('Beep'), { k: 'if' as const, branches: [{ cond: '1', items: [act('Quit')] }] },
    { k: 'submacro' as const, name: 'S', items: [] }] };
  const at = (selected: number[] | null) => addPoint({ ...initialEdit(def), selected });
  it('after the selected item, at the end of a selected branch, else at the end of the main body', () => {
    expect(at([0])).toEqual([1]);
    expect(at([1, 0, 0])).toEqual([1, 0, 1]);
    const inBranch = macroEdit(initialEdit(def), { type: 'add', at: at([1, 0]), item: act('Beep') }).def.items[1];
    expect(inBranch.k === 'if' && names(inBranch.branches[0].items)).toEqual(['Quit', 'Beep']);
    expect(names(macroEdit(initialEdit(def), { type: 'add', at: at(null), item: act('Quit') }).def.items)).toEqual(['Beep', 'if', 'Quit', 'submacro']);
  });
});
