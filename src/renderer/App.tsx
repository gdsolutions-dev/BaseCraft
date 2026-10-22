import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionState, TableSummary } from '../shared/api';
import { sameName } from '../shared/field-types';
import { api } from './bridge';
import { applyUi } from './i18n';
import { ImportTextWizard } from './import-text/ImportTextWizard';
import { hasPendingRow } from './import-text/wizard-model';
import { Backstage, type BackstageView, type Settings } from './shell/Backstage';
import { Banners } from './shell/Banners';
import { DocumentTabs } from './shell/DocumentTabs';
import { ModalProvider, useErrorDialog, useModal } from './shell/Modal';
import { NavPane } from './shell/NavPane';
import { Ribbon } from './shell/Ribbon';
import {
  SHELL_SCOPE, modeGuard, registerCommands, runCommand, setActiveCommandTab, setCommandContext, setCommandErrorHandler, type RibbonContext,
} from './shell/ribbon-model';
import { StatusBar } from './shell/StatusBar';
import { appReducer, initialAppState, type AppAction, type DocTab } from './state/app-state';
import './shell/shell.css';

export function App() {
  return <ModalProvider><Shell /></ModalProvider>;
}

function Shell() {
  const { t } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [session, setSession] = useState<SessionState | null | undefined>(undefined); // undefined: not known yet
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [backstage, setBackstage] = useState<BackstageView | null>(null);
  const [importing, setImporting] = useState(false);
  const [state, rawDispatch] = useReducer(appReducer, initialAppState);
  const live = useRef({ state, tables });
  live.current = { state, tables };

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

  // Every table change goes through here so that the navigation pane follows. A change of mode of an open document
  // (ribbon, status bar, navigation pane) first asks the document (a dirty design: "save first?").
  const dispatch = useCallback((a: AppAction) => {
    if (a.type === 'setMode' || a.type === 'open') {
      const tabs = live.current.state.tabs;
      const tab = a.type === 'setMode' ? tabs.find((x) => x.id === a.id)
        : a.isNew ? undefined : tabs.find((x) => x.kind === a.kind && !x.isNew && sameName(x.name, a.name));
      const guard = tab && tab.mode !== a.mode ? modeGuard(tab.id) : undefined;
      if (guard) {
        guard('mode').then((ok) => { if (ok) rawDispatch(a); }, (e) => void showError(e));
        return;
      }
    }
    rawDispatch(a);
    if (a.type === 'tableSaved' || a.type === 'tableRenamed' || a.type === 'tableDropped') void refreshTables();
  }, [refreshTables, showError]);

  useEffect(() => {
    void refreshSettings();
    const off = api.base.onStateChanged(setSession);
    void api.base.state().then((s) => setSession((cur) => (cur === undefined ? s : cur)));
    return off;
  }, [refreshSettings]);

  // A different base: its documents start empty and the backstage gives way.
  const path = session?.path ?? null;
  useEffect(() => {
    rawDispatch({ type: 'reset' });
    if (path) setBackstage(null);
  }, [path]);

  const tablesKey = session ? `${session.path}|${session.readOnly}|${!!session.needsRecovery}` : '';
  useEffect(() => {
    if (tablesKey) void refreshTables();
    else setTables([]);
  }, [tablesKey, refreshTables]);

  useEffect(() => { document.title = session ? `${session.fileName} – ${t('app.title')}` : t('app.title'); }, [session, t]);
  const active = state.tabs.find((x) => x.id === state.activeId) ?? null;
  const ctx: RibbonContext = { hasBase: !!session, readOnly: !!session?.readOnly, mode: active?.mode ?? null, isNew: !!active?.isNew };
  useEffect(() => { setActiveCommandTab(state.activeId); }, [state.activeId]);
  useEffect(() => { setCommandContext(ctx); }); // cheap: ignored when unchanged
  useEffect(() => { setCommandErrorHandler((e) => void showError(e)); }, [showError]);

  // Shell-level commands; a document registering the same command takes precedence.
  useEffect(() => registerCommands(SHELL_SCOPE, {
    createTableDesign: () => {
      const { state: s, tables: list } = live.current;
      const taken = (n: string) => list.some((x) => sameName(x.name, n)) || s.tabs.some((x) => sameName(x.name, n));
      let n = 1;
      while (taken(t('designer.newTableName', { n }))) n++;
      rawDispatch({ type: 'open', kind: 'table', name: t('designer.newTableName', { n }), mode: 'design', isNew: true });
    },
    viewDesign: () => {
      const id = live.current.state.activeId;
      if (id) dispatch({ type: 'setMode', id, mode: 'design' });
    },
    viewDatasheet: () => {
      const id = live.current.state.activeId; // gated by the ribbon context: never for a table not saved yet
      if (id) dispatch({ type: 'setMode', id, mode: 'datasheet' });
    },
    importText: () => setImporting(true),
  }), [t, dispatch]);

  // An import done: the navigation pane shows the new tables (error table included); a datasheet of the table re-reads its rows,
  // a design of it is left alone (never reloaded, never switched); otherwise the table opens in Datasheet view.
  const onImported = (r: { table: string }) => {
    void refreshTables();
    const tab = live.current.state.tabs.find((x) => !x.isNew && sameName(x.name, r.table));
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
      if (s) { setSession(s); setBackstage(null); }
    } catch (e) {
      await showError(e);
    } finally {
      void refreshSettings(); // recent files
    }
  };
  const closeBase = async () => {
    if (!(await leaveDocuments(live.current.state.tabs))) return;
    try { await api.base.close(); setSession(null); } catch (e) { await showError(e); }
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
          <NavPane tables={tables} readOnly={readOnly} activeName={active && !active.isNew ? active.name : null}
            visible={state.navVisible} onToggle={() => rawDispatch({ type: 'toggleNav' })} dispatch={dispatch} />
        )}
        <DocumentTabs state={state} readOnly={readOnly} dispatch={dispatch} onClose={(tab) => void closeTab(tab)} />
      </div>
      <StatusBar ctx={ctx} />
      {importing && session && (
        <ImportTextWizard tables={tables} pendingRow={(name) => hasPendingRow(live.current.state.tabs, name)}
          onClose={() => setImporting(false)} onImported={onImported} />
      )}
      {session !== undefined && showBackstage && (
        <Backstage view={backstage ?? 'home'} onView={setBackstage} onBack={session ? () => setBackstage(null) : null}
          hasBase={!!session} settings={settings} onSettingsChanged={() => void refreshSettings()}
          onNew={() => void switchBase(api.base.create)} onOpen={(p) => void switchBase(() => api.base.open(p))}
          onCloseBase={() => void closeBase()} />
      )}
    </div>
  );
}
