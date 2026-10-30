// Formulaire en mode Création : le concepteur générique avec l'hôte des formulaires, la Feuille de propriétés, la Liste des champs,
// l'ordre de tabulation ; chargement et enregistrement par api.objects (genre 'form').
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { DesignDoc, SectionDef } from '../../shared/design/model';
import type { DisplayContext } from '../../shared/expr/localize';
import { localeInfo } from '../../shared/locale-format';
import type { SourceField } from '../../shared/record-source';
import { api } from '../bridge';
import { ArrangePopup, Designer, FormatPopup, type ToolState } from '../designer/Designer';
import { clipboardCommands, clipContext, pasteEnabled, subscribeClip } from '../designer/designer-clipboard';
import { designerCommands, selectedCount, type ArrangeMenu } from '../designer/designer-commands';
import { designerReducer, findControl, initDesigner, type DesignerAction } from '../designer/designer-model';
import { FieldList } from '../designer/FieldList';
import { formatCommands, type FormatPopupId } from '../designer/format-commands';
import { fromSourceRef } from '../designer/property-sheet-model';
import type { PropertySheetContext } from '../designer/sheet-types';
import type { DocViewProps } from '../shell/DocumentTabs';
import { errorMessage, useErrorDialog, useModal } from '../shell/Modal';
import { nameErrorKey } from '../shell/nav-menu-items';
import { registerCommandStates, registerCommands, registerModeGuard, runCommand } from '../shell/ribbon-model';
import { emptyFormDoc, fieldControls, FORM_SECTIONS, FormDefError, nextFreeTop, parseFormDoc, shouldReload, withTabOrder } from './form-def';
import { useFormHost } from './form-host';
import { proposeLinks } from './links';
import { GALLERY_TOOLS, headerItem } from './form-ribbon';
import './form-nav-menu';
import { TabOrderDialog } from './TabOrderDialog';
import { firstRun } from './views';
import './form.css';

const FIELD_LEFT = 1701;   // 3 cm : un champ ajouté sans point de dépôt, son étiquette à gauche
interface Lists { tables: string[]; queries: string[]; forms: string[]; reports: string[] }
const NO_LISTS: Lists = { tables: [], queries: [], forms: [], reports: [] };
const PICTURE_MAX = 1024 * 1024;   // comme la Feuille de propriétés

