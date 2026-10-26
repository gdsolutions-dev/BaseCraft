import { expect, it } from 'vitest';
import { DEFAULT_STARTUP } from '../../shared/startup';
import { FAILURE_NUMBERS, type RunOutcome } from '../macro/engine';
import { FULL_UI, runStartup, startupUi, type StartupDeps } from './startup';

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
  expect(startupUi({ ...DEFAULT_STARTUP, ribbon: 'simplified' })).toEqual({ ribbon: 'simplified', runMode: false });
  expect(startupUi({ ...DEFAULT_STARTUP, runMode: true })).toEqual({ ribbon: 'simplified', runMode: true });
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
