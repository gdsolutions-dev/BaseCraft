import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { ObjectSummary, SessionState, TableSummary } from '../shared/api';
import { sameName } from '../shared/field-types';
import { formulaLang } from '../shared/i18n';
import { hasStartup, type StartupOptions } from '../shared/startup';
import { api, setPasswordPrompt } from './bridge';
import { applyUi } from './i18n';
import { design } from './design/entry';
import { hasPendingRow } from './import-text/wizard-model';
import { firstFreeName, formNames } from './form/form-def';
import { Backstage, type BackstageView, type Settings } from './shell/Backstage';
import { compactMessage } from './shell/compact-message';
import { emitDataRefresh } from './shell/data-refresh';
import { Banners } from './shell/Banners';
import { DialogHost } from './shell/DialogHost';
import { DocumentTabs } from './shell/DocumentTabs';
import { ModalProvider, useErrorDialog, useModal } from './shell/Modal';
import { NavPane } from './shell/NavPane';
import { setNavImportText } from './shell/nav-menu-items';
import { setNavImportExcel } from './exchange/exchange-menu';
import { setNavLeaveTable } from './links/nav-menu-links';
import './query/nav-menu-query'; // after the foundation's items (a later registration wins by id)
import { setOpenTabs } from './query/run-action';
import { clearTempVars, macroNamesWithSubs, runMacroByName, setMacroShell } from './macro/macro-shell';
import { closeEmbeddedOf } from './macro/embedded';
import { formCancelled, whenFormOpened } from './form/form-instances';
import { base64ToBytes, bytesToBase64, storedIconPng } from './shell/app-icon';
import { SHIFT_GRACE_MS, shiftHeld } from './shell/shift-key';
import { baseUi, publishUi, runStartup, type StartupUi } from './shell/startup';
import { reportShown } from './report/report-events';
import { askMacroToRun } from './macro/RunMacroDialog';
import { localeInfo } from '../shared/locale-format';
import { PRODUCT_TITLE_KEY, RUNTIME } from '../shared/product';
import './report/report-menu'; // A5's Navigation Pane items for reports (C6)
import './macro/macro-menu'; // B1's Navigation Pane items for macros (C6)
import './exchange/exchange-menu'; // A6's Navigation Pane items: Export (C6)
import { exportNamed } from './exchange/export';
import { setClip } from './exchange/object-clipboard';
import { runNavClipboard } from './shell/nav-menu';
import { showObjectProperties } from './shell/ObjectProperties';
import { dialogInFront, inertRef, setShellDispatch, useModalTab } from './shell/modal-tab';
import { Ribbon } from './shell/Ribbon';
import { RunningNotice } from './shell/RunningNotice';
import {
  SHELL_SCOPE, modeGuard, registerCommands, runCommand, setActiveCommandTab, setCommandContext, setCommandErrorHandler, type RibbonContext,
} from './shell/ribbon-model';
import { StatusBar } from './shell/StatusBar';
import { pickSource, setSourceHint } from './shell/SourcePicker';
import { selectedSource, sourceHint } from './shell/source-picker-model';
import { appReducer, initialAppState, dialogActivates, isDoc, reopenMode, type AppAction, type DocTab } from './state/app-state';
import './shell/shell.css';

export function App() {
  return <ModalProvider><Shell /></ModalProvider>;
}

/** The window icon from a base's stored icon ('' : BaseCraft's); one that cannot be used leaves BaseCraft's, silently. `current`: still the base it was for.
 *  Resolves the icon as a data URL for the form and report tabs (O1 R10), null: BaseCraft's. */
async function applyIcon(appIcon: string, current: () => boolean): Promise<string | null> {
  try {
    const png = appIcon ? await storedIconPng(base64ToBytes(appIcon)) : null;
    if (current()) await api.app.setWindowIcon(png);
    return png && `data:image/png;base64,${bytesToBase64(png)}`;
  } catch {
    if (current()) await api.app.setWindowIcon(null).catch(() => {});
    return null;
  }
}

