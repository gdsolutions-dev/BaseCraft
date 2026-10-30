import { expect, it } from 'vitest';
import { DEFAULT_STARTUP } from '../../shared/startup';
import { FAILURE_NUMBERS, type RunOutcome } from '../macro/engine';
import { FULL_UI, RUNTIME_UI, baseUi, currentUi, publishUi, runStartup, startupUi, type StartupDeps } from './startup';

/** Fake deps recording their calls in order. */
function deps(over: Partial<StartupDeps> = {}): StartupDeps & { calls: string[] } {
  const calls: string[] = [];
  const d: StartupDeps = {
    setUi: (ui) => { calls.push(`setUi:${ui.ribbon}${ui.runMode ? ':run' : ''}`); },
    setNav: (v) => { calls.push(`setNav:${v}`); },
    openForm: async () => 'opened',
    runAutoExec: async () => ({ ok: true }),
    formNotFound: async () => {},
    stillCurrent: () => true,
    ...over,
  };
  const rec = <K extends 'openForm' | 'runAutoExec' | 'formNotFound'>(k: K) =>
    (async (name: string) => { calls.push(`${k}:${name}`); return d[k](name); }) as StartupDeps[K];
  return { ...d, openForm: rec('openForm'), runAutoExec: rec('runAutoExec'), formNotFound: rec('formNotFound'), calls };
}

it('the UI the options ask for: run mode implies the simplified ribbon', () => {
  expect(startupUi(DEFAULT_STARTUP)).toEqual(FULL_UI);
  expect(startupUi({ ...DEFAULT_STARTUP, ribbon: 'simplified' })).toEqual({ ...FULL_UI, ribbon: 'simplified' });
  expect(startupUi({ ...DEFAULT_STARTUP, runMode: true })).toEqual({ ...FULL_UI, ribbon: 'simplified', runMode: true });
});

it('the two base UIs show every switch', () => {
  const on = { statusBar: true, documentTabs: true, specialKeys: true, shortcutMenus: true, datasheetDesign: true };
  expect(FULL_UI).toEqual({ ribbon: 'full', runMode: false, ...on });
  expect(RUNTIME_UI).toEqual({ ribbon: 'simplified', runMode: true, ...on });
});

it('the switches come from the options', () => {
  const o = { ...DEFAULT_STARTUP, statusBar: false, documentTabs: false, specialKeys: false, shortcutMenus: false, datasheetDesign: false };
  expect(startupUi(o, false)).toEqual({ ...FULL_UI, statusBar: false, documentTabs: false, specialKeys: false, shortcutMenus: false, datasheetDesign: false });
  // compact on close and the icon for forms are not UI flags: App and the main process read them elsewhere
  expect(startupUi({ ...DEFAULT_STARTUP, compactOnClose: true, iconForForms: true }, false)).toEqual(FULL_UI);
});

it('full menus off is run mode, the pane still follows its option', async () => {
  expect(startupUi({ ...DEFAULT_STARTUP, fullMenus: false }, false)).toEqual({ ...FULL_UI, ribbon: 'simplified', runMode: true });
  const d = deps(); await runStartup({ ...DEFAULT_STARTUP, fullMenus: false }, null, false, d);
  expect(d.calls).toEqual(['setUi:simplified:run', 'setNav:true']);
});

it('the Runtime keeps the base\'s switches', () => {
  expect(startupUi({ ...DEFAULT_STARTUP, specialKeys: false, shortcutMenus: false, statusBar: false }, true))
    .toEqual({ ...RUNTIME_UI, specialKeys: false, shortcutMenus: false, statusBar: false });
  expect(startupUi(DEFAULT_STARTUP, true)).toEqual(RUNTIME_UI);
});

it('the UI App shows now is one module value', () => {
  const was = currentUi();
  expect(was).toEqual(baseUi());   // before any opening
  const ui = { ...FULL_UI, datasheetDesign: false };
  publishUi(ui); expect(currentUi()).toBe(ui);
  publishUi(was); expect(currentUi()).toBe(was);
});

