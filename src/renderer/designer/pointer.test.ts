import { describe, expect, it } from 'vitest';
import type { ControlDef } from '../../shared/design/model';
import { gestureEnd, isTypingKey, keyAction, placeRect, typedLabel, type Gesture } from './pointer';

const noMods = { alt: false, shift: false };
const none = { ctrl: false, shift: false };
const moveFrom = (section: number): Gesture => ({ kind: 'move', section, origin: { x: 0, y: 0 } });
const bandFrom = (section: number): Gesture => ({ kind: 'band', section, origin: { x: 0, y: 0 } });

describe('pointer gestures', () => {
  it('drag converts px to twips (the reducer snaps)', () => expect(gestureEnd(moveFrom(1), { x: 10, y: 1, section: 1 }, noMods))
    .toEqual([{ type: 'moveBy', dx: 150, dy: 15, drop: { x: 150, y: 15 } }]));
  it('drop in another section', () => expect(gestureEnd(moveFrom(1), { x: 0, y: 40, section: 0 }, noMods)).toContainEqual(expect.objectContaining({ type: 'changeSection', to: 0 })));
  it('drop in another section is one action: the anchor lands at the point, with the horizontal move; Alt = free', () => {
    expect(gestureEnd(moveFrom(1), { x: 10, y: 40, section: 0 }, noMods)).toEqual([{ type: 'changeSection', to: 0, top: 600, dx: 150, drop: { x: 150, y: 600 } }]);
    expect(gestureEnd(moveFrom(1), { x: 0, y: 40, section: 0 }, { alt: true, shift: false })).toEqual([{ type: 'changeSection', to: 0, top: 600, free: true, drop: { x: 0, y: 600 } }]); });
  it('alt = free', () => expect(gestureEnd(moveFrom(1), { x: 10, y: 0, section: 1 }, { alt: true, shift: false })[0]).toMatchObject({ free: true }));
  it('a tiny move is a click', () => expect(gestureEnd(moveFrom(1), { x: 2, y: 2, section: 1 }, noMods)).toEqual([]));
  it('tiny band = click (no rect select)', () => expect(gestureEnd(bandFrom(1), { x: 2, y: 1, section: 1 }, noMods)).toEqual([{ type: 'select', selection: { kind: 'doc' } }]));
  it('band selects by rectangle, shift adds', () => expect(gestureEnd(bandFrom(1), { x: 100, y: 30, section: 1 }, { alt: false, shift: true }))
    .toEqual([{ type: 'selectRect', section: 1, rect: { left: 0, top: 0, width: 1500, height: 450 }, add: true }]));
  it('band drawn up and left is normalized', () => expect(gestureEnd({ kind: 'band', section: 0, origin: { x: 100, y: 30 } }, { x: 0, y: 0, section: 0 }, noMods))
    .toEqual([{ type: 'selectRect', section: 0, rect: { left: 0, top: 0, width: 1500, height: 450 }, add: false }]));
  it('resize and section height', () => {
    expect(gestureEnd({ kind: 'resize', handle: 'se', origin: { x: 0, y: 0 } }, { x: 10, y: 4, section: 0 }, { alt: true, shift: false }))
      .toEqual([{ type: 'resize', handle: 'se', dx: 150, dy: 60, free: true }]);
    expect(gestureEnd({ kind: 'sectionHeight', index: 2, origin: { y: 50 }, start: 1000 }, { x: 0, y: 40, section: 2 }, noMods))
      .toEqual([{ type: 'setSectionHeight', index: 2, height: 850 }]);
  });
  it('place with default size, or the drawn rectangle', () => { const g = { kind: 'place', tool: 'textBox', section: 1, origin: { x: 100, y: 20 } } as const;
    expect(gestureEnd(g, { x: 101, y: 21, section: 1 }, noMods)).toEqual([]);
    expect(placeRect(g, { x: 101, y: 21, section: 1 })).toEqual({ section: 1, rect: { left: 1500, top: 300, width: 1418, height: 340 } });
    expect(placeRect(g, { x: 200, y: 60, section: 1 }).rect).toEqual({ left: 1500, top: 300, width: 1500, height: 600 }); });
  it('keys', () => { expect(keyAction('ArrowRight', { ctrl: false, shift: false }, 142)).toEqual({ type: 'moveBy', dx: 142, dy: 0 });
    expect(keyAction('ArrowRight', { ctrl: true, shift: false }, 142)).toEqual({ type: 'moveBy', dx: 15, dy: 0, free: true });
    expect(keyAction('ArrowDown', { ctrl: false, shift: true }, 142)).toEqual({ type: 'resize', handle: 's', dx: 0, dy: 142 });
    expect(keyAction('Delete', none, 142)).toEqual({ type: 'deleteSelection' }); expect(keyAction('z', { ctrl: true, shift: false }, 142)).toEqual({ type: 'undo' }); });
  it('more keys', () => {
    expect(keyAction('ArrowUp', none, 142)).toEqual({ type: 'moveBy', dx: 0, dy: -142 });
    expect(keyAction('ArrowLeft', { ctrl: false, shift: true }, 142)).toEqual({ type: 'resize', handle: 'e', dx: -142, dy: 0 });
    expect(keyAction('ArrowLeft', { ctrl: true, shift: true }, 142)).toEqual({ type: 'resize', handle: 'e', dx: -15, dy: 0, free: true });
    expect(keyAction('A', { ctrl: true, shift: false }, 142)).toEqual({ type: 'selectAll' });
    expect(keyAction('y', { ctrl: true, shift: false }, 142)).toEqual({ type: 'redo' });
    expect(keyAction('Escape', none, 142)).toEqual({ type: 'select', selection: { kind: 'doc' } });
    expect(keyAction('a', none, 142)).toBeNull(); expect(keyAction('Delete', { ctrl: true, shift: false }, 142)).toBeNull();
  });
});

