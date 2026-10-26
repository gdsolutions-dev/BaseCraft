// La séquence de démarrage d'une base (B3 R3) : l'interface que demandent ses options, son formulaire de démarrage, puis AutoExec.
// Sans E/S : App fournit ce qu'elle touche (StartupDeps).
import type { StartupOptions } from '../../shared/startup';
import type { RunOutcome } from '../macro/engine';

export interface StartupUi { ribbon: 'full' | 'simplified'; runMode: boolean }
export const FULL_UI: StartupUi = Object.freeze({ ribbon: 'full', runMode: false });

/** Run mode implies the simplified ribbon (R10). */
export function startupUi(o: StartupOptions): StartupUi {
  return o.runMode ? { ribbon: 'simplified', runMode: true } : { ribbon: o.ribbon, runMode: false };
}

export interface StartupDeps {
  setUi(ui: StartupUi): void;
  /** dispatch setNav { visible, strip: visible } */
  setNav(visible: boolean): void;
  /** The stored name (sameName), dispatch open 'run', then whenFormOpened. */
  openForm(name: string): Promise<'opened' | 'notFound' | 'cancelled'>;
  /** runMacroByName */
  runAutoExec(name: string): Promise<RunOutcome | null>;
  /** modal: startup.formNotFound */
  formNotFound(name: string): Promise<void>;
  /** The same opening (no other base meanwhile). */
  stillCurrent(): boolean;
}

/** R3 steps 2–4; bypass: nothing. Resolves whether AutoExec stopped on a blocked action (R6). */
export async function runStartup(o: StartupOptions, autoExec: string | null, bypass: boolean, d: StartupDeps): Promise<{ autoExecBlocked: boolean }> {
  const none = { autoExecBlocked: false };
  if (bypass) return none;
  d.setUi(startupUi(o));
  d.setNav(o.showNavPane && !o.runMode);   // run mode hides the Navigation Pane (R10)
  if (o.startupForm) {
    const r = await d.openForm(o.startupForm);
    if (!d.stillCurrent()) return none;
    if (r === 'notFound') await d.formNotFound(o.startupForm);   // R8: a cancelled On Open is silent (its own macro explains)
  }
  if (!autoExec || !d.stillCurrent()) return none;
  const outcome = await d.runAutoExec(autoExec);
  return { autoExecBlocked: outcome?.ok === false && outcome.failure.code === 'blocked' };
}
