// Formulaire en mode Création : le concepteur générique avec l'hôte des formulaires, la Feuille de propriétés, la Liste des champs,
// l'ordre de tabulation ; chargement et enregistrement par api.objects (genre 'form').
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesignDoc, SectionDef } from '../../shared/design/model';
import type { DisplayContext } from '../../shared/expr/localize';
import { localeInfo } from '../../shared/locale-format';
import type { SourceField } from '../../shared/record-source';
import { api } from '../bridge';
import { promptParameters } from '../query/prompt-parameters';
import { unsavedRunDoc } from '../query/unsaved-run';
import { ArrangePopup, Designer, FormatPopup, LayoutPopupMenu, type ToolState } from '../designer/Designer';
import { clipboardCommands, clipContext, pasteEnabled, subscribeClip } from '../designer/designer-clipboard';
import { designerCommands, selectedCount, type ArrangeMenu } from '../designer/designer-commands';
import { designerReducer, findControl, initDesigner, setDocProp, type DesignerAction } from '../designer/designer-model';
import { registerOpenDesign } from '../designer/open-designs';
import { ThemeGallery } from '../designer/ThemeGallery';
import { FieldList } from '../designer/FieldList';
import { formatCommands, type FormatPopupId } from '../designer/format-commands';
import { layoutCommands, layoutKey, type LayoutPopup } from '../designer/layout-commands';
import { deleteKeyAllowed } from '../designer/delete-guard';
import { fromSourceRef } from '../designer/property-sheet-model';
import type { PropertySheetContext } from '../designer/sheet-types';
import type { DocViewProps } from '../shell/DocumentTabs';
import { errorMessage, useErrorDialog, useModal, type ModalApi } from '../shell/Modal';
import { nameErrorKey } from '../shell/nav-menu-items';
import { firstPythonCall, viewCode } from '../designer/view-code';
import { registerCommandStates, registerCommands, registerModeGuard, runCommand } from '../shell/ribbon-model';
import { editsDesign, sameView, type DocMode } from '../state/app-state';
import { emptyFormDoc, fieldControls, FORM_SECTIONS, FormDefError, headerFooterShown, nextFreeTop, parseFormDoc, shouldReload, toggleHeaderFooter, withPageTabOrder, withTabOrder } from './form-def';
import { DocThemeProvider, useAppMode } from '../design/theme-context';
import { useFormHost } from './form-host';
import { viewHost } from './layout-host';
import { LayoutRecordBar } from './LayoutRecordBar';
import { loadLive, type LiveData } from './live-records';
import { proposeLinks } from './links';
import { GALLERY_TOOLS, headerItem } from './form-ribbon';
import './form-nav-menu';
import { pageGroup, sectionGroups, TabOrderDialog } from './TabOrderDialog';
import { allowsLayout, firstRun } from './views';
import './form.css';

const FIELD_LEFT = 1701;   // 3 cm : un champ ajouté sans point de dépôt, son étiquette à gauche
interface Lists { tables: string[]; queries: string[]; forms: string[]; reports: string[] }
const NO_LISTS: Lists = { tables: [], queries: [], forms: [], reports: [] };
const PICTURE_MAX = 1024 * 1024;   // comme la Feuille de propriétés

/** Formulaire vierge (Créer › Formulaire vierge) : le nouvel onglet de ce nom provisoire s'ouvre avec la Liste des champs (lu une fois). */
let fieldListFor: string | null = null;
export function requestFieldList(name: string): void { fieldListFor = name; }

interface Leaving { mode: DocMode; name: string; busy: boolean; flush(): Promise<void>; dirty(): boolean; confirm: ModalApi['confirm']; save(): Promise<boolean>; unsaved(keep: boolean): void }
/** Avant que la vue parte : vers le mode Formulaire ou Feuille, la définition telle quelle s'affiche, enregistrée ou non (Access, comme une
 *  requête) ; à la fermeture, Oui enregistre, Non abandonne les modifications.
 *  Création ↔ Page (L2) : le même concepteur reste, rien n'est demandé (modifications et annulations gardées). */
