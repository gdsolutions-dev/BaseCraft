// Macro en mode Création : les blocs (ActionBlock), l'enregistrement (validateMacro, puis api.objects.save, le nom demandé pour une
// nouvelle macro), la question à la fermeture d'une macro modifiée, les commandes du ruban Création de macro (Exécuter, Pas à pas,
// Réduire/développer, Catalogue d'actions, Afficher toutes les actions). Une macro incorporée (R16, tab.embedded) se lit dans sa session
// et s'enregistre dans le formulaire ou l'état ouvert, sans nom ni fichier ; ni Exécuter ni Pas à pas.
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DisplayContext } from '../../shared/expr/localize';
import { localeInfo } from '../../shared/locale-format';
import { dataMacroIssue } from '../../shared/macro/data-macro';
import { sameName } from '../../shared/field-types';
import { emptyMacro, parseMacroDef, validateMacro, type MacroDef } from '../../shared/macro/model';
import { convertedModuleName, convertMacro } from '../../shared/macro/to-python';
import type { ModuleExport } from '../../shared/python/bridge';
import { api } from '../bridge';
import { functionClashes, listFunctions } from '../python/function-index';
import { pythonHost } from '../python/python-host';
import type { DocViewProps } from '../shell/DocumentTabs';
import { errorMessage, useErrorDialog, useModal } from '../shell/Modal';
import { nameErrorKey } from '../shell/nav-menu-items';
import { registerCommandStates, registerCommands, registerModeGuard } from '../shell/ribbon-model';
import { ActionCatalog } from './ActionCatalog';
import { askConvertOptions } from './ConvertMacrosDialog';
import { ItemList, type BlockCtx } from './ActionBlock';
import type { ObjectLists } from './ArgEditor';
import { dropEmbedded, embeddedSession } from './embedded';
import { initialEdit, macroEdit, pathKey } from './macro-edit';
import { macroNamesWithSubs, runMacroByName } from './macro-shell';
import './macro.css';

const NO_LISTS: ObjectLists = { table: [], query: [], form: [], report: [], macro: [] };

