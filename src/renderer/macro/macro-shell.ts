// Le shell des macros : chaque action du catalogue que l'interpréteur ne fait pas lui-même, faite avec ce que l'application
// fait déjà (ouvrir un objet, imprimer un état, fermer un onglet, exécuter une requête action), et les variables temporaires
// de la base ouverte. App le branche (setMacroShell) ; runMacroByName exécute une macro et montre son échec.
import type { Value } from '../../shared/expr/ast';
import { foldName, sameName } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { parseMacroDef, submacroNames } from '../../shared/macro/model';
import { isSelectBody, type Query } from '../../shared/query/ast';
import { parseSql } from '../../shared/query/sql-parser';
import { api } from '../bridge';
import { i18n } from '../i18n';
import { runActionFlow } from '../query/run-action';
import { layoutSavedReport } from '../report/load';
import { askParameters, layoutEnv, outputReport } from '../report/ReportPreviewView';
import { contentBlocked } from '../shell/Banners';
import { bcErrorCode, type ModalApi } from '../shell/Modal';
import type { AppDispatch } from '../shell/nav-menu';
import { isDoc, type DocMode, type DocTab, type OpenArgs } from '../state/app-state';
import { runMacro, type ActionCall, type MacroHost, type RunOutcome, type StepInfo } from './engine';
import { showMacroFailed } from './MacroFailedDialog';
import { showMessageBox, type MessageBoxType } from './MessageBoxDialog';
import { askStep } from './SingleStepDialog';

export interface MacroShellDeps {
  dispatch: AppDispatch; modal: ModalApi; tabs(): readonly DocTab[]; active(): DocTab | null; contentEnabled(): boolean;
  closeTab(tab: DocTab): Promise<boolean>; closeBase(): Promise<boolean>; quit(): Promise<boolean>; region(): LocaleInfo; lang(): 'fr' | 'en';   // false: a document kept open
  showError(e: unknown): Promise<void>;
}

let shell: MacroShellDeps | null = null;
export function setMacroShell(d: MacroShellDeps | null): void { shell = d; }

/** The open base's temporary variables (TempVars): every run shares them; App clears them when the base closes or changes. */
const tempVars = new Map<string, Value>();
export function clearTempVars(): void { tempVars.clear(); }

/** An object the action names does not exist: the action fails with its name (`bc:notFound||<name>`). */
const notFound = (name: string) => new Error(`bc:notFound||${name}`);
/** The user declined (a question answered No, a document kept open): the action fails, as Access's 2501. */
const cancelled = () => new Error('bc:actionCancelled');
const parse = (sql: string): Query | null => { try { return parseSql(sql); } catch { return null; } };

/** The stored spelling of a form, report or query (`kind`), or of a table. */
async function storedName(kind: 'table' | 'form' | 'report' | 'query', name: string): Promise<string> {
  const list = kind === 'table' ? await api.tables.list() : await api.objects.list(kind);
  const found = list.find((x) => sameName(x.name, name));
  if (!found) throw notFound(name);
  return found.name;
}