export async function leaveFormDesign(reason: 'mode' | 'close', target: DocMode | undefined, d: Leaving): Promise<boolean> {
  if (reason === 'mode' && sameView(d.mode, target)) return true;   // pas même pendant un enregistrement : rien n'est quitté
  if (d.busy) return false;
  await d.flush();
  if (reason === 'mode') { d.unsaved(d.dirty()); return true; }
  if (!d.dirty()) return true;
  const r = await d.confirm({ titleKey: 'form.saveFirstTitle', messageKey: 'form.saveFirst', params: { name: d.name }, buttons: ['yes', 'no', 'cancel'] });
  return r === 'no' || (r === 'yes' && (await d.save()));
}

export function FormDesignView({ tab, active, readOnly, dispatch }: DocViewProps) {
  const { t, i18n } = useTranslation();
  const modal = useModal();
  const showError = useErrorDialog();
  const [state, send] = useReducer(designerReducer, undefined, () => initDesigner(emptyFormDoc(null), 'form'));
  useState(() => firstRun(tab.id));   // opened in Design view: Form view is then never the opening view (Default View Datasheet)
  const [phase, setPhase] = useState<'loading' | 'ready' | { error: string }>(tab.isNew ? 'ready' : 'loading');
  const [extra, setExtra] = useState<SectionDef[]>([]);   // sections d'un autre genre : gardées telles quelles, non montrées
  const [notice, setNotice] = useState({ dropped: 0, badSource: false });
  const [linked, setLinked] = useState<string | null>(null);   // the link fields just proposed for a subform (form.subform.linked)
  const [fields, setFields] = useState<SourceField[]>([]);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [lists, setLists] = useState<Lists>(NO_LISTS);
  const [region, setRegion] = useState<string | null>(null);
  const [tool, setTool] = useState<ToolState>({ kind: null, locked: false });
  const [sheetVisible, setSheetVisible] = useState(true);
  const [fieldList, setFieldList] = useState(() => !!tab.isNew && fieldListFor === tab.name);
  const [menu, setMenu] = useState<ArrangeMenu | null>(null);
  const [formatMenu, setFormatMenu] = useState<FormatPopupId | null>(null);
  const [themesOpen, setThemesOpen] = useState(false);
  const [layoutMenu, setLayoutMenu] = useState<LayoutPopup | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const logoFile = useRef<HTMLInputElement>(null);
  const loaded = useRef<{ name: string; token: number } | null>(null);
  const busy = useRef(false);
  const [liveGen, setLiveGen] = useState(0);   // L2 : la définition relue d'ailleurs (pas un enregistrement d'ici) relit les données du mode Page

  useEffect(() => { if (fieldListFor === tab.name) fieldListFor = null; }, [tab.name]);
  useEffect(() => { void api.app.getSettings().then((s) => setRegion(s.region), () => setRegion('en-US')); }, []);
  const appMode = useAppMode();
  const lang = i18n.language.startsWith('fr') ? 'fr' : 'en';
  const display = useMemo<DisplayContext>(() => ({ lang, region: localeInfo(region ?? 'en-US') }), [lang, region]);
  const fieldNames = useMemo(() => fields.map((f) => f.name), [fields]);
  const sheet = useMemo<PropertySheetContext>(() => ({ display, fields: fieldNames, tables: lists.tables, queries: lists.queries,
    objects: (k) => (k === 'form' ? lists.forms : lists.reports), owner: { tabId: tab.id, name: tab.name, doc: () => live.current.state.doc } }),
    [display, fieldNames, lists, tab.id, tab.name]);
  const pageTabOrder = useCallback((control: string, page: number) => void cmds.current.tabOrder({ control, page }), []);   // cmds : plus bas, lu au clic
  const { host, labels } = useFormHost(sheet, tab.mode === 'layout' ? undefined : pageTabOrder);   // pas d'Ordre de tabulation en mode Page (Access)

  const live = useRef({ state, readOnly, tab, extra, phase, labels, host });
  live.current = { state, readOnly, tab, extra, phase, labels, host };

  // la définition : à l'ouverture, puis à chaque enregistrement venu d'ailleurs tant que le concepteur n'a rien de modifié
  useEffect(() => {
    if (tab.isNew) return;
    const prev = loaded.current;
    loaded.current = { name: tab.name, token: tab.reloadToken };
    if (!shouldReload(prev, tab.reloadToken, live.current.state.dirty)) return;
    let current = true;
    api.objects.get('form', tab.name).then((r) => {
      if (!current) return;
      const { doc, dropped, badSource } = parseFormDoc(r.definition);
      send({ type: 'load', doc: { ...doc, sections: doc.sections.slice(0, FORM_SECTIONS.length) }, objectKind: 'form' });
      setExtra(doc.sections.slice(FORM_SECTIONS.length));
      setNotice({ dropped, badSource });
      setLiveGen((g) => g + 1);
      setPhase('ready');
    }).catch((e) => {
      if (!current) return;
      if (e instanceof FormDefError) { setPhase({ error: t('dialog.error.corruptObject') }); return; }
      const m = errorMessage(e);
      setPhase({ error: t(m.key, m.params) });
    });
    return () => { current = false; };
  }, [tab.name, tab.isNew, tab.reloadToken, t]);

  // les tables et objets proposés par la feuille (source, sous-formulaire, contenu des listes)
  useEffect(() => {
    let current = true;
    Promise.all([api.tables.list(), api.objects.list()]).then(([ts, os]) => {
      if (!current) return;
      const of = (k: string) => os.filter((o) => o.kind === k).map((o) => o.name);
      setLists({ tables: ts.map((x) => x.name), queries: of('query'), forms: of('form'), reports: of('report') });
    }, () => { /* une base fermée entre-temps : la feuille propose des listes vides */ });
    return () => { current = false; };
  }, [tab.reloadToken]);

  // les champs de la source : feuille (Source contrôle) et Liste des champs ; une erreur s'affiche, le concepteur reste utilisable
  const source = state.doc.recordSource;
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    if (!source) { setFields([]); setSourceError(null); return; }
    let current = true;
    api.sources.describe(source).then((info) => { if (current) { setFields(info.fields); setSourceError(null); } }, (e) => {
      if (!current) return;
      const m = errorMessage(e);
      setFields([]);
      setSourceError(t('form.sourceError', { name: fromSourceRef(source), message: t(m.key, m.params) }));
    });
    return () => { current = false; };
  }, [sourceKey, tab.reloadToken, t]);   // `source` suit sourceKey (un nouvel objet à chaque chargement, la même source)

  // L2, mode Page : les premiers enregistrements de la source, lus une fois par source et par définition relue (ni Création ↔ Page
  // ni un enregistrement d'ici ne relisent : les paramètres ne sont demandés qu'une fois, comme en mode Formulaire) ; seul
  // l'enregistrement montré change, rien n'est écrit
  const layout = tab.mode === 'layout';
  const liveKey = `${liveGen}|${sourceKey}`;
  const [liveRows, setLiveRows] = useState<{ key: string; data: LiveData } | null>(null);
  const [row, setRow] = useState(0);
  useEffect(() => {
    if (!layout || region === null || phase !== 'ready' || liveRows?.key === liveKey) return;
    let current = true;
    void loadLive(source, (ps) => promptParameters(modal, ps, localeInfo(region))).then((data) => {
      if (current) { setLiveRows({ key: liveKey, data }); setRow(0); }
    });
    return () => { current = false; };
  }, [layout, liveKey, region, phase]);   // eslint-disable-line react-hooks/exhaustive-deps -- `source` suit liveKey
  useEffect(() => { if (layout) setTool({ kind: null, locked: false }); }, [layout]);   // l'outil choisi en Création ne passe pas au mode Page
  const liveData = liveRows?.key === liveKey ? liveRows.data : null;
  const view = viewHost(tab.mode, host, liveData, row, state.doc);

  // `tab.mode`: back from the form view (this design stays mounted behind it), whose unmount cleared the tab's flag (as a query)
  useEffect(() => { dispatch({ type: 'setDirty', id: tab.id, dirty: state.dirty }); }, [state.dirty, tab.id, tab.mode, dispatch]);
  useEffect(() => () => { void dispatch({ type: 'setDirty', id: tab.id, dirty: false }); }, [tab.id, dispatch]);   // les modifications partent avec la vue

  /** Un brouillon de la feuille se valide à la sortie du champ : il atteint le document avant l'enregistrement. */
  const flush = async () => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !root.current?.contains(el)) return;
    el.blur();
    await new Promise((r) => setTimeout(r));
  };
  const message = (messageKey: string) => modal.confirm({ titleKey: 'dialog.errorTitle', messageKey, buttons: ['ok'] });
  const askName = (initial: string) => modal.prompt({ titleKey: 'form.saveAsTitle', labelKey: 'form.nameLabel', initial,
    validate: (v) => { const k = nameErrorKey(v); return k && t(k); } });

  const save = async (): Promise<boolean> => {
    const { readOnly: ro, tab: doc, phase: ph } = live.current;
    if (ro || ph !== 'ready' || busy.current) return false;
    busy.current = true;
    try {
      await flush();
      let name = doc.isNew ? await askName(doc.name) : doc.name;
      for (;;) {
        if (name === null) return false;
        const { state: s, extra: more } = live.current;
        const def: DesignDoc = { ...s.doc, sections: [...s.doc.sections, ...more] };
        const r = await api.objects.save('form', name, def, doc.isNew ? null : doc.name);
        if (r.ok) {
          send({ type: 'saved' });
          setNotice({ dropped: 0, badSource: false });   // réécrit sans les contrôles illisibles
          loaded.current = { name, token: doc.reloadToken + 1 };   // objectSaved l'augmente : ce n'est pas une modification venue d'ailleurs
          dispatch(doc.isNew ? { type: 'objectSaved', kind: 'form', name, tabId: doc.id } : { type: 'objectSaved', kind: 'form', name });
          return true;
        }
        await message(`dialog.op.${r.reason}`);
        if (!doc.isNew || (r.reason !== 'nameExists' && r.reason !== 'nameInvalid')) return false;
        name = await askName(name);
      }
    } catch (e) {
      await showError(e);   // par exemple bc:invalidArgument au-delà de 8 Mo : le concepteur reste modifié
      return false;
    } finally {
      busy.current = false;
    }
  };

  const leave = (reason: 'mode' | 'close', target?: DocMode): Promise<boolean> => leaveFormDesign(reason, target, {
    mode: live.current.tab.mode, name: live.current.tab.name, busy: busy.current, flush, dirty: () => live.current.state.dirty || !!live.current.tab.isNew, confirm: modal.confirm, save,
    unsaved: (keep) => { // what the form view shows: the design as it stands (its extra sections too), unsaved
      const id = live.current.tab.id;
      if (!keep) { unsavedRunDoc.delete(id); return; }
      const { state: s, extra: more } = live.current;
      unsavedRunDoc.set(id, { ...s.doc, sections: [...s.doc.sections, ...more] });
    },
  });

  /** Sans `scope` : l'ordre de chaque section ; avec : celui d'une page d'un contrôle à onglets. Une seule étape d'annulation. */
  const tabOrder = async (scope?: { control: string; page: number }) => {
    const { state: s, readOnly: ro } = live.current;
    const groups = scope
      ? pageGroup(s.doc, scope.control, scope.page, t('form.tabOrder.pageLabel', { control: scope.control, page: String((findControl(s.doc, scope.control)?.control.props.Pages as unknown[] | undefined)?.[scope.page] || scope.page + 1) }))
      : sectionGroups(s.doc, host.sectionLabel);
    const orders = await modal.custom<string[][]>((close) => <TabOrderDialog groups={groups} readOnly={ro} close={close} />,
      { titleKey: 'ribbon.cmd.tabOrder' });
    if (!orders || live.current.readOnly) return;
    if (scope) { send({ type: 'edit', apply: (d) => withPageTabOrder(d, scope.control, scope.page, orders[0]) }); return; }
    send({ type: 'edit', apply: (d) => {
      const sections = d.sections.map((x, i) => (orders[i] ? withTabOrder(x, orders[i]) : x));
      return sections.every((x, i) => x === d.sections[i]) ? d : { ...d, sections };
    } });
  };

  /** Logo, Titre, Date et heure : dans l'en-tête de formulaire, affiché s'il était masqué (une seule annulation). */
  const addHeaderItem = (item: 'logo' | 'title' | 'dateTime', picture?: string) => {
    const { readOnly: ro, tab: doc, labels: l } = live.current;
    if (!ro) send({ type: 'edit', apply: (d) => headerItem(d, item, { title: doc.name, picture, labels: l }) });
  };
  const readLogo = (f: File | undefined) => {
    if (!f) return;
    if (f.size > PICTURE_MAX) { void message('sheet.error.pictureTooLarge'); return; }
    const r = new FileReader();
    r.onload = () => addHeaderItem('logo', String(r.result));
    r.readAsDataURL(f);
  };

  const cmds = useRef({ save, leave, tabOrder, addHeaderItem });
  cmds.current = { save, leave, tabOrder, addHeaderItem };
  const selected = selectedCount(state);
  const layoutKind = layoutKey(state);
  // the form view runs in front (DocumentView keeps this design behind it): this design registers no command, only its close guard
  // (closing the tab there asks to save the design, as a query does). A tab merely in the
  // background still registers, its close guard above all (else a modified form closed from another tab is lost unasked)
  const behind = !editsDesign(tab.mode);
  // la galerie des thèmes retrouve ce concepteur (même derrière la vue Formulaire) pour lui retirer son thème propre
  useEffect(() => registerOpenDesign({ kind: 'form', name: tab.name, clearTheme: () => {
    if (live.current.state.doc.props.Theme !== undefined) send({ type: 'edit', apply: (d) => setDocProp(d, 'Theme', undefined) });
  } }), [tab.name]);
  useEffect(() => {
    if (behind) return registerModeGuard(tab.id, (reason, target) => (reason === 'close' ? cmds.current.leave(reason, target) : true));
    const off = registerCommands(tab.id, {
      ...designerCommands(send, setMenu, selected),
      ...formatCommands(() => live.current.state, send, setFormatMenu, selected),
      themes: () => setThemesOpen(true),
      ...layoutCommands(() => live.current.state, send, { shown: headerFooterShown, toggle: toggleHeaderFooter }, setLayoutMenu),
      ...clipboardCommands(() => live.current.state, send, () => clipContext(live.current.host, t)),
      // la galerie Contrôles : le même outil que la boîte à outils (le prochain clic dans une section pose le contrôle)
      ...Object.fromEntries(Object.entries(GALLERY_TOOLS).map(([id, kind]) => [id, () => setTool({ kind: kind ?? null, locked: false })])),
      logo: () => logoFile.current?.click(),
      title: () => cmds.current.addHeaderItem('title'),
      dateTime: () => cmds.current.addHeaderItem('dateTime'),
      save: async () => { await cmds.current.save(); },
      addExistingFields: () => setFieldList((v) => !v),
      propertySheet: () => setSheetVisible((v) => !v),
      tabOrder: () => cmds.current.tabOrder(),
      viewCode: () => { const { state: s } = live.current; viewCode(firstPythonCall(s.doc, s.selection), (name, line) => { void dispatch({ type: 'open', kind: 'module', name, mode: 'design', args: { line } }); }, () => { runCommand('createModule'); }).catch(showError); },
    });
    const offGuard = registerModeGuard(tab.id, (reason, target) => cmds.current.leave(reason, target));
    return () => { off(); offGuard(); };
  }, [tab.id, behind, selected, layoutKind]);
  // Coller grisé tant qu'aucun presse-papiers (contrôles qu'un formulaire reçoit, objets du volet) n'a rien à coller
  const pasteable = useSyncExternalStore(subscribeClip, () => pasteEnabled(host.tools.map((x) => x.kind)));
  // L2 : mode Page éteint quand AllowLayoutView vaut false (la valeur en cours de modification compte)
  const layoutOk = allowsLayout(state.doc);
  useEffect(() => (behind ? undefined : registerCommandStates(tab.id, { paste: { enabled: pasteable }, viewLayout: { enabled: layoutOk } })), [tab.id, behind, pasteable, layoutOk]);

  // F5 (Access, C7) : du mode Création au mode Formulaire, tant que cet onglet est actif
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F5' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      runCommand('viewForm');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  // Suppr, Ctrl+Z / Ctrl+Y (Access) : annuler, rétablir dans le document où que soit le focus dans la vue ou sur le ruban (la surface
  // les traite elle-même) ; jamais dans une zone de saisie, qui garde sa propre annulation
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const del = e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;   // Suppr après un bouton du ruban (Sélectionner la ligne…) : le focus n'est pas sur la surface
      if (e.defaultPrevented || (!del && (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || (k !== 'z' && k !== 'y')))) return;
      const el = e.target as HTMLElement;
      if (live.current.readOnly || document.querySelector('[aria-modal="true"]') || el.isContentEditable || el instanceof HTMLTextAreaElement
        || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'color', 'file', 'range'].includes(el.type))) return;
      if (el !== document.body && !root.current?.contains(el) && !el.closest('.ribbon')) return;
      if (del && !deleteKeyAllowed(el)) return;   // Suppr depuis un select, une case, un onglet… : pas de suppression de la sélection
      e.preventDefault();
      send({ type: del ? 'deleteSelection' : k === 'z' ? 'undo' : 'redo' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  // un champ de la Liste des champs : au point de dépôt, ou sous le dernier contrôle du Détail
  const onAdd = useCallback((f: SourceField, at?: { section: number; left: number; top: number }) => {
    const { state: s, readOnly: ro, labels: l } = live.current;
    if (ro) return;
    const detail = s.doc.sections.findIndex((x) => x.kind === 'detail');
    const where = at ?? { section: detail, left: FIELD_LEFT, top: nextFreeTop(s.doc.sections[detail]) };
    // déposé (at) : le point de dépôt peut le faire entrer dans une disposition ; ajouté au clavier ou par double-clic, jamais
    send({ type: 'insert', section: where.section, controls: fieldControls(s.doc, f, where, l), ...(at ? { at: { x: at.left, y: at.top } } : {}) });
  }, []);
  /** Link fields proposed when a subform gets its Source Object and has none yet: from a relation between the two forms' sources,
   *  else the master's primary key (links.ts); one more edit per list, undone like any other, announced in the banner. */
  const proposeFor = async (names: string[], object: string) => {
    const master = live.current.state.doc.recordSource;
    if (!master) return;
    try {
      const childDoc = parseFormDoc((await api.objects.get('form', object)).definition).doc;
      const child = childDoc.recordSource;
      if (!child) return;
      const [mi, ci, rels] = await Promise.all([api.sources.describe(master), api.sources.describe(child), api.relations.list()]);
      const links = proposeLinks(mi, master, ci, child, rels);
      if (!links) return;
      for (const name of names) {
        const { state: s, readOnly: ro } = live.current;
        const c = findControl(s.doc, name)?.control;
        if (ro || !c || c.kind !== 'subform' || c.props.SourceObject !== object || c.props.LinkMasterFields || c.props.LinkChildFields) continue;
        const targets = [{ kind: 'control' as const, name }];
        send({ type: 'setProp', targets, name: 'LinkMasterFields', value: links.master.join(';') });
        send({ type: 'setProp', targets, name: 'LinkChildFields', value: links.child.join(';') });
        setLinked(t('form.subform.linked', { master: links.master.join(';'), child: links.child.join(';') }));
      }
    } catch { /* an unreadable form or source: nothing proposed, the links stay to be typed */ }
  };
  const proposing = useRef(proposeFor);
  proposing.current = proposeFor;
  /** The designer's dispatch, with the links proposed after a subform's Source Object is set. */
  const dispatchDesign = useCallback((a: DesignerAction) => {
    send(a);
    if (a.type.startsWith('select') || a.type === 'toggleSelect') setLinked(null);   // announced while its subform is selected
    if (a.type !== 'setProp' || a.name !== 'SourceObject' || typeof a.value !== 'string' || !a.value) return;
    const names = a.targets.flatMap((x) => (x.kind === 'control' ? [x.name] : []));
    if (names.length) void proposing.current(names, a.value);
  }, []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeFormatMenu = useCallback(() => setFormatMenu(null), []);
  const closeThemes = useCallback(() => setThemesOpen(false), []);
  const closeLayoutMenu = useCallback(() => setLayoutMenu(null), []);
  const closeSheet = useCallback(() => setSheetVisible(false), []);

  if (typeof phase === 'object') return <div className="doc-empty muted" role="alert" data-testid="form-load-error">{phase.error}</div>;
  if (phase === 'loading' || region === null) return <div className="form-design" ref={root} />;
  return (
    <DocThemeProvider docProps={state.doc.props} mode={appMode}>
    <div className="form-design" ref={root} data-testid="form-design">
      {notice.dropped > 0 && <div className="fz-banner" role="status" data-testid="form-dropped">{t('form.dropped', { count: notice.dropped })}</div>}
      {notice.badSource && <div className="fz-banner" role="status" data-testid="form-bad-source">{t('form.badSource')}</div>}
      {sourceError && <div className="fz-banner" role="status" data-testid="form-source-error">{sourceError}</div>}
      {linked && <div className="fz-banner" role="status" data-testid="form-subform-linked">{linked}</div>}
      {layout && liveData?.notice && !(liveData.notice === 'unreadable' && sourceError) && <div className="fz-banner" role="status" data-testid="layout-notice">{t(`layoutView.notice.${liveData.notice}`)}</div>}
      <Designer state={state} dispatch={dispatchDesign} host={view.host} readOnly={readOnly} tool={tool} onTool={setTool} sheetVisible={sheetVisible} onSheetClose={closeSheet}
        side={fieldList && <FieldList fields={fields} readOnly={readOnly} onAdd={onAdd} />} restrict={view.restrict} />
      {layout && <LayoutRecordBar row={row} count={liveData?.rows.length ?? 0} onGo={setRow} />}
      {menu && <ArrangePopup menu={menu} state={state} dispatch={send} onClose={closeMenu} readOnly={readOnly} />}
      {layoutMenu && <LayoutPopupMenu key={layoutMenu} id={layoutMenu} state={state} dispatch={send} onClose={closeLayoutMenu} readOnly={readOnly} />}
      {formatMenu && <FormatPopup id={formatMenu} state={state} dispatch={send} docKind="form" sectionLabel={host.sectionLabel} onClose={closeFormatMenu} readOnly={readOnly} />}
      {themesOpen && <ThemeGallery kind="form" dispatch={send} appDispatch={dispatch} onClose={closeThemes} readOnly={readOnly} />}
      <input ref={logoFile} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" data-testid="form-logo-file"
        onChange={(e) => { readLogo(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
    </DocThemeProvider>
  );
}