it('order: UI, startup form, AutoExec', async () => {
  const d = deps({ openForm: async () => 'opened', runAutoExec: async () => ({ ok: true }) });
  await runStartup({ ...DEFAULT_STARTUP, startupForm: 'FMenu', showNavPane: false, runMode: true }, 'AutoExec', false, d);
  expect(d.calls).toEqual(['setUi:simplified:run', 'setNav:false', 'openForm:FMenu', 'runAutoExec:AutoExec']);
});

it('run mode hides the Navigation Pane whatever showNavPane says; no form, no AutoExec: nothing opened', async () => {
  const d = deps();
  expect(await runStartup({ ...DEFAULT_STARTUP, runMode: true }, null, false, d)).toEqual({ autoExecBlocked: false });
  expect(d.calls).toEqual(['setUi:simplified:run', 'setNav:false']);
});

it('bypass runs nothing', async () => {
  const d = deps();
  expect(await runStartup({ ...DEFAULT_STARTUP, startupForm: 'FMenu', runMode: true }, 'AutoExec', true, d)).toEqual({ autoExecBlocked: false });
  expect(d.calls).toEqual([]);
});

it('a missing startup form is reported, AutoExec still runs', async () => {
  const d = deps({ openForm: async () => 'notFound', runAutoExec: async () => ({ ok: true }) });
  await runStartup({ ...DEFAULT_STARTUP, startupForm: 'Absent' }, 'AutoExec', false, d);
  expect(d.calls).toEqual(['setUi:full', 'setNav:true', 'openForm:Absent', 'formNotFound:Absent', 'runAutoExec:AutoExec']);
});

it('a cancelled startup form is silent, AutoExec still runs', async () => {
  const d = deps({ openForm: async () => 'cancelled' });
  await runStartup({ ...DEFAULT_STARTUP, startupForm: 'FMenu' }, 'AutoExec', false, d);
  expect(d.calls).toEqual(['setUi:full', 'setNav:true', 'openForm:FMenu', 'runAutoExec:AutoExec']);
});

it('AutoExec blocked is remembered', async () => {
  const blocked: RunOutcome = { ok: false, failure: { macro: 'AutoExec', action: 'RunSQL', raw: {}, code: 'blocked', number: FAILURE_NUMBERS.blocked } };
  expect(await runStartup(DEFAULT_STARTUP, 'AutoExec', false, deps({ runAutoExec: async () => blocked }))).toEqual({ autoExecBlocked: true });
  const other: RunOutcome = { ok: false, failure: { macro: 'AutoExec', action: 'RunMacro', raw: {}, code: 'tooDeep', number: FAILURE_NUMBERS.tooDeep } };
  expect(await runStartup(DEFAULT_STARTUP, 'AutoExec', false, deps({ runAutoExec: async () => other }))).toEqual({ autoExecBlocked: false });
  expect(await runStartup(DEFAULT_STARTUP, 'AutoExec', false, deps({ runAutoExec: async () => null }))).toEqual({ autoExecBlocked: false });
});

it('stops when another base took over', async () => {
  const d = deps({ openForm: async () => 'opened', stillCurrent: () => false });
  await runStartup({ ...DEFAULT_STARTUP, startupForm: 'FMenu' }, 'AutoExec', false, d);
  expect(d.calls).not.toContain('runAutoExec:AutoExec');
});

it('the Runtime is always in run mode', () => {
  expect(baseUi(true)).toEqual(RUNTIME_UI); expect(baseUi(false)).toEqual(FULL_UI);
  expect(startupUi(DEFAULT_STARTUP, true)).toEqual(RUNTIME_UI); expect(startupUi({ ...DEFAULT_STARTUP, ribbon: 'full' }, true)).toEqual(RUNTIME_UI);
});

it('the pane follows the base, not the forced run mode', async () => {   // R3: a plain base keeps its pane in the Runtime
  const d = deps(); await runStartup(DEFAULT_STARTUP, null, false, d);   // the pane rule reads o only, so it is the same in both products
  expect(d.calls).toContain('setNav:true');
  const e = deps(); await runStartup({ ...DEFAULT_STARTUP, runMode: true }, null, false, e); expect(e.calls).toContain('setNav:false');
});
