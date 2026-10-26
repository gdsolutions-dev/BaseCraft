import { beforeEach, expect, it, vi } from 'vitest';
import type { EventBinding } from '../../shared/design/events';
import type { DesignDoc } from '../../shared/design/model';
import type { EventContext } from '../macro/engine';

const runs: { binding: EventBinding; ctx: EventContext; done(cancel: boolean): void }[] = [];
vi.mock('../macro/macro-shell', () => ({
  runEvent: (binding: EventBinding, ctx: EventContext) => new Promise<boolean>((done) => { runs.push({ binding, ctx, done }); }),
}));
const { FormEvents } = await import('./form-events');

const ctl = { kind: 'textBox' as const, name: 'Nom', left: 0, top: 0, width: 1, height: 1, props: { OnExit: 'MSortie', OnClick: '[Event Procedure]' } };
const doc = (props: Record<string, unknown>): DesignDoc => ({ formatVersion: '1.0', recordSource: null, props, sections: [{ kind: 'detail', height: 1, props: {}, controls: [ctl] }] });
const base = { locale: 'fr-FR', lang: 'fr' as const, now: () => new Date() };
const tick = () => new Promise((r) => setTimeout(r, 0));
beforeEach(() => { runs.length = 0; });

it('raises only events bound to a macro, with the form or the control as its object', async () => {
  const h = new FormEvents(doc({ BeforeUpdate: 'MAvant' }), 'F', base);
  expect(await h.raise('OnClick', ctl)).toBe(false);   // [Event Procedure]: kept, does nothing (R1)
  expect(await h.raise('OnLoad')).toBe(false);
  expect(runs).toHaveLength(0);
  const exit = h.raise('OnExit', ctl);
  expect(runs[0]!.ctx).toMatchObject({ object: { kind: 'form', name: 'F' }, event: 'OnExit', control: 'Nom', cancellable: true });
  runs[0]!.done(true);
  expect(await exit).toBe(true);
});

it('record events: only those the form has; On Current waits for On Load', async () => {
  const h = new FormEvents(doc({ BeforeUpdate: 'MAvant', OnCurrent: 'MCourant' }), 'F', base);
  const ev = h.recordEvents();
  expect(Object.keys(ev).sort()).toEqual(['beforeUpdate', 'current']);
  ev.current!();
  expect(runs).toHaveLength(0);   // before On Load
  void h.start();   // no records: not ready, no On Current yet
  ev.current!();
  expect(runs.map((r) => r.ctx.event)).toEqual(['OnCurrent']);
});

it('a control\'s events run one after another, after a Before Insert under way; a save waits for them, unless asked from inside one', async () => {
  const h = new FormEvents(doc({ BeforeInsert: 'MInsert' }), 'F', base);
  expect(h.idle()).toBeNull();
  const insert = h.recordEvents().beforeInsert!();
  const order: string[] = [];
  const a = h.serial(async () => { order.push('a'); expect(h.busy).toBe(true); expect(h.idle()).toBeNull(); return true; });
  const b = h.serial(async () => { order.push('b'); return false; });
  const idle = h.idle();
  expect(idle).not.toBeNull();
  await tick();
  expect(order).toEqual([]);   // Before Insert first
  runs[0]!.done(false);
  expect(await insert).toBe(true);
  expect([await a, await b]).toEqual([true, false]);
  await idle;
  expect(order).toEqual(['a', 'b']);
  expect(h.idle()).toBeNull();
});

it('control events raised while an event macro runs nest inside it (R6), on its own chain', async () => {
  const h = new FormEvents(doc({}), 'F', base);
  const order: string[] = [];
  const outerBusy = h.serial(async () => { order.push('queued before'); return true; });
  await outerBusy;
  const exit = h.raise('OnExit', ctl);   // its macro is running
  const inner = h.serial(async () => { order.push('inner'); return true; });
  expect(h.idle()).toBeNull();   // a save asked by the macro never waits for the outer queue
  await h.drain();
  expect(order).toEqual(['queued before', 'inner']);   // before the macro ends
  runs[0]!.done(false);
  expect(await exit).toBe(false);
  expect(await inner).toBe(true);
  const after = h.serial(async () => { order.push('after'); return true; });
  await h.drain();
  expect(await after).toBe(true);
  expect(order).toEqual(['queued before', 'inner', 'after']);
});

it('a control event that throws resolves false (the chain goes on) and its error is logged, not swallowed', async () => {
  const h = new FormEvents(doc({}), 'F', base);
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const boom = new Error('boom');
  expect(await h.serial(async () => { throw boom; })).toBe(false);
  const exit = h.raise('OnExit', ctl);   // nested, inside a macro
  expect(await h.serial(async () => { throw boom; })).toBe(false);
  runs.at(-1)!.done(false);
  await exit;
  expect(logged.mock.calls).toEqual([[boom], [boom]]);
  logged.mockRestore();
});

it('SetProperty keeps runtime properties (R9) and the views get copies of those controls only', async () => {
  const { withOverrides } = await import('./form-events');
  const other = { ...ctl, name: 'Ville', props: {} };
  const d: DesignDoc = { formatVersion: '1.0', recordSource: null, props: {}, sections: [{ kind: 'detail', height: 1, props: {}, controls: [ctl, other] }] };
  const h = new FormEvents(d, 'F', base);
  let told = 0;
  h.subscribe(() => { told++; });
  h.setProperty('nom', 'visible', { t: 'bool', v: false });
  h.setProperty('Nom', 'width', { t: 'num', v: 567 });
  expect(told).toBe(2);
  expect(() => h.setProperty('Absent', 'visible', { t: 'bool', v: false })).toThrow('bc:notFound||Absent');
  expect(() => h.setProperty('Nom', 'caption', { t: 'str', v: 'x' })).toThrow('bc:propertyNotSupported');   // a text box has no Caption
  const shown = withOverrides(d, h.overrides);
  const [nom, ville] = shown.sections[0]!.controls;
  expect(nom).toMatchObject({ width: 567, props: { Visible: false } });
  expect(ctl.props).not.toHaveProperty('Visible');   // the design is left as it is
  expect(ville).toBe(other);
  expect(withOverrides(d, {})).toBe(d);
});

it('value: a control, else a field of the current record, with what is typed; else unknownField', () => {
  const h = new FormEvents(doc({}), 'F', base);
  h.view = { stored: () => ({}), extra: () => ({ Nom: { t: 'str', v: 'Dupont' } }), results: () => ({}) };
  expect(h.value('nom')).toEqual({ t: 'str', v: 'Dupont' });
  expect(() => h.value('Absent')).toThrow(expect.objectContaining({ code: 'unknownField' }));
});