function Shell() {
  const { t, i18n } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [session, setSession] = useState<SessionState | null | undefined>(undefined); // undefined: not known yet
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [objects, setObjects] = useState<ObjectSummary[]>([]);
  const [backstage, setBackstage] = useState<BackstageView | null>(null);
  const modalTab = useModalTab();
  const [importing, setImporting] = useState<false | { appendTo?: string; source?: 'text' | 'excel' }>(false);
  const [navSelection, setNavSelection] = useState<{ kind: string; name: string } | null>(null);
  const [state, rawDispatch] = useReducer(appReducer, initialAppState);
  // The UI the base's startup options ask for (B3 R10), set by the startup sequence; the full UI otherwise (BaseCraft Runtime: always run mode).
  const [ui, setUi] = useState<StartupUi>(baseUi());
  const [appTitle, setAppTitle] = useState(''); // the base's Application Title ('' : BaseCraft's)
  const [formIcon, setFormIcon] = useState<string | null>(null); // the base's icon on form and report tabs (O1 R10), null: their own
  /** The opening whose startup sequence ran (or runs); null: none yet for the open base. */
  const startedFor = useRef<{ path: string } | null>(null);
  /** Shift held on the click or key that asked for the opening (Backstage Recent, Open); read once by the sequence (R4). */
  const openShift = useRef(false);
  /** This opening's AutoExec, stopped on a blocked action: « Activer le contenu » runs it again once (R6). */
  const blockedAutoExec = useRef<string | null>(null);
  const live = useRef({ state, tables, objects, readOnly: false, navSelection, session, settings, ui });
  live.current = { state, tables, objects, readOnly: !!session?.readOnly, navSelection, session, settings, ui };

  const refreshSettings = useCallback(async () => {
    const s = await api.app.getSettings();
    await applyUi(s.theme, s.uiLanguage);
    setSettings(s);
  }, []);

  const refreshTables = useCallback(async () => {
    try {
      setTables(await api.tables.list());
    } catch (e) {
      setTables([]);
      if (!/needsRecovery|noBase/.test(String(e))) void showError(e); // a base to recover is explained by its banner
    }
  }, [showError]);

  const refreshObjects = useCallback(async () => {
    try {
      setObjects(await api.objects.list());
    } catch (e) {
      setObjects([]);
      if (!/needsRecovery|noBase/.test(String(e))) void showError(e);
    }
  }, [showError]);

  /** The design's embedded macro tabs (R16) have their say first (their Save writes into the design), then a tick lets the design
   *  take what they wrote before its own guard reads it. False: one stays (it is shown). */
  const leaveEmbedded = async (owner: DocTab): Promise<boolean> => {
    const ids = closeEmbeddedOf(owner.id);
    const tabs = live.current.state.tabs.filter((x) => x.embedded !== undefined && ids.includes(x.embedded));
    for (const tab of tabs) {
      const guard = modeGuard(tab.id);
      if (guard && !(await guard('close'))) { rawDispatch({ type: 'activate', id: tab.id }); return false; }
    }
    // ponytail: one setTimeout(0) tick assumed enough for React to render the design's setProp (as the designs' flush() assumes);
    // a design-side "pending embedded saves" promise if a guard is ever seen reading stale state
    if (tabs.length) await new Promise((r) => setTimeout(r));
    return true;
  };

  // Every table change goes through here so that the navigation pane follows. A change of mode of an open document
  // (ribbon, status bar, navigation pane) first asks the document (a dirty design: "save first?"), after its embedded macros.
  // `apply` is that work; `dispatch` puts run mode's and a linked table's Design view first.
  const apply = useCallback((a: AppAction): void | Promise<boolean> => {
    if (a.type === 'setMode' || a.type === 'open') {
      const tabs = live.current.state.tabs;
      const tab = a.type === 'setMode' ? tabs.find((x) => x.id === a.id)
        : a.isNew || a.embedded ? undefined : tabs.find((x) => isDoc(x, a.kind, a.name));
      // a macro's Open with args in the same view reads the records again: the record being edited is saved (or asked) first;
      // in Dialog mode an open form is only activated (R12)
      const reload = a.type === 'open' && !!a.args;
      const activateOnly = a.type === 'open' && !!tab && dialogActivates(tab, a.args);
      const modeChanges = !!tab && !activateOnly && tab.mode !== (a.type === 'open' ? reopenMode(tab, a.mode) : a.mode);
      const guard = tab && !activateOnly && (reload || modeChanges) ? modeGuard(tab.id) : undefined;
      const owns = modeChanges && closeEmbeddedOf(tab.id).length > 0;
      if (guard || owns) { // A3: the promise tells whether the document let the change happen (openSqlView drops a refused request)
        return (async () => (!owns || await leaveEmbedded(tab!)) && (!guard || await guard('mode')))()
          .then((ok) => { if (ok) rawDispatch(a); return ok; }, (e) => { void showError(e); return false; });
      }
    }
    rawDispatch(a);
    if (a.type === 'tableSaved' || a.type === 'tableRenamed' || a.type === 'tableDropped' || a.type === 'listsChanged' || a.type === 'tableDescribed') void refreshTables();
    if (a.type === 'objectSaved' || a.type === 'objectRenamed' || a.type === 'objectDeleted' || a.type === 'listsChanged') void refreshObjects();
  }, [refreshTables, refreshObjects, showError]);

  const dispatch = useCallback((a: AppAction) => {
    // R10: run mode has no Design view. Refused like a document that stays: nothing happens, and a macro's OpenForm fails (actionCancelled).
    if (live.current.ui.runMode && (a.type === 'open' || a.type === 'setMode') && a.mode === 'design') return Promise.resolve(false);
    // C1 R8 (as Access): a linked table's structure belongs to its file: its Design view opens read-only, after a warning (No:
    // nothing happens), once its source answers (missing, password: told as its Datasheet tells it)
    if ((a.type === 'open' || a.type === 'setMode') && a.mode === 'design') {
      const { tabs } = live.current.state;
      const doc = a.type === 'open' ? (a.isNew ? undefined : a) : tabs.find((x) => x.id === a.id);
      const name = doc?.kind === 'table' ? doc.name : null;
      const shown = tabs.some((x) => x.kind === 'table' && x.mode === 'design' && name !== null && sameName(x.name, name)); // only activated
      if (name !== null && !shown && live.current.tables.some((x) => x.link && sameName(x.name, name))) {
        return (async () => {
          const r = await modal.confirm({ titleKey: 'link.designTitle', messageKey: 'link.designWarning', params: { name }, buttons: ['yes', 'no'], defaultButton: 'yes' });
          if (r !== 'yes') return false;
          await api.tables.design(name);
          return (await apply(a)) !== false;
        })().catch((e) => { void showError(e); return false; });
      }
    }
    return apply(a);
  }, [apply, showError, modal]);

  useEffect(() => {
    void refreshSettings();
    const off = api.base.onStateChanged(setSession);
    const offCrash = api.base.onHostCrashed(() => {
      void modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'dialog.error.hostCrashed', buttons: ['ok'] });
    });
    void api.base.state().then((s) => setSession((cur) => (cur === undefined ? s : cur)));
    // the base the system gave (command line, file association) that did not open: told as a Backstage Open's failure is
    void api.base.openFailure().then((m) => { if (m) void showError(new Error(m)); }, console.error);
    return () => { off(); offCrash(); };
  }, [refreshSettings, modal, showError]);

  // C3 R10: another workstation wrote: the open datasheets and forms read again
  useEffect(() => api.base.onDataChanged(emitDataRefresh), []);
  // every settings write (language, theme, options, recent files) comes here: the one refresh per write
  useEffect(() => api.app.onSettingsChanged((s) => { void applyUi(s.theme, s.uiLanguage); setSettings(s); }), []);

  // A different base: its documents start empty and the backstage gives way.
  const path = session?.path ?? null;
  useEffect(() => {
    rawDispatch({ type: 'reset' });
    setNavSelection(null);
    clearTempVars(); // TempVars live for the open base: closed, switched (Open, New, Save As)
    formCancelled(); reportShown(null, false); // a macro waiting for a form or a preview of the base gone fails (never hangs)
    if (path) setBackstage(null);
    // R11: every opening starts from the base UI (the full UI; in BaseCraft Runtime, run mode) and the product's own title and icon; its own sequence runs next (below)
    startedFor.current = null;
    blockedAutoExec.current = null;
    publishUi(baseUi());
    setUi(baseUi());
    rawDispatch({ type: 'setNav', visible: true, strip: true });
    setAppTitle('');
    setFormIcon(null);
    api.app.setWindowIcon(null).catch(() => {});
  }, [path]);

  // The startup sequence (R3), once per opening of a usable base (a base to recover: once recovered).
  useEffect(() => {
    if (!session || session.needsRecovery || startedFor.current?.path === session.path) return;
    const run = { path: session.path };
    startedFor.current = run;
    const shift = openShift.current;
    openShift.current = false;
    const stillCurrent = () => startedFor.current === run && live.current.session?.path === run.path;
    void (async () => {
      const [o, macros] = await Promise.all([api.base.startup(), api.objects.list('macro')]);
      if (!stillCurrent()) return;
      const autoExec = macros.find((m) => sameName(m.name, 'AutoExec'))?.name ?? null;
      // (1) title and icon, also when bypassed (they hide nothing); a stored icon that cannot be used leaves BaseCraft's, silently
      setAppTitle(o.appTitle);
      if (o.appIcon) void applyIcon(o.appIcon, stillCurrent).then((url) => { if (o.iconForForms && stillCurrent()) setFormIcon(url); });
      // R4: decided once; the grace is waited for only when there is something to bypass. BaseCraft Runtime has no bypass (B5).
      let bypass = !RUNTIME && shift;
      if (!RUNTIME && !bypass && hasStartup(o, !!autoExec)) {
        await new Promise((r) => setTimeout(r, SHIFT_GRACE_MS));
        bypass = shiftHeld();
      }
      if (!stillCurrent()) return;
      const { autoExecBlocked } = await runStartup(o, autoExec, bypass, {
        // committed at once: the next action (run mode's Design refusal, the ribbon) sees the new UI
        setUi: (u) => { publishUi(u); flushSync(() => setUi(u)); },
        setNav: (visible) => flushSync(() => rawDispatch({ type: 'setNav', visible, strip: visible })),
        openForm: async (name) => {
          const stored = (await api.objects.list('form')).find((f) => sameName(f.name, name))?.name;
          if (!stored) return 'notFound';
          const opened = whenFormOpened(stored);   // waited for before the dispatch: the form may mount and cancel before it resolves
          opened.catch(() => {});
          if ((await dispatch({ type: 'open', kind: 'form', name: stored, mode: 'run' })) === false) return 'cancelled';
          return opened.then(() => 'opened' as const, () => 'cancelled' as const);
        },
        runAutoExec: (name) => runMacroByName(name),
        formNotFound: async (name) => {
          await modal.confirm({ titleKey: PRODUCT_TITLE_KEY, messageKey: 'startup.formNotFound', params: { name }, buttons: ['ok'] });
        },
        stillCurrent,
      });
      if (autoExecBlocked && stillCurrent()) blockedAutoExec.current = autoExec;
    })().catch((e) => { if (stillCurrent()) void showError(e); });
  }, [session, dispatch, modal, showError]);

  const tablesKey = session ? `${session.path}|${session.readOnly}|${!!session.needsRecovery}` : '';
  useEffect(() => {
    if (tablesKey) { void refreshTables(); void refreshObjects(); }
    else { setTables([]); setObjects([]); }
  }, [tablesKey, refreshTables, refreshObjects]);

  useEffect(() => { document.title = session ? appTitle || `${session.fileName} – ${t(PRODUCT_TITLE_KEY)}` : t(PRODUCT_TITLE_KEY); }, [session, appTitle, t]);
  const active = state.tabs.find((x) => x.id === state.activeId) ?? null;
  /** A linked table's Design view (C1 R8): its source, the view read-only. */
  const linkedDesign = (tab: DocTab) => (tab.kind === 'table' && tab.mode === 'design' && !tab.isNew
    ? tables.find((x) => x.link && sameName(x.name, tab.name))?.link : undefined);
  useEffect(() => { setSourceHint(sourceHint(active, navSelection)); }); // pickSource's default preselection
  // what the base's startup options ask of the ribbon (B3 R10), the Query Builder's too: it does not depend on how the builder was reached
  const startupCtx = { ...(ui.ribbon === 'simplified' || ui.runMode ? { ribbon: 'simplified' as const } : {}), ...(ui.runMode ? { runMode: true as const } : {}),
    ...(ui.datasheetDesign ? {} : { datasheetDesign: false as const }) };
  // a Query Builder's tab in front: the ribbon serves its query (its own commands only)
  const ctx: RibbonContext = modalTab
    ? { hasBase: !!session, readOnly: !!session?.readOnly, mode: modalTab.mode, isNew: false, kind: modalTab.kind, builder: true, ...startupCtx }
    : { hasBase: !!session, readOnly: !!session?.readOnly, mode: active?.mode ?? null, isNew: !!active?.isNew, kind: active?.kind ?? null, embedded: !!active?.embedded, ...startupCtx,
      ...(active && linkedDesign(active) ? { linked: true as const } : {}) };
  const commandTab = modalTab?.scope ?? state.activeId;
  useEffect(() => { setActiveCommandTab(commandTab); }, [commandTab]);
  useEffect(() => { setCommandContext(ctx); }); // cheap: ignored when unchanged
  useEffect(() => { setCommandErrorHandler((e) => void showError(e)); }, [showError]);
  // C2 R7: a protected Access file asks its password at the first read (bridge.ts withPassword); a refused one asks again
  useEffect(() => {
    setPasswordPrompt((path, wrong) => modal.prompt({
      titleKey: 'link.password.title', labelKey: 'link.password.label', params: { path }, initial: '', secret: true,
      ...(wrong ? { error: t('link.password.wrong') } : {}),
      validate: (v) => (v.length < 1 || v.length > 256 ? t('link.password.wrong') : null),
    }));
  }, [modal, t]);
  useEffect(() => { if (design) setNavImportText((table) => setImporting({ appendTo: table })); }, []);   // no import without the designers (B5)
  useEffect(() => { if (design) setNavImportExcel((table) => setImporting({ appendTo: table, source: 'excel' })); }, []);
  useEffect(() => setOpenTabs(() => live.current.state.tabs), []);
  useEffect(() => setShellDispatch(dispatch), [dispatch]);

  /** Create › Form Design / Blank Form: a new form named Formulaire<n> (the first free n among forms and open tabs). */
  const newForm = (fieldList: boolean) => {
    const { state: s, objects: objs } = live.current;
    const name = firstFreeName(formNames(objs, s.tabs), (n) => t('form.newName', { n }));
    if (fieldList) design?.requestFieldList('form', name);
    rawDispatch({ type: 'open', kind: 'form', name, mode: 'design', isNew: true });
  };
  /** The first « État<n> » free among the reports and the open tabs. */
  const newReportName = useCallback(() => {
    const { state: s, objects: objs } = live.current;
    return firstFreeName([...s.tabs, ...objs.filter((x) => x.kind === 'report')].map((x) => x.name), (n) => t('report.newName', { n }));
  }, [t]);

  /** The first « Macro<n> » free among the macros and the open tabs. */
  const newMacroName = useCallback(() => {
    const { state: s, objects: objs } = live.current;
    return firstFreeName([...s.tabs, ...objs.filter((x) => x.kind === 'macro')].map((x) => x.name), (n) => t('macro.newName', { n }));
  }, [t]);

  // Create › Form and Report, as Access: the Navigation Pane's selection (a form's or report's own source), else the picker
  const sourceToCreate = async (titleKey: string) => {
    const sel = live.current.navSelection;
    const def = sel?.kind === 'form' || sel?.kind === 'report' ? (await api.objects.get(sel.kind, sel.name)).definition : undefined;
    const picked = selectedSource(sel, def);
    if (picked) return picked;
    const ref = await pickSource(modal, { titleKey });
    return ref && ref.kind !== 'sql' ? { ref, name: ref.name } : null;   // the picker gives a table or a query
  };

  // External Data › Export without a datasheet to export: the Navigation Pane's table or query
  const exportSelected = async (format: 'text' | 'excel') => {
    const sel = live.current.navSelection;
    if (sel?.kind === 'table' || sel?.kind === 'query') return exportNamed(modal, sel.kind, sel.name, format);
    await modal.confirm({ titleKey: format === 'excel' ? 'ribbon.cmd.exportExcel' : 'ribbon.cmd.exportText', messageKey: 'exchange.selectObject', buttons: ['ok'] });
  };

  const clipboardCommand = (cmd: 'cut' | 'copy' | 'paste') => {
    if (document.activeElement?.closest('.nitem')) runNavClipboard(cmd);
    else return api.app.edit(cmd);
  };

  // Shell-level commands; a document registering the same command takes precedence.
  useEffect(() => registerCommands(SHELL_SCOPE, {
    ...design?.shellCommands({ modal, dispatch, rawDispatch, t, live, sourceToCreate, newForm, newQueryName, newReportName, newMacroName, setImporting, closeDocuments }),
    viewDesign: () => {
      const id = live.current.state.activeId;
      if (id) dispatch({ type: 'setMode', id, mode: 'design' });
    },
    viewDatasheet: () => {
      const tab = live.current.state.tabs.find((x) => x.id === live.current.state.activeId); // gated: never for a table not saved yet
      if (tab) dispatch({ type: 'setMode', id: tab.id, mode: tab.kind === 'table' || tab.kind === 'form' ? 'datasheet' : 'run' }); // an object's Run view; a form's Datasheet view (M10)
    },
    // Home › Clipboard: the Navigation Pane's item when the pane has the focus, else the focused element (text field, datasheet)
    cut: () => clipboardCommand('cut'),
    copy: () => clipboardCommand('copy'),
    paste: () => clipboardCommand('paste'),
    exportText: () => exportSelected('text'),
    exportExcel: () => exportSelected('excel'),
    compactRepair: () => compact(),
    saveAs: () => switchBase(api.base.saveAs),
    tableProperties: () => {
      const tab = live.current.state.tabs.find((x) => x.id === live.current.state.activeId); // gated: a table's datasheet
      if (tab) return showObjectProperties(modal, { kind: 'table', name: tab.name }, live.current.readOnly, dispatch);
    },
    viewForm: () => {
      const tab = live.current.state.tabs.find((x) => x.id === live.current.state.activeId); // gated: a saved form
      if (tab) dispatch({ type: 'setMode', id: tab.id, mode: 'run' });
    },
    // Database Tools › Run Macro: a macro or submacro chosen (or typed), run; its failure is shown by runMacroByName
    runMacro: async () => {
      const name = await askMacroToRun(modal, await macroNamesWithSubs());
      if (name) await runMacroByName(name);
    },
    viewPrintPreview: () => {
      const id = live.current.state.activeId; // gated: a saved report
      if (id) dispatch({ type: 'setMode', id, mode: 'run' });
    },
  }), [t, i18n, modal, dispatch, newReportName, newMacroName]);
  /** A3: Requête1…, free among tables, queries and open tabs. */
  function newQueryName(): string {
    const { state: s, tables: list, objects: objs } = live.current;
    const taken = (n: string) => list.some((x) => sameName(x.name, n)) || s.tabs.some((x) => sameName(x.name, n))
      || objs.some((x) => x.kind === 'query' && sameName(x.name, n));
    let n = 1;
    while (taken(t('query.newName', { n }))) n++;
    return t('query.newName', { n });
  }

  // An import done: the navigation pane and the Relations window show the new tables (error table included); a datasheet of
  // the table re-reads its rows, a design of it is left alone (never reloaded, never switched); otherwise the table opens in Datasheet view.
  const onImported = (r: { table: string }) => {
    void refreshTables();
    rawDispatch({ type: 'tablesChanged' });
    const tab = live.current.state.tabs.find((x) => x.kind === 'table' && !x.isNew && x.name === r.table);
    if (!tab) dispatch({ type: 'open', kind: 'table', name: r.table, mode: 'datasheet' });
    else if (tab.mode === 'datasheet') { rawDispatch({ type: 'tableDataChanged', name: r.table }); rawDispatch({ type: 'activate', id: tab.id }); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogInFront()) return; // a dialog or the backstage is in front (a Query Builder's tab is served)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        runCommand('save');
      } else if (e.key === 'F11') {
        e.preventDefault();
        if (live.current.ui.specialKeys) rawDispatch({ type: 'toggleNav' });   // special keys off: F11 does nothing (O1 R6)
      } else if (e.key === 'F9' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault(); // Shift+F9: Access's Requery. F5 stays free (record number box, Design -> Form view: later batches).
        runCommand('refresh');
      } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        if (runCommand('find')) e.preventDefault(); // Find, where a datasheet delivers it
      } else if (e.key === 'F4' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        if (runCommand('propertySheet')) e.preventDefault(); // Property Sheet, where a view delivers it (form designer)
      }
    };
    window.addEventListener('keydown', onKey, true); // capture: works even when an editor stops propagation
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Each document has its say before it goes (the same guard as for a change of mode): a datasheet saves its pending row
  // (or asks to discard it), a modified design asks to be saved. The first document that stays is shown.
  const leaveDocuments = async (tabs: DocTab[]) => {
    const ordered = [...tabs.filter((x) => x.embedded), ...tabs.filter((x) => !x.embedded)];   // an embedded macro before its design
    for (const [i, tab] of ordered.entries()) {
      // ponytail: one setTimeout(0) tick assumed enough for the designs to take what their embedded macros wrote (see leaveEmbedded)
      if (i > 0 && ordered[i - 1]!.embedded && !tab.embedded) await new Promise((r) => setTimeout(r));
      const guard = modeGuard(tab.id);
      if (guard && !(await guard('close'))) { rawDispatch({ type: 'activate', id: tab.id }); return false; }
    }
    return true;
  };
  const closeTab = async (tab: DocTab): Promise<boolean> => {
    try {
      if (!(await leaveEmbedded(tab)) || !(await leaveDocuments([tab]))) return false;
      rawDispatch({ type: 'close', id: tab.id });
      return true;
    } catch (e) { await showError(e); return false; }
  };

  // R24: the window's close button (and the system) asks first; main closes the window only once the documents agree.
  const closing = useRef(false);
  const leaveRef = useRef(leaveDocuments);
  leaveRef.current = leaveDocuments;
  // Convert to Local Table (C1): the table's documents have their say first, as when their tabs close
  useEffect(() => setNavLeaveTable((name) => leaveRef.current(live.current.state.tabs.filter((x) => isDoc(x, 'table', name)))), []);
  useEffect(() => api.app.onCloseRequested(() => {
    if (closing.current) return; // a second click while the first close is still asking
    closing.current = true;
    leaveRef.current(live.current.state.tabs)
      .then((ok) => (ok ? api.app.confirmClose() : undefined))
      .catch((e) => showError(e))
      .finally(() => { closing.current = false; });
  }), [showError]);

  const switchBase = async (fn: () => Promise<SessionState | null>, shift = false) => {
    if (!(await leaveDocuments(live.current.state.tabs))) return;
    openShift.current = shift;   // before the call: the new state may reach the window before it returns
    try {
      const s = await fn();
      // committed at once: the startup effect has read the flag, or none was due (the same base again, a base to recover)
      if (s) flushSync(() => { setClip(null); setSession(s); setBackstage(null); });
      openShift.current = false;   // it never outlives its opening
    } catch (e) {
      openShift.current = false;
      await showError(e);
    }
  };
  /** false: a document stayed open, or the close failed (a macro's CloseDatabase then fails). */
  const closeBase = async (): Promise<boolean> => {
    if (!(await leaveDocuments(live.current.state.tabs))) return false;
    try { await api.base.close(); setClip(null); setSession(null); return true; } catch (e) { await showError(e); return false; }
  };
  /** Before Compact and Repair (A6) and Split Database (C3): as in Access, every document is closed first (each one asked about
   *  its changes). false: one stayed. */
  const closeDocuments = async (): Promise<boolean> => {
    if (!(await leaveRef.current(live.current.state.tabs))) return false;
    rawDispatch({ type: 'reset' });
    setBackstage(null);
    return true;
  };
  const compact = async () => {
    if (!(await closeDocuments())) return;
    try {
      const m = compactMessage(await api.base.compact(), i18n.language, (count) => t('compact.more', { count }));
      await modal.confirm({ titleKey: 'compact.title', ...m, buttons: ['ok'] });
    } catch (e) {
      await showError(e);
    } finally {
      void refreshTables();
      void refreshObjects();
    }
  };
  // A macro's Quit: the window's own close path (every document has its say, then the window closes)
  const quit = async (): Promise<boolean> => {
    if (!(await leaveDocuments(live.current.state.tabs))) return false;
    await api.app.confirmClose();
    return true;
  };

  // OpenForm in Dialog mode waits for its tab to leave the state (R12): told after each render that changes the tabs
  const closeWaiters = useRef<{ id: string; resolve(): void }[]>([]);
  useEffect(() => {
    const waiting = closeWaiters.current;
    closeWaiters.current = waiting.filter((w) => state.tabs.some((x) => x.id === w.id));
    waiting.filter((w) => !closeWaiters.current.includes(w)).forEach((w) => w.resolve());
  }, [state.tabs]);
  const whenClosed = useCallback((id: string) => new Promise<void>((resolve) => {
    if (live.current.state.tabs.some((x) => x.id === id)) closeWaiters.current.push({ id, resolve });
    else resolve();
  }), []);

  // The macro shell (B1): what the actions of a macro reach. Read through refs, so one registration serves the whole session.
  const shellRef = useRef({ closeTab, closeBase, quit });
  shellRef.current = { closeTab, closeBase, quit };
  useEffect(() => {
    setMacroShell({
      dispatch, modal, showError,
      tabs: () => live.current.state.tabs,
      active: () => live.current.state.tabs.find((x) => x.id === live.current.state.activeId) ?? null,
      contentEnabled: () => live.current.session?.content !== 'disabled', // the data process refuses again on its own
      closeTab: (tab) => shellRef.current.closeTab(tab),
      closeBase: () => shellRef.current.closeBase(),
      quit: () => shellRef.current.quit(),
      region: () => localeInfo(live.current.settings?.region ?? navigator.language),
      lang: () => formulaLang(i18n.language),
      whenClosed,
    });
    return () => setMacroShell(null);
  }, [dispatch, modal, showError, i18n, whenClosed]);

  const takeOver = async () => {
    try { setSession(await api.base.takeOverLock()); } catch (e) { await showError(e); }
  };

  const enableContent = async () => {
    try {
      const s = await api.base.enableContent();
      flushSync(() => setSession(s));   // committed: the macro shell reads the content enabled
    } catch (e) { await showError(e); return; }
    const autoExec = blockedAutoExec.current;   // R6: AutoExec stopped on a blocked action runs again from its start, once
    blockedAutoExec.current = null;
    if (autoExec) await runMacroByName(autoExec);
  };

  // Options › Base de données active: the title and the icon (and its use on form and report tabs) apply at once, the other options at the next opening (R11)
  // `opened` is this render's base: the section calls the callback it was given when its save began, so a save that resolves
  // after a switch to another base is dropped (its title and icon are the previous base's).
  const opened = session?.path;
  const onStartupApplied = (o: StartupOptions) => {
    const stillCurrent = () => live.current.session?.path === opened;
    if (!stillCurrent()) return;
    setAppTitle(o.appTitle);
    void applyIcon(o.appIcon, stillCurrent).then((url) => { if (stillCurrent()) setFormIcon(o.iconForForms ? url : null); });
  };

  const readOnly = !!session?.readOnly;
  const showBackstage = session === null || backstage !== null;
  const dialogOpen = state.tabs.some((x) => x.dialog);

  return (<>
    {/* a dialog form (R12): the whole window stands back, but RunningNotice's Stop (above modals) */}
    <div className="app" data-testid="app-root" ref={inertRef(dialogOpen)}>
      {/* a Query Builder's tab (modal): all but the ribbon and the status bar (which serve it) and the document tabs stands back */}
      <Ribbon ctx={ctx}
        onFile={() => { void refreshSettings(); setBackstage('home'); }} />
      {session && <div className="contents" ref={inertRef(!!modalTab)}><Banners session={session} onTakeOver={() => void takeOver()} onEnableContent={() => void enableContent()} /></div>}
      <div className="work">
        {session && (
          <div className="contents" ref={inertRef(!!modalTab)}>
            <NavPane tables={tables} objects={objects} readOnly={readOnly} active={active && !active.isNew ? active : null}
              visible={state.navVisible} strip={state.navStrip} runtime={ui.runMode} shortcutMenus={ui.shortcutMenus} onToggle={() => rawDispatch({ type: 'toggleNav' })} dispatch={dispatch} onSelect={setNavSelection} />
          </div>
        )}
        <DocumentTabs state={state} readOnly={readOnly} linkOf={linkedDesign} dispatch={dispatch} onClose={(tab) => void closeTab(tab)} showTabs={ui.documentTabs} formIcon={formIcon} />
      </div>
      {ui.statusBar && <StatusBar ctx={ctx} />}
      {importing && session && design && (
        <design.ImportWizard tables={tables} queries={objects.filter((o) => o.kind === 'query').map((o) => o.name)} pendingRow={(name) => hasPendingRow(live.current.state.tabs, name)}
          source={importing.source} appendTo={importing.appendTo} onClose={() => setImporting(false)} onImported={onImported} />
      )}
      {session !== undefined && showBackstage && (
        <Backstage view={backstage ?? 'home'} onView={setBackstage} onBack={session ? () => setBackstage(null) : null}
          hasBase={!!session} settings={settings}
          onNew={() => void switchBase(api.base.create)} onOpen={(p, shift) => void switchBase(() => api.base.open(p), shift)}
          onCloseBase={() => void closeBase()} readOnly={readOnly} needsRecovery={!!session?.needsRecovery}
          forms={objects.filter((x) => x.kind === 'form').map((x) => x.name)} onStartupApplied={onStartupApplied}
          onSaveAs={() => void switchBase(api.base.saveAs)} onCompact={() => void compact()} />
      )}
    </div>
    <DialogHost tabs={state.tabs} activeId={state.activeId} dispatch={dispatch} readOnly={readOnly} />
    <RunningNotice />
  </>);
}
