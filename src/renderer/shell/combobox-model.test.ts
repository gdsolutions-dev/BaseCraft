import { describe, it, expect } from 'vitest';
import { CLOSED, comboKey, placeList, typed, visibleOptions, type ComboOption } from './combobox-model';

const OPTS: ComboOption[] = [
  { id: 'generalNumber', label: 'Nombre général' }, { id: 'currency', label: 'Monétaire' }, { id: 'fixed', label: 'Fixe' },
];

describe('combobox model', () => {
  it('filters on the typed text, ignoring case and accents; null shows all', () => {
    expect(visibleOptions(OPTS, null)).toEqual(OPTS);
    expect(visibleOptions(OPTS, 'monet').map((o) => o.id)).toEqual(['currency']);
    expect(visibleOptions(OPTS, 'É').map((o) => o.id)).toEqual(['generalNumber', 'currency', 'fixed']);
    expect(visibleOptions(OPTS, 'zz')).toEqual([]);
  });

  it('typing keeps the text as typed: the list shows the matches, none is active', () => {
    expect(typed(OPTS, 'fi')).toEqual({ open: true, filter: 'fi', active: -1 });
    expect(typed(OPTS, '0.00 €')).toEqual({ open: false, filter: '0.00 €', active: -1 }); // free text: no match, no list
    expect(typed(OPTS, '').open).toBe(false);
    // Enter on free text picks nothing and lets the key go
    expect(comboKey(typed(OPTS, '0.00 €'), 'Enter', false, OPTS, '0.00 €')).toEqual({ state: CLOSED, handled: false });
  });

  it('ArrowDown opens on the current value (or the first), then moves and wraps; Enter picks', () => {
    let r = comboKey(CLOSED, 'ArrowDown', false, OPTS, '');
    expect(r).toEqual({ state: { open: true, filter: null, active: 0 }, handled: true });
    r = comboKey(CLOSED, 'ArrowDown', false, OPTS, 'Monétaire');
    expect(r.state.active).toBe(1);
    r = comboKey(r.state, 'ArrowDown', false, OPTS, 'Monétaire');
    expect(r.state.active).toBe(2);
    r = comboKey(r.state, 'ArrowDown', false, OPTS, 'Monétaire');
    expect(r.state.active).toBe(0);
    r = comboKey(r.state, 'ArrowUp', false, OPTS, 'Monétaire');
    expect(r.state.active).toBe(2);
    expect(comboKey(r.state, 'Enter', false, OPTS, 'Monétaire')).toEqual({ state: CLOSED, pick: OPTS[2], handled: true });
  });

  it('moves within the filtered options only', () => {
    const r = comboKey(typed(OPTS, 'fi'), 'ArrowDown', false, OPTS, 'fi');
    expect(comboKey(r.state, 'Enter', false, OPTS, 'fi').pick).toEqual(OPTS[2]);
  });

  it('Alt+ArrowDown opens without moving; Escape closes (handled only when open); Tab closes and leaves', () => {
    const r = comboKey(CLOSED, 'ArrowDown', true, OPTS, 'zz');
    expect(r).toEqual({ state: { open: true, filter: null, active: -1 }, handled: true });
    expect(comboKey(r.state, 'Escape', false, OPTS, '')).toEqual({ state: CLOSED, handled: true });
    expect(comboKey(CLOSED, 'Escape', false, OPTS, '')).toEqual({ state: CLOSED, handled: false });
    expect(comboKey(r.state, 'Tab', false, OPTS, '')).toEqual({ state: CLOSED, handled: false });
  });

  it('Alt+ArrowUp closes the open list without moving or picking', () => {
    expect(comboKey({ open: true, filter: null, active: 1 }, 'ArrowUp', true, OPTS, '')).toEqual({ state: CLOSED, handled: true });
  });

  it('opens the list on the roomier side, then keeps that side while the filter narrows it', () => {
    const field = { left: 10, top: 500, bottom: 528, width: 200 }; // in a 600px window: 68px free below, 496 above
    const above = { left: 10, minWidth: 200, maxHeight: 240, bottom: 102 };
    const opened = placeList(field, 600, 200, null);
    expect(opened).toEqual({ down: false, style: above });
    expect(placeList(field, 600, 30, opened.down)).toEqual({ down: false, style: above }); // one option left: no jump
    expect(placeList(field, 600, 30, null)).toEqual({ down: true, style: { left: 10, minWidth: 200, maxHeight: 68, top: 530 } });
  });

  it('without options the keys do nothing', () => {
    expect(comboKey(CLOSED, 'ArrowDown', false, [], '')).toEqual({ state: CLOSED, handled: false });
  });
});