describe('gestureEnd enclosed', () => {
  it('carries enclosed into selectRect only when true', () => {
    expect(gestureEnd({ kind: 'band', section: 1, origin: { x: 0, y: 0 } }, { x: 100, y: 30, section: 1 }, { alt: false, shift: false, enclosed: true }))
      .toEqual([{ type: 'selectRect', section: 1, rect: { left: 0, top: 0, width: 1500, height: 450 }, add: false, enclosed: true }]);
  });
});

describe('isTypingKey', () => {
  const k = (key: string, m: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => isTypingKey({ key, ctrlKey: false, altKey: false, metaKey: false, ...m });
  it('printable characters, space included', () => { for (const key of ['a', 'é', ' ', '1']) expect(k(key)).toBe(true); });
  it('named keys are not typing', () => { for (const key of ['Enter', 'Escape', 'Delete', 'ArrowLeft', 'F2', 'Tab']) expect(k(key)).toBe(false); });
  it('AltGr characters (reported as Ctrl+Alt on Windows) are typing; Ctrl+letter stays a shortcut', () => {
    const altGr = (key: string, ctrlKey = true, altKey = true) => isTypingKey({ key, ctrlKey, altKey, metaKey: false, getModifierState: (m) => m === 'AltGraph' });
    for (const key of ['@', '€', '#', '{', '[']) expect(altGr(key)).toBe(true);
    expect(isTypingKey({ key: 'a', ctrlKey: true, altKey: true, metaKey: false, getModifierState: () => false })).toBe(false);
  });
  it('Ctrl, Alt or Meta is a shortcut', () => { for (const m of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) expect(k('a', m)).toBe(false); });
});

describe('typedLabel', () => {
  it('sets the Caption and keeps the host label name and rect', () => {
    const l: ControlDef = { kind: 'label', name: 'Etiquette1', left: 10, top: 20, width: 300, height: 240, props: { FontSize: 9 } };
    expect(typedLabel([l], 'Bonjour')).toEqual([{ ...l, props: { FontSize: 9, Caption: 'Bonjour' } }]);
  });
});
