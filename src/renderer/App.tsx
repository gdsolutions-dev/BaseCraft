import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ObjectSummary, SessionState, TableSummary } from '../shared/api';
import { sameName } from '../shared/field-types';
import { saveTableInteractive } from './table-design/save-table';
import { emptyDesign, toSaveRequest, withDefaultPrimaryKey } from './table-design/design-model';
import { instantReport, uniqueReportName } from '../shared/report/instant';
import { api } from './bridge';
import { applyUi } from './i18n';
import { ImportTextWizard } from './import-text/ImportTextWizard';
import { hasPendingRow } from './import-text/wizard-model';
import { autoForm, firstFreeName, formLabels, uniqueFormName } from './form/form-def';
import { requestFieldList } from './form/FormDesignView';
import { Backstage, type BackstageView, type Settings } from './shell/Backstage';
import { compactMessage } from './shell/compact-message';
import { Banners } from './shell/Banners';
import { DocumentTabs } from './shell/DocumentTabs';
import { ModalProvider, useErrorDialog, useModal } from './shell/Modal';
import { NavPane } from './shell/NavPane';
import { setNavImportText } from './shell/nav-menu-items';
import { setNavImportExcel } from './exchange/exchange-menu';
import './query/nav-menu-query'; // after the foundation's items (a later registration wins by id)
import { openSqlView } from './query/QueryDesignView';
import { setOpenTabs } from './query/run-action';
import './report/report-menu'; // A5's Navigation Pane items for reports (C6)
import './exchange/exchange-menu'; // A6's Navigation Pane items: Export (C6)
import { exportNamed } from './exchange/export';
import { setClip } from './exchange/object-clipboard';
import { runNavClipboard } from './shell/nav-menu';
import { requestFieldList as requestReportFieldList } from './report/design/ReportDesignView';
import { showObjectProperties } from './shell/ObjectProperties';
import { Ribbon } from './shell/Ribbon';
import { RunningNotice } from './shell/RunningNotice';
import {
  SHELL_SCOPE, modeGuard, registerCommands, runCommand, setActiveCommandTab, setCommandContext, setCommandErrorHandler, type RibbonContext,
} from './shell/ribbon-model';
import { StatusBar } from './shell/StatusBar';
import { pickSource, setSourceHint } from './shell/SourcePicker';
import { selectedSource, sourceHint } from './shell/source-picker-model';
import { appReducer, initialAppState, isDoc, reopenMode, type AppAction, type DocTab } from './state/app-state';
import './shell/shell.css';