/** The macro host of one top-level run: SetWarnings lasts for this run only (Access: warnings come back on at its end). */
export function shellHost(d: MacroShellDeps, opts: { singleStep: boolean }): MacroHost {
  let warnings = true;
  const open = async (kind: 'table' | 'query' | 'form' | 'report', name: string, mode: DocMode, args: OpenArgs = {}) => {
    // Design view takes no args (Where, Data Mode); refused (an open document kept its record): the action fails
    const withArgs = mode !== 'design' && Object.keys(args).length > 0;
    if ((await d.dispatch({ type: 'open', kind, name, mode, ...(withArgs ? { args } : {}) })) === false) throw cancelled();
  };
  /** An action query, as the shell runs it (its own messages); anything but 'done' fails the action (blocked: the run stops). */
  const actionQuery = async (ref: { kind: 'query'; name: string } | { kind: 'sql'; sql: string }) => {
    const outcome = await runActionFlow(ref, { modal: d.modal, region: d.region(), showError: d.showError, dispatch: d.dispatch, warnings });
    if (outcome === 'cancelled') throw cancelled();
    if (outcome === 'blocked') throw new Error('bc:contentDisabled');
    if (outcome === 'failed') throw new Error('bc:actionNotRun');
  };

  async function perform({ action, args }: ActionCall): Promise<void | 'stopAll'> {
    const a = args as Record<string, string | undefined>;   // the shell's arguments are all enum / name / text / where / sql
    switch (action) {
      case 'OpenForm': {
        const name = await storedName('form', a.FormName!);
        const extra: OpenArgs = { ...(a.WhereCondition ? { where: a.WhereCondition } : {}), ...(a.DataMode ? { dataMode: a.DataMode as OpenArgs['dataMode'] } : {}) };
        return open('form', name, a.View === 'datasheet' ? 'datasheet' : a.View === 'design' ? 'design' : 'run', extra);
      }
      case 'OpenReport': {
        const name = await storedName('report', a.ReportName!);
        const where = a.WhereCondition || undefined;
        if (a.View === 'design') return open('report', name, 'design');
        if (a.View !== 'print') return open('report', name, 'run', where ? { where } : {});   // R7: Print Preview by default
        return outputReport(d.modal, name, async (signal, ready) =>   // as the Navigation Pane prints: the system dialog, no preview
          layoutSavedReport(api, name, await layoutEnv(), askParameters(d.modal), signal, ready, where), 'printer');
      }
      case 'OpenQuery': {
        const name = await storedName('query', a.QueryName!);
        if (a.View === 'design') return open('query', name, 'design');
        const q = parse(((await api.objects.get('query', name)).definition as { sql: string }).sql);
        return q && !isSelectBody(q) ? actionQuery({ kind: 'query', name }) : open('query', name, 'run');
      }
      case 'OpenTable': return open('table', await storedName('table', a.TableName!), a.View === 'design' ? 'design' : 'datasheet');
      case 'CloseWindow': {
        const type = a.ObjectType ?? '', name = a.ObjectName ?? '';
        const tab = !type && !name ? d.active() : d.tabs().find((t) => isDoc(t, type as DocTab['kind'], name));
        // its own guard asks about unsaved changes (R6); kept open: the action fails; nothing open: nothing (Access)
        if (tab && !(await d.closeTab(tab))) throw cancelled();
        return;
      }
      case 'MessageBox':
        if (a.Beep === 'yes') api.app.beep().catch(() => {});   // no beep is no reason to fail the message
        return showMessageBox(d.modal, { message: a.Message ?? '', title: a.Title || i18n.t('macro.msgbox.defaultTitle'), type: (a.Type ?? 'none') as MessageBoxType });
      case 'Beep': return api.app.beep();
      // the window or the base goes: the run ends there (as StopAllMacros); a document kept open fails the action
      case 'Quit': case 'CloseDatabase':
        if (!(await (action === 'Quit' ? d.quit() : d.closeBase()))) throw cancelled();
        return 'stopAll';
      case 'RunSQL': {
        const sql = a.SQLStatement ?? '', q = parse(sql);
        if (!q || isSelectBody(q)) throw new Error('bc:runSqlSelect');
        return actionQuery({ kind: 'sql', sql });
      }
      case 'SetWarnings': warnings = a.WarningsOn === 'yes'; return;
      default: throw new Error(`bc:unknownAction||${action}`);
    }
  }

  return {
    load: async (name) => {
      let definition: unknown;
      try { ({ definition } = await api.objects.get('macro', name)); } catch (e) {
        throw bcErrorCode(e) === 'notFound' ? new Error('bc:notFound') : e;   // the engine reads the bare code
      }
      return parseMacroDef(definition);
    },
    contentEnabled: () => d.contentEnabled(),
    perform,
    tempVars,
    ...(opts.singleStep ? { step: (info: StepInfo) => askStep(d.modal, info) } : {}),   // Single Step: asked before each action
    locale: d.region().locale, lang: d.lang(), now: () => new Date(),
  };
}

/** Runs `M` or `M.Sub` in the open base; an unhandled failure is shown (Action Failed), a blocked action brings the security bar back. */
let running = false;
/** Runs `M` or `M.Sub` in the open base; an unhandled failure is shown (Action Failed), a blocked action brings the security bar back.
 *  One run at a time (they share the TempVars): a run asked during another is ignored with a beep (null). */
export async function runMacroByName(name: string, opts: { singleStep?: boolean } = {}): Promise<RunOutcome | null> {
  const d = shell;
  if (!d) throw new Error('bc:noBase');
  if (running) { api.app.beep().catch(() => {}); return null; }
  running = true;
  try {
    const outcome = await runMacro(name, shellHost(d, { singleStep: !!opts.singleStep }), opts);
    if (!outcome.ok) {
      if (outcome.failure.code === 'blocked') contentBlocked();
      await showMacroFailed(d.modal, outcome.failure);
    }
    return outcome;
  } finally { running = false; }
}

/** Every macro, each followed by its submacros (`M.Sub`, in their order): the Run Macro dialog, RunMacro's list. */
export async function macroNamesWithSubs(): Promise<string[]> {
  const names = (await api.objects.list('macro')).map((o) => o.name).sort((x, y) => foldName(x).localeCompare(foldName(y)));
  const out: string[] = [];
  for (const name of names) {
    out.push(name);
    try {
      out.push(...submacroNames(parseMacroDef((await api.objects.get('macro', name)).definition)).map((s) => `${name}.${s}`));
    } catch { /* unreadable: listed without its submacros (running it says why) */ }
  }
  return out;
}