/** Loads the definition (a new macro starts empty), then the designer. */
export function MacroDesignView(p: DocViewProps) {
  const { t } = useTranslation();
  const emb = p.tab.embedded;
  const [def, setDef] = useState<MacroDef | { error: string } | null>(() => (p.tab.isNew ? emptyMacro()
    : emb ? embeddedSession(emb)?.def ?? { error: t('macro.embedded.ownerGone') } : null));
  useEffect(() => (emb ? () => dropEmbedded(emb) : undefined), [emb]);   // its tab closed: the session goes
  useEffect(() => {
    if (p.tab.isNew || emb) return;
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
  const [state, send] = useReducer(macroEdit, def, (d) => ({ ...initialEdit(d, tab.embedded ? embeddedSession(tab.embedded)?.data ?? null : null), catalog: !!tab.isNew }));
  const [singleStep, setSingleStep] = useState(false);   // Single Step: the next Run asks before each action
  const [region, setRegion] = useState<string | null>(null);
  const [lists, setLists] = useState<ObjectLists>(NO_LISTS);
  const root = useRef<HTMLDivElement>(null);
  const busy = useRef<Promise<unknown> | null>(null);   // the save under way
  const savedDef = useRef<unknown>(null);   // the macro last saved: still shown, nothing to save (before the render says so)

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
  const saveNow = async (): Promise<string | null> => {
    if (live.current.readOnly) { await message('dialog.op.readOnly'); return null; }
    try {
      await flush();
      const data = live.current.state.data;   // a data macro (T2): its own checks (actions allowed for the event, no Python)
      const issues = validateMacro(live.current.state.def, { data: !!data });
      const dataIssue = data && issues.length === 0 ? dataMacroIssue(live.current.state.def, data === 'named' ? undefined : data) : null;
      if (issues.length || dataIssue) {
        await message('macro.issues', { list: dataIssue ?? issues.map((x) => t(`macro.issue.${x.code}`, { path: x.path })).join('\n') });
        return null;
      }
      const doc = live.current.tab;
      if (doc.embedded) {   // into its design (R16): the design becomes dirty, nothing is written to the file
        const session = embeddedSession(doc.embedded);
        if (!(await session?.save(live.current.state.def))) { await message('macro.embedded.ownerGone'); return null; }
        savedDef.current = live.current.state.def;
        send({ type: 'saved' });
        return doc.name;
      }
      let name = doc.isNew ? await askName(doc.name) : doc.name;
      for (;;) {
        if (name === null) return null;
        const def = live.current.state.def;
        const r = await api.objects.save('macro', name, def, doc.isNew ? null : doc.name);
        if (r.ok) {
          savedDef.current = def;
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
    }
  };
  /** One save at a time; leaving waits for the one under way (Access's save is over before the next action). */
  const save = (): Promise<string | null> => busy.current ? Promise.resolve(null) : (busy.current = saveNow().finally(() => { busy.current = null; }));

  /** Before the view goes: Yes saves, No drops the changes, Cancel keeps the macro open. */
  const leave = async (): Promise<boolean> => {
    while (busy.current) await busy.current;   // closed or switched while Ctrl+S is saving: once saved (Access)
    await flush();
    const { state: s, tab: doc } = live.current;
    if (!s.dirty || s.def === savedDef.current) return true;
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

  /** Convert Macros to Python (D4): the saved macro becomes the module "Converted_Macro_<name>"; the macro is not touched, nothing is opened. */
  const convert = async () => {
    if (busy.current) return;
    await flush();
    const { state: s, tab: doc } = live.current;
    if (live.current.readOnly) { await message('dialog.op.readOnly'); return; }
    let name: string | null = doc.name;
    if (s.dirty || doc.isNew) {
      const r = await modal.confirm({ titleKey: 'macro.saveFirstTitle', messageKey: 'macro.convert.saveFirst', buttons: ['yes', 'no'] });
      name = r === 'yes' ? await save() : null;
    }
    if (name === null) return;
    const options = await askConvertOptions(modal);
    if (!options) return;
    try {
      const [mods, fns] = await Promise.all([api.objects.list('module'), listFunctions()]);
      const out = convertMacro(name, live.current.state.def, options, { moduleOf: (f) => { const x = fns.find((y) => sameName(y.fn, f)); return x ? { module: x.module, fn: x.fn } : null } });
      const module = convertedModuleName(name, mods.map((m) => m.name));
      let exports: ModuleExport[] = [], engineDown = false;
      try { exports = (await pythonHost().exports(out.source)).exports; } catch { engineDown = true; }   // as the module editor: saved anyway
      const r = await api.objects.save('module', module, { formatVersion: '1.0', source: out.source, exports }, null);
      if (!r.ok) { await message(`dialog.op.${r.reason}`); return; }
      dispatch({ type: 'objectSaved', kind: 'module', name: module });
      if (!engineDown && pythonHost().state() !== 'off') await pythonHost().reset();
      const clashes = await functionClashes(module, exports).catch(() => []);
      await modal.confirm({ titleKey: 'macro.convert.title', messageKey: 'macro.convert.done', params: { macro: name, module }, buttons: ['ok'] });
      if (engineDown) await message('module.exportsUnavailable');
      if (out.notes.length) await modal.confirm({ titleKey: 'macro.convert.title', messageKey: 'macro.convert.todo', params: { count: out.notes.length }, buttons: ['ok'] });
      for (const x of clashes) await message(x.other === null ? 'module.functionBuiltin' : 'module.functionClash', { name: x.fn, fn: x.fn, other: x.other });
    } catch (e) { await showError(e); }
  };

  const cmds = useRef({ save, leave, run, convert });
  cmds.current = { save, leave, run, convert };
  useEffect(() => {
    const collapse = (on: boolean) => { const sel = live.current.state.selected; if (sel) send({ type: 'collapse', path: sel, on }); };
    const off = registerCommands(tab.id, {
      save: async () => { await cmds.current.save(); },
      ...(tab.embedded ? {} : { macroRun: () => cmds.current.run(), singleStep: () => setSingleStep((v) => !v), convertMacros: () => cmds.current.convert() }),
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

  const ctx = useMemo<BlockCtx>(() => ({ display, readOnly, send, lists, state, ...(state.data ? { data: true } : {}) }), [display, readOnly, lists, state]);
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