export function App() {
  return <ModalProvider><Shell /></ModalProvider>;
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
  const [importing, setImporting] = useState<false | { appendTo?: string; source?: 'text' | 'excel' }>(false);
  const [navSelection, setNavSelection] = useState<{ kind: string; name: string } | null>(null);
  const [state, rawDispatch] = useReducer(appReducer, initialAppState);
  const live = useRef({ state, tables, objects, readOnly: false, navSelection });
  live.current = { state, tables, objects, readOnly: !!session?.readOnly, navSelection };

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

  // Every table change goes through here so that the navigation pane follows. A change of mode of an open document
  // (ribbon, status bar, navigation pane) first asks the document (a dirty design: "save first?").
  const dispatch = useCallback((a: AppAction) => {
    if (a.type === 'setMode' || a.type === 'open') {
      const tabs = live.current.state.tabs;
      const tab = a.type === 'setMode' ? tabs.find((x) => x.id === a.id)
        : a.isNew ? undefined : tabs.find((x) => isDoc(x, a.kind, a.name));
      const guard = tab && tab.mode !== (a.type === 'open' ? reopenMode(tab, a.mode) : a.mode) ? modeGuard(tab.id) : undefined;
      if (guard) { // A3: the promise tells whether the document let the change happen (openSqlView drops a refused request)
        return guard('mode').then((ok) => { if (ok) rawDispatch(a); return ok; }, (e) => { void showError(e); return false; });
      }
    }
    rawDispatch(a);
    if (a.type === 'tableSaved' || a.type === 'tableRenamed' || a.type === 'tableDropped' || a.type === 'listsChanged' || a.type === 'tableDescribed') void refreshTables();
    if (a.type === 'objectSaved' || a.type === 'objectRenamed' || a.type === 'objectDeleted' || a.type === 'listsChanged') void refreshObjects();
  }, [refreshTables, refreshObjects, showError]);

  useEffect(() => {
    void refreshSettings();
    const off = api.base.onStateChanged(setSession);
    const offCrash = api.base.onHostCrashed(() => {
      void modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: 'dialog.error.hostCrashed', buttons: ['ok'] });
    });
    void api.base.state().then((s) => setSession((cur) => (cur === undefined ? s : cur)));
    return () => { off(); offCrash(); };
  }, [refreshSettings, modal]);

  // A different base: its documents start empty and the backstage gives way.
  const path = session?.path ?? null;
  useEffect(() => {
    rawDispatch({ type: 'reset' });
    setNavSelection(null);
    if (path) setBackstage(null);
  }, [path]);

  const tablesKey = session ? `${session.path}|${session.readOnly}|${!!session.needsRecovery}` : '';
  useEffect(() => {
    if (tablesKey) { void refreshTables(); void refreshObjects(); }
    else { setTables([]); setObjects([]); }
  }, [tablesKey, refreshTables, refreshObjects]);

  useEffect(() => { document.title = session ? `${session.fileName} – ${t('app.title')}` : t('app.title'); }, [session, t]);
  const active = state.tabs.find((x) => x.id === state.activeId) ?? null;
  useEffect(() => { setSourceHint(sourceHint(active, navSelection)); }); // pickSource's default preselection
  const ctx: RibbonContext = {
    hasBase: !!session, readOnly: !!session?.readOnly, mode: active?.mode ?? null, isNew: !!active?.isNew, kind: active?.kind ?? null,
  };
  useEffect(() => { setActiveCommandTab(state.activeId); }, [state.activeId]);
  useEffect(() => { setCommandContext(ctx); }); // cheap: ignored when unchanged
  useEffect(() => { setCommandErrorHandler((e) => void showError(e)); }, [showError]);
  useEffect(() => setNavImportText((table) => setImporting({ appendTo: table })), []);
  useEffect(() => setNavImportExcel((table) => setImporting({ appendTo: table, source: 'excel' })), []);
  useEffect(() => setOpenTabs(() => live.current.state.tabs), []);

  /** The forms' names, saved or open (a new form's tab not saved yet). */
  const formNames = (objs: ObjectSummary[], tabs: DocTab[]) => [...objs, ...tabs].filter((x) => x.kind === 'form').map((x) => x.name);
  /** Create › Form Design / Blank Form: a new form named Formulaire<n> (the first free n among forms and open tabs). */
  const newForm = (fieldList: boolean) => {
    const { state: s, objects: objs } = live.current;
    const name = firstFreeName(formNames(objs, s.tabs), (n) => t('form.newName', { n }));
    if (fieldList) requestFieldList(name);
    rawDispatch({ type: 'open', kind: 'form', name, mode: 'design', isNew: true });
  };
  /** The first « État<n> » free among the reports and the open tabs. */
  const newReportName = useCallback(() => {
    const { state: s, objects: objs } = live.current;
    return firstFreeName([...s.tabs, ...objs.filter((x) => x.kind === 'report')].map((x) => x.name), (n) => t('report.newName', { n }));
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
    createTableDesign: () => {
      const { state: s, tables: list, objects: objs } = live.current; // a query shares the tables' namespace
      const taken = (n: string) => list.some((x) => sameName(x.name, n)) || s.tabs.some((x) => sameName(x.name, n))
        || objs.some((x) => x.kind === 'query' && sameName(x.name, n));
      let n = 1;
      while (taken(t('designer.newTableName', { n }))) n++;
      rawDispatch({ type: 'open', kind: 'table', name: t('designer.newTableName', { n }), mode: 'design', isNew: true });
    },
    // Table Fields tab › Create › Table: Table1 (free among tables, queries and open tabs) with the AutoNumber key, saved at once
    createTable: async () => {
      const { state: s, tables: list, objects: objs } = live.current;
      const taken = (n: string) => list.some((x) => sameName(x.name, n)) || s.tabs.some((x) => sameName(x.name, n))
        || objs.some((x) => x.kind === 'query' && sameName(x.name, n));
      let n = 1;
      while (taken(`${t('tableFields.newTable')}${n}`)) n++;
      const name = `${t('tableFields.newTable')}${n}`;
      const m = withDefaultPrimaryKey(emptyDesign(), t('designer.defaultIdName'));
      if (!(await saveTableInteractive(modal, toSaveRequest(m, name, false)))) return;
      dispatch({ type: 'tableSaved', name });
      dispatch({ type: 'open', kind: 'table', name, mode: 'datasheet' });
    },
    viewDesign: () => {
      const id = live.current.state.activeId;
      if (id) dispatch({ type: 'setMode', id, mode: 'design' });
    },
    viewDatasheet: () => {
      const tab = live.current.state.tabs.find((x) => x.id === live.current.state.activeId); // gated: never for a table not saved yet
      if (tab) dispatch({ type: 'setMode', id: tab.id, mode: tab.kind === 'table' || tab.kind === 'form' ? 'datasheet' : 'run' }); // an object's Run view; a form's Datasheet view (M10)
    },
    importText: () => setImporting({}),
    importExcel: () => setImporting({ source: 'excel' }),
    // Home › Clipboard: the Navigation Pane's item when the pane has the focus, else the focused element (text field, datasheet)
    cut: () => clipboardCommand('cut'),
    copy: () => clipboardCommand('copy'),
    paste: () => clipboardCommand('paste'),
    exportText: () => exportSelected('text'),
    exportExcel: () => exportSelected('excel'),
    compactRepair: () => compact(),
    saveAs: () => switchBase(api.base.saveAs),
    relationships: () => rawDispatch({ type: 'open', kind: 'relations', name: 'Relations', mode: 'run' }),
    tableProperties: () => {
      const tab = live.current.state.tabs.find((x) => x.id === live.current.state.activeId); // gated: a table's datasheet
      if (tab) return showObjectProperties(modal, { kind: 'table', name: tab.name }, live.current.readOnly, dispatch);
    },
    createFormDesign: () => newForm(false),
    viewForm: () => {
      const tab = live.current.state.tabs.find((x) => x.id === live.current.state.activeId); // gated: a saved form
      if (tab) dispatch({ type: 'setMode', id: tab.id, mode: 'run' });
    },
    // Access opens it in Layout view (later): a new unbound form in Design view, the Field List shown
    createBlankForm: () => newForm(true),
    // Create › Form (AutoForm): a columnar form of the selected (else chosen) source, saved under its name (made unique), opened in Form view
    createForm: async () => {
      const src = await sourceToCreate('form.autoFormSource');
      if (!src) return;
      const info = await api.sources.describe(src.ref);   // a rejection (a query that cannot be read) is shown; no form
      const { state: s, objects: objs } = live.current;
      const name = uniqueFormName(formNames(objs, s.tabs), src.name);
      const r = await api.objects.save('form', name, autoForm(src.ref, src.name, info, formLabels(t)), null);
      if (!r.ok) { await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`, buttons: ['ok'] }); return; }
      dispatch({ type: 'objectSaved', kind: 'form', name });
      dispatch({ type: 'open', kind: 'form', name, mode: 'run' });
    },
    // A3: a new query in Design view, named like a new table (Requête1…), free among tables, queries and open tabs
    createQueryDesign: () => rawDispatch({ type: 'open', kind: 'query', name: newQueryName(), mode: 'design', isNew: true }),
    // A3 Task 9: a new query in SQL view; SQL View from a query's datasheet (its Design view has its own handler)
    createSqlQuery: () => openSqlView(rawDispatch, newQueryName(), true),
    viewSql: () => {
      const tab = live.current.state.tabs.find((x) => x.id === live.current.state.activeId);
      if (tab?.kind === 'query') openSqlView(dispatch, tab.name);
    },
    // AutoReport (A5): a tabular report on the selected (else chosen) source, saved under a free name and opened in Print Preview.
    createReport: async () => {
      const src = await sourceToCreate('report.pickSourceTitle');
      if (!src) return;
      const doc = instantReport({ ...src.ref, name: src.name }, await api.sources.describe(src.ref), { lang: i18n.language === 'en' ? 'en' : 'fr' });
      const name = uniqueReportName((await api.objects.list('report')).map((o) => o.name), src.name);
      const r = await api.objects.save('report', name, doc, null);
      if (!r.ok) { await modal.confirm({ titleKey: 'dialog.errorTitle', messageKey: `dialog.op.${r.reason}`, buttons: ['ok'] }); return; }
      dispatch({ type: 'objectSaved', kind: 'report', name });
      dispatch({ type: 'open', kind: 'report', name, mode: 'run' });
    },
    // Report Design and Blank Report (A5): a new report in Design view, État1…; Access opens a blank report in Layout view
    // (later) with the Field List: here, Design view with the Field List.
    createReportDesign: () => rawDispatch({ type: 'open', kind: 'report', name: newReportName(), mode: 'design', isNew: true }),
    createBlankReport: () => {
      const name = newReportName();
      requestReportFieldList(name);
      rawDispatch({ type: 'open', kind: 'report', name, mode: 'design', isNew: true });
    },
    viewPrintPreview: () => {
      const id = live.current.state.activeId; // gated: a saved report
      if (id) dispatch({ type: 'setMode', id, mode: 'run' });
    },
  }), [t, i18n, modal, dispatch, newReportName]);
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
      if (document.querySelector('[aria-modal="true"]')) return; // a dialog or the backstage is in front
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        runCommand('save');
      } else if (e.key === 'F11') {
        e.preventDefault();
        rawDispatch({ type: 'toggleNav' });
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
    for (const tab of tabs) {
      const guard = modeGuard(tab.id);
      if (guard && !(await guard('close'))) { rawDispatch({ type: 'activate', id: tab.id }); return false; }
    }
    return true;
  };
  const closeTab = async (tab: DocTab) => {
    try { if (await leaveDocuments([tab])) rawDispatch({ type: 'close', id: tab.id }); } catch (e) { await showError(e); }
  };

  // R24: the window's close button (and the system) asks first; main closes the window only once the documents agree.
  const closing = useRef(false);
  const leaveRef = useRef(leaveDocuments);
  leaveRef.current = leaveDocuments;
  useEffect(() => api.app.onCloseRequested(() => {
    if (closing.current) return; // a second click while the first close is still asking
    closing.current = true;
    leaveRef.current(live.current.state.tabs)
      .then((ok) => (ok ? api.app.confirmClose() : undefined))
      .catch((e) => showError(e))
      .finally(() => { closing.current = false; });
  }), [showError]);

  const switchBase = async (fn: () => Promise<SessionState | null>) => {
    if (!(await leaveDocuments(live.current.state.tabs))) return;
    try {
      const s = await fn();
      if (s) { setClip(null); setSession(s); setBackstage(null); }
    } catch (e) {
      await showError(e);
    } finally {
      void refreshSettings(); // recent files
    }
  };
  const closeBase = async () => {
    if (!(await leaveDocuments(live.current.state.tabs))) return;
    try { await api.base.close(); setClip(null); setSession(null); } catch (e) { await showError(e); }
  };
  // Compact and Repair (A6): as in Access, every document is closed first (each one asked about its changes).
  const compact = async () => {
    if (!(await leaveDocuments(live.current.state.tabs))) return;
    rawDispatch({ type: 'reset' });
    setBackstage(null);
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
  const takeOver = async () => {
    try { setSession(await api.base.takeOverLock()); } catch (e) { await showError(e); }
  };

  const readOnly = !!session?.readOnly;
  const showBackstage = session === null || backstage !== null;

  return (
    <div className="app" data-testid="app-root">
      <Ribbon ctx={ctx}
        onFile={() => { void refreshSettings(); setBackstage('home'); }} />
      {session && <Banners session={session} onTakeOver={() => void takeOver()} />}
      <div className="work">
        {session && (
          <NavPane tables={tables} objects={objects} readOnly={readOnly} active={active && !active.isNew ? active : null}
            visible={state.navVisible} onToggle={() => rawDispatch({ type: 'toggleNav' })} dispatch={dispatch} onSelect={setNavSelection} />
        )}
        <DocumentTabs state={state} readOnly={readOnly} dispatch={dispatch} onClose={(tab) => void closeTab(tab)} />
      </div>
      <StatusBar ctx={ctx} />
      <RunningNotice />
      {importing && session && (
        <ImportTextWizard tables={tables} queries={objects.filter((o) => o.kind === 'query').map((o) => o.name)} pendingRow={(name) => hasPendingRow(live.current.state.tabs, name)}
          source={importing.source} appendTo={importing.appendTo} onClose={() => setImporting(false)} onImported={onImported} />
      )}
      {session !== undefined && showBackstage && (
        <Backstage view={backstage ?? 'home'} onView={setBackstage} onBack={session ? () => setBackstage(null) : null}
          hasBase={!!session} settings={settings} onSettingsChanged={() => void refreshSettings()}
          onNew={() => void switchBase(api.base.create)} onOpen={(p) => void switchBase(() => api.base.open(p))}
          onCloseBase={() => void closeBase()} readOnly={readOnly}
          onSaveAs={() => void switchBase(api.base.saveAs)} onCompact={() => void compact()} />
      )}
    </div>
  );
}
