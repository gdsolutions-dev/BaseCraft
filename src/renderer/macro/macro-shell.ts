// Le shell des macros : chaque action du catalogue que l'interpréteur ne fait pas lui-même, faite avec ce que l'application
// fait déjà (ouvrir un objet, imprimer un état, fermer un onglet, exécuter une requête action), et les variables temporaires
// de la base ouverte. App le branche (setMacroShell) ; runMacroByName exécute une macro et montre son échec.
// B2 : runEvent exécute la macro d'un événement (imbriquée, jamais mise en file, R6) ; les actions de formulaire passent par
// le registre des formulaires ouverts (form-instances).
import { sectionName, type EventBinding } from '../../shared/design/events';
import type { Value } from '../../shared/expr/ast';
import { evaluate } from '../../shared/expr/evaluate';
import { bool, fail, num, str } from '../../shared/expr/library';
import { parseCanonical } from '../../shared/expr/parser';
import { foldName, sameName } from '../../shared/field-types';
import type { LocaleInfo } from '../../shared/locale-format';
import { parseMacroDef, submacroNames } from '../../shared/macro/model';
import { isSelectBody, type Query } from '../../shared/query/ast';
import { parseSql } from '../../shared/query/sql-parser';
import { api } from '../bridge';
import { i18n } from '../i18n';
import { parseCm } from '../designer/units';
import { formNamed, formOfTab, formOpening, resolveObjectMember, whenFormOpened, type FormInstance, type RecordTarget, type SettableProperty } from '../form/form-instances';
import { runActionFlow } from '../query/run-action';
import type { SectionEvent } from '../../shared/report/types';
import { reportShown, whenReportShown } from '../report/report-events';
import { outputSavedReport } from '../report/ReportPreviewView';
import { contentBlocked } from '../shell/Banners';
import { bcErrorCode, type ModalApi } from '../shell/Modal';
import type { AppDispatch } from '../shell/nav-menu';
import { isDoc, type DocMode, type DocTab, type OpenArgs } from '../state/app-state';
import { FAILURE_NUMBERS, runMacro, runMacroDef, type ActionCall, type EventContext, type MacroHost, type RunOutcome, type StepInfo } from './engine';
import { showMacroFailed } from './MacroFailedDialog';
import { showMessageBox, type MessageBoxType } from './MessageBoxDialog';
import { askStep } from './SingleStepDialog';
import { tempVars } from './temp-vars';

export interface MacroShellDeps {
  dispatch: AppDispatch; modal: ModalApi; tabs(): readonly DocTab[]; active(): DocTab | null; contentEnabled(): boolean;
  closeTab(tab: DocTab): Promise<boolean>; closeBase(): Promise<boolean>; quit(): Promise<boolean>; region(): LocaleInfo; lang(): 'fr' | 'en';   // false: a document kept open
  showError(e: unknown): Promise<void>;
  /** Resolves when the tab leaves the state: OpenForm in Dialog mode waits for it (R12). Absent: the macro does not wait. */
  whenClosed?(tabId: string): Promise<void>;
}

let shell: MacroShellDeps | null = null;
export function setMacroShell(d: MacroShellDeps | null): void { shell = d; }

export { clearTempVars } from './temp-vars';

/** An object the action names does not exist: the action fails with its name (`bc:notFound||<name>`). */
const notFound = (name: string) => new Error(`bc:notFound||${name}`);
/** The user declined (a question answered No, a document kept open): the action fails, as Access's 2501. */
const cancelled = () => new Error('bc:actionCancelled');
const parse = (sql: string): Query | null => { try { return parseSql(sql); } catch { return null; } };
const notOpen = (name: string) => new Error(`bc:notOpen||${name}`);
/** Access's limit on FindRecord's Find What. */
const MAX_FIND_WHAT = 255;

const YES = new Set(['yes', 'true', 'vrai', 'oui', '-1']), NO = new Set(['no', 'false', 'faux', 'non', '0']);
const LITERALS = new Set(['num', 'str', 'date', 'bool', 'null']);

