import { expect, it } from 'vitest';
import { shiftHeld, trackShift } from './shift-key';

const keyEvent = (type: string, key: string, shiftKey: boolean) => Object.assign(new Event(type), { key, shiftKey });
const mouseEvent = (type: string, init: { shiftKey: boolean }) => Object.assign(new Event(type), init);

it('follows Shift and forgets it on blur', () => {
  const t = new EventTarget(); const off = trackShift(t);
  t.dispatchEvent(keyEvent('keydown', 'Shift', true)); expect(shiftHeld()).toBe(true);
  t.dispatchEvent(keyEvent('keyup', 'Shift', false)); expect(shiftHeld()).toBe(false);
  t.dispatchEvent(mouseEvent('mousemove', { shiftKey: true })); expect(shiftHeld()).toBe(true);
  t.dispatchEvent(new Event('blur')); expect(shiftHeld()).toBe(false); off();
});

it('a Shift key event decides by its type; once stopped, the target is no longer followed', () => {
  const t = new EventTarget(); const off = trackShift(t);
  t.dispatchEvent(keyEvent('keyup', 'Shift', true)); expect(shiftHeld()).toBe(false);   // some platforms keep the flag on its own keyup
  t.dispatchEvent(keyEvent('keydown', 'a', true)); expect(shiftHeld()).toBe(true);
  t.dispatchEvent(new Event('blur')); off();
  t.dispatchEvent(mouseEvent('pointerdown', { shiftKey: true })); expect(shiftHeld()).toBe(false);
});