/** Formulaire vierge (Créer › Formulaire vierge) : le nouvel onglet de ce nom provisoire s'ouvre avec la Liste des champs (lu une fois). */
let fieldListFor: string | null = null;
export function requestFieldList(name: string): void { fieldListFor = name; }

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
  const root = useRef<HTMLDivElement>(null);
  const logoFile = useRef<HTMLInputElement>(null);
  const loaded = useRef<{ name: string; token: number } | null>(null);
  const busy = useRef(false);

  useEffect(() => { if (fieldListFor === tab.name) fieldListFor = null; }, [tab.name]);
  useEffect(() => { void api.app.getSettings().then((s) => setRegion(s.region), () => setRegion('en-US')); }, []);
  const lang = i18n.language.startsWith('fr') ? 'fr' : 'en';
  const display = useMemo<DisplayContext>(() => ({ lang, region: localeInfo(region ?? 'en-US') }), [lang, region]);
  const fieldNames = useMemo(() => fields.map((f) => f.name), [fields]);
  const sheet = useMemo<PropertySheetContext>(() => ({ display, fields: fieldNames, tables: lists.tables, queries: lists.queries,
    objects: (k) => (k === 'form' ? lists.forms : lists.reports), owner: { tabId: tab.id, name: tab.name, doc: () => live.current.state.doc } }),
    [display, fieldNames, lists, tab.id, tab.name]);
  const { host, labels } = useFormHost(sheet);

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

  useEffect(() => { dispatch({ type: 'setDirty', id: tab.id, dirty: state.dirty }); }, [state.dirty, tab.id, dispatch]);
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

  /** Avant que la vue parte : vers le mode Formulaire, Oui enregistre et Non reste ; à la fermeture, Non abandonne les modifications. */
  const leave = async (reason: 'mode' | 'close'): Promise<boolean> => {
    if (busy.current) return false;
    await flush();
    const { state: s, tab: doc } = live.current;
    if (!s.dirty) return true;
    if (reason === 'mode') {
      const r = await modal.confirm({ titleKey: 'form.saveFirstTitle', messageKey: 'form.mustSaveFirst', params: { name: doc.name }, buttons: ['yes', 'no'] });
      return r === 'yes' && (await save());
    }
    const r = await modal.confirm({ titleKey: 'form.saveFirstTitle', messageKey: 'form.saveFirst', params: { name: doc.name }, buttons: ['yes', 'no', 'cancel'] });
    return r === 'no' || (r === 'yes' && (await save()));
  };

  const tabOrder = async () => {
    const { state: s, readOnly: ro } = live.current;
    const orders = await modal.custom<string[][]>((close) => <TabOrderDialog doc={s.doc} sectionLabel={host.sectionLabel} readOnly={ro} close={close} />,
      { titleKey: 'ribbon.cmd.tabOrder' });
    if (!orders || live.current.readOnly) return;
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
  useEffect(() => {
    const off = registerCommands(tab.id, {
      ...designerCommands(send, setMenu, selected),
      ...formatCommands(() => live.current.state, send, setFormatMenu, selected),
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
    });
    const offGuard = registerModeGuard(tab.id, (reason) => cmds.current.leave(reason));
    return () => { off(); offGuard(); };
  }, [tab.id, selected]);
  // Coller grisé tant qu'aucun presse-papiers (contrôles qu'un formulaire reçoit, objets du volet) n'a rien à coller
  const pasteable = useSyncExternalStore(subscribeClip, () => pasteEnabled(host.tools.map((x) => x.kind)));
  useEffect(() => registerCommandStates(tab.id, { paste: { enabled: pasteable } }), [tab.id, pasteable]);

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

  // Ctrl+Z / Ctrl+Y (Access) : annuler, rétablir dans le document où que soit le focus dans la vue ou sur le ruban (la surface
  // les traite elle-même) ; jamais dans une zone de saisie, qui garde sa propre annulation
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.defaultPrevented || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || (k !== 'z' && k !== 'y')) return;
      const el = e.target as HTMLElement;
      if (live.current.readOnly || document.querySelector('[aria-modal="true"]') || el.isContentEditable || el instanceof HTMLTextAreaElement
        || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'color', 'file', 'range'].includes(el.type))) return;
      if (el !== document.body && !root.current?.contains(el) && !el.closest('.ribbon')) return;
      e.preventDefault();
      send({ type: k === 'z' ? 'undo' : 'redo' });
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
    send({ type: 'insert', section: where.section, controls: fieldControls(s.doc, f, where, l) });
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
  const closeSheet = useCallback(() => setSheetVisible(false), []);

  if (typeof phase === 'object') return <div className="doc-empty muted" role="alert" data-testid="form-load-error">{phase.error}</div>;
  if (phase === 'loading' || region === null) return <div className="form-design" ref={root} />;
  return (
    <div className="form-design" ref={root} data-testid="form-design">
      {notice.dropped > 0 && <div className="fz-banner" role="status" data-testid="form-dropped">{t('form.dropped', { count: notice.dropped })}</div>}
      {notice.badSource && <div className="fz-banner" role="status" data-testid="form-bad-source">{t('form.badSource')}</div>}
      {sourceError && <div className="fz-banner" role="status" data-testid="form-source-error">{sourceError}</div>}
      {linked && <div className="fz-banner" role="status" data-testid="form-subform-linked">{linked}</div>}
      <Designer state={state} dispatch={dispatchDesign} host={host} readOnly={readOnly} tool={tool} onTool={setTool} sheetVisible={sheetVisible} onSheetClose={closeSheet}
        side={fieldList && <FieldList fields={fields} readOnly={readOnly} onAdd={onAdd} />} />
      {menu && <ArrangePopup menu={menu} state={state} dispatch={send} onClose={closeMenu} readOnly={readOnly} />}
      {formatMenu && <FormatPopup id={formatMenu} state={state} dispatch={send} docKind="form" sectionLabel={host.sectionLabel} onClose={closeFormatMenu} readOnly={readOnly} />}
      <input ref={logoFile} type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp" data-testid="form-logo-file"
        onChange={(e) => { readLogo(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}