/** SetProperty's Value text as the property takes it (R9); unreadable: bc:badValue||<text>. */
async function propertyValue(p: SettableProperty, text: string, region: LocaleInfo): Promise<Value> {
  const bad = (): never => { throw new Error(`bc:badValue||${text}`); };
  const t = text.trim();
  switch (p) {
    case 'visible': case 'enabled': case 'locked': {
      const k = t.toLowerCase();
      return YES.has(k) ? bool(true) : NO.has(k) ? bool(false) : bad();
    }
    case 'left': case 'top': case 'width': case 'height': return num(parseCm(t, region) ?? bad());
    case 'foreColor': case 'backColor': {
      if (/^#[0-9a-f]{6}$/i.test(t)) return str(t.toLowerCase());
      if (!/^\d+$/.test(t) || Number(t) > 0xffffff) return bad();
      const n = Number(t);   // an Access colour number: a long in BGR order
      return str(`#${[n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff].map((c) => c.toString(16).padStart(2, '0')).join('')}`);
    }
    case 'caption': return str(text);
    case 'value': {
      // a literal (canonical: 12.5, "a", #2026-01-31#, True, Null, -3), else the text itself
      try {
        const e = parseCanonical(t);
        if (LITERALS.has(e.k) || (e.k === 'un' && e.op === '-' && e.e.k === 'num')) {
          return await evaluate(e, { field: () => fail('unknownField'), now: () => new Date(), locale: region.locale });
        }
      } catch { /* not an expression: the text */ }
      return str(text);
    }
  }
}

/** SetProperty in a report's On Format / On Print (R9, R10): on the band being formatted, a control's `visible` or `value`, the
 *  section's own `visible` or `height`; another property bc:propertyNotSupported. A name not in the band (another section, a
 *  control of another section) does nothing: R9 applies to the band being formatted only. */
function setOnBand(e: SectionEvent | undefined, name: string, p: SettableProperty, v: Value): void {
  const unsupported = () => new Error('bc:propertyNotSupported');
  if (!e) throw unsupported();   // On Open, On No Data, On Close: no band
  const on = v?.t === 'bool' && v.v;
  if (sameName(sectionName(e.section, e.groupLevel), name)) {
    if (p === 'visible') e.sectionVisible = on;
    else if (p === 'height' && v?.t === 'num') e.height = v.v;
    else throw unsupported();
    return;
  }
  const c = Object.keys(e.visible).find((k) => sameName(k, name));
  if (c === undefined) return;
  if (p === 'visible') e.visible[c] = on;
  else if (p === 'value') e.values[c] = v;
  else throw unsupported();
}

/** The stored spelling of a form, report or query (`kind`), or of a table. */
async function storedName(kind: 'table' | 'form' | 'report' | 'query', name: string): Promise<string> {
  const list = kind === 'table' ? await api.tables.list() : await api.objects.list(kind);
  const found = list.find((x) => sameName(x.name, name));
  if (!found) throw notFound(name);
  return found.name;
}

/** Bumped by Quit, CloseDatabase and StopAllMacros: every run in progress (an opener waiting for its dialog, a macro whose
 *  action raised an event) ends after its current action, as Access stops all macros. */
let haltEpoch = 0;

/** The macro host of one top-level run: SetWarnings lasts for this run only (Access: warnings come back on at its end). */
export function shellHost(d: MacroShellDeps, opts: { singleStep: boolean }): MacroHost {
  let warnings = true;
  const epoch = haltEpoch;
  const halted = () => haltEpoch !== epoch;
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

  const namedForm = (name: string): FormInstance => { const f = formNamed(name); if (!f) throw notOpen(name); return f; };
  /** The form an action acts on: the event's form, else the active tab's (a dialog when one is open: it is the active tab, R12). */
  const currentForm = (event: EventContext | undefined): FormInstance => {
    if (event?.object.kind === 'form') return namedForm(event.object.name);
    const tab = d.active();
    const f = tab && formOfTab(tab.id);
    if (!f) throw new Error('bc:noActiveForm');
    return f;
  };

  async function perform({ action, args, event }: ActionCall): Promise<void | 'stopAll'> {
    // every argument but SetValue's Expression (a Value) is enum / name / text / where / sql / reference text
    const a = args as Record<string, string | undefined>;
    switch (action) {
      case 'OpenForm': {
        const name = await storedName('form', a.FormName!);
        const extra: OpenArgs = { ...(a.WhereCondition ? { where: a.WhereCondition } : {}), ...(a.DataMode ? { dataMode: a.DataMode as OpenArgs['dataMode'] } : {}),
          ...(a.WindowMode === 'dialog' ? { windowMode: 'dialog' as const } : {}) };
        const wasOpen = !!formNamed(name);
        // the next action sees On Open, On Load and On Current done; a cancelled On Open rejects bc:actionCancelled (Access 2501).
        // Waited for before the dispatch: the form may mount and cancel before the dispatch resolves. Not for a form whose open is
        // under way (this event's own form, or A and B opening each other in On Open): it waits for this very macro.
        const opened = a.View === 'design' || formOpening(name) ? null : whenFormOpened(name);
        opened?.catch(() => {});   // a refused dispatch fails the action itself
        await open('form', name, a.View === 'datasheet' ? 'datasheet' : a.View === 'design' ? 'design' : 'run', extra);
        if (!opened) return;
        const f = await opened;
        // R12: an open form is only activated; one open in Design view switches to Form view in its tab (no dialog to wait for)
        if (a.WindowMode === 'dialog' && !wasOpen && d.whenClosed && d.tabs().some((t) => t.id === f.tabId && t.dialog)) await d.whenClosed(f.tabId);
        return;
      }
      case 'OpenReport': {
        const name = await storedName('report', a.ReportName!);
        const where = a.WhereCondition || undefined;
        if (a.View === 'design') return open('report', name, 'design');
        if (a.View !== 'print') {   // R7: Print Preview by default
          // the next action sees On Open and On No Data done; one cancelling fails the action (2501). A preview already open
          // with no condition is only activated: nothing to wait for.
          const shown = !where && d.tabs().some((t) => isDoc(t, 'report', name) && t.mode === 'run') ? null : whenReportShown(name);
          shown?.catch(() => {});   // a refused dispatch fails the action itself
          try { await open('report', name, 'run', where ? { where } : {}); } catch (e) {
            reportShown(name, false);   // no waiter left behind
            throw e;
          }
          return shown ?? undefined;
        }
        // as the Navigation Pane prints: the system dialog, no preview
        if (await outputSavedReport(d.modal, name, 'printer', where)) throw cancelled();
        return;
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
        haltEpoch++;
        return 'stopAll';
      case 'RunSQL': {
        const sql = a.SQLStatement ?? '', q = parse(sql);
        if (!q || isSelectBody(q)) throw new Error('bc:runSqlSelect');
        return actionQuery({ kind: 'sql', sql });
      }
      case 'SetWarnings': warnings = a.WarningsOn === 'yes'; return;
      case 'GoToRecord': {
        const f = a.ObjectType === 'form' && a.ObjectName ? namedForm(a.ObjectName) : currentForm(event);
        const r = (a.Record ?? 'next') as RecordTarget;
        if (r !== 'goTo' && r !== 'next' && r !== 'previous') return f.goToRecord(r);
        const offset = a.Offset?.trim() ? a.Offset.trim() : '1';
        if (!/^[1-9]\d*$/.test(offset)) throw new Error('bc:cantGoToRecord');   // from 1
        return f.goToRecord(r, Number(offset));
      }
      case 'GoToControl': return currentForm(event).goToControl(a.ControlName!);
      case 'ApplyFilter': return currentForm(event).applyFilter(a.WhereCondition!);
      case 'ShowAllRecords': return currentForm(event).showAllRecords();
      case 'Requery': return currentForm(event).requery(a.ControlName || undefined);
      case 'SaveRecord': return currentForm(event).saveRecord();
      case 'UndoRecord': return currentForm(event).undoRecord();
      case 'RefreshRecord': return currentForm(event).refreshRecord();
      case 'DeleteRecord': return currentForm(event).deleteRecord(warnings);   // SetWarnings off: no confirmation
      case 'FindRecord': {
        const what = a.FindWhat ?? '';
        if (what.length > MAX_FIND_WHAT) throw new Error('bc:findWhatTooLong');
        const found = await currentForm(event).find({
          what, match: (a.Match ?? 'whole') as 'whole', matchCase: a.MatchCase === 'yes', search: (a.Search ?? 'all') as 'all',
          onlyCurrentField: a.OnlyCurrentField !== 'no', findFirst: a.FindFirst !== 'no',
        });
        // not found: Access's message, not a failure
        if (!found) await showMessageBox(d.modal, { message: i18n.t('macro.findRecord.notFound'), title: i18n.t('macro.msgbox.defaultTitle'), type: 'information' });
        return;
      }
      case 'SetProperty': {
        const p = (a.Property ?? 'enabled') as SettableProperty;
        if (event?.object.kind === 'report') return setOnBand(event.report, a.ControlName || '', p, await propertyValue(p, a.Value ?? '', d.region()));
        const f = currentForm(event);
        return f.setProperty(a.ControlName || event?.control || '', p, await propertyValue(p, a.Value ?? '', d.region()));
      }
      case 'SetValue': {
        const item = a.Item ?? '';
        let e;
        try { e = parseCanonical(item); } catch { throw new Error(`bc:badReference||${item}`); }
        const value = (args.Expression ?? null) as Value;
        if (e.k === 'member' && e.path[0] === 'Forms' && e.path.length === 3) return namedForm(e.path[1]!).setValue(e.path[2]!, value);
        if (e.k === 'id' && !e.table) return currentForm(event).setValue(e.name, value);
        throw new Error(`bc:badReference||${item}`);   // [Reports]!, an expression: not something a value can be put in
      }
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
    // stopped meanwhile (a nested run's Quit, CloseDatabase, StopAllMacros): this run ends too, its action's failure unseen
    perform: async (c) => {
      try { const r = await perform(c); return halted() ? 'stopAll' : r; } catch (e) {
        if (halted()) return 'stopAll';
        throw e;
      }
    },
    stopAll: () => { haltEpoch++; },
    tempVars,
    objectMember: resolveObjectMember,   // [Forms]! / [Reports]! in every run, an event's or not (R11)
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
  const epoch = haltEpoch;
  try {
    const outcome = await runMacro(name, shellHost(d, { singleStep: !!opts.singleStep }), opts);
    if (!outcome.ok && epoch === haltEpoch) {   // stopped meanwhile (the base gone): no failure shown
      if (outcome.failure.code === 'blocked') contentBlocked();
      await showMacroFailed(d.modal, outcome.failure);
    }
    return outcome;
  } finally { running = false; }
}

export const MAX_EVENT_DEPTH = 20;
/** Event runs in progress, nested (R6): an event raised by an action of another event's macro runs inside it. */
let eventDepth = 0;

/** « FCommandes : Total : Avant MAJ »: an embedded macro in failures and MacroError (no dot: the OnError handler splits at it). */
const embeddedLabel = (c: EventContext): string =>
  [c.object.name, c.control, i18n.t(`prop.${c.event}`)].filter(Boolean).join(' : ');

/** Runs the macro an event property names; resolves true when the event is cancelled (CancelEvent, or a failure in a cancellable event, R7). */
export async function runEvent(binding: EventBinding, ctx: EventContext): Promise<boolean> {
  const d = shell;
  if (!d || binding.kind === 'none' || binding.kind === 'other') return false;
  const label = binding.kind === 'macro' ? binding.name : embeddedLabel(ctx);
  eventDepth++;   // events bypass `running` (R6): they nest instead
  const epoch = haltEpoch;
  try {
    let outcome: RunOutcome;
    if (eventDepth > MAX_EVENT_DEPTH) {
      outcome = { ok: false, failure: { macro: label, action: '', raw: {}, code: 'tooDeep', number: FAILURE_NUMBERS.tooDeep, detail: 'events' } };
    } else {
      const host = shellHost(d, { singleStep: false });
      outcome = binding.kind === 'macro' ? await runMacro(binding.name, host, { event: ctx }) : await runMacroDef(binding.def, label, host, { event: ctx });
    }
    if (!outcome.ok && epoch === haltEpoch) {   // stopped meanwhile (the base gone): no failure shown
      if (outcome.failure.code === 'blocked') contentBlocked();
      await showMacroFailed(d.modal, outcome.failure);
    }
    return ctx.cancelled || (!outcome.ok && ctx.cancellable);
  } finally { eventDepth--; }
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
