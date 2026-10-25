// Macro en mode Création : les blocs (ActionBlock), l'enregistrement (validateMacro, puis api.objects.save, le nom demandé pour une
// nouvelle macro), la question à la fermeture d'une macro modifiée, les commandes du ruban Création de macro (Exécuter, Pas à pas,
// Réduire/développer, Catalogue d'actions, Afficher toutes les actions).
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayContext } from '../../shared/expr/localize';
import { localeInfo } from '../../shared/locale-format';
import { emptyMacro, parseMacroDef, validateMacro, type MacroDef } from '../../shared/macro/model';
import { api } from '../bridge';
import type { DocViewProps } from '../shell/DocumentTabs';
import { errorMessage, useErrorDialog, useModal } from '../shell/Modal';
import { nameErrorKey } from '../shell/nav-menu-items';
import { registerCommandStates, registerCommands, registerModeGuard } from '../shell/ribbon-model';
import { ActionCatalog } from './ActionCatalog';
import { ItemList, type BlockCtx } from './ActionBlock';
import type { ObjectLists } from './ArgEditor';
import { initialEdit, macroEdit, pathKey } from './macro-edit';
import { macroNamesWithSubs, runMacroByName } from './macro-shell';
import './macro.css';

const NO_LISTS: ObjectLists = { table: [], query: [], form: [], report: [], macro: [] };

