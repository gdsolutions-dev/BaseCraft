import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/settings-defaults';
import { editKey, entryCaret, nextCell, type EditKey } from './edit-keys';

const P = DEFAULT_SETTINGS;
const k = (key: string, o: Partial<EditKey> = {}): EditKey => ({ key, shift: false, ctrl: false, alt: false, meta: false, composing: false, caret: null, editing: false, grid: false, continuous: false, multiline: false, ...o });
const text = (start: number, end: number, length: number) => ({ caret: { start, end, length } });

describe('editKey', () => {
  it('Enter follows Move after Enter', () => {
    expect(editKey(k('Enter'), P)).toEqual({ to: 'field', dir: 1, stopAtEnds: false });
    expect(editKey(k('Enter'), { ...P, moveAfterEnter: 'nextRecord' })).toEqual({ to: 'record', dir: 1 });
    expect(editKey(k('Enter'), { ...P, moveAfterEnter: 'none' })).toEqual({ to: 'stay' });
    expect(editKey(k('Enter', { multiline: true }), P)).toEqual({ to: 'pass' });
    expect(editKey(k('Enter', { shift: true }), P)).toEqual({ to: 'pass' });
    expect(editKey(k('Enter', { composing: true }), P)).toEqual({ to: 'pass' });
    expect(editKey(k('Enter'), { ...P, cursorStopsAtEnds: true })).toEqual({ to: 'field', dir: 1, stopAtEnds: false });   // the stop: arrows only
  });
  it('arrows, next field: navigation moves, edit mode keeps the caret; the stop applies to arrows only', () => {
    expect(editKey(k('ArrowRight', text(0, 4, 4)), P)).toEqual({ to: 'field', dir: 1, stopAtEnds: false });
    expect(editKey(k('ArrowRight', { ...text(2, 2, 4), editing: true }), P)).toEqual({ to: 'pass' });
    expect(editKey(k('ArrowDown'), { ...P, cursorStopsAtEnds: true })).toEqual({ to: 'field', dir: 1, stopAtEnds: true });
    expect(editKey(k('ArrowDown', { grid: true }), P)).toEqual({ to: 'pass' });
    expect(editKey(k('ArrowUp', { multiline: true }), P)).toEqual({ to: 'pass' });
    expect(editKey(k('ArrowUp', { ...text(2, 2, 4), editing: true }), P)).toEqual({ to: 'field', dir: -1, stopAtEnds: false });
  });
  it('arrows, next character', () => {
    const C = { ...P, arrowKeyBehavior: 'nextCharacter' as const };
    expect(editKey(k('ArrowRight', text(4, 4, 4)), C)).toEqual({ to: 'field', dir: 1, stopAtEnds: false });
    expect(editKey(k('ArrowLeft', text(0, 0, 4)), C)).toEqual({ to: 'field', dir: -1, stopAtEnds: false });
    expect(editKey(k('ArrowRight', text(0, 4, 4)), C)).toEqual({ to: 'caret', at: 'end' });
    expect(editKey(k('ArrowLeft', text(0, 4, 4)), C)).toEqual({ to: 'caret', at: 'start' });
    expect(editKey(k('ArrowRight', text(1, 1, 4)), C)).toEqual({ to: 'pass' });
    expect(editKey(k('ArrowRight', text(1, 3, 4)), C)).toEqual({ to: 'pass' });
    expect(editKey(k('ArrowRight'), C)).toEqual({ to: 'field', dir: 1, stopAtEnds: false });   // a check box
  });
  it('continuous forms: Up/Down or Left/Right are records', () => {
    expect(editKey(k('ArrowUp', { continuous: true }), { ...P, continuousArrowKeys: 'upDown' })).toEqual({ to: 'record', dir: -1 });
    expect(editKey(k('ArrowRight', { continuous: true, ...text(0, 3, 3) }), { ...P, continuousArrowKeys: 'leftRight' })).toEqual({ to: 'record', dir: 1 });
    expect(editKey(k('ArrowUp'), { ...P, continuousArrowKeys: 'upDown' })).toEqual({ to: 'field', dir: -1, stopAtEnds: false });   // a single form
    expect(editKey(k('ArrowDown', { continuous: true, multiline: true }), { ...P, continuousArrowKeys: 'upDown' })).toEqual({ to: 'record', dir: 1 });
  });
  it('F2 toggles navigation and edit', () => {
    expect(editKey(k('F2', text(0, 3, 3)), P)).toEqual({ to: 'caret', at: 'end' });
    expect(editKey(k('F2', { ...text(3, 3, 3), editing: true }), P)).toEqual({ to: 'caret', at: 'all' });
  });
  it('leaves every other key, and any key with Ctrl, Alt (AltGr), Meta or while composing, to the entry', () => {
    for (const key of ['a', 'é', 'Dead', 'Process', 'Home', 'End', 'Tab', 'Escape', 'PageDown', 'Backspace']) expect(editKey(k(key, text(0, 0, 4)), P)).toEqual({ to: 'pass' });
    for (const o of [{ ctrl: true }, { alt: true }, { meta: true }, { composing: true }, { shift: true }])
      for (const key of ['ArrowRight', 'ArrowDown', 'F2']) expect(editKey(k(key, { ...text(0, 4, 4), ...o }), P)).toEqual({ to: 'pass' });
  });
});

describe('nextCell', () => {
  it('wraps through records unless stopped', () => {
    expect(nextCell([0, 0], 1, 3, 5, false)).toEqual([1, 0]);
    expect(nextCell([2, 0], 1, 3, 5, false)).toEqual([0, 1]); expect(nextCell([2, 0], 1, 3, 5, true)).toBeNull();
    expect(nextCell([0, 1], -1, 3, 5, false)).toEqual([2, 0]); expect(nextCell([0, 0], -1, 3, 5, false)).toBeNull();
    expect(nextCell([2, 4], 1, 3, 5, false)).toBeNull();   // Review Focus 3: the sheet's last cell
  });
});

describe('entryCaret', () => {
  it('selects all, or puts the caret at the start or the end', () => {
    expect(entryCaret(5, 'selectAll')).toEqual([0, 5]); expect(entryCaret(5, 'start')).toEqual([0, 0]); expect(entryCaret(5, 'end')).toEqual([5, 5]);
  });
});