/** Loads the definition (a new macro starts empty), then the designer. */
export function MacroDesignView(p: DocViewProps) {
  const { t } = useTranslation();
  const [def, setDef] = useState<MacroDef | { error: string } | null>(() => (p.tab.isNew ? emptyMacro() : null));
  useEffect(() => {
    if (p.tab.isNew) return;
    let current = true;
    api.objects.get('macro', p.tab.name).then((r) => { if (current) setDef(parseMacroDef(r.definition)); }).catch((e) => {
      if (!current) return;
      if (e instanceof Error && e.message === 'bc:invalidDefinition') { setDef({ error: t('dialog.error.corruptObject') }); return; }
      const m = errorMessage(e);
      setDef({ error: t(m.key, m.params) });
    });
    return () => { current = false; };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- read once: a save renames the tab, it does not reload
  if (def && 'error' in def) return <div className="doc-empty muted" role="alert" data-testid="macro-load-error">{def.error}</div>;
  return def ? <MacroEditor {...p} def={def} /> : <div className="macro-design" />;
}

function MacroEditor({ tab, readOnly, dispatch, def }: DocViewProps & { def: MacroDef }) {
  const { t, i18n } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  // the Action Catalog is shown for a new macro, as Access
  const [state, send] = useReducer(macroEdit, def, (d) => ({ ...initialEdit(d), catalog: !!tab.isNew }));
  const [singleStep, setSingleStep] = useState(false);   // Single Step: the next Run asks before each action
  const [region, setRegion] = useState<string | null>(null);
  const [lists, setLists] = useState<ObjectLists>(NO_LISTS);
  const root = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  useEffect(() => { void api.app.getSettings().then((s) => setRegion(s.region), () => setRegion('en-US')); }, []);
  const lang = i18n.language.startsWith('fr') ? 'fr' : 'en';
  const display = useMemo<DisplayContext>(() => ({ lang, region: localeInfo(region ?? 'en-US') }), [lang, region]);

  // the objects the name arguments offer (free text stays allowed: an object created later)
  useEffect(() => {
    let current = true;
    Promise.all([api.tables.list(), api.objects.list(), macroNamesWithSubs()]).then(([ts, os, macros]) => {
      if (!current) return;
      const of = (k: string) => os.filter((o) => o.kind === k).map((o) => o.name);
      setLists({ table: ts.map((x) => x.name), query: of('query'), form: of('form'), report: of('report'), macro: macros });
    }, () => { /* a base closed meanwhile: empty lists */ });
    return () => { current = false; };
  }, [tab.reloadToken]);

  const live = useRef({ state, readOnly, tab, singleStep });
  live.current = { state, readOnly, tab, singleStep };

  useEffect(() => { dispatch({ type: 'setDirty', id: tab.id, dirty: state.dirty }); }, [state.dirty, tab.id, dispatch]);
  useEffect(() => () => { void dispatch({ type: 'setDirty', id: tab.id, dirty: false }); }, [tab.id, dispatch]);

  /** A field being typed is committed when it loses the focus: it reaches the definition before the save. */
  const flush = async () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !root.current?.contains(el)) return;
    el.blur();
    await new Promise((r) => setTimeout(r));
  };
  const message = (messageKey: string, params?: object) => modal.confirm({ titleKey: 'dialog.errorTitle', messageKey, params, buttons: ['ok'] });
  const askName = (initial: string) => modal.prompt({ titleKey: 'designer.saveAsTitle', labelKey: 'macro.nameLabel', initial,
    validate: (v) => { const k = nameErrorKey(v); return k && t(k); } });

  /** The name saved under, or null (nothing saved). */
  const save = async (): Promise<string | null> => {
    if (busy.current) return null;
    if (live.current.readOnly) { await message('dialog.op.readOnly'); return null; }
    busy.current = true;
    try {
      await flush();
      const issues = validateMacro(live.current.state.def);
      if (issues.length) {
        await message('macro.issues', { list: issues.map((x) => t(`macro.issue.${x.code}`, { path: x.path })).join('\n') });
        return null;
      }
      const doc = live.current.tab;
      let name = doc.isNew ? await askName(doc.name) : doc.name;
      for (;;) {
        if (name === null) return null;
        const r = await api.objects.save('macro', name, live.current.state.def, doc.isNew ? null : doc.name);
        if (r.ok) {
          send({ type: 'saved' });
          dispatch(doc.isNew ? { type: 'objectSaved', kind: 'macro', name, tabId: doc.id } : { type: 'objectSaved', kind: 'macro', name });
          return name;
        }
        await message(`dialog.op.${r.reason}`);
        if (!doc.isNew || (r.reason !== 'nameExists' && r.reason !== 'nameInvalid')) return null;
        name = await askName(name);
      }
    } catch (e) {
      await showError(e);   // bc:invalidArgument past 8 M characters: the designer stays modified
      return null;
    } finally {
      busy.current = false;
    }
  };

  /** Before the view goes: Yes saves, No drops the changes, Cancel keeps the macro open. */
  const leave = async (): Promise<boolean> => {
    if (busy.current) return false;
    await flush();
    const { state: s, tab: doc } = live.current;
    if (!s.dirty) return true;
    const r = await modal.confirm({ titleKey: 'macro.saveFirstTitle', messageKey: 'macro.saveFirst', params: { name: doc.name }, buttons: ['yes', 'no', 'cancel'] });
    return r === 'no' || (r === 'yes' && (await save()) !== null);
  };

  /** Run: a new or modified macro is saved first (No: nothing runs); the run is stepped while Single Step is on. */
  const run = async () => {
    if (busy.current) return;
    await flush();
    const { state: s, tab: doc } = live.current;
    let name: string | null = doc.name;
    if (s.dirty || doc.isNew) {
      const r = await modal.confirm({ titleKey: 'macro.saveFirstTitle', messageKey: 'macro.saveBeforeRun', buttons: ['yes', 'no'] });
      name = r === 'yes' ? await save() : null;
    }
    if (name === null) return;
    try { await runMacroByName(name, { singleStep: live.current.singleStep }); } catch (e) { await showError(e); }
  };

  const cmds = useRef({ save, leave, run });
  cmds.current = { save, leave, run };
  useEffect(() => {
    const collapse = (on: boolean) => { const sel = live.current.state.selected; if (sel) send({ type: 'collapse', path: sel, on }); };
    const off = registerCommands(tab.id, {
      save: async () => { await cmds.current.save(); },
      macroRun: () => cmds.current.run(),
      singleStep: () => setSingleStep((v) => !v),
      expandActions: () => collapse(false), collapseActions: () => collapse(true),
      expandAll: () => send({ type: 'collapseAll', on: false }), collapseAll: () => send({ type: 'collapseAll', on: true }),
      actionCatalog: () => send({ type: 'toggleCatalog' }), showAllActions: () => send({ type: 'toggleShowAll' }),
    });
    const offGuard = registerModeGuard(tab.id, () => cmds.current.leave());
    return () => { off(); offGuard(); };
  }, [tab.id]);

  // pressed: Single Step, the catalogue shown, unsafe actions listed; Expand / Collapse Actions need a selected block
  const hasSelection = state.selected !== null;
  useEffect(() => registerCommandStates(tab.id, {
    singleStep: { active: singleStep }, actionCatalog: { active: state.catalog }, showAllActions: { active: state.showAll },
    expandActions: { enabled: hasSelection }, collapseActions: { enabled: hasSelection },
  }), [tab.id, singleStep, state.catalog, state.showAll, hasSelection]);

  // the selected block keeps the focus when Ctrl+Up / Ctrl+Down moves it
  useEffect(() => {
    if (!state.selected || !(document.activeElement as HTMLElement | null)?.classList.contains('macro-block')) return;
    root.current?.querySelector<HTMLElement>(`[data-testid="macro-item-${pathKey(state.selected)}"]`)?.focus();
  }, [state.selected]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const { state: s, readOnly: ro } = live.current;
    const el = e.target as HTMLElement;
    // not from a field: the blocks are keyed by index, so a field's pending text would follow the index, not its moved item
    if (!s.selected || ro || el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return;
    if (e.key === 'Delete' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      send({ type: 'remove', path: s.selected });
    } else if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      send({ type: 'move', path: s.selected, dir: e.key === 'ArrowUp' ? -1 : 1 });
    }
  };

  const ctx = useMemo<BlockCtx>(() => ({ display, readOnly, send, lists, state }), [display, readOnly, lists, state]);
  if (region === null) return <div className="macro-design" ref={root} />;
  return (
    <div className="macro-designer">
      <div className="macro-design" ref={root} data-testid="macro-design" onKeyDown={onKeyDown} onClick={() => send({ type: 'select', path: null })}>
        <ItemList items={state.def.items} lp={[]} ctx={ctx} />
      </div>
      {state.catalog && <ActionCatalog state={state} send={send} readOnly={readOnly} />}
    </div>
  );
}
